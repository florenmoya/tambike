import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import * as giveawayValidation from "../../src/features/giveaways/validation";

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
  parseUpdateGiveawayInput,
  updateGiveawaySchema,
} from "../../src/features/giveaways/validation";

const drawSeed = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const encryptionKey = Buffer.alloc(32, 9).toString("base64");

function validateGiveawayUpdateInput(input: unknown) {
  const validator = Reflect.get(giveawayValidation, "validateGiveawayUpdateInput");
  if (typeof validator === "function") return validator(input);
  return parseUpdateGiveawayInput(input);
}

function createValidGiveawayInput() {
  return {
    eventId: "event-1",
    title: "Ride Day Raffle",
    kind: "raffle",
    entryMode: "automatic",
    maxEntriesPerRider: 10_000,
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
        publicPresentation: { disclosure: "revealed", title: "Tambike helmet" },
      },
    ],
  };
}

function createGiveawayInputWithPrizePool(prizePool: Record<string, unknown>) {
  return {
    ...createValidGiveawayInput(),
    prizePools: [prizePool],
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
  test("requires maxEntriesPerRider to be a bounded positive integer", () => {
    const input = createValidGiveawayInput();
    const inputWithoutEntryCap = { ...input } as Record<string, unknown>;
    delete inputWithoutEntryCap.maxEntriesPerRider;

    expect(
      createGiveawaySchema.safeParse({ ...input, maxEntriesPerRider: 10_000 }).success,
    ).toBe(true);
    expect(createGiveawaySchema.safeParse({ ...input, maxEntriesPerRider: 0 }).success).toBe(false);
    expect(createGiveawaySchema.safeParse({ ...input, maxEntriesPerRider: 10_001 }).success).toBe(
      false,
    );
    expect(createGiveawaySchema.safeParse(inputWithoutEntryCap).success).toBe(false);
  });

  test("rejects a finite guaranteed prize pool", () => {
    const input = createValidGiveawayInput();
    input.prizePools[0].awardMode = "guaranteed";

    expect(createGiveawaySchema.safeParse(input).success).toBe(false);
  });

  test("accepts guaranteed unlimited pools with no item rows", () => {
    const pool = {
      ...createValidGiveawayInput().prizePools[0],
      awardMode: "guaranteed",
      inventory: { kind: "unlimited" },
      items: [],
    };

    expect(createGiveawaySchema.safeParse(createGiveawayInputWithPrizePool(pool)).success).toBe(true);
  });

  test("requires a public title only when a prize is revealed", () => {
    const randomPool = createValidGiveawayInput().prizePools[0];
    const revealed = createGiveawayInputWithPrizePool({
      ...randomPool,
      publicPresentation: { disclosure: "revealed", title: "  " },
    });
    const surprise = createGiveawayInputWithPrizePool({
      ...randomPool,
      publicPresentation: { disclosure: "surprise" },
    });

    expect(createGiveawaySchema.safeParse(revealed).success).toBe(false);
    expect(createGiveawaySchema.safeParse(surprise).success).toBe(true);
  });

  test("rejects caller-supplied public prize image URLs", () => {
    const input = createGiveawayInputWithPrizePool({
      ...createValidGiveawayInput().prizePools[0],
      publicImage: {
        mediaId: "untrusted-media",
        url: "https://untrusted.example/prize.png",
        width: 1200,
        height: 800,
      },
    });

    expect(createGiveawaySchema.safeParse(input).success).toBe(false);
  });

  test("rejects duplicate prize-pool IDs before persistence", () => {
    const pool = createValidGiveawayInput().prizePools[0];
    const input = {
      ...createValidGiveawayInput(),
      prizePools: [
        pool,
        {
          ...pool,
          title: "Second logical pool",
          publicPresentation: {
            disclosure: "revealed",
            title: "Second public prize",
          },
        },
      ],
    };

    const result = createGiveawaySchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["prizePools"],
          message: "DUPLICATE_PRIZE_POOL_ID",
        }),
      );
    }
  });

  test.each(["random_draw", "first_come", "manual_selection"])(
    "accepts %s pools only when finite item rows match inventory quantity",
    (awardMode) => {
      const pool = {
        ...createValidGiveawayInput().prizePools[0],
        awardMode,
        inventory: { kind: "finite", quantity: 2 },
        items: [{ title: "First prize" }, { title: "Second prize" }],
      };

      expect(createGiveawaySchema.safeParse(createGiveawayInputWithPrizePool(pool)).success).toBe(true);
    },
  );

  test.each([
    ["a finite guaranteed pool", "guaranteed", { kind: "finite", quantity: 1 }, []],
    ["an item on an unlimited guaranteed pool", "guaranteed", { kind: "unlimited" }, [{ title: "Extra" }]],
    ["an unlimited random draw pool", "random_draw", { kind: "unlimited" }, []],
    ["an unlimited first-come pool", "first_come", { kind: "unlimited" }, []],
    ["an unlimited manual selection pool", "manual_selection", { kind: "unlimited" }, []],
    ["too few finite item rows", "random_draw", { kind: "finite", quantity: 2 }, [{ title: "Only one" }]],
    ["too many finite item rows", "first_come", { kind: "finite", quantity: 1 }, [{ title: "One" }, { title: "Two" }]],
    ["a non-positive finite quantity", "manual_selection", { kind: "finite", quantity: 0 }, []],
  ])("rejects %s", (_label, awardMode, inventory, items) => {
    const pool = {
      ...createValidGiveawayInput().prizePools[0],
      awardMode,
      inventory,
      items,
    };

    expect(createGiveawaySchema.safeParse(createGiveawayInputWithPrizePool(pool)).success).toBe(false);
  });

  test.each([
    ["an invalid IANA time zone", { timeZone: "Not/AZone" }],
    ["a backwards schedule", { entryOpensAt: "2026-07-13T10:00:00.000Z", entryClosesAt: "2026-07-13T09:00:00.000Z" }],
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
    expect(() => validateGiveawayUpdateInput({ id: "giveaway-1", title: "" })).toThrow();
    expect(validateGiveawayUpdateInput({ id: "giveaway-1", title: "Updated title" })).toEqual({
      id: "giveaway-1",
      title: "Updated title",
    });
  });

  test("exports the authoritative atomic giveaway update validator", () => {
    expect(Reflect.get(giveawayValidation, "validateGiveawayUpdateInput")).toBeTypeOf("function");
  });

  test("requires eligibility groups and prize pools as one update bundle", () => {
    const input = createValidGiveawayInput();
    const pool = input.prizePools[0];

    expect(() =>
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        eligibilityGroups: input.eligibilityGroups,
      }),
    ).toThrow("ELIGIBILITY_PRIZE_POOL_BUNDLE_REQUIRED");
    expect(() =>
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        prizePools: [pool],
      }),
    ).toThrow("ELIGIBILITY_PRIZE_POOL_BUNDLE_REQUIRED");
    expect(
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        eligibilityGroups: input.eligibilityGroups,
        prizePools: [pool],
      }),
    ).toMatchObject({ id: "giveaway-1" });
  });

  test("rejects undefined eligibility bundle members while allowing the whole bundle to be omitted", () => {
    const input = createValidGiveawayInput();
    const patch = {
      id: "giveaway-1",
      eligibilityGroups: undefined,
      prizePools: input.prizePools,
    };

    expect(updateGiveawaySchema.safeParse(patch).success).toBe(false);
    expect(() => validateGiveawayUpdateInput(patch)).toThrow(
      "ATOMIC_UPDATE_BUNDLE_MEMBER_UNDEFINED",
    );
    expect(validateGiveawayUpdateInput({ id: "giveaway-1", title: "No bundle update" })).toEqual({
      id: "giveaway-1",
      title: "No bundle update",
    });
  });

  test("validates prize-pool group references against the supplied complete bundle", () => {
    const input = createValidGiveawayInput();

    expect(() =>
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        eligibilityGroups: input.eligibilityGroups,
        prizePools: [
          {
            ...input.prizePools[0],
            eligibilityGroupIds: ["unknown-group"],
          },
        ],
      }),
    ).toThrow("UNKNOWN_ELIGIBILITY_GROUP");
  });

  test("requires every own schedule field before accepting an update bundle", () => {
    const timestamp = "2026-07-13T10:00:00.000Z";

    expect(() =>
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        entryOpensAt: timestamp,
      }),
    ).toThrow("SCHEDULE_BUNDLE_REQUIRED");
    expect(
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        entryOpensAt: timestamp,
        entryClosesAt: "2026-07-13T11:00:00.000Z",
        drawAt: null,
        claimDeadlineAt: null,
      }),
    ).toMatchObject({ id: "giveaway-1" });
  });

  test("rejects undefined schedule bundle members while allowing the whole bundle to be omitted", () => {
    const patch = {
      id: "giveaway-1",
      entryOpensAt: "2026-07-13T10:00:00.000Z",
      entryClosesAt: undefined,
      drawAt: undefined,
      claimDeadlineAt: undefined,
    };

    expect(updateGiveawaySchema.safeParse(patch).success).toBe(false);
    expect(() => validateGiveawayUpdateInput(patch)).toThrow(
      "ATOMIC_UPDATE_BUNDLE_MEMBER_UNDEFINED",
    );
    expect(validateGiveawayUpdateInput({ id: "giveaway-1", mechanics: "No schedule update" })).toEqual({
      id: "giveaway-1",
      mechanics: "No schedule update",
    });
  });

  test("rejects inherited schedule fields instead of treating them as an update bundle", () => {
    const inherited = Object.create({
      entryOpensAt: "2026-07-13T10:00:00.000Z",
      entryClosesAt: "2026-07-13T11:00:00.000Z",
      drawAt: null,
      claimDeadlineAt: null,
    }) as Record<string, unknown>;
    inherited.id = "giveaway-1";

    expect(() => validateGiveawayUpdateInput(inherited)).toThrow(
      "UPDATE_BUNDLE_FIELDS_MUST_BE_OWN_PROPERTIES",
    );
  });

  test("accepts null only for optional draw and claim dates and rejects equal present dates", () => {
    const timestamp = "2026-07-13T10:00:00.000Z";

    expect(() =>
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        entryOpensAt: null,
        entryClosesAt: "2026-07-13T11:00:00.000Z",
        drawAt: null,
        claimDeadlineAt: null,
      }),
    ).toThrow();
    expect(() =>
      validateGiveawayUpdateInput({
        id: "giveaway-1",
        entryOpensAt: timestamp,
        entryClosesAt: timestamp,
        drawAt: null,
        claimDeadlineAt: null,
      }),
    ).toThrow("SCHEDULE_ORDER_INVALID");
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

  test("rejects sparse arrays instead of silently collapsing missing audit values", () => {
    const sparse: unknown[] = [];
    sparse[1] = "present";

    expect(() => canonicalizeJson(sparse)).toThrow("INVALID_AUDIT_PAYLOAD");
  });

  test("rejects inherited numeric array properties instead of treating them as present", () => {
    const sparse: unknown[] = [];
    Object.setPrototypeOf(sparse, { 0: "inherited" });
    sparse.length = 1;

    expect(() => canonicalizeJson(sparse)).toThrow("INVALID_AUDIT_PAYLOAD");
  });
});

describe("giveaway DTO privacy", () => {
  test.each([
    "PublicGiveawayCampaignSummary",
    "RiderGiveawayState",
    "OperatorGiveawayClaimView",
  ])("keeps %s free of rider identity fields", (interfaceName) => {
    const typesSource = readFileSync(new URL("../../src/features/giveaways/types.ts", import.meta.url), "utf8");
    const interfaceBody = typesSource.match(
      new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`),
    )?.[1];
    expect(interfaceBody).toBeDefined();
    const fieldNames = Array.from(
      interfaceBody?.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\??:/gm) ?? [],
      ([, fieldName]) => fieldName,
    );

    for (const identityField of [
      "displayName",
      "riderDisplayName",
      "email",
      "phone",
      "firstName",
      "lastName",
      "fullName",
      "riderId",
      "userId",
    ]) {
      expect(fieldNames).not.toContain(identityField);
    }
    if (interfaceName === "OperatorGiveawayClaimView") {
      expect(fieldNames).toContain("claimReference");
    }
  });
});
