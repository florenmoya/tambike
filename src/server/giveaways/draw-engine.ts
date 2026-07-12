import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import type { PublicGiveawayDrawVerification } from "../../features/giveaways/types";

const DRAW_SEED_BYTES = 32;
const DRAW_IV_BYTES = 12;
const DRAW_AUTH_TAG_BYTES = 16;
const AES_256_GCM = "aes-256-gcm";
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface EncryptedDrawSeed {
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface FrozenWeightedDrawEntry {
  id: string;
  weight: number;
}

export interface RankedDrawUnit {
  entryId: string;
  unitOrdinal: number;
  rank: string;
}

export interface BuildPublicDrawVerificationInput {
  giveawayId: string;
  published: boolean;
  seed?: Uint8Array;
  commitment: string;
  snapshotDigest: string;
  snapshotCount: number;
  algorithmVersion: string;
  drawDigest: string;
}

export function generateDrawSeed(): Buffer {
  return randomBytes(DRAW_SEED_BYTES);
}

export function createDrawSeedCommitment(seed: Uint8Array): string {
  assertDrawSeed(seed);
  return createHash("sha256").update(seed).digest("hex");
}

export function encryptDrawSeed(seed: Uint8Array, base64Key: string): EncryptedDrawSeed {
  assertDrawSeed(seed);
  const key = decodeDrawEncryptionKey(base64Key);
  const iv = randomBytes(DRAW_IV_BYTES);
  const cipher = createCipheriv(AES_256_GCM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);

  return {
    algorithm: AES_256_GCM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptDrawSeed(payload: unknown, base64Key: string): Buffer {
  const key = decodeDrawEncryptionKey(base64Key);
  const encrypted = parseEncryptedDrawSeed(payload);

  try {
    const decipher = createDecipheriv(AES_256_GCM, key, encrypted.iv);
    decipher.setAuthTag(encrypted.authTag);
    const seed = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
    assertDrawSeed(seed, "INVALID_DRAW_SEED_CIPHERTEXT");
    return seed;
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_DRAW_SEED_CIPHERTEXT") {
      throw error;
    }
    throw new Error("INVALID_DRAW_SEED_CIPHERTEXT");
  }
}

export function rankFrozenWeightedEntries({
  giveawayId,
  seed,
  entries,
}: {
  giveawayId: string;
  seed: Uint8Array;
  entries: readonly FrozenWeightedDrawEntry[];
}): RankedDrawUnit[] {
  if (!giveawayId.trim()) throw new Error("INVALID_GIVEAWAY_ID");
  assertDrawSeed(seed);

  const seenEntryIds = new Set<string>();
  const units: RankedDrawUnit[] = [];
  for (const entry of entries) {
    if (!entry.id.trim() || !Number.isInteger(entry.weight) || entry.weight <= 0) {
      throw new Error("INVALID_FROZEN_DRAW_ENTRY");
    }
    if (seenEntryIds.has(entry.id)) throw new Error("DUPLICATE_FROZEN_DRAW_ENTRY");
    seenEntryIds.add(entry.id);

    for (let unitOrdinal = 0; unitOrdinal < entry.weight; unitOrdinal += 1) {
      const rank = createHmac("sha256", seed)
        .update(`${giveawayId}\u0000${entry.id}\u0000${unitOrdinal}`)
        .digest("hex");
      units.push({ entryId: entry.id, unitOrdinal, rank });
    }
  }

  return units.sort(compareRankedDrawUnits);
}

export function buildPublicDrawVerification(
  input: BuildPublicDrawVerificationInput,
): PublicGiveawayDrawVerification {
  const publicFields = {
    giveawayId: input.giveawayId,
    commitment: input.commitment,
    snapshotDigest: input.snapshotDigest,
    snapshotCount: input.snapshotCount,
    algorithmVersion: input.algorithmVersion,
    drawDigest: input.drawDigest,
  };

  if (!input.published) return publicFields;
  if (!input.seed) throw new Error("DRAW_SEED_REQUIRED_FOR_PUBLISHED_VERIFICATION");
  assertDrawSeed(input.seed);
  if (createDrawSeedCommitment(input.seed) !== input.commitment) {
    throw new Error("DRAW_SEED_COMMITMENT_MISMATCH");
  }

  return {
    ...publicFields,
    seed: Buffer.from(input.seed).toString("base64url"),
  };
}

function decodeDrawEncryptionKey(base64Key: string): Buffer {
  const key = decodeCanonicalBase64(base64Key, "INVALID_DRAW_ENCRYPTION_KEY");
  if (key.length !== DRAW_SEED_BYTES) throw new Error("INVALID_DRAW_ENCRYPTION_KEY");
  return key;
}

function parseEncryptedDrawSeed(payload: unknown): {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
} {
  if (!payload || typeof payload !== "object") throw new Error("INVALID_DRAW_SEED_CIPHERTEXT");
  const candidate = payload as Record<string, unknown>;
  if (
    candidate.algorithm !== AES_256_GCM ||
    typeof candidate.iv !== "string" ||
    typeof candidate.authTag !== "string" ||
    typeof candidate.ciphertext !== "string"
  ) {
    throw new Error("INVALID_DRAW_SEED_CIPHERTEXT");
  }

  const iv = decodeCanonicalBase64(candidate.iv, "INVALID_DRAW_SEED_CIPHERTEXT");
  const authTag = decodeCanonicalBase64(candidate.authTag, "INVALID_DRAW_SEED_CIPHERTEXT");
  const ciphertext = decodeCanonicalBase64(candidate.ciphertext, "INVALID_DRAW_SEED_CIPHERTEXT");
  if (
    iv.length !== DRAW_IV_BYTES ||
    authTag.length !== DRAW_AUTH_TAG_BYTES ||
    ciphertext.length !== DRAW_SEED_BYTES
  ) {
    throw new Error("INVALID_DRAW_SEED_CIPHERTEXT");
  }

  return { iv, authTag, ciphertext };
}

function decodeCanonicalBase64(value: string, code: string): Buffer {
  if (!base64Pattern.test(value)) throw new Error(code);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(code);
  return decoded;
}

function assertDrawSeed(seed: Uint8Array, code = "INVALID_DRAW_SEED"): void {
  if (seed.byteLength !== DRAW_SEED_BYTES) throw new Error(code);
}

function compareRankedDrawUnits(left: RankedDrawUnit, right: RankedDrawUnit): number {
  if (left.rank < right.rank) return -1;
  if (left.rank > right.rank) return 1;
  if (left.entryId < right.entryId) return -1;
  if (left.entryId > right.entryId) return 1;
  return left.unitOrdinal - right.unitOrdinal;
}
