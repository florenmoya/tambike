import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as generatedPrismaClient from "@prisma/client";
import { Prisma } from "@prisma/client";
import { describe, expect, test } from "vitest";

const giveawayMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260713000000_flexible_event_giveaways/migration.sql",
  ),
  "utf8",
);

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

  test("keeps finite prize item rows bounded by their pool inventory in the migration", () => {
    expect(giveawayMigrationSql).toContain('CREATE FUNCTION "validate_giveaway_prize_item_inventory"()');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawayPrizeItem_inventory_guard"');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawayPrizePool_inventory_guard"');
    expect(giveawayMigrationSql).toContain('"inventoryLimit"');
    expect(giveawayMigrationSql).toContain('"awardMode" = \'guaranteed\'');
    expect(giveawayMigrationSql).toContain('WHERE "id" = NEW."prizePoolId" FOR UPDATE');
  });

  test("freezes prize-pool award mode and inventory after any award history", () => {
    const awardInventoryFunction = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_giveaway_award_inventory"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawayAward_inventory_guard"'),
    );
    const poolInventoryFunction = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_giveaway_prize_pool_inventory"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawayPrizePool_inventory_guard"'),
    );

    expect(awardInventoryFunction).toContain('FOR UPDATE');
    expect(poolInventoryFunction).toContain('pool_award_count');
    expect(poolInventoryFunction).toContain('FROM "GiveawayAward"');
    expect(poolInventoryFunction).toContain('NEW."awardMode" IS DISTINCT FROM OLD."awardMode"');
    expect(poolInventoryFunction).toContain(
      'NEW."inventoryLimit" IS DISTINCT FROM OLD."inventoryLimit"',
    );
  });

  test("guards every required cross-campaign parentage link in the migration", () => {
    const guards = [
      ["validate_giveaway_draw_parentage", "GiveawayDraw_parentage_guard"],
      ["validate_giveaway_award_parentage", "GiveawayAward_parentage_guard"],
      [
        "validate_giveaway_prize_pool_eligibility_parentage",
        "GiveawayPrizePoolEligibilityGroup_parentage_guard",
      ],
      ["validate_giveaway_entry_event_parentage", "GiveawayEntryEvent_parentage_guard"],
      ["validate_giveaway_snapshot_parentage", "GiveawaySnapshot_parentage_guard"],
      [
        "validate_giveaway_snapshot_entry_parentage",
        "GiveawaySnapshotEntry_parentage_guard",
      ],
      [
        "validate_giveaway_eligibility_condition_parentage",
        "GiveawayEligibilityCondition_parentage_guard",
      ],
    ] as const;

    for (const [functionName, triggerName] of guards) {
      expect(giveawayMigrationSql).toContain(`CREATE FUNCTION "${functionName}"()`);
      expect(giveawayMigrationSql).toContain(`CREATE TRIGGER "${triggerName}"`);
    }

    expect(giveawayMigrationSql).toContain('"snapshotId"');
    expect(giveawayMigrationSql).toContain('"predecessorAwardId"');
    expect(giveawayMigrationSql).toContain('snapshot_entry_rider_id');
    expect(giveawayMigrationSql).toContain('NEW."winnerUserId"');
    expect(giveawayMigrationSql).toContain('"perkId"');
  });

  test("prevents scoped-parent updates from bypassing giveaway parentage guards", () => {
    expect(giveawayMigrationSql).toContain('CREATE FUNCTION "prevent_giveaway_scope_reparenting"()');
    expect(giveawayMigrationSql).toContain('TG_ARGV');
    expect(giveawayMigrationSql).toContain('to_jsonb(NEW)');

    const immutableScopeTriggers = [
      "EventGiveaway_scope_immutable",
      "GiveawayMechanicsVersion_scope_immutable",
      "GiveawayEligibilityGroup_scope_immutable",
      "GiveawayEntry_scope_immutable",
      "GiveawaySnapshot_scope_immutable",
      "GiveawaySnapshotEntry_scope_immutable",
      "GiveawayPrizePool_scope_immutable",
      "GiveawayPrizeItem_scope_immutable",
      "GiveawayDraw_scope_immutable",
      "GiveawayAward_scope_immutable",
    ];

    for (const triggerName of immutableScopeTriggers) {
      expect(giveawayMigrationSql).toContain(`CREATE TRIGGER "${triggerName}"`);
    }

    expect(giveawayMigrationSql).toContain('CREATE FUNCTION "validate_giveaway_perk_event_parentage"()');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "Perk_giveaway_event_parentage_guard"');
    expect(giveawayMigrationSql).toContain(
      'BEFORE UPDATE OF "giveawayId", "drawId", "prizePoolId", "prizeItemId", "snapshotEntryId", "winnerUserId", "predecessorAwardId"',
    );
  });
});
