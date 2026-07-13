import { readFileSync, readdirSync } from "node:fs";
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
const manualReplacementMigrationDirectory = readdirSync(
  resolve(process.cwd(), "prisma/migrations"),
).find((directory) => directory.includes("manual_giveaway_award_replacement"));
const manualReplacementMigrationSql = manualReplacementMigrationDirectory
  ? readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations",
        manualReplacementMigrationDirectory,
        "migration.sql",
      ),
      "utf8",
    )
  : "";

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
      "listGiveawayManualSelectionCandidates",
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

  test("keeps Prisma manual-selection candidates frozen, opaque, and pool-scoped", () => {
    const manualSelectionSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async listGiveawayManualSelectionCandidates"),
      prismaBackendSource.indexOf("/** Minimal cross-event administrator campaign list"),
    );

    expect(manualSelectionSource).toContain("requireGiveawayConfigurator");
    expect(manualSelectionSource).toContain('["locked", "drawing"]');
    expect(manualSelectionSource).toContain("snapshot.entries");
    expect(manualSelectionSource).toContain("opaquePublicReference");
    expect(manualSelectionSource).not.toContain("riderIdsWithGiveawayActivity");
    expect(manualSelectionSource).not.toContain("displayName");
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
    expect(claimSource).toContain("recoverFrozenImmediateGiveawayAwardSlot");
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

  test("makes every terminal direct source either linked once or explicitly closed", () => {
    const award = dmmfModel("GiveawayAward");
    const directFinalizationSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async reallocateFinalizedDirectGiveawayAward"),
      prismaBackendSource.indexOf("private async requireGiveawaySnapshot"),
    );
    const genericVoidSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async voidDirectGiveawayAwards"),
      prismaBackendSource.indexOf("private async voidIneligibleDirectGiveawayAwards"),
    );

    for (const field of ["recoveryClosedAt", "recoveryClosedReasonDigest", "recoverySourceAwardId"]) {
      expect(award?.fields.find((candidate) => candidate.name === field)).toBeTruthy();
    }
    expect(prismaSchema).toContain("recoverySourceAwardId String?            @unique");
    expect(directFinalizationSource).toContain("recoverFrozenImmediateGiveawayAwardSlot");
    expect(directFinalizationSource).toContain("reallocateImmediateDirectGiveawayAwardSlot");
    expect(directFinalizationSource).toContain("linkGiveawayDirectRecoverySource");
    expect(genericVoidSource).toContain("closeGiveawayDirectRecoverySource");
    expect(prismaBackendSource).toContain("hasUnresolvedTerminalDirectGiveawayAward");
    expect(giveawayMigrationSql).toContain('"GiveawayAward_recoverySourceAwardId_key"');
    expect(giveawayMigrationSql).toContain('"GiveawayAward_recovery_resolution_one_way"');
    expect(giveawayMigrationSql).toContain('"recoverySourceAwardId"');
  });

  test("resolves open direct recovery sources before generic immediate allocation", () => {
    const immediateAllocationSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async reallocateImmediateGiveawayAwards"),
      prismaBackendSource.indexOf("private async reallocateFrozenImmediateGiveawayAwards"),
    );
    const recoveryResolverSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async resolvePendingDirectGiveawayRecoverySources"),
      prismaBackendSource.indexOf("private async reallocateFrozenImmediateGiveawayAwards"),
    );

    const resolverCallPosition = immediateAllocationSource.indexOf(
      "await this.resolvePendingDirectGiveawayRecoverySources(tx, giveaway)",
    );
    const genericPoolLoopPosition = immediateAllocationSource.indexOf("for (const pool of giveaway.prizePools)");
    expect(resolverCallPosition).toBeGreaterThanOrEqual(0);
    expect(resolverCallPosition).toBeLessThan(genericPoolLoopPosition);
    expect(recoveryResolverSource).toContain('if (giveaway.status !== "open") return;');
    expect(recoveryResolverSource).toContain("reallocateFinalizedDirectGiveawayAward");
    expect(recoveryResolverSource).toContain('recoveryClosedAt: null');
    expect(recoveryResolverSource).toContain('status: { in: ["declined", "voided", "disqualified", "expired"] }');
  });

  test("reserves elapsed direct recovery capacity from generic immediate allocation", () => {
    const immediateAllocationSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async reallocateImmediateGiveawayAwards"),
      prismaBackendSource.indexOf("private async reallocateFrozenImmediateGiveawayAwards"),
    );
    const directAllocationSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async allocateDirectGiveawayAwardForPool"),
      prismaBackendSource.indexOf("private async voidDirectGiveawayAwards"),
    );
    const reservationSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async getElapsedDirectGiveawayRecoveryReservation"),
      prismaBackendSource.indexOf("private async reallocateFrozenImmediateGiveawayAwards"),
    );

    expect(immediateAllocationSource).toContain("getElapsedDirectGiveawayRecoveryReservation");
    expect(directAllocationSource).toContain("reservedTotalAwardSlots");
    expect(directAllocationSource).toContain("protectedPrizeItemIds");
    expect(reservationSource).toContain('claimDeadlineAt: { not: null, lte: new Date() }');
    expect(reservationSource).toContain("reservedTotalAwardSlots");
    expect(reservationSource).toContain("protectedPrizeItemIdsByPool");
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

  test("keeps manual prize inventory publish-blocking only while an awardable frozen candidate remains", () => {
    const publishSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async publishGiveawayDraw"),
      prismaBackendSource.indexOf("async declineGiveawayAward"),
    );

    expect(publishSource).toContain(
      "await this.hasAwardableManualSelectionCandidates(tx, giveaway, snapshot)",
    );
    const guardSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async hasAwardableManualSelectionCandidates"),
      prismaBackendSource.indexOf("private async createDrawGiveawayAward"),
    );
    expect(guardSource).toContain('pool.awardMode === "manual_selection"');
    expect(guardSource).toContain('item.status === "available"');
    expect(guardSource).toContain("snapshot.entries");
    expect(guardSource).toContain("canCreateDrawGiveawayAward");
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

  test("declares the static Prisma manual-replacement lineage and privacy contract", () => {
    const optionsSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async listManualGiveawayReplacementCandidates"),
      prismaBackendSource.indexOf("async listAdminGiveaways"),
    );
    const replacementSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async replaceManualGiveawayAward"),
      prismaBackendSource.indexOf("async issueGiveawayClaimToken"),
    );
    const lineageSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("private async requireManualGiveawayReplacementSource"),
      prismaBackendSource.indexOf("private async hasAwardableManualSelectionCandidates"),
    );

    expect(prismaBackendSource).toMatch(/async listManualGiveawayReplacementCandidates\(/);
    expect(prismaBackendSource).toMatch(/async replaceManualGiveawayAward\(/);
    expect(optionsSource).toContain("requireGiveawayConfigurator");
    expect(optionsSource).toContain('giveaway.status !== "claims_open"');
    expect(optionsSource).toContain("snapshot.entries");
    expect(optionsSource).toContain("opaquePublicReference");
    expect(optionsSource).not.toContain("displayName");
    expect(optionsSource).not.toContain("riderIdsWithGiveawayActivity");

    expect(replacementSource).toContain('giveaway.status !== "claims_open"');
    expect(lineageSource).toContain('["declined", "voided", "disqualified", "expired"]');
    expect(lineageSource).toContain("!snapshot.seedRevealedAt");
    expect(lineageSource).toContain('originalDraw.status !== "published"');
    expect(lineageSource).toContain('originalDraw.algorithmVersion !== "manual-selection-v1"');
    expect(lineageSource).toContain('pool.awardMode !== "manual_selection"');
    expect(replacementSource).toContain("giveawayId_idempotencyKey");
    expect(replacementSource).toContain("assertGiveawayDrawReplayInput");
    expect(replacementSource).toContain('type: "redraw"');
    expect(replacementSource).toContain('status: "published"');
    expect(replacementSource).toContain('algorithmVersion: "manual-selection-v1"');
    expect(replacementSource).toContain("predecessorAwardId: currentAward.id");
    expect(replacementSource).toContain("reservePrizeItem: false");
    expect(replacementSource).toContain("GIVEAWAY_MANUAL_AWARD_REPLACED");
    expect(replacementSource).toContain("await this.notifyGiveaway");
    expect(replacementSource).not.toContain('status: "superseded"');

    expect(prismaSchema).toContain("predecessorAwardId   String?             @unique");
    expect(manualReplacementMigrationSql).toContain(
      'GiveawayAward predecessor successor duplicate preflight failed',
    );
    expect(manualReplacementMigrationSql).toContain(
      'CREATE UNIQUE INDEX "GiveawayAward_predecessorAwardId_key"',
    );
    expect(manualReplacementMigrationSql).toContain(
      'DROP INDEX "GiveawayAward_predecessorAwardId_idx"',
    );
    expect(manualReplacementMigrationSql).toContain(
      'CREATE FUNCTION "validate_giveaway_award_predecessor_recovery"()',
    );
    expect(manualReplacementMigrationSql).toContain(
      'GiveawayAward predecessor successor must use the same prize item and frozen snapshot',
    );
    expect(manualReplacementMigrationSql).toContain(
      "predecessor_draw_status NOT IN ('completed', 'published')",
    );
    expect(manualReplacementMigrationSql).toContain(
      "successor_draw_status NOT IN ('completed', 'published')",
    );
    expect(manualReplacementMigrationSql).toContain("predecessor_draw_status <> 'published'");
    expect(manualReplacementMigrationSql).toContain("successor_draw_status <> 'published'");
  });

  test("declares the static safe organizer operations contract", () => {
    const operationsSource = prismaBackendSource.slice(
      prismaBackendSource.indexOf("async getOrganizerGiveawayOperations"),
      prismaBackendSource.indexOf("async listGiveawayCampaignCodes"),
    );
    const directReofferSource = operationsSource.slice(
      operationsSource.indexOf("label: `Direct re-offer"),
      operationsSource.indexOf("      }\n    }\n", operationsSource.indexOf("label: `Direct re-offer")),
    );

    expect(prismaBackendSource).toMatch(/async getOrganizerGiveawayOperations\(/);
    expect(operationsSource).toContain("requireGiveawayConfigurator");
    expect(operationsSource).toContain('awardMode === "random_draw"');
    expect(operationsSource).toContain('algorithmVersion === "hmac-sha256-v1"');
    expect(operationsSource).toContain('awardMode === "manual_selection"');
    expect(operationsSource).toContain('algorithmVersion === "manual-selection-v1"');
    expect(operationsSource).toContain('["drawing", "claims_open"].includes(giveaway.status)');
    expect(operationsSource).toContain('giveaway.status === "claims_open"');
    expect(operationsSource).not.toContain('award.status !== "expired"');
    expect(operationsSource).toContain("recoveryClosedAt");
    expect(operationsSource).toContain("isGiveawayClaimDeadlineElapsed");
    expect(operationsSource).toContain('draw.status === "completed"');
    expect(operationsSource).toContain("canRunInitialRandomDraw");
    expect(operationsSource).toContain("canCancel");
    expect(operationsSource).toContain("publishableDrawId");
    expect(
      operationsSource.match(
        /claimDeadlineRequired: !this\.hasUsableGiveawayReplacementDeadline\(giveaway\)/g,
      ),
    ).toHaveLength(2);
    expect(directReofferSource).toContain("claimDeadlineRequired: true");
    expect(operationsSource).not.toContain("displayName");
    expect(operationsSource).not.toContain("claimTokenHash");
    expect(operationsSource).not.toContain("encryptedSeed");
  });
});
