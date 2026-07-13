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

  test("restores a withdrawn entry's active ledger weight on Prisma requalification", () => {
    const writeEntrySource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async writeGiveawayEntry"),
      prismaBackendSource.indexOf("private entryQualifiedGroupIds"),
    );

    expect(writeEntrySource).toContain(
      "calculateGiveawayEntryWeightDelta(existing, qualification.weight)",
    );
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

  test("persists locked snapshots and fair draw lifecycle operations", () => {
    for (const method of [
      "lockGiveaway",
      "runGiveawayDraw",
      "selectManualGiveawayAward",
      "publishGiveawayDraw",
      "declineGiveawayAward",
      "voidGiveawayAward",
      "disqualifyGiveawayAward",
      "redrawGiveawayAward",
    ]) {
      expect(prismaBackendSource).toMatch(new RegExp(`async ${method}\\(`));
    }
    expect(prismaBackendSource).toContain("rankFrozenWeightedEntries");
    expect(prismaBackendSource).toContain("GIVEAWAY_DRAW_ENCRYPTION_KEY");
    expect(prismaBackendSource).toContain("buildPublicDrawVerification");
    expect(prismaBackendSource).not.toContain("Math.random");
    for (const method of [
      "issueGiveawayClaimToken",
      "resolveGiveawayClaim",
      "verifyGiveawayClaim",
      "fulfillGiveawayAward",
      "grantGiveawayOperator",
      "revokeGiveawayOperator",
      "submitGiveawayDeliveryDetails",
      "readGiveawayDeliveryDetails",
      "withdrawGiveawayDeliveryDetails",
      "expireGiveawayClaims",
      "settleGiveawayAward",
      "completeGiveawayClaims",
      "recoverExpiredDirectGiveawayAward",
    ]) {
      expect(prismaBackendSource).toMatch(new RegExp(`async ${method}\\(`));
    }
    expect(prismaBackendSource).toContain("hashGiveawayClaimToken");
    expect(prismaBackendSource).toContain("parseGiveawayClaimQrPayload");
    expect(prismaBackendSource).toContain("GIVEAWAY_DELIVERY_ENCRYPTION_KEY");
  });

  test("keeps post-deadline claim recovery explicit, delivery retention live, and rider states truthful", () => {
    const claimSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async issueGiveawayClaimToken"),
      prismaBackendSource.indexOf("async createEventDraft"),
    );
    const redrawSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async redrawGiveawayAward"),
      prismaBackendSource.indexOf("async issueGiveawayClaimToken"),
    );
    const riderStateSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async toRiderGiveawayState"),
      prismaBackendSource.indexOf("private async resolveGiveawayAwardByAdministrator"),
    );

    expect(claimSource).toContain("async recoverExpiredDirectGiveawayAward");
    expect(claimSource).toContain("reallocateFrozenImmediateGiveawayAwards");
    expect(claimSource).toContain("retentionExpiresAt.getTime() <= Date.now()");
    expect(claimSource).toContain('status: { in: ["pending_verification", "claimable"] }');
    expect(redrawSource).toContain("claimDeadlineAt: parsed.claimDeadlineAt");
    expect(redrawSource).toContain("GIVEAWAY_AWARD_REDRAWN");
    expect(riderStateSource).toContain('"pending_verification"');
    expect(riderStateSource).toContain('"expired"');
    expect(riderStateSource).toContain("award.status as RiderGiveawayEntryStatus");
    expect(prismaBackendSource).toContain("requireOpaqueGiveawayLedgerText");
    expect(giveawayMigrationSql).toContain('"GiveawayClaimVerification_idempotency_opaque"');
    expect(giveawayMigrationSql).toContain('"GiveawayFulfillment_idempotency_opaque"');
    expect(giveawayMigrationSql).toContain('"GiveawayFulfillment_reference_nonsecret"');
    expect(giveawayMigrationSql).toContain('"GiveawayDeliveryDetail_consentVersion_opaque"');
    expect(giveawayMigrationSql).toContain('AND detail."retentionExpiresAt" > CURRENT_TIMESTAMP');
    expect(giveawayMigrationSql).toContain("GiveawayDeliveryDetail must belong to a current verified delivery award while claims are open");
    expect(giveawayMigrationSql).toContain("award_status <> 'verified'");
    expect(giveawayMigrationSql).toContain("giveaway_status <> 'claims_open'");
    expect(giveawayMigrationSql).toContain('"GiveawayAward_claimTokenHash_canonical"');
    expect(giveawayMigrationSql).toContain('char_length("claimTokenHash") = 43');
    expect(giveawayMigrationSql).not.toContain('"GiveawayState"');
  });

  test("finalizes direct awards as historical records and reallocates post-lock capacity from frozen entries", () => {
    const declineSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async declineGiveawayAward"),
      prismaBackendSource.indexOf("async voidGiveawayAward"),
    );
    const administratorResolutionSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async resolveGiveawayAwardByAdministrator"),
      prismaBackendSource.indexOf("private calculateMechanicsChecksum"),
    );
    const finalizationSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async lockDirectGiveawayAwardForFinalization"),
      prismaBackendSource.indexOf("private async requireGiveawaySnapshot"),
    );
    const frozenReallocationSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async reallocateFrozenImmediateGiveawayAwards"),
      prismaBackendSource.indexOf("/** Reconciles only open automatic campaigns"),
    );

    for (const source of [declineSource, administratorResolutionSource]) {
      expect(source).toContain("lockDirectGiveawayAwardForFinalization");
      expect(source).toContain("finalizeDirectGiveawayAward");
      expect(source).toContain("reallocateFinalizedDirectGiveawayAward");
    }
    expect(finalizationSource).toContain('data: { isCurrent: false, status, reasonDigest }');
    expect(finalizationSource).toContain('data: { status: "available" }');
    expect(finalizationSource).toContain('"locked", "drawing", "claims_open"');
    expect(finalizationSource).toContain("assertFrozenDirectEntryProvenance");
    expect(frozenReallocationSource).toContain("snapshot.entries.map");
    expect(frozenReallocationSource).toContain("assertFrozenDirectEntryProvenance(snapshot, lockedEntries)");
    expect(frozenReallocationSource).not.toContain('status: "eligible"');
    expect(giveawayMigrationSql).toContain("IF entry_status = 'locked' THEN");
    expect(giveawayMigrationSql).toContain("locked direct allocations require matching frozen snapshot provenance");
    expect(giveawayMigrationSql).toContain('snapshot_entry."entryId" = NEW."entryId"');
    expect(giveawayMigrationSql).toContain(
      "locked_snapshot_entry_frozen_weight IS DISTINCT FROM entry_current_weight",
    );
    expect(giveawayMigrationSql).toContain(
      "locked_snapshot_entry_qualified_source_fingerprint IS DISTINCT FROM entry_qualified_source_fingerprint",
    );
    expect(giveawayMigrationSql).toContain(
      'BEFORE UPDATE OF "giveawayId", "riderId" ON "GiveawayEntry"',
    );
    expect(giveawayMigrationSql).toContain(
      `"prevent_giveaway_scope_reparenting"('giveawayId', 'riderId')`,
    );
  });

  test("derives redraw exclusions from consumed weighted units instead of excluding every snapshot entry", () => {
    const redrawSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async redrawGiveawayAward"),
      prismaBackendSource.indexOf("async createEventDraft"),
    );

    expect(redrawSource).toContain("consumedWeightedUnitKeys");
    expect(redrawSource).toContain("rankedUnits[historicalAward.rank - 1]");
    expect(redrawSource).toContain("${unit.entryId}:${unit.unitOrdinal}");
    expect(redrawSource).toContain("this.isDirectGiveawayAward(award)");
    expect(redrawSource).not.toContain("selectedSnapshotEntryIds");
  });

  test("locks giveaway entries before immediate award allocation during snapshot locking", () => {
    const lockSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async lockGiveaway"),
      prismaBackendSource.indexOf("async runGiveawayDraw"),
    );
    const initialEntryLockPosition = lockSource.indexOf(
      "await this.lockGiveawayEntries(tx, giveaway.id);",
    );
    const reconciliationPosition = lockSource.indexOf("for (const riderId of riderIds)");
    const entryLockPosition = lockSource.indexOf(
      "const lockedEntries = await this.lockGiveawayEntries(tx, giveaway.id)",
    );
    const immediateAllocationPosition = lockSource.indexOf(
      "await this.reallocateImmediateGiveawayAwards(tx, giveaway)",
    );

    expect(initialEntryLockPosition).toBeGreaterThanOrEqual(0);
    expect(initialEntryLockPosition).toBeLessThan(reconciliationPosition);
    expect(lockSource).toContain("reconcileDirectAwards: false");
    expect(entryLockPosition).toBeGreaterThanOrEqual(0);
    expect(immediateAllocationPosition).toBeGreaterThan(entryLockPosition);
  });

  test("rejects publication of a non-completed draw before exposing the committed seed", () => {
    const publishSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async publishGiveawayDraw"),
      prismaBackendSource.indexOf("async declineGiveawayAward"),
    );

    expect(publishSource).toContain('if (draw.status !== "completed")');
  });

  test("binds idempotent draw replays to the exact action inputs", () => {
    expect(prismaBackendSource).toContain("assertGiveawayDrawReplayInput");
    expect(prismaBackendSource).toContain('action: "initial_random_draw"');
    expect(prismaBackendSource).toContain('action: "manual_selection"');
    expect(prismaBackendSource).toContain('action: "redraw"');
    const drawDigestSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private calculateGiveawayDrawInputDigest"),
      prismaBackendSource.indexOf("private calculateGiveawayDrawResultDigest"),
    );

    expect(drawDigestSource).toContain("reasonDigest: actionInput.reasonDigest");
    expect(drawDigestSource).toContain("prizePoolId: actionInput.prizePoolId ?? null");
    expect(drawDigestSource).toContain("riderId: actionInput.riderId ?? null");
    expect(drawDigestSource).toContain("predecessorAwardId: actionInput.predecessorAwardId ?? null");
    expect(drawDigestSource).toContain("claimDeadlineAt: actionInput.claimDeadlineAt ?? null");
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

  test("reconciles qualifying attendance atomically and keeps pending self-review excluded", () => {
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
    const registerTransaction = registerSource.slice(
      registerSource.indexOf("this.prisma.$transaction(async (tx) =>"),
      registerSource.indexOf("\n    });\n\n    await this.audit"),
    );
    const selfCheckInTransaction = selfCheckInSource.slice(
      selfCheckInSource.indexOf("this.prisma.$transaction(async (tx) =>"),
      selfCheckInSource.indexOf("\n      });\n\n      await this.audit"),
    );
    const scanTransaction = scanSource.slice(
      scanSource.indexOf("this.prisma.$transaction(async (tx) =>"),
      scanSource.indexOf("\n      });\n\n      await this.audit"),
    );

    expect(registerTransaction).toContain(
      "await this.reconcileAutomaticGiveawayEligibility(tx, event.id, user.id)",
    );
    expect(selfCheckInTransaction).toContain(
      "await this.reconcileAutomaticGiveawayEligibility(tx, event.id, rider.id)",
    );
    const selfReviewBranch = selfCheckInTransaction.slice(
      selfCheckInTransaction.indexOf('if (settings.mode === "self_review")'),
      selfCheckInTransaction.indexOf("const updated = await tx.pass.updateMany"),
    );
    expect(selfReviewBranch).not.toContain("reconcileAutomaticGiveawayEligibility");
    expect(scanTransaction).toContain(
      "await this.reconcileAutomaticGiveawayEligibility(tx, event.id, pass.userId)",
    );
    expect(
      scanTransaction.match(
        /await this\.reconcileAutomaticGiveawayEligibility\(tx, event\.id, pass\.userId\)/g,
      ),
    ).toHaveLength(2);
    expect(prismaBackendSource).not.toContain("reconcileAutomaticGiveawayEligibilityAfterEvent");
    expect(openSource).toContain("reconcileAutomaticGiveawayEntry(tx, opened, riderId, {");
    expect(openSource).not.toContain("reconcileAutomaticGiveawayEligibility(tx, giveaway.eventId)");
  });

  test("locks all automatic campaign entries before open-time allocation locks pools", () => {
    const openSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async openGiveaway"),
      prismaBackendSource.indexOf("async pauseGiveaway"),
    );
    const entryLockPosition = openSource.indexOf("await this.lockGiveawayEntries(tx, opened.id);");
    const reconciliationPosition = openSource.indexOf("for (const riderId of riderIds)");
    const allocationPosition = openSource.indexOf(
      "await this.reallocateImmediateGiveawayAwards(tx, opened)",
    );

    expect(entryLockPosition).toBeGreaterThanOrEqual(0);
    expect(entryLockPosition).toBeLessThan(reconciliationPosition);
    expect(openSource).toContain("reconcileDirectAwards: false");
    expect(openSource).toContain("revalidateDirectGiveawayAwardsForLockedEntries");
    expect(allocationPosition).toBeGreaterThan(reconciliationPosition);
  });

  test("reallocates retained direct capacity on reopen for every entry mode", () => {
    const openSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async openGiveaway"),
      prismaBackendSource.indexOf("async pauseGiveaway"),
    );
    const automaticBranchEnd = openSource.indexOf("const lockedEntries = await this.lockGiveawayEntries");
    const immediateAllocationPosition = openSource.indexOf(
      "await this.reallocateImmediateGiveawayAwards(tx, opened)",
    );

    expect(automaticBranchEnd).toBeGreaterThanOrEqual(0);
    expect(immediateAllocationPosition).toBeGreaterThan(automaticBranchEnd);
    expect(openSource).toContain(
      "await this.revalidateDirectGiveawayAwardsForLockedEntries(tx, opened, lockedEntries)",
    );
  });
});
