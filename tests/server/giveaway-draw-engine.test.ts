import { describe, expect, test } from "vitest";

import {
  buildPublicDrawVerification,
  createDrawSeedCommitment,
  decryptDrawSeed,
  encryptDrawSeed,
  generateDrawSeed,
  rankFrozenWeightedEntries,
} from "../../src/server/giveaways/draw-engine";
import {
  calculateGiveawayAuditHash,
  canonicalizeJson,
} from "../../src/server/giveaways/audit";
import {
  canTransitionGiveawayState,
  createGiveawaySchema,
  updateGiveawaySchema,
} from "../../src/features/giveaways/validation";

const drawSeed = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const encryptionKey = Buffer.alloc(32, 9).toString("base64");

function createValidGiveawayInput() {
  return {
    eventId: "event-1",
    title: "Ride Day Raffle",
    kind: "raffle",
    entryMode: "automatic",
    eligibilityGroups: [
      {
        id: "checked-in",
        label: "Confirmed arrivals",
        weight: 1,
        conditions: [{ source: "confirmed_check_in" }],
      },
    ],
    mechanics: "Confirmed riders receive one entry.",
    terms: "One prize per rider.",
    timeZone: "Asia/Manila",
    winnerLimits: {
      perRider: 1,
      total: 1,
    },
    organizerAttestation: true,
    prizePools: [
      {
        id: "helmet-pool",
        title: "Helmet raffle",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Tambike helmet" }],
      },
    ],
  };
}

describe("giveaway draw engine", () => {
  test("generates a 32-byte CSPRNG draw seed and commits the exact lowercase SHA-256 hash", () => {
    expect(generateDrawSeed()).toHaveLength(32);
    expect(createDrawSeedCommitment(drawSeed)).toBe(
      "3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9",
    );
  });

  test("ranks every weighted frozen entry deterministically in stable ascending order", () => {
    const input = {
      giveawayId: "giveaway-1",
      seed: drawSeed,
      entries: [
        { id: "entry-a", weight: 1 },
        { id: "entry-b", weight: 3 },
      ],
    };

    const first = rankFrozenWeightedEntries(input);
    const second = rankFrozenWeightedEntries(input);

    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
    expect(first.filter((unit) => unit.entryId === "entry-a")).toHaveLength(1);
    expect(first.filter((unit) => unit.entryId === "entry-b")).toHaveLength(3);
    expect(first.map((unit) => unit.rank)).toEqual(
      [...first.map((unit) => unit.rank)].sort(),
    );
  });

  test("round-trips an encrypted draw seed and rejects invalid encryption inputs", () => {
    const encrypted = encryptDrawSeed(drawSeed, encryptionKey);

    expect(encrypted.algorithm).toBe("aes-256-gcm");
    expect(decryptDrawSeed(encrypted, encryptionKey)).toEqual(drawSeed);
    expect(() => encryptDrawSeed(drawSeed, "not-a-base64-32-byte-key")).toThrow(
      "INVALID_DRAW_ENCRYPTION_KEY",
    );
    expect(() =>
      decryptDrawSeed(
        {
          algorithm: "aes-256-gcm",
          iv: "bad",
          authTag: "bad",
          ciphertext: "bad",
        },
        encryptionKey,
      ),
    ).toThrow("INVALID_DRAW_SEED_CIPHERTEXT");
  });

  test("keeps an unpublished verification payload secret", () => {
    const verification = buildPublicDrawVerification({
      giveawayId: "giveaway-1",
      published: false,
      seed: drawSeed,
      commitment: createDrawSeedCommitment(drawSeed),
      snapshotDigest: "snapshot-digest",
      snapshotCount: 12,
      algorithmVersion: "hmac-sha256-v1",
      drawDigest: "draw-digest",
    });

    expect(verification).not.toHaveProperty("seed");
    expect(verification).toEqual({
      giveawayId: "giveaway-1",
      commitment: createDrawSeedCommitment(drawSeed),
      snapshotDigest: "snapshot-digest",
      snapshotCount: 12,
      algorithmVersion: "hmac-sha256-v1",
      drawDigest: "draw-digest",
    });
  });

  test("reveals only the base64url seed and public verification fields after publication", () => {
    const verification = buildPublicDrawVerification({
      giveawayId: "giveaway-1",
      published: true,
      seed: drawSeed,
      commitment: createDrawSeedCommitment(drawSeed),
      snapshotDigest: "snapshot-digest",
      snapshotCount: 12,
      algorithmVersion: "hmac-sha256-v1",
      drawDigest: "draw-digest",
    });

    expect(verification).toEqual({
      giveawayId: "giveaway-1",
      commitment: createDrawSeedCommitment(drawSeed),
      snapshotDigest: "snapshot-digest",
      snapshotCount: 12,
      algorithmVersion: "hmac-sha256-v1",
      drawDigest: "draw-digest",
      seed: drawSeed.toString("base64url"),
    });
    expect(verification).not.toHaveProperty("entries");
    expect(verification).not.toHaveProperty("sourceFacts");
  });
});

