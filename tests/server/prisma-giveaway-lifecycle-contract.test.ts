import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma } from "@prisma/client";
import { describe, expect, test } from "vitest";

const prismaBackendSource = readFileSync(
  resolve(process.cwd(), "src/server/prisma-backend.ts"),
  "utf8",
);
const prismaSchema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const giveawayMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260713000000_flexible_event_giveaways/migration.sql",
  ),
  "utf8",
);

function dmmfModel(name: string) {
  return Prisma.dmmf.datamodel.models.find((model) => model.name === name);
}

describe("Prisma giveaway lifecycle contract", () => {
  test("persists normalized entry provenance and durable campaign-code claims", () => {
    const giveaway = dmmfModel("EventGiveaway");
    const entry = dmmfModel("GiveawayEntry");
    const campaignCode = dmmfModel("GiveawayCampaignCode");
    const codeClaim = dmmfModel("GiveawayCampaignCodeClaim");
    const award = dmmfModel("GiveawayAward");

    expect(giveaway?.fields.find((field) => field.name === "presenceVerificationRequired")).toMatchObject({
      kind: "scalar",
      type: "Boolean",
    });
    for (const [name, kind, type] of [
      ["entryPath", "enum", "GiveawayEntryPath"],
      ["qualifiedEligibilityGroupIds", "scalar", "Json"],
      ["manualGrantActive", "scalar", "Boolean"],
      ["acknowledgedMechanicsVersionId", "scalar", "String"],
      ["acknowledgedMechanicsChecksum", "scalar", "String"],
      ["acknowledgedMechanicsAt", "scalar", "DateTime"],
    ] as const) {
      expect(entry?.fields.find((field) => field.name === name)).toMatchObject({ kind, type });
    }
    expect(campaignCode?.fields.find((field) => field.name === "createdByUserId")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(award?.fields.find((field) => field.name === "directAllocationKey")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(codeClaim).toBeDefined();
    expect(prismaSchema).toContain("enum GiveawayEntryPath");
    expect(prismaSchema).toContain("model GiveawayCampaignCodeClaim");
    expect(prismaSchema).toContain("@@unique([campaignCodeId, riderId])");
    expect(prismaSchema).toContain("@@unique([campaignCodeId, idempotencyKey])");
    expect(giveawayMigrationSql).toContain('CREATE TYPE "GiveawayEntryPath"');
    expect(giveawayMigrationSql).toContain('CREATE TABLE "GiveawayCampaignCodeClaim"');
    expect(giveawayMigrationSql).toContain(
      'CREATE UNIQUE INDEX "GiveawayCampaignCodeClaim_campaignCodeId_riderId_key"',
    );
    expect(giveawayMigrationSql).toContain('"directAllocationKey" TEXT');
    expect(giveawayMigrationSql).toContain('CREATE UNIQUE INDEX "GiveawayAward_directAllocationKey_key"');
    expect(giveawayMigrationSql).toContain('"GiveawayAward_directAllocation_provenance"');
    expect(giveawayMigrationSql).toContain('"GiveawayEntry_provenance_guard"');
    expect(giveawayMigrationSql).toContain('"GiveawayCampaignCodeClaim_parentage_guard"');
    expect(giveawayMigrationSql).toContain('"GiveawayEntryEvent_append_only"');
    expect(giveawayMigrationSql).toContain('"GiveawayCampaignCodeClaim_append_only"');
  });

  test("exposes the non-draw lifecycle and entry methods through interactive campaign transactions", () => {
    const methods = [
      "createGiveaway",
      "updateGiveaway",
      "listOrganizerGiveaways",
      "getPublicGiveaway",
      "getRiderGiveawayState",
      "submitGiveawayForReview",
      "reviewGiveawayCompliance",
      "openGiveaway",
      "pauseGiveaway",
      "cancelGiveaway",
      "suspendGiveaway",
      "optInToGiveaway",
      "createGiveawayCampaignCode",
      "claimGiveawayCampaignCode",
      "grantManualGiveawayEntry",
      "revokeManualGiveawayEntry",
    ];

    for (const method of methods) {
      expect(prismaBackendSource).toMatch(new RegExp(`async ${method}\\(`));
    }
    expect(prismaBackendSource).toContain("private async lockGiveawayCampaign");
    expect(prismaBackendSource).toContain('FROM "EventGiveaway" WHERE "id" = ${giveawayId} FOR UPDATE');
    expect(prismaBackendSource).toContain("this.prisma.$transaction");
    expect(prismaBackendSource).toContain("reconcileAutomaticGiveawayEligibility");
    expect(prismaBackendSource).toContain("allocateDirectGiveawayAwards");
    expect(prismaBackendSource).toContain("voidIneligibleDirectGiveawayAwards");
    expect(prismaBackendSource).toContain("reallocateImmediateGiveawayAwards");
    expect(prismaBackendSource).not.toContain("SKIP LOCKED");
  });

  test("keeps locking, snapshots, and draw/claim fulfillment work deferred", () => {
    expect(prismaBackendSource).not.toMatch(/async lockGiveaway\(/);
    expect(prismaBackendSource).not.toMatch(/async runGiveawayDraw\(/);
    expect(prismaBackendSource).not.toMatch(/async publishGiveawayDraw\(/);
    expect(prismaBackendSource).not.toMatch(/async redrawGiveawayAward\(/);
    expect(prismaBackendSource).not.toMatch(/async verifyGiveawayClaim\(/);
    expect(prismaBackendSource).not.toMatch(/async fulfillGiveawayAward\(/);
  });

  test("keeps giveaway candidates, source facts, token hashes, and audit payloads out of the global snapshot", () => {
    const getSnapshotSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async getSnapshot"),
      prismaBackendSource.indexOf("async signUpRider"),
    );

    expect(getSnapshotSource).not.toContain("eventGiveaway");
    expect(getSnapshotSource).not.toContain("giveawayAuditEvent");
    expect(getSnapshotSource).not.toContain("campaignCode");
  });

  test("reconciles automatic eligibility only after committed attendance activity and avoids cross-campaign opening locks", () => {
    const registerSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async registerForEvent"),
      prismaBackendSource.indexOf("async configureCheckIn"),
    );
    const selfCheckInSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async selfCheckIn"),
      prismaBackendSource.indexOf("async scanPass"),
    );
    const scanSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async scanPass"),
      prismaBackendSource.indexOf("async approveVenueWithConditions"),
    );
    const openSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async openGiveaway"),
      prismaBackendSource.indexOf("async pauseGiveaway"),
    );

    expect(registerSource).toContain("reconcileAutomaticGiveawayEligibilityAfterEvent(event.id, user.id)");
    expect(selfCheckInSource).toContain(
      "if (outcome.status === \"confirmed\") {\n        await this.reconcileAutomaticGiveawayEligibilityAfterEvent",
    );
    expect(scanSource).toContain(
      "await this.reconcileAutomaticGiveawayEligibilityAfterEvent(event.id, pass.userId)",
    );
    expect(openSource).toContain("reconcileAutomaticGiveawayEntry(tx, opened, riderId)");
    expect(openSource).not.toContain("reconcileAutomaticGiveawayEligibility(tx, giveaway.eventId)");
  });
});
