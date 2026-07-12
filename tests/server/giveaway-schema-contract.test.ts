import * as generatedPrismaClient from "@prisma/client";
import { Prisma } from "@prisma/client";
import { describe, expect, test } from "vitest";

const requiredEnums = {
  GiveawayKind: ["raffle", "giveaway"],
  GiveawayStatus: [
    "draft",
    "scheduled",
    "open",
    "paused",
    "locked",
    "drawing",
    "claims_open",
    "completed",
    "cancelled",
    "suspended",
  ],
  GiveawayComplianceStatus: [
    "draft",
    "pending_review",
    "approved",
    "changes_requested",
    "rejected",
  ],
  GiveawayEntryMode: ["automatic", "opt_in", "claim_code", "manual_only"],
  GiveawayVisibility: ["event_page", "registered_riders", "eligible_riders", "hidden"],
  GiveawayEligibilitySource: [
    "active_rsvp_pass",
    "confirmed_check_in",
    "staff_confirmed_check_in",
    "perk_redemption",
    "campaign_code",
    "manual",
  ],
  GiveawayEntryStatus: ["eligible", "locked", "disqualified", "withdrawn"],
  GiveawayEntryEventType: [
    "automatic_qualified",
    "opted_in",
    "campaign_code_claimed",
    "manual_grant",
    "manual_revoke",
    "source_revalidated",
  ],
  GiveawayAwardMode: ["random_draw", "first_come", "guaranteed", "manual_selection"],
  GiveawayPrizeItemStatus: ["available", "reserved", "fulfilled", "voided"],
  GiveawayDrawType: ["initial", "redraw"],
  GiveawayDrawStatus: ["pending", "completed", "published", "voided"],
  GiveawayAwardStatus: [
    "pending_verification",
    "claimable",
    "verified",
    "fulfilled",
    "declined",
    "disqualified",
    "expired",
    "voided",
    "superseded",
  ],
  GiveawayClaimVerificationMethod: ["camera", "upload", "manual"],
  GiveawayClaimVerificationResult: ["verified", "rejected"],
  GiveawayFulfillmentType: ["onsite", "digital_code", "delivery", "manual_contact"],
  GiveawayFulfillmentStatus: ["pending", "fulfilled", "failed", "cancelled"],
} as const;

const requiredModels = [
  "EventGiveaway",
  "GiveawayMechanicsVersion",
  "GiveawayEligibilityGroup",
  "GiveawayEligibilityCondition",
  "GiveawayCampaignCode",
  "GiveawayEntry",
  "GiveawayEntryEvent",
  "GiveawaySnapshot",
  "GiveawaySnapshotEntry",
  "GiveawayPrizePool",
  "GiveawayPrizeItem",
  "GiveawayPrizePoolEligibilityGroup",
  "GiveawayDraw",
  "GiveawayAward",
  "GiveawayClaimVerification",
  "GiveawayFulfillment",
  "GiveawayDeliveryDetail",
  "GiveawayOperator",
  "GiveawayAuditEvent",
] as const;

describe("giveaway Prisma schema contract", () => {
  test("exposes every giveaway enum with its persisted lowercase values", () => {
    const generatedEnums = generatedPrismaClient as unknown as Record<
      string,
      Record<string, string> | undefined
    >;

    for (const [name, values] of Object.entries(requiredEnums)) {
      expect(Object.values(generatedEnums[name] ?? {})).toEqual(values);
    }
  });

  test("exposes the complete giveaway aggregate and event relation", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((entry) => [entry.name, entry]));

    for (const name of requiredModels) {
      expect(models.has(name)).toBe(true);
    }

    const event = models.get("Event");
    expect(event?.fields.find((field) => field.name === "giveaways")).toMatchObject({
      kind: "object",
      type: "EventGiveaway",
    });
  });
});
