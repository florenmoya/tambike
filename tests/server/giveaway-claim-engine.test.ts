import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  createGiveawayClaimToken,
  decryptGiveawayDeliveryPayload,
  encryptGiveawayDeliveryPayload,
  hashGiveawayClaimToken,
  parseGiveawayClaimQrPayload,
  toGiveawayClaimQrPayload,
} from "../../src/server/giveaways/claim-engine";

const deliveryKey = Buffer.alloc(32, 42).toString("base64");

describe("giveaway claim token protocol", () => {
  test("generates a versioned CSPRNG claim token, hashes it in the giveaway domain, and accepts only the exact QR namespace", () => {
    const token = createGiveawayClaimToken();

    expect(token).toMatch(/^tbk_gc1_[A-Za-z0-9_-]{43}$/);
    expect(hashGiveawayClaimToken(token)).not.toBe(token);
    expect(hashGiveawayClaimToken(token)).not.toBe(
      createHash("sha256").update(token).digest("base64url"),
    );

    const payload = toGiveawayClaimQrPayload(token);
    expect(payload).toBe(`TAMBIKE:GIVEAWAY-CLAIM:v1:${token}`);
    expect(parseGiveawayClaimQrPayload(payload)).toBe(token);

    for (const malformed of [
      token,
      ` ${payload}`,
      `${payload} `,
      `https://tambike.example/check-in/${token}`,
      `TAMBIKE:PASS:v1:${token}`,
      `TAMBIKE:GIVEAWAY-CLAIM:v2:${token}`,
      "TAMBIKE:GIVEAWAY-CLAIM:v1:tbk_gc1_not-a-32-byte-token",
    ]) {
      expect(() => parseGiveawayClaimQrPayload(malformed)).toThrow("INVALID_GIVEAWAY_CLAIM_QR");
    }
  });
});

describe("giveaway delivery encryption", () => {
  test("uses canonical AES-256-GCM payloads bound by award and persisted key metadata", () => {
    const encrypted = encryptGiveawayDeliveryPayload(
      {
        recipientName: "Mina Rider",
        address: { line1: "42 Example Road", city: "Antipolo" },
        phone: "+639171234567",
      },
      {
        awardId: "award-1",
        payloadVersion: "delivery-v1",
        aadVersion: "aad-v1",
        encryptionKeyVersion: "delivery-key-2026-07",
      },
      deliveryKey,
    );

    expect(encrypted).toMatchObject({ algorithm: "aes-256-gcm" });
    expect(JSON.stringify(encrypted)).not.toContain("Mina Rider");
    expect(
      decryptGiveawayDeliveryPayload(
        encrypted,
        {
          awardId: "award-1",
          payloadVersion: "delivery-v1",
          aadVersion: "aad-v1",
          encryptionKeyVersion: "delivery-key-2026-07",
        },
        deliveryKey,
      ),
    ).toEqual({
      address: { city: "Antipolo", line1: "42 Example Road" },
      phone: "+639171234567",
      recipientName: "Mina Rider",
    });

    expect(() =>
      decryptGiveawayDeliveryPayload(
        encrypted,
        {
          awardId: "award-other",
          payloadVersion: "delivery-v1",
          aadVersion: "aad-v1",
          encryptionKeyVersion: "delivery-key-2026-07",
        },
        deliveryKey,
      ),
    ).toThrow("INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");

    expect(() =>
      decryptGiveawayDeliveryPayload(
        encrypted,
        {
          awardId: "award-1",
          payloadVersion: "delivery-v1",
          aadVersion: "aad-v2",
          encryptionKeyVersion: "delivery-key-2026-07",
        },
        deliveryKey,
      ),
    ).toThrow("INVALID_GIVEAWAY_DELIVERY_CIPHERTEXT");
  });
});
