import { createHash, randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";

function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

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

describe("Prisma giveaway draw concurrency", () => {
  test("serializes two-client lock, draw, and redraw replays on the disposable database", async () => {
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
    const organizerId = `integration-organizer-${suffix}`;
    const organizerProfileId = `integration-organizer-profile-${suffix}`;
    const adminId = `integration-admin-${suffix}`;
    const riderId = `integration-rider-${suffix}`;
    const secondRiderId = `integration-rider-second-${suffix}`;
    const eventId = `integration-event-${suffix}`;
    const organizerSession = `integration-organizer-session-${suffix}`;
    const adminSession = `integration-admin-session-${suffix}`;
    const previousEncryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 61).toString("base64");

    try {
      await rawClients.primary.$transaction(async (tx) => {
        await tx.user.createMany({
          data: [
            {
              id: organizerId,
              displayName: "Integration Organizer",
              email: `integration-organizer-${suffix}@example.test`,
              passwordHash: "integration-only",
              role: "organizer",
              verificationStatus: "APPROVED",
              area: "Antipolo",
            },
            {
              id: adminId,
              displayName: "Integration Administrator",
              email: `integration-admin-${suffix}@example.test`,
              passwordHash: "integration-only",
              role: "admin",
              verificationStatus: "APPROVED",
              area: "Antipolo",
            },
            {
              id: riderId,
              displayName: "Integration Rider",
              email: `integration-rider-${suffix}@example.test`,
              passwordHash: "integration-only",
              role: "rider",
              verificationStatus: "UNVERIFIED",
              area: "Antipolo",
            },
            {
              id: secondRiderId,
              displayName: "Integration Second Rider",
              email: `integration-rider-second-${suffix}@example.test`,
              passwordHash: "integration-only",
              role: "rider",
              verificationStatus: "UNVERIFIED",
              area: "Antipolo",
            },
          ],
        });
        await tx.organizerProfile.create({
          data: {
            id: organizerProfileId,
            userId: organizerId,
            organizerType: "Integration test organizer",
            displayName: "Integration Organizer",
            realName: "Integration Organizer",
            contactNumber: "09000000000",
            fbLink: "https://example.test/organizer",
            reason: "Disposable integration test only.",
            pastEventLinks: [],
            verificationStatus: "APPROVED",
          },
        });
        await tx.event.create({
          data: {
            id: eventId,
            slug: eventId,
            title: "Disposable draw concurrency event",
            type: "BIKE_NIGHT",
            status: "PUBLISHED",
            organizerId: organizerProfileId,
            dateLabel: "August 15, 2030",
            timeLabel: "7:00 PM - 10:00 PM",
            area: "Antipolo",
            expectedRiders: 2,
            description: "Disposable integration event.",
            whatHappens: "Tests a serialized giveaway draw.",
            poster: "/integration-poster.png",
            perkPreview: "Disposable giveaway",
            tags: [],
            riskFlags: [],
            safetyRules: [],
          },
        });
        const rsvpId = `integration-rsvp-${suffix}`;
        const secondRsvpId = `integration-rsvp-second-${suffix}`;
        await tx.rSVP.create({
          data: {
            id: rsvpId,
            eventId,
            userId: riderId,
            status: "going",
            goingAt: new Date(),
            attendanceType: "direct",
          },
        });
        await tx.rSVP.create({
          data: {
            id: secondRsvpId,
            eventId,
            userId: secondRiderId,
            status: "going",
            goingAt: new Date(),
            attendanceType: "direct",
          },
        });
        await tx.pass.create({
          data: {
            id: `integration-pass-${suffix}`,
            eventId,
            userId: riderId,
            rsvpId,
            qrTokenHash: `integration-pass-token-${suffix}`,
            status: "active",
          },
        });
        await tx.pass.create({
          data: {
            id: `integration-pass-second-${suffix}`,
            eventId,
            userId: secondRiderId,
            rsvpId: secondRsvpId,
            qrTokenHash: `integration-pass-token-second-${suffix}`,
            status: "active",
          },
        });
        await tx.session.createMany({
          data: [
            {
              id: `integration-session-organizer-${suffix}`,
              tokenHash: sessionTokenHash(organizerSession),
              userId: organizerId,
              expiresAt: new Date(Date.now() + 60_000),
            },
            {
              id: `integration-session-admin-${suffix}`,
              tokenHash: sessionTokenHash(adminSession),
              userId: adminId,
              expiresAt: new Date(Date.now() + 60_000),
            },
          ],
        });
      });

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
    } finally {
      if (previousEncryptionKey === undefined) {
        delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      } else {
        process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousEncryptionKey;
      }
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
