import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";
import { createPrismaEventFixture } from "./fixtures";

function giveawayInput(eventId: string): CreateGiveawayInput {
  return {
    eventId,
    title: "Disposable draw concurrency campaign",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 5,
    mechanics: "Each eligible rider has one deterministic draw entry.",
    terms: "Disposable integration-test terms.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "hidden",
    eligibilityGroups: [
      {
        id: "active-pass",
        label: "Active RSVP and pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "random-prize",
        title: "Disposable helmet",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Disposable prize item" }],
      },
    ],
  };
}

function directGiveawayInput(eventId: string): CreateGiveawayInput {
  return {
    eventId,
    title: "Disposable direct reallocation campaign",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 5,
    mechanics: "Eligible riders receive a deterministic first-come allocation.",
    terms: "Disposable integration-test terms.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "hidden",
    eligibilityGroups: [
      {
        id: "active-pass",
        label: "Active RSVP and pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "first-come-prize",
        title: "Disposable first-come prize",
        awardMode: "first_come",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Disposable direct prize item" }],
      },
    ],
  };
}

function manualGiveawayInput(eventId: string): CreateGiveawayInput {
  return {
    eventId,
    title: "Disposable manual replacement campaign",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 5,
    mechanics: "An organizer selects one frozen entry and may replace a terminal award.",
    terms: "Disposable integration-test terms.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "hidden",
    eligibilityGroups: [
      {
        id: "active-pass",
        label: "Active RSVP and pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "manual-prize",
        title: "Disposable manual helmet",
        awardMode: "manual_selection",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Disposable manual prize item" }],
      },
    ],
  };
}