describe("giveaway input validation", () => {
  test("rejects a finite guaranteed prize pool", () => {
    const input = createValidGiveawayInput();
    input.prizePools[0].awardMode = "guaranteed";

    expect(createGiveawaySchema.safeParse(input).success).toBe(false);
  });

  test.each([
    ["an invalid IANA time zone", { timeZone: "Not/AZone" }],
    ["a backwards schedule", { opensAt: "2026-07-13T10:00:00.000Z", closesAt: "2026-07-13T09:00:00.000Z" }],
    ["a missing organizer attestation", { organizerAttestation: false }],
    ["a group without conditions", { eligibilityGroups: [{ id: "empty", label: "Empty", weight: 1, conditions: [] }] }],
    ["a non-positive group weight", { eligibilityGroups: [{ id: "zero", label: "Zero", weight: 0, conditions: [{ source: "confirmed_check_in" }] }] }],
    ["a perk rule without a perk id", { eligibilityGroups: [{ id: "perk", label: "Perk", weight: 1, conditions: [{ source: "perk_redemption" }] }] }],
  ])("rejects %s", (_label, invalidFields) => {
    expect(
      createGiveawaySchema.safeParse({
        ...createValidGiveawayInput(),
        ...invalidFields,
      }).success,
    ).toBe(false);
  });

  test("validates update inputs with the same field constraints", () => {
    expect(updateGiveawaySchema.safeParse({ id: "giveaway-1", title: "" }).success).toBe(false);
    expect(updateGiveawaySchema.safeParse({ id: "giveaway-1", title: "Updated title" }).success).toBe(
      true,
    );
  });

  test("allows opening only after compliance approval and never allows post-award cancellation", () => {
    expect(canTransitionGiveawayState("scheduled", "open", "pending_review")).toBe(false);
    expect(canTransitionGiveawayState("scheduled", "open", "approved")).toBe(true);
    expect(canTransitionGiveawayState("claims_open", "cancelled", "approved")).toBe(false);
    expect(canTransitionGiveawayState("suspended", "draft", "approved")).toBe(false);
  });
});

describe("giveaway audit primitives", () => {
  test("emits canonical JSON without whitespace for nested arrays", () => {
    expect(canonicalizeJson({ z: [2, { b: true, a: 1 }], a: "first" })).toBe(
      '{"a":"first","z":[2,{"a":1,"b":true}]}',
    );
  });

  test("canonicalizes object-key order and produces the same chained hash", () => {
    const first = { actor: "organizer-1", action: "locked", metadata: { b: 2, a: 1 } };
    const second = { metadata: { a: 1, b: 2 }, action: "locked", actor: "organizer-1" };

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
    expect(calculateGiveawayAuditHash("previous-hash", first)).toBe(
      calculateGiveawayAuditHash("previous-hash", second),
    );
  });
});
