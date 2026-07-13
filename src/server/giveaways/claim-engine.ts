import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { canonicalizeJson } from "./audit";

const CLAIM_TOKEN_PREFIX = "tbk_gc1_";
const CLAIM_QR_PREFIX = "TAMBIKE:GIVEAWAY-CLAIM:v1:";
const CLAIM_TOKEN_BYTES = 32;
const DELIVERY_IV_BYTES = 12;
const DELIVERY_AUTH_TAG_BYTES = 16;
const AES_256_GCM = "aes-256-gcm";
const CLAIM_HASH_DOMAIN = "tambike:giveaway-claim:v1\u0000";
const DELIVERY_AAD_SCOPE = "tambike:giveaway-delivery:v1";
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type GiveawayDeliveryEncryptionContext = {
  awardId: string;
  payloadVersion: string;
  /** Persisted AAD format version; changing it must make old ciphertext unreadable. */
  aadVersion: string;
  encryptionKeyVersion: string;
};

export type EncryptedGiveawayDeliveryPayload = {
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

/** Generates the only raw form of a rider claim secret. Persist its hash, never this value. */
export function createGiveawayClaimToken() {
  return `${CLAIM_TOKEN_PREFIX}${randomBytes(CLAIM_TOKEN_BYTES).toString("base64url")}`;
}

/**
 * Claim hashes are deliberately domain-separated from session, pass, campaign-code,
 * and generic token hashes. The raw token is not accepted by persistence helpers.
 */
export function hashGiveawayClaimToken(token: string) {
  assertGiveawayClaimToken(token);
  return createHash("sha256").update(CLAIM_HASH_DOMAIN).update(token).digest("base64url");
}

export function toGiveawayClaimQrPayload(token: string) {
  assertGiveawayClaimToken(token);
  return `${CLAIM_QR_PREFIX}${token}`;
}

/** Rejects URLs, bare tokens, pass/perk payloads, whitespace, and noncanonical encodings. */
export function parseGiveawayClaimQrPayload(payload: string) {
  if (typeof payload !== "string" || !payload.startsWith(CLAIM_QR_PREFIX)) {
    throw new Error("INVALID_GIVEAWAY_CLAIM_QR");
  }
  const token = payload.slice(CLAIM_QR_PREFIX.length);
  try {
    assertGiveawayClaimToken(token);
  } catch {
    throw new Error("INVALID_GIVEAWAY_CLAIM_QR");
  }
  // Exact concatenation makes any hidden suffix/prefix or normalization fail.
  if (`${CLAIM_QR_PREFIX}${token}` !== payload) throw new Error("INVALID_GIVEAWAY_CLAIM_QR");
  return token;
}

export function encryptGiveawayDeliveryPayload(
  payload: Record<string, unknown>,
  context: GiveawayDeliveryEncryptionContext,
  base64Key: string,
): EncryptedGiveawayDeliveryPayload {
  assertPlainRecord(payload, "INVALID_GIVEAWAY_DELIVERY_PAYLOAD");
  const key = decodeDeliveryEncryptionKey(base64Key);
  const iv = randomBytes(DELIVERY_IV_BYTES);
  const cipher = createCipheriv(AES_256_GCM, key, iv);
  cipher.setAAD(createDeliveryAad(context));
  const ciphertext = Buffer.concat([
    cipher.update(canonicalizeJson(payload), "utf8"),
    cipher.final(),
  ]);

  return {
    algorithm: AES_256_GCM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptGiveawayDeliveryPayload(
  encryptedPayload: unknown,
  context: GiveawayDeliveryEncryptionContext,
  base64Key: string,
): Record<string, unknown> {
  const key = decodeDeliveryEncryptionKey(base64Key);
  const encrypted = parseEncryptedDeliveryPayload(encryptedPayload);
  try {
    const decipher = createDecipheriv(AES_256_GCM, key, encrypted.iv);
    decipher.setAAD(createDeliveryAad(context));
    decipher.setAuthTag(encrypted.authTag);
    const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString(
      "utf8",
    );
    const parsed: unknown = JSON.parse(plaintext);
    assertPlainRecord(parsed, "INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
    // Retain a single canonical serialization so integrity and audit boundaries never
    // depend on JavaScript key insertion order.
    if (canonicalizeJson(parsed) !== plaintext) {
      throw new Error("INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT") {
      throw error;
    }
    throw new Error("INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
  }
}

function assertGiveawayClaimToken(value: string) {
  if (typeof value !== "string" || !value.startsWith(CLAIM_TOKEN_PREFIX)) {
    throw new Error("INVALID_GIVEAWAY_CLAIM_TOKEN");
  }
  const encoded = value.slice(CLAIM_TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error("INVALID_GIVEAWAY_CLAIM_TOKEN");
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length !== CLAIM_TOKEN_BYTES || decoded.toString("base64url") !== encoded) {
    throw new Error("INVALID_GIVEAWAY_CLAIM_TOKEN");
  }
}

function decodeDeliveryEncryptionKey(value: string) {
  const key = decodeCanonicalBase64(value, "INVALID_GIVEAWAY_DELIVERY_ENCRYPTION_KEY");
  if (key.length !== 32) throw new Error("INVALID_GIVEAWAY_DELIVERY_ENCRYPTION_KEY");
  return key;
}

function createDeliveryAad(context: GiveawayDeliveryEncryptionContext) {
  for (const value of [
    context.awardId,
    context.payloadVersion,
    context.aadVersion,
    context.encryptionKeyVersion,
  ]) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("INVALID_GIVEAWAY_DELIVERY_CONTEXT");
    }
  }
  return Buffer.from(
    canonicalizeJson({
      scope: DELIVERY_AAD_SCOPE,
      awardId: context.awardId,
      payloadVersion: context.payloadVersion,
      aadVersion: context.aadVersion,
      encryptionKeyVersion: context.encryptionKeyVersion,
    }),
    "utf8",
  );
}

function parseEncryptedDeliveryPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
  }
  const record = payload as Record<string, unknown>;
  if (
    record.algorithm !== AES_256_GCM ||
    typeof record.iv !== "string" ||
    typeof record.authTag !== "string" ||
    typeof record.ciphertext !== "string"
  ) {
    throw new Error("INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
  }
  const iv = decodeCanonicalBase64(record.iv, "INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
  const authTag = decodeCanonicalBase64(record.authTag, "INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
  const ciphertext = decodeCanonicalBase64(
    record.ciphertext,
    "INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT",
  );
  if (iv.length !== DELIVERY_IV_BYTES || authTag.length !== DELIVERY_AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error("INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
  }
  return { iv, authTag, ciphertext };
}

function decodeCanonicalBase64(value: string, code: string) {
  if (!canonicalBase64Pattern.test(value)) throw new Error(code);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(code);
  return decoded;
}

function assertPlainRecord(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(code);
  }
}