describe("Prisma giveaway draw concurrency", () => {
  test("serializes two-client draw, redraw, and manual-replacement replays on the disposable database", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(
      process.env,
      (databaseUrl) => {
        const backend = PrismaTambikeBackend.create(databaseUrl);
        return {
          backend,
          $disconnect: () => backend.disconnect(),
        };
      },
    );
    const suffix = randomUUID();
    const previousEncryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 61).toString("base64");

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix,
        riderCount: 2,
      });
      const { eventId, organizerSession, adminSession } = fixture;
      const riderId = fixture.riders[0]?.userId;
      const secondRiderId = fixture.riders[1]?.userId;
      const riderSession = fixture.riders[0]?.sessionToken;
      const secondRiderSession = fixture.riders[1]?.sessionToken;
      if (!riderId || !secondRiderId || !riderSession || !secondRiderSession) {
        throw new Error("INTEGRATION_FIXTURE_RIDERS_MISSING");
      }

      const created = await backendClients.primary.backend.createGiveaway(
        organizerSession,
        eventId,
        giveawayInput(eventId),
      );
      await backendClients.primary.backend.submitGiveawayForReview(organizerSession, created.id);
      await backendClients.primary.backend.reviewGiveawayCompliance(adminSession, created.id, {
        decision: "approved",
      });
      await backendClients.primary.backend.openGiveaway(organizerSession, created.id);

      const [firstLock, secondLock] = await Promise.all([
        backendClients.primary.backend.lockGiveaway(organizerSession, created.id),
        backendClients.secondary.backend.lockGiveaway(organizerSession, created.id),
      ]);
      expect(secondLock.snapshot).toEqual(firstLock.snapshot);

      const drawInput = { giveawayId: created.id, idempotencyKey: `draw-${suffix}` };
      const [firstDraw, secondDraw] = await Promise.all([
        backendClients.primary.backend.runGiveawayDraw(organizerSession, drawInput),
        backendClients.secondary.backend.runGiveawayDraw(organizerSession, drawInput),
      ]);
      expect(secondDraw).toEqual(firstDraw);
      expect(firstDraw.verification.seed).toBeUndefined();

      const originalAward = await rawClients.primary.giveawayAward.findFirst({
        where: { giveawayId: created.id, drawId: firstDraw.drawId, isCurrent: true },
        select: { id: true, winnerUserId: true },
      });
      expect(originalAward).not.toBeNull();
      if (!originalAward) throw new Error("INTEGRATION_DRAW_AWARD_MISSING");

      const publication = await backendClients.primary.backend.publishGiveawayDraw(
        organizerSession,
        created.id,
        firstDraw.drawId,
      );
      await backendClients.primary.backend.voidGiveawayAward(
        adminSession,
        originalAward.id,
        "Disposable integration redraw reason",
      );

      const redrawInput = {
        awardId: originalAward.id,
        idempotencyKey: `redraw-${suffix}`,
        reason: "Disposable integration redraw reason",
      };
      const [firstRedraw, secondRedraw] = await Promise.all([
        backendClients.primary.backend.redrawGiveawayAward(organizerSession, redrawInput),
        backendClients.secondary.backend.redrawGiveawayAward(organizerSession, redrawInput),
      ]);
      expect(secondRedraw).toEqual(firstRedraw);
      expect(firstRedraw.drawId).not.toBe(firstDraw.drawId);
      expect(firstRedraw.verification).toMatchObject({
        commitment: publication.commitment,
        snapshotDigest: publication.snapshotDigest,
        seed: publication.seed,
      });
      const currentAward = await rawClients.primary.giveawayAward.findFirst({
        where: { giveawayId: created.id, isCurrent: true },
        select: { id: true, predecessorAwardId: true, winnerUserId: true },
      });
      expect(currentAward).toMatchObject({ predecessorAwardId: originalAward.id });
      expect(currentAward?.winnerUserId).not.toBe(originalAward.winnerUserId);

      const directCampaign = await backendClients.primary.backend.createGiveaway(
        organizerSession,
        eventId,
        directGiveawayInput(eventId),
      );
      await backendClients.primary.backend.submitGiveawayForReview(organizerSession, directCampaign.id);
      await backendClients.primary.backend.reviewGiveawayCompliance(adminSession, directCampaign.id, {
        decision: "approved",
      });
      await backendClients.primary.backend.openGiveaway(organizerSession, directCampaign.id);
      const originalDirectAward = await rawClients.primary.giveawayAward.findFirst({
        where: { giveawayId: directCampaign.id, drawId: null, isCurrent: true },
        select: { id: true, entryId: true, winnerUserId: true, prizeItemId: true },
      });
      expect(originalDirectAward).not.toBeNull();
      if (!originalDirectAward) throw new Error("INTEGRATION_DIRECT_AWARD_MISSING");

      await backendClients.primary.backend.lockGiveaway(organizerSession, directCampaign.id);
      await expect(
        rawClients.primary.giveawayEntry.update({
          where: { id: originalDirectAward.entryId },
          data: {
            riderId: originalDirectAward.winnerUserId === riderId ? secondRiderId : riderId,
          },
        }),
      ).rejects.toThrow("GiveawayEntry.riderId scope field is immutable once created");
      const directDraw = await backendClients.primary.backend.runGiveawayDraw(organizerSession, {
        giveawayId: directCampaign.id,
        idempotencyKey: `direct-draw-${suffix}`,
      });
      await backendClients.primary.backend.publishGiveawayDraw(
        organizerSession,
        directCampaign.id,
        directDraw.drawId,
      );
      const [replacementDirectEntry, directPrizePool] = await Promise.all([
        rawClients.primary.giveawayEntry.findFirst({
          where: {
            giveawayId: directCampaign.id,
            riderId: { not: originalDirectAward.winnerUserId },
          },
          select: {
            id: true,
            riderId: true,
            eligibilityCycleAt: true,
            qualifiedSourceFingerprint: true,
          },
        }),
        rawClients.primary.giveawayPrizePool.findFirst({
          where: { giveawayId: directCampaign.id, awardMode: "first_come" },
          select: { id: true },
        }),
      ]);
      expect(replacementDirectEntry).not.toBeNull();
      expect(directPrizePool).not.toBeNull();
      if (!replacementDirectEntry || !directPrizePool) {
        throw new Error("INTEGRATION_DIRECT_REPLACEMENT_PROVENANCE_MISSING");
      }
      await rawClients.primary.giveawayEntry.update({
        where: { id: replacementDirectEntry.id },
        data: { qualifiedSourceFingerprint: `tampered-after-lock-${suffix}` },
      });
      await expect(
        rawClients.primary.giveawayAward.create({
          data: {
            id: `integration-tampered-direct-award-${suffix}`,
            giveawayId: directCampaign.id,
            entryId: replacementDirectEntry.id,
            prizePoolId: directPrizePool.id,
            prizeItemId: originalDirectAward.prizeItemId,
            winnerUserId: replacementDirectEntry.riderId,
            status: "voided",
            isCurrent: false,
            directAllocationKey: `direct:${replacementDirectEntry.id}:${directPrizePool.id}:${replacementDirectEntry.eligibilityCycleAt.toISOString()}`,
            allocationEligibilityAt: replacementDirectEntry.eligibilityCycleAt,
            opaqueClaimReference: `integration-tampered-direct-${suffix}`,
          },
        }),
      ).rejects.toThrow("GiveawayAward locked direct allocations require matching frozen snapshot provenance");
      const directWinnerSession =
        originalDirectAward.winnerUserId === riderId ? riderSession : secondRiderSession;
      await expect(
        backendClients.primary.backend.declineGiveawayAward(
          directWinnerSession,
          originalDirectAward.id,
          "Disposable post-lock direct decline must preserve snapshot provenance",
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
      expect(
        await rawClients.primary.giveawayAward.findUnique({
          where: { id: originalDirectAward.id },
          select: { isCurrent: true, status: true },
        }),
      ).toMatchObject({ isCurrent: true });
      await rawClients.primary.giveawayEntry.update({
        where: { id: replacementDirectEntry.id },
        data: { qualifiedSourceFingerprint: replacementDirectEntry.qualifiedSourceFingerprint },
      });
      await backendClients.primary.backend.declineGiveawayAward(
        directWinnerSession,
        originalDirectAward.id,
        "Disposable post-lock direct decline",
      );
      const [historicalDirectAward, replacementDirectAward] = await Promise.all([
        rawClients.primary.giveawayAward.findUnique({
          where: { id: originalDirectAward.id },
          select: { isCurrent: true, status: true },
        }),
        rawClients.primary.giveawayAward.findFirst({
          where: {
            giveawayId: directCampaign.id,
            drawId: null,
            isCurrent: true,
            id: { not: originalDirectAward.id },
          },
          select: { winnerUserId: true, prizeItemId: true },
        }),
      ]);
      expect(historicalDirectAward).toMatchObject({ isCurrent: false, status: "declined" });
      expect(replacementDirectAward).toMatchObject({
        prizeItemId: originalDirectAward.prizeItemId,
      });
      expect(replacementDirectAward?.winnerUserId).not.toBe(originalDirectAward.winnerUserId);

      const manualCampaign = await backendClients.primary.backend.createGiveaway(
        organizerSession,
        eventId,
        manualGiveawayInput(eventId),
      );
      await backendClients.primary.backend.submitGiveawayForReview(organizerSession, manualCampaign.id);
      await backendClients.primary.backend.reviewGiveawayCompliance(adminSession, manualCampaign.id, {
        decision: "approved",
      });
      await backendClients.primary.backend.openGiveaway(organizerSession, manualCampaign.id);
      await backendClients.primary.backend.lockGiveaway(organizerSession, manualCampaign.id);
      const manualPrizePool = await rawClients.primary.giveawayPrizePool.findFirst({
        where: { giveawayId: manualCampaign.id, awardMode: "manual_selection" },
        select: { id: true },
      });
      if (!manualPrizePool) throw new Error("INTEGRATION_MANUAL_PRIZE_POOL_MISSING");
      const initialManualCandidates =
        await backendClients.primary.backend.listGiveawayManualSelectionCandidates(
          organizerSession,
          manualCampaign.id,
          manualPrizePool.id,
        );
      expect(initialManualCandidates).toHaveLength(2);
      const initialManualCandidate = initialManualCandidates[0];
      if (!initialManualCandidate) throw new Error("INTEGRATION_MANUAL_CANDIDATE_MISSING");
      const initialManualDraw = await backendClients.primary.backend.selectManualGiveawayAward(
        organizerSession,
        {
          giveawayId: manualCampaign.id,
          prizePoolId: manualPrizePool.id,
          snapshotEntryId: initialManualCandidate.snapshotEntryId,
          reason: "Disposable initial manual selection",
          idempotencyKey: `manual-selection-${suffix}`,
        },
      );
      const manualPublication = await backendClients.primary.backend.publishGiveawayDraw(
        organizerSession,
        manualCampaign.id,
        initialManualDraw.drawId,
      );
      const originalManualAward = await rawClients.primary.giveawayAward.findFirst({
        where: { giveawayId: manualCampaign.id, drawId: initialManualDraw.drawId, isCurrent: true },
        select: {
          id: true,
          drawId: true,
          prizeItemId: true,
          snapshotEntryId: true,
          winnerUserId: true,
          draw: { select: { snapshotId: true, algorithmVersion: true, status: true } },
        },
      });
      if (
        !originalManualAward ||
        !originalManualAward.prizeItemId ||
        !originalManualAward.snapshotEntryId ||
        !originalManualAward.draw
      ) {
        throw new Error("INTEGRATION_MANUAL_AWARD_MISSING");
      }
      expect(originalManualAward.draw).toMatchObject({
        algorithmVersion: "manual-selection-v1",
        status: "published",
      });
      await backendClients.primary.backend.voidGiveawayAward(
        adminSession,
        originalManualAward.id,
        "Disposable manual replacement reason",
      );
      const manualReplacementOptions =
        await backendClients.primary.backend.listManualGiveawayReplacementCandidates(
          organizerSession,
          originalManualAward.id,
        );
      expect(manualReplacementOptions).toMatchObject({
        sourceAwardId: originalManualAward.id,
        claimDeadlineRequired: false,
      });
      expect(manualReplacementOptions.candidates).toHaveLength(1);
      const manualReplacementCandidate = manualReplacementOptions.candidates[0];
      if (!manualReplacementCandidate) {
        throw new Error("INTEGRATION_MANUAL_REPLACEMENT_CANDIDATE_MISSING");
      }
      expect(manualReplacementCandidate.snapshotEntryId).not.toBe(
        originalManualAward.snapshotEntryId,
      );
      const manualReplacementInput = {
        sourceAwardId: originalManualAward.id,
        snapshotEntryId: manualReplacementCandidate.snapshotEntryId,
        reason: "Disposable manual replacement reason",
        idempotencyKey: `manual-replacement-${suffix}`,
      };
      const [firstManualReplacement, secondManualReplacement] = await Promise.all([
        backendClients.primary.backend.replaceManualGiveawayAward(
          organizerSession,
          manualReplacementInput,
        ),
        backendClients.secondary.backend.replaceManualGiveawayAward(
          organizerSession,
          manualReplacementInput,
        ),
      ]);
      expect(secondManualReplacement).toEqual(firstManualReplacement);
      expect(firstManualReplacement.drawId).not.toBe(initialManualDraw.drawId);
      expect(firstManualReplacement.verification).toMatchObject({
        commitment: manualPublication.commitment,
        snapshotDigest: manualPublication.snapshotDigest,
        seed: manualPublication.seed,
        algorithmVersion: "manual-selection-v1",
      });

      const [historicalManualAward, currentManualAward, replacementManualDraw, currentAwardCount] =
        await Promise.all([
          rawClients.primary.giveawayAward.findUnique({
            where: { id: originalManualAward.id },
            select: { isCurrent: true, status: true, prizeItemId: true },
          }),
          rawClients.primary.giveawayAward.findFirst({
            where: {
              giveawayId: manualCampaign.id,
              predecessorAwardId: originalManualAward.id,
              isCurrent: true,
            },
            select: {
              id: true,
              prizeItemId: true,
              snapshotEntryId: true,
              predecessorAwardId: true,
              winnerUserId: true,
            },
          }),
          rawClients.primary.giveawayDraw.findUnique({
            where: { id: firstManualReplacement.drawId },
            select: { snapshotId: true, type: true, status: true, algorithmVersion: true },
          }),
          rawClients.primary.giveawayAward.count({
            where: {
              giveawayId: manualCampaign.id,
              prizeItemId: originalManualAward.prizeItemId,
              isCurrent: true,
            },
          }),
        ]);
      expect(historicalManualAward).toMatchObject({
        isCurrent: false,
        status: "voided",
        prizeItemId: originalManualAward.prizeItemId,
      });
      expect(currentManualAward).toMatchObject({
        predecessorAwardId: originalManualAward.id,
        prizeItemId: originalManualAward.prizeItemId,
        snapshotEntryId: manualReplacementCandidate.snapshotEntryId,
      });
      expect(currentManualAward?.winnerUserId).not.toBe(originalManualAward.winnerUserId);
      expect(currentAwardCount).toBe(1);
      expect(replacementManualDraw).toMatchObject({
        snapshotId: originalManualAward.draw.snapshotId,
        type: "redraw",
        status: "published",
        algorithmVersion: "manual-selection-v1",
      });
      if (!currentManualAward) throw new Error("INTEGRATION_MANUAL_SUCCESSOR_MISSING");
      const successorRiderSession =
        currentManualAward.winnerUserId === riderId ? riderSession : secondRiderSession;
      const successorClaim = await backendClients.primary.backend.issueGiveawayClaimToken(
        successorRiderSession,
        currentManualAward.id,
      );
      await backendClients.primary.backend.verifyGiveawayClaim(adminSession, {
        payload: successorClaim.qrPayload,
        method: "manual",
        presenceObserved: true,
        idempotencyKey: `manual-replacement-verify-${suffix}`,
      });
      await backendClients.primary.backend.fulfillGiveawayAward(adminSession, {
        awardId: currentManualAward.id,
        idempotencyKey: `manual-replacement-fulfill-${suffix}`,
        reference: "desk:manual-replacement",
      });
      expect(
        await rawClients.primary.giveawayPrizeItem.findUnique({
          where: { id: originalManualAward.prizeItemId },
          select: { status: true },
        }),
      ).toMatchObject({ status: "fulfilled" });
      expect(
        await backendClients.primary.backend.replaceManualGiveawayAward(
          organizerSession,
          manualReplacementInput,
        ),
      ).toEqual(firstManualReplacement);
    } finally {
      if (previousEncryptionKey === undefined) {
        delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      } else {
        process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousEncryptionKey;
      }
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  }, 30_000);
});
