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
    title: "Synthetic live presentation campaign",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 5,
    mechanics: "Each eligible synthetic rider receives one entry.",
    terms: "Synthetic integration-test terms.",
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
        title: "Synthetic helmet",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Synthetic prize item" }],
      },
    ],
  };
}

describe("Prisma live giveaway presentation", () => {
  test("persists rider-owned consent and freezes its privacy-safe label at lock", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(
      process.env,
      (databaseUrl) => {
        const backend = PrismaTambikeBackend.create(databaseUrl);
        return { backend, $disconnect: () => backend.disconnect() };
      },
    );
    const suffix = randomUUID();
    const organizerId = `presentation-organizer-${suffix}`;
    const organizerProfileId = `presentation-organizer-profile-${suffix}`;
    const adminId = `presentation-admin-${suffix}`;
    const riderId = `presentation-rider-${suffix}`;
    const outsiderId = `presentation-outsider-${suffix}`;
    const eventId = `presentation-event-${suffix}`;
    const organizerSession = `presentation-organizer-session-${suffix}`;
    const adminSession = `presentation-admin-session-${suffix}`;
    const riderSession = `presentation-rider-session-${suffix}`;
    const outsiderSession = `presentation-outsider-session-${suffix}`;
    const previousEncryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 79).toString("base64");

    try {
      await rawClients.primary.$transaction(async (tx) => {
        await tx.user.createMany({
          data: [
            {
              id: organizerId,
              displayName: "Synthetic Organizer",
              email: `presentation-organizer-${suffix}@example.test`,
              passwordHash: "integration-only",
              role: "organizer",
              verificationStatus: "APPROVED",
              area: "Antipolo",
            },
            {
              id: adminId,
              displayName: "Synthetic Administrator",
              email: `presentation-admin-${suffix}@example.test`,
              passwordHash: "integration-only",
              role: "admin",
              verificationStatus: "APPROVED",
              area: "Antipolo",
            },
            {
              id: riderId,
              displayName: "Synthetic Rider",
              email: `presentation-rider-${suffix}@example.test`,
              passwordHash: "integration-only",
              role: "rider",
              verificationStatus: "UNVERIFIED",
              area: "Antipolo",
            },
            {
              id: outsiderId,
              displayName: "Synthetic Outsider",
              email: `presentation-outsider-${suffix}@example.test`,
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
            organizerType: "Synthetic integration organizer",
            displayName: "Synthetic Organizer",
            realName: "Synthetic Organizer",
            contactNumber: "09000000000",
            fbLink: "https://example.test/organizer",
            reason: "Synthetic integration test only.",
            pastEventLinks: [],
            verificationStatus: "APPROVED",
          },
        });
        await tx.event.create({
          data: {
            id: eventId,
            slug: eventId,
            title: "Synthetic live presentation event",
            type: "BIKE_NIGHT",
            status: "PUBLISHED",
            organizerId: organizerProfileId,
            dateLabel: "August 15, 2030",
            timeLabel: "7:00 PM - 10:00 PM",
            area: "Antipolo",
            expectedRiders: 1,
            description: "Synthetic integration event.",
            whatHappens: "Exercises live presentation consent.",
            poster: "/integration-poster.png",
            perkPreview: "Synthetic giveaway",
            tags: [],
            riskFlags: [],
            safetyRules: [],
          },
        });
        const rsvpId = `presentation-rsvp-${suffix}`;
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
        await tx.pass.create({
          data: {
            id: `presentation-pass-${suffix}`,
            eventId,
            userId: riderId,
            rsvpId,
            qrTokenHash: `presentation-pass-token-${suffix}`,
            status: "active",
          },
        });
        await tx.session.createMany({
          data: [
            {
              id: `presentation-session-organizer-${suffix}`,
              tokenHash: sessionTokenHash(organizerSession),
              userId: organizerId,
              expiresAt: new Date(Date.now() + 60_000),
            },
            {
              id: `presentation-session-admin-${suffix}`,
              tokenHash: sessionTokenHash(adminSession),
              userId: adminId,
              expiresAt: new Date(Date.now() + 60_000),
            },
            {
              id: `presentation-session-rider-${suffix}`,
              tokenHash: sessionTokenHash(riderSession),
              userId: riderId,
              expiresAt: new Date(Date.now() + 60_000),
            },
            {
              id: `presentation-session-outsider-${suffix}`,
              tokenHash: sessionTokenHash(outsiderSession),
              userId: outsiderId,
              expiresAt: new Date(Date.now() + 60_000),
            },
          ],
        });
      });

      const giveaway = await backendClients.primary.backend.createGiveaway(
        organizerSession,
        eventId,
        giveawayInput(eventId),
      );
      await backendClients.primary.backend.submitGiveawayForReview(organizerSession, giveaway.id);
      await backendClients.primary.backend.reviewGiveawayCompliance(adminSession, giveaway.id, {
        decision: "approved",
      });
      await backendClients.primary.backend.openGiveaway(organizerSession, giveaway.id);

      await expect(
        backendClients.primary.backend.setGiveawayLivePresentationPreference(
          organizerSession,
          giveaway.id,
          true,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        backendClients.primary.backend.setGiveawayLivePresentationPreference(
          outsiderSession,
          giveaway.id,
          true,
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_NOT_ELIGIBLE" });

      const beforeOptIn = new Date();
      const optedInState = await backendClients.primary.backend.setGiveawayLivePresentationPreference(
        riderSession,
        giveaway.id,
        true,
      );
      const afterOptIn = new Date();
      expect(optedInState.livePresentation).toEqual({
        optedIn: true,
        canUpdate: true,
        labelPreview: "Synthetic R.",
      });

      const entry = await rawClients.primary.giveawayEntry.findUniqueOrThrow({
        where: { giveawayId_riderId: { giveawayId: giveaway.id, riderId } },
        select: {
          id: true,
          livePresentationOptedInAt: true,
          livePresentationRevokedAt: true,
        },
      });
      expect(entry.livePresentationOptedInAt).toBeInstanceOf(Date);
      expect(entry.livePresentationOptedInAt?.getTime()).toBeGreaterThanOrEqual(
        beforeOptIn.getTime(),
      );
      expect(entry.livePresentationOptedInAt?.getTime()).toBeLessThanOrEqual(afterOptIn.getTime());
      expect(entry.livePresentationRevokedAt).toBeNull();

      const consentAudit = await rawClients.primary.giveawayAuditEvent.findFirstOrThrow({
        where: {
          giveawayId: giveaway.id,
          action: "GIVEAWAY_LIVE_PRESENTATION_OPTED_IN",
        },
        select: {
          actorUserId: true,
          targetType: true,
          targetId: true,
          canonicalPayload: true,
          payload: true,
        },
      });
      expect(consentAudit).toEqual({
        actorUserId: riderId,
        targetType: "entry",
        targetId: entry.id,
        canonicalPayload: '{"optedIn":true}',
        payload: { optedIn: true },
      });

      const beforeRevocation = new Date();
      const revokedState = await backendClients.primary.backend.setGiveawayLivePresentationPreference(
        riderSession,
        giveaway.id,
        false,
      );
      const afterRevocation = new Date();
      expect(revokedState.livePresentation).toMatchObject({ optedIn: false, canUpdate: true });
      const revokedEntry = await rawClients.primary.giveawayEntry.findUniqueOrThrow({
        where: { id: entry.id },
        select: { livePresentationOptedInAt: true, livePresentationRevokedAt: true },
      });
      expect(revokedEntry.livePresentationOptedInAt).toEqual(entry.livePresentationOptedInAt);
      expect(revokedEntry.livePresentationRevokedAt).toBeInstanceOf(Date);
      expect(revokedEntry.livePresentationRevokedAt?.getTime()).toBeGreaterThanOrEqual(
        beforeRevocation.getTime(),
      );
      expect(revokedEntry.livePresentationRevokedAt?.getTime()).toBeLessThanOrEqual(
        afterRevocation.getTime(),
      );
      const revocationAudit = await rawClients.primary.giveawayAuditEvent.findFirstOrThrow({
        where: {
          giveawayId: giveaway.id,
          action: "GIVEAWAY_LIVE_PRESENTATION_REVOKED",
        },
        select: { canonicalPayload: true, payload: true },
      });
      expect(revocationAudit).toEqual({
        canonicalPayload: '{"optedIn":false}',
        payload: { optedIn: false },
      });

      await backendClients.primary.backend.setGiveawayLivePresentationPreference(
        riderSession,
        giveaway.id,
        true,
      );
      const relockedPreference = await rawClients.primary.giveawayEntry.findUniqueOrThrow({
        where: { id: entry.id },
        select: { livePresentationOptedInAt: true, livePresentationRevokedAt: true },
      });
      expect(relockedPreference.livePresentationOptedInAt?.getTime()).toBeGreaterThanOrEqual(
        revokedEntry.livePresentationRevokedAt?.getTime() ?? 0,
      );
      expect(relockedPreference.livePresentationRevokedAt).toBeNull();

      const locked = await backendClients.primary.backend.lockGiveaway(
        organizerSession,
        giveaway.id,
      );
      const frozenEntry = await rawClients.primary.giveawaySnapshotEntry.findFirstOrThrow({
        where: { entryId: entry.id, snapshot: { is: { giveawayId: giveaway.id } } },
        select: { presentationLabel: true, presentationLabelKind: true },
      });
      expect(frozenEntry).toEqual({
        presentationLabel: "Synthetic R.",
        presentationLabelKind: "consented_name",
      });
      expect(locked.snapshot.candidateCount).toBe(1);

      await rawClients.primary.user.update({
        where: { id: riderId },
        data: { displayName: "Synthetic Changed Rider" },
      });
      const lockedState = await backendClients.primary.backend.getRiderGiveawayState(
        riderSession,
        giveaway.id,
      );
      expect(lockedState.livePresentation).toEqual({
        optedIn: true,
        canUpdate: false,
        labelPreview: frozenEntry.presentationLabel,
      });
      await expect(
        backendClients.primary.backend.setGiveawayLivePresentationPreference(
          riderSession,
          giveaway.id,
          false,
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_NOT_OPEN" });
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
