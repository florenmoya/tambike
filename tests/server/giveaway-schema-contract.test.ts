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
const prismaSchema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

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

  test("persists a bounded per-rider entry cap and each entry source fingerprint", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((entry) => [entry.name, entry]));
    const giveaway = models.get("EventGiveaway");
    const entry = models.get("GiveawayEntry");

    expect(giveaway?.fields.find((field) => field.name === "maxEntriesPerRider")).toMatchObject({
      kind: "scalar",
      type: "Int",
    });
    expect(entry?.fields.find((field) => field.name === "qualifiedSourceFingerprint")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(prismaSchema).toMatch(/maxEntriesPerRider\s+Int\s*\n/);
    expect(prismaSchema).toMatch(/qualifiedSourceFingerprint\s+String\s*\n/);
    expect(giveawayMigrationSql).toContain('"maxEntriesPerRider" INTEGER NOT NULL');
    expect(giveawayMigrationSql).toContain(
      'CONSTRAINT "EventGiveaway_maxEntriesPerRider_bounded" CHECK ("maxEntriesPerRider" >= 1 AND "maxEntriesPerRider" <= 10000)',
    );
    expect(giveawayMigrationSql).toContain('"qualifiedSourceFingerprint" TEXT NOT NULL');
  });

  test("supports direct entry awards without inventing draw or snapshot provenance", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((entry) => [entry.name, entry]));
    const award = models.get("GiveawayAward");

    expect(award?.fields.find((field) => field.name === "entryId")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(prismaSchema).toMatch(/entryId\s+String\s*\n/);
    expect(prismaSchema).toMatch(/drawId\s+String\?\s*\n/);
    expect(prismaSchema).toMatch(/snapshotEntryId\s+String\?\s*\n/);
    expect(prismaSchema).toMatch(/rank\s+Int\?\s*\n/);
    expect(giveawayMigrationSql).toContain('"entryId" TEXT NOT NULL');
    expect(giveawayMigrationSql).toContain('"drawId" TEXT,');
    expect(giveawayMigrationSql).toContain('"snapshotEntryId" TEXT,');
    expect(giveawayMigrationSql).toContain('"rank" INTEGER,');
    expect(giveawayMigrationSql).toContain(
      'CONSTRAINT "GiveawayAward_provenance_paired" CHECK (("drawId" IS NULL) = ("snapshotEntryId" IS NULL))',
    );
    expect(giveawayMigrationSql).toContain(
      'CONSTRAINT "GiveawayAward_rank_matches_provenance" CHECK (("drawId" IS NULL AND "rank" IS NULL) OR ("drawId" IS NOT NULL AND "rank" IS NOT NULL AND "rank" > 0))',
    );
    expect(giveawayMigrationSql).toContain('GiveawayAward entry must belong to the same giveaway rider');
    expect(giveawayMigrationSql).toContain('NEW."entryId"');
    expect(giveawayMigrationSql).toContain('"entryId", "drawId", "prizePoolId"');
    expect(giveawayMigrationSql).toContain('"GiveawayAward_entryId_fkey"');
    expect(giveawayMigrationSql).toContain('CREATE INDEX "GiveawayAward_entryId_idx"');
  });

  test("does not cap a prize pool to one current award per snapshot entry", () => {
    expect(giveawayMigrationSql).not.toContain('GiveawayAward_currentPoolSnapshotEntry_key');
  });

  test("binds draw-backed award provenance to the draw's exact frozen snapshot", () => {
    expect(giveawayMigrationSql).toContain('draw_snapshot_id TEXT');
    expect(giveawayMigrationSql).toContain('snapshot_entry_snapshot_id TEXT');
    expect(giveawayMigrationSql).toContain(
      'SELECT "giveawayId", "snapshotId"\n      INTO draw_giveaway_id, draw_snapshot_id\n    FROM "GiveawayDraw"',
    );
    expect(giveawayMigrationSql).toContain(
      'SELECT snapshot."giveawayId", snapshot_entry."snapshotId", snapshot_entry."entryId", entry."riderId"',
    );
    expect(giveawayMigrationSql).toContain('draw_snapshot_id <> snapshot_entry_snapshot_id');
    expect(giveawayMigrationSql).toContain(
      'GiveawayAward draw and snapshot entry must refer to the same frozen snapshot',
    );
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
      'BEFORE UPDATE OF "giveawayId", "entryId", "drawId", "prizePoolId", "prizeItemId", "snapshotEntryId", "winnerUserId", "rank", "predecessorAwardId"',
    );
    expect(giveawayMigrationSql).toContain(
      'FUNCTION "prevent_giveaway_scope_reparenting"(\'giveawayId\', \'entryId\', \'drawId\', \'prizePoolId\', \'prizeItemId\', \'snapshotEntryId\', \'winnerUserId\', \'rank\', \'predecessorAwardId\')',
    );
  });
});
