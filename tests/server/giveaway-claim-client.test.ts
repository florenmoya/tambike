import { describe, expect, test } from "vitest";

import {
  getGiveawayClaimRoute,
  normalizeGiveawayClaimPayload,
} from "../../src/features/giveaways/giveaway-claim-client";

describe("giveaway claim client payload guard", () => {
  test("accepts the exact dedicated giveaway claim QR payload", () => {
    const payload = `TAMBIKE:GIVEAWAY-CLAIM:v1:tbk_gc1_${"a".repeat(43)}`;

    expect(normalizeGiveawayClaimPayload(`  ${payload}  `)).toBe(payload);
  });

  test.each([
    "tbk_gc1_" + "a".repeat(43),
    "TAMBIKE:PASS:v1:tbk_gc1_" + "a".repeat(43),
    "https://example.test/claim/tbk_gc1_" + "a".repeat(43),
    "TAMBIKE:GIVEAWAY-CLAIM:v1:tbk_gc1_" + "a".repeat(42),
    "TAMBIKE:GIVEAWAY-CLAIM:v1:tbk_gc1_" + "a".repeat(43) + "?copy=1",
  ])("rejects a non-claim or malformed payload: %s", (payload) => {
    expect(normalizeGiveawayClaimPayload(payload)).toBeNull();
  });
});

describe("giveaway claim route strip", () => {
  test("makes credential issuance the current factual step until a rider has one", () => {
    expect(getGiveawayClaimRoute("claimable", false)).toEqual([
      { label: "Awarded", state: "complete" },
      { label: "Credential", state: "current" },
      { label: "Verification", state: "upcoming" },
      { label: "Fulfilment", state: "upcoming" },
    ]);
  });

  test("moves the route to fulfilment only after staff verification", () => {
    expect(getGiveawayClaimRoute("verified", true)).toEqual([
      { label: "Awarded", state: "complete" },
      { label: "Credential", state: "complete" },
      { label: "Verification", state: "complete" },
      { label: "Fulfilment", state: "current" },
    ]);
  });
});
