import { describe, expect, test } from "vitest";

import {
  calculateGiveawayEntryWeightDelta,
  compareGiveawayEntriesByPoolPriority,
  reconcileGiveawayEligibilityTimings,
  resolveGiveawayPoolEligibilityPriority,
} from "../../src/server/giveaways/eligibility-timing";

describe("giveaway eligibility timing", () => {
  test("preserves an active group timing and derives AND and OR priority canonically", () => {
    const result = reconcileGiveawayEligibilityTimings({
      previousTimings: [{ groupId: "rsvp", eligibleAt: "2026-08-01T09:00:00.000Z" }],
      qualifiedGroups: [
        { groupId: "check-in", position: 1, derivedEligibleAt: "2026-08-01T10:00:00.000Z" },
        { groupId: "rsvp", position: 2, derivedEligibleAt: "2026-08-01T11:00:00.000Z" },
      ],
    });

    expect(result).toEqual({
      qualifiedEligibilityGroupTimings: [
        { groupId: "check-in", eligibleAt: "2026-08-01T10:00:00.000Z" },
        { groupId: "rsvp", eligibleAt: "2026-08-01T09:00:00.000Z" },
      ],
      eligibilityCycleAt: "2026-08-01T09:00:00.000Z",
    });
    expect(
      resolveGiveawayPoolEligibilityPriority({
        eligibilityCycleAt: result.eligibilityCycleAt,
        qualifiedEligibilityGroupTimings: result.qualifiedEligibilityGroupTimings,
        permittedGroupIds: ["check-in"],
      }),
    ).toBe("2026-08-01T10:00:00.000Z");
  });

  test("gates explicit entries by their action time and resets a withdrawn eligibility cycle", () => {
    const actionGated = reconcileGiveawayEligibilityTimings({
      previousTimings: [],
      qualifiedGroups: [
        { groupId: "code", position: 0, derivedEligibleAt: "2026-08-01T09:00:00.000Z" },
      ],
      actionAt: "2026-08-01T12:00:00.000Z",
    });
    expect(actionGated.eligibilityCycleAt).toBe("2026-08-01T12:00:00.000Z");

    const withdrawn = reconcileGiveawayEligibilityTimings({
      previousTimings: actionGated.qualifiedEligibilityGroupTimings,
      qualifiedGroups: [],
    });
    expect(withdrawn).toEqual({
      qualifiedEligibilityGroupTimings: [],
      eligibilityCycleAt: null,
    });

    const requalified = reconcileGiveawayEligibilityTimings({
      previousTimings: withdrawn.qualifiedEligibilityGroupTimings,
      qualifiedGroups: [
        { groupId: "code", position: 0, derivedEligibleAt: "2026-08-01T14:00:00.000Z" },
      ],
    });
    expect(requalified.eligibilityCycleAt).toBe("2026-08-01T14:00:00.000Z");
  });

  test("orders finite first-come candidates by pool timing and then stable entry ID", () => {
    const candidates = [
      {
        id: "entry-z",
        eligibilityCycleAt: "2026-08-01T09:00:00.000Z",
        qualifiedEligibilityGroupTimings: [
          { groupId: "rsvp", eligibleAt: "2026-08-01T09:00:00.000Z" },
          { groupId: "check-in", eligibleAt: "2026-08-01T13:00:00.000Z" },
        ],
      },
      {
        id: "entry-a",
        eligibilityCycleAt: "2026-08-01T10:00:00.000Z",
        qualifiedEligibilityGroupTimings: [
          { groupId: "rsvp", eligibleAt: "2026-08-01T10:00:00.000Z" },
          { groupId: "check-in", eligibleAt: "2026-08-01T12:00:00.000Z" },
        ],
      },
      {
        id: "entry-b",
        eligibilityCycleAt: "2026-08-01T10:00:00.000Z",
        qualifiedEligibilityGroupTimings: [
          { groupId: "rsvp", eligibleAt: "2026-08-01T10:00:00.000Z" },
          { groupId: "check-in", eligibleAt: "2026-08-01T12:00:00.000Z" },
        ],
      },
    ];

    expect(
      [...candidates]
        .sort((left, right) =>
          compareGiveawayEntriesByPoolPriority(left, right, ["check-in"]),
        )
        .map((entry) => entry.id),
    ).toEqual(["entry-a", "entry-b", "entry-z"]);
  });

  test("restores the full ledger weight when a withdrawn entrant requalifies", () => {
    expect(
      calculateGiveawayEntryWeightDelta({ status: "withdrawn", currentWeight: 3 }, 3),
    ).toBe(3);
    expect(
      calculateGiveawayEntryWeightDelta({ status: "eligible", currentWeight: 3 }, 5),
    ).toBe(2);
  });
});
