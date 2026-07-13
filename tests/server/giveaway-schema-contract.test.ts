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
const publicGiveawayProofMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260713010000_public_giveaway_proofs/migration.sql",
  ),
  "utf8",
);
const prismaSchema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const prismaSeed = readFileSync(resolve(process.cwd(), "prisma/seed.ts"), "utf8");

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

  test("persists canonical eligibility-cycle timing, direct allocation proof, and RSVP going transitions", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((entry) => [entry.name, entry]));
    const entry = models.get("GiveawayEntry");
    const award = models.get("GiveawayAward");
    const rsvp = models.get("RSVP");

    expect(entry?.fields.find((field) => field.name === "eligibilityCycleAt")).toMatchObject({
      kind: "scalar",
      type: "DateTime",
    });
    expect(
      entry?.fields.find((field) => field.name === "qualifiedEligibilityGroupTimings"),
    ).toMatchObject({ kind: "scalar", type: "Json" });
    expect(award?.fields.find((field) => field.name === "allocationEligibilityAt")).toMatchObject({
      kind: "scalar",
      type: "DateTime",
    });
    expect(rsvp?.fields.find((field) => field.name === "goingAt")).toMatchObject({
      kind: "scalar",
      type: "DateTime",
    });
    expect(prismaSchema).toMatch(/eligibilityCycleAt\s+DateTime\s*\n/);
    expect(prismaSchema).toMatch(/qualifiedEligibilityGroupTimings\s+Json\s*\n/);
    expect(prismaSchema).toMatch(/allocationEligibilityAt\s+DateTime\?\s*\n/);
    expect(prismaSchema).toMatch(/goingAt\s+DateTime\?\s*\n/);
    expect(giveawayMigrationSql).toContain('"eligibilityCycleAt" TIMESTAMP(3) NOT NULL');
    expect(giveawayMigrationSql).toContain('"qualifiedEligibilityGroupTimings" JSONB NOT NULL');
    expect(giveawayMigrationSql).toContain('"allocationEligibilityAt" TIMESTAMP(3)');
    expect(giveawayMigrationSql).toContain('"goingAt" TIMESTAMP(3)');
    expect(giveawayMigrationSql).toContain('"GiveawayEntry_giveawayId_status_eligibilityCycleAt_id_idx"');
  });

  test("derives conservative historical RSVP timing and rejects tampered timing priority", () => {
    const entryTimingGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_giveaway_entry_provenance"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawayEntry_provenance_guard"'),
    );
    const snapshotTimingGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_giveaway_snapshot_entry_parentage"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawaySnapshotEntry_parentage_guard"'),
    );

    expect(giveawayMigrationSql).toContain(
      'GREATEST(pass."generatedAt", rsvp."createdAt", rsvp."updatedAt")',
    );
    expect(giveawayMigrationSql).toContain('GREATEST("createdAt", "updatedAt")');
    expect(entryTimingGuard).toContain("::timestamptz");
    expect(entryTimingGuard).toContain('NEW."eligibilityCycleAt"');
    expect(entryTimingGuard).toContain("earliest_eligibility_at");
    expect(snapshotTimingGuard).toContain("::timestamptz");
    expect(snapshotTimingGuard).toContain('NEW."eligibilityCycleAt"');
    expect(snapshotTimingGuard).toContain("earliest_eligibility_at");
  });

  test("freezes entrant-facing configuration after entry history while retaining operational campaign edits", () => {
    const configurationGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_event_giveaway_entrant_configuration"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "EventGiveaway_entrant_configuration_guard"'),
    );

    expect(configurationGuard).toContain('giveaway_has_entrant_history(OLD."id")');
    expect(giveawayMigrationSql).toContain('FROM "GiveawayEntry"');
    expect(giveawayMigrationSql).toContain('FROM "GiveawayEntryEvent"');
    expect(configurationGuard).toContain('NEW."title"');
    expect(configurationGuard).toContain('NEW."visibility"');
    expect(configurationGuard).toContain('NEW."timeZone"');
    expect(configurationGuard).toContain('NEW."entryMode"');
    expect(configurationGuard).toContain('NEW."maxEntriesPerRider"');
    expect(configurationGuard).toContain('NEW."maxWinsPerRider"');
    expect(configurationGuard).toContain('NEW."presenceVerificationRequired"');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "EventGiveaway_entrant_configuration_guard"');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawayMechanicsVersion_entrant_configuration_guard"');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawayEligibilityGroup_entrant_configuration_guard"');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawayPrizePool_entrant_configuration_guard"');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawayPrizeItem_entrant_configuration_guard"');
    expect(giveawayMigrationSql).toContain(
      'CREATE TRIGGER "GiveawayPrizePoolEligibilityGroup_entrant_configuration_guard"',
    );
    const mechanicsGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_giveaway_mechanics_entrant_configuration"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawayMechanicsVersion_entrant_configuration_guard"'),
    );
    expect(mechanicsGuard).toContain('NEW."version"');
    expect(mechanicsGuard).toContain('NEW."checksum"');
    expect(mechanicsGuard).toContain('NEW."createdByUserId"');
  });

  test("binds direct award provenance to the entry and pool eligibility priority", () => {
    const awardGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_giveaway_award_parentage"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawayAward_parentage_guard"'),
    );

    expect(awardGuard).toContain("expected_allocation_eligibility_at");
    expect(awardGuard).toContain('NEW."allocationEligibilityAt"');
    expect(awardGuard).toContain("format('direct:%s:%s:%s'");
    expect(awardGuard).toContain('GiveawayAward direct allocation provenance must match entry and pool priority');
    expect(awardGuard).toContain("entry_status");
    expect(awardGuard).toContain('GiveawayAward direct allocations require an eligible entry');
  });

  test("persists the frozen source fingerprint and qualified groups on every snapshot entry", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((entry) => [entry.name, entry]));
    const snapshotEntry = models.get("GiveawaySnapshotEntry");

    expect(snapshotEntry?.fields.find((field) => field.name === "qualifiedSourceFingerprint")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(snapshotEntry?.fields.find((field) => field.name === "qualifiedEligibilityGroupIds")).toMatchObject({
      kind: "scalar",
      type: "Json",
    });
    expect(prismaSchema).toMatch(/qualifiedSourceFingerprint\s+String\s*\n/);
    expect(prismaSchema).toMatch(/qualifiedEligibilityGroupIds\s+Json\s*\n/);
    expect(giveawayMigrationSql).toContain('"qualifiedSourceFingerprint" TEXT NOT NULL');
    expect(giveawayMigrationSql).toContain('"qualifiedEligibilityGroupIds" JSONB NOT NULL');
    const snapshotEntryGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_giveaway_snapshot_entry_parentage"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawaySnapshotEntry_parentage_guard"'),
    );
    expect(snapshotEntryGuard).toContain('NEW."frozenWeight" IS DISTINCT FROM entry_current_weight');
    expect(snapshotEntryGuard).toContain(
      'NEW."opaquePublicReference" IS DISTINCT FROM entry_opaque_public_reference',
    );
    expect(snapshotEntryGuard).toContain(
      'NEW."qualifiedSourceFingerprint" IS DISTINCT FROM entry_qualified_source_fingerprint',
    );
  });

  test("keeps snapshots immutable except for a single seed revelation and blocks snapshot-entry mutation", () => {
    const snapshotGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "prevent_giveaway_snapshot_mutation"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawaySnapshot_immutable"'),
    );
    const snapshotEntryGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "prevent_giveaway_snapshot_entry_mutation"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawaySnapshotEntry_immutable"'),
    );

    expect(snapshotGuard).toContain("IF TG_OP = 'DELETE' THEN");
    expect(snapshotGuard).toContain('OLD."seedRevealedAt" IS NOT NULL');
    expect(snapshotGuard).toContain('NEW."seedRevealedAt" IS NULL');
    expect(snapshotGuard).toContain(
      "(to_jsonb(NEW) - 'seedRevealedAt' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'seedRevealedAt' - 'updatedAt')",
    );
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawaySnapshot_immutable"');
    expect(giveawayMigrationSql).toContain('BEFORE UPDATE OR DELETE ON "GiveawaySnapshot"');
    expect(snapshotEntryGuard).toContain("RAISE EXCEPTION 'GiveawaySnapshotEntry is immutable'");
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "GiveawaySnapshotEntry_immutable"');
    expect(giveawayMigrationSql).toContain('BEFORE UPDATE OR DELETE ON "GiveawaySnapshotEntry"');
  });

  test("has no audit-purge bypass and fails seed reset closed when giveaway history exists", () => {
    const auditGuard = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "prevent_giveaway_audit_event_mutation"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "GiveawayAuditEvent_append_only"'),
    );

    expect(auditGuard).toContain("RAISE EXCEPTION 'GiveawayAuditEvent is append-only'");
    expect(auditGuard).not.toContain("current_setting");
    expect(giveawayMigrationSql).not.toContain("tambike.allow_giveaway_audit_purge");
    expect(prismaSeed).toContain("REFUSING_TO_SEED_WITH_GIVEAWAY_HISTORY");
    expect(prismaSeed).toContain("prisma.eventGiveaway.count()");
    expect(prismaSeed).toContain("prisma.giveawayAuditEvent.count()");
    expect(prismaSeed).not.toContain("giveawayAuditEvent.deleteMany");
    expect(prismaSeed).not.toContain("eventGiveaway.deleteMany");
    expect(prismaSeed).not.toContain("tambike.allow_giveaway_audit_purge");
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

  test("persists a winner's revocable publication consent without changing award provenance", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((entry) => [entry.name, entry]));
    const award = models.get("GiveawayAward");

    expect(award?.fields.find((field) => field.name === "publicWinnerAlias")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(award?.fields.find((field) => field.name === "winnerAliasOptedInAt")).toMatchObject({
      kind: "scalar",
      type: "DateTime",
    });
    expect(award?.fields.find((field) => field.name === "winnerAliasRevokedAt")).toMatchObject({
      kind: "scalar",
      type: "DateTime",
    });
    expect(prismaSchema).toMatch(/publicWinnerAlias\s+String\?\s*\n/);
    expect(prismaSchema).toMatch(/winnerAliasOptedInAt\s+DateTime\?\s*\n/);
    expect(prismaSchema).toMatch(/winnerAliasRevokedAt\s+DateTime\?\s*\n/);
    expect(publicGiveawayProofMigrationSql).toContain('ADD COLUMN "publicWinnerAlias" TEXT');
    expect(publicGiveawayProofMigrationSql).toContain(
      'CONSTRAINT "GiveawayAward_public_winner_alias_pair"',
    );
    expect(publicGiveawayProofMigrationSql).toContain(
      'GiveawayAward public winner aliases require draw-backed frozen provenance',
    );
    expect(publicGiveawayProofMigrationSql).toContain(
      'CREATE TRIGGER "GiveawayAward_public_winner_alias_guard"',
    );
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
    expect(poolInventoryFunction).toContain(
      'NEW."maxWinsPerRider" IS DISTINCT FROM OLD."maxWinsPerRider"',
    );
    expect(giveawayMigrationSql).toContain(
      'BEFORE INSERT OR UPDATE OF "awardMode", "inventoryLimit", "maxWinsPerRider" ON "GiveawayPrizePool"',
    );
  });

  test("freezes campaign winner limits after any award history", () => {
    const campaignWinnerLimitFunction = giveawayMigrationSql.slice(
      giveawayMigrationSql.indexOf('CREATE FUNCTION "validate_event_giveaway_winner_limits"()'),
      giveawayMigrationSql.indexOf('CREATE TRIGGER "EventGiveaway_winner_limits_guard"'),
    );

    expect(campaignWinnerLimitFunction).toContain('FROM "GiveawayAward"');
    expect(campaignWinnerLimitFunction).toContain('"giveawayId" = OLD."id"');
    expect(campaignWinnerLimitFunction).toContain('NEW."maxWinsPerRider" IS NOT DISTINCT FROM OLD."maxWinsPerRider"');
    expect(campaignWinnerLimitFunction).toContain('NEW."maxWinsTotal" IS NOT DISTINCT FROM OLD."maxWinsTotal"');
    expect(giveawayMigrationSql).toContain('CREATE TRIGGER "EventGiveaway_winner_limits_guard"');
    expect(giveawayMigrationSql).toContain(
      'BEFORE UPDATE OF "maxWinsPerRider", "maxWinsTotal" ON "EventGiveaway"',
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
      'BEFORE UPDATE OF "giveawayId", "entryId", "drawId", "prizePoolId", "prizeItemId", "snapshotEntryId", "winnerUserId", "rank", "directAllocationKey", "allocationEligibilityAt", "recoverySourceAwardId", "predecessorAwardId"',
    );
    expect(giveawayMigrationSql).toContain(
      'FUNCTION "prevent_giveaway_scope_reparenting"(\'giveawayId\', \'entryId\', \'drawId\', \'prizePoolId\', \'prizeItemId\', \'snapshotEntryId\', \'winnerUserId\', \'rank\', \'directAllocationKey\', \'allocationEligibilityAt\', \'recoverySourceAwardId\', \'predecessorAwardId\')',
    );
  });
});
