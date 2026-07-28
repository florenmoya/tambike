import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { describe, expect, test } from "vitest";

import {
  COMPLETED_SAMPLE_RAFFLE_TITLE,
  ONGOING_SAMPLE_RAFFLE_TITLE,
  SAMPLE_RAFFLE_WINNER_ALIAS,
  createPrismaSampleRaffleProvisioner,
  provisionSampleRaffles,
  type SampleRaffleManifest,
  type SampleRaffleProvisioningInput,
} from "../../src/server/giveaways/sample-raffles";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";
import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import { requirePrismaIntegrationTestDatabaseUrl } from "./environment";
import { createPrismaEventFixture } from "./fixtures";

const completedAuditActions = [
  "GIVEAWAY_CREATED",
  "GIVEAWAY_SUBMITTED_FOR_REVIEW",
  "GIVEAWAY_COMPLIANCE_REVIEWED",
  "GIVEAWAY_OPENED",
  "GIVEAWAY_MANUAL_ENTRY_GRANTED",
  "GIVEAWAY_ENTRY_RECONCILED",
  "GIVEAWAY_LOCKED",
  "GIVEAWAY_MANUAL_AWARD_SELECTED",
  "GIVEAWAY_DRAW_PUBLISHED",
  "GIVEAWAY_WINNER_PUBLICATION_OPTED_IN",
  "GIVEAWAY_CLAIM_TOKEN_ISSUED",
  "GIVEAWAY_CLAIM_VERIFIED",
  "GIVEAWAY_AWARD_FULFILLED",
  "GIVEAWAY_COMPLETED",
  "GIVEAWAY_UPDATED",
] as const;

const ongoingAuditActions = [
  "GIVEAWAY_CREATED",
  "GIVEAWAY_SUBMITTED_FOR_REVIEW",
  "GIVEAWAY_COMPLIANCE_REVIEWED",
  "GIVEAWAY_OPENED",
  "GIVEAWAY_UPDATED",
] as const;

function validIntegrationInput(): SampleRaffleProvisioningInput {
  return {
    confirmedProduction: true,
    organizerPassword: "integration-organizer-password",
    adminPassword: "integration-admin-password",
    winnerPassword: "integration-winner-password",
    drawEncryptionKeyPresent: true,
    databaseTargetPresent: true,
    directLockPresent: true,
  };
}

describe("guarded Prisma sample raffle provisioner", () => {
  test("provisions one completed winner and one open raffle idempotently", async () => {
    const databaseUrl = requirePrismaIntegrationTestDatabaseUrl(process.env);
    const clients = createPrismaIntegrationClients();
    const prisma = clients.primary;
    const suffix = randomUUID();
    const previousEncryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 83).toString("base64");

    try {
      const fixture = await createPrismaEventFixture(prisma, {
        suffix,
        riderCount: 2,
      });
      const organizerPasswordHash = await bcrypt.hash(
        validIntegrationInput().organizerPassword!,
        4,
      );
      const adminPasswordHash = await bcrypt.hash(
        validIntegrationInput().adminPassword!,
        4,
      );

      await prisma.user.update({
        where: { id: fixture.organizerId },
        data: { passwordHash: organizerPasswordHash },
      });
      await prisma.user.upsert({
        where: { email: "admin@bayanko.ph" },
        create: {
          id: `integration-sample-raffle-admin-${suffix}`,
          displayName: "Integration Sample Raffle Administrator",
          email: "admin@bayanko.ph",
          passwordHash: adminPasswordHash,
          role: "admin",
          verificationStatus: "APPROVED",
          area: "Antipolo",
        },
        update: {
          passwordHash: adminPasswordHash,
          role: "admin",
          verificationStatus: "APPROVED",
        },
      });

      const manifest: SampleRaffleManifest = {
        eventId: fixture.eventId,
        completedTitle: COMPLETED_SAMPLE_RAFFLE_TITLE,
        ongoingTitle: ONGOING_SAMPLE_RAFFLE_TITLE,
        winnerEmail: `integration-sample-raffle-winner-${suffix}@example.test`,
        winnerName: "Raffle Winner — Sample Rider",
        winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
      };
      const provisionOnce = async () => {
        const provisioner = await createPrismaSampleRaffleProvisioner(
          databaseUrl,
          databaseUrl,
          manifest,
          {
            fetchPhoto: async () =>
              new Response(Uint8Array.from([1, 2, 3]), {
                headers: { "content-type": "image/jpeg" },
              }),
            normalizePhoto: async () => ({
              bytes: Buffer.from("integration-sample-raffle-image"),
              mimeType: "image/webp",
              width: 1200,
              height: 900,
            }),
            mediaStore: {
              async putObject() {},
              async deleteObject() {},
            },
          },
        );
        try {
          return await provisionSampleRaffles(
            validIntegrationInput(),
            provisioner.dependencies,
            manifest,
          );
        } finally {
          await provisioner.close();
        }
      };

      const first = await provisionOnce();
      expect(first).toMatchObject({
        completed: {
          state: "completed",
          winnerCount: 1,
          winnerAlias: "Cafe Classico Rider",
        },
        ongoing: { state: "open", winnerCount: 0 },
        changed: true,
      });

      const second = await provisionOnce();
      expect(second).toMatchObject({
        completed: { giveawayId: first.completed.giveawayId },
        ongoing: { giveawayId: first.ongoing.giveawayId },
        changed: false,
      });

      expect(await prisma.eventGiveaway.count({
        where: {
          eventId: fixture.eventId,
          title: {
            in: [
              "Cafe Classico Helmet Raffle",
              "Weekend Rider Gear Raffle",
            ],
          },
        },
      })).toBe(2);

      const completed = await prisma.eventGiveaway.findUniqueOrThrow({
        where: { id: first.completed.giveawayId },
        select: {
          status: true,
          mechanicsVersions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { mechanics: true, terms: true },
          },
          prizePools: {
            orderBy: { position: "asc" },
            select: {
              publicTitle: true,
              publicDescription: true,
              publicImage: {
                select: { mediaId: true, mimeType: true, width: true, height: true },
              },
            },
          },
          awards: {
            orderBy: { id: "asc" },
            select: {
              isCurrent: true,
              status: true,
              publicWinnerAlias: true,
              winnerUserId: true,
              winner: { select: { email: true } },
            },
          },
          auditEvents: {
            orderBy: { sequence: "asc" },
            select: { action: true },
          },
        },
      });
      const dedicatedWinner = await prisma.user.findUniqueOrThrow({
        where: { email: manifest.winnerEmail },
        select: { id: true },
      });
      expect(completed).toMatchObject({
        status: "completed",
        mechanicsVersions: [{
          mechanics: "One eligible rider was selected from valid entries.",
          terms:
            "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.",
        }],
        prizePools: [{
          publicTitle: "Cafe Classico Helmet",
          publicDescription: "A full-face helmet for safer everyday rides.",
          publicImage: {
            mediaId: "sample-raffle-helmet-photo-v1",
            mimeType: "image/webp",
            width: 1200,
            height: 900,
          },
        }],
        awards: [{
          isCurrent: true,
          status: "fulfilled",
          publicWinnerAlias: "Cafe Classico Rider",
          winner: { email: manifest.winnerEmail },
        }],
      });
      expect(completed.awards).toHaveLength(1);
      expect(completed.awards.map((award) => award.winnerUserId)).toEqual([
        dedicatedWinner.id,
      ]);
      for (const rider of fixture.riders) {
        expect(completed.awards.map((award) => award.winnerUserId)).not.toContain(
          rider.userId,
        );
      }
      expect(completed.auditEvents.map((event) => event.action)).toEqual(
        completedAuditActions,
      );

      const ongoing = await prisma.eventGiveaway.findUniqueOrThrow({
        where: { id: first.ongoing.giveawayId },
        select: {
          status: true,
          mechanicsVersions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { mechanics: true, terms: true },
          },
          prizePools: {
            orderBy: { position: "asc" },
            select: {
              publicTitle: true,
              publicDescription: true,
              publicImage: {
                select: { mediaId: true, mimeType: true, width: true, height: true },
              },
            },
          },
          snapshot: { select: { id: true } },
          draws: { select: { id: true } },
          awards: { select: { id: true } },
          auditEvents: {
            orderBy: { sequence: "asc" },
            select: { action: true },
          },
        },
      });
      expect(ongoing).toMatchObject({
        status: "open",
        mechanicsVersions: [{
          mechanics: "Registered event riders may enter once while the raffle is open.",
          terms:
            "One winner will receive the Weekend Rider Gear Package. The organizer will announce and contact the winner after the draw.",
        }],
        prizePools: [{
          publicTitle: "Weekend Rider Gear Package",
          publicDescription: "Helmet, riding gloves, and Tambike gear for your next ride.",
          publicImage: {
            mediaId: "sample-raffle-gear-photo-v1",
            mimeType: "image/webp",
            width: 1200,
            height: 900,
          },
        }],
        snapshot: null,
        draws: [],
        awards: [],
      });
      expect(ongoing.auditEvents.map((event) => event.action)).toEqual(
        ongoingAuditActions,
      );

      const publicBackend = PrismaTambikeBackend.create(databaseUrl);
      try {
        const surprise = await publicBackend.createGiveaway(
          fixture.organizerSession,
          fixture.eventId,
          {
            eventId: fixture.eventId,
            title: "Disposable Surprise Raffle",
            kind: "raffle",
            entryMode: "opt_in",
            maxEntriesPerRider: 1,
            mechanics: "Registered riders may enter this disposable surprise raffle once.",
            terms: "Disposable Prisma redaction contract only.",
            timeZone: "Asia/Manila",
            winnerLimits: { perRider: 1, total: 1 },
            organizerAttestation: true,
            publicVisibility: "event_page",
            presenceVerificationRequired: false,
            eligibilityGroups: [
              {
                id: "surprise-active-pass",
                label: "Active RSVP and pass",
                weight: 1,
                conditions: [{ source: "active_rsvp_pass" }],
              },
            ],
            prizePools: [
              {
                id: "surprise-prize-pool",
                title: "SENTINEL_INTERNAL_POOL_TITLE",
                awardMode: "random_draw",
                fulfilmentMode: "onsite",
                publicPresentation: {
                  disclosure: "surprise",
                  title: "SENTINEL_HIDDEN_PUBLIC_TITLE",
                  description: "SENTINEL_HIDDEN_PUBLIC_DESCRIPTION",
                },
                inventory: { kind: "finite", quantity: 1 },
                items: [{ title: "SENTINEL_INTERNAL_ITEM_TITLE" }],
              },
            ],
          },
        );
        await publicBackend.submitGiveawayForReview(
          fixture.organizerSession,
          surprise.id,
        );
        await publicBackend.reviewGiveawayCompliance(
          fixture.adminSession,
          surprise.id,
          { decision: "approved" },
        );
        await publicBackend.openGiveaway(
          fixture.organizerSession,
          surprise.id,
        );

        const publicGiveaways = await publicBackend.listPublicGiveawaysForEvent(
          fixture.eventId,
        );
        const completedPublic = publicGiveaways.find(
          ({ giveaway }) => giveaway.id === first.completed.giveawayId,
        );
        const ongoingPublic = publicGiveaways.find(
          ({ giveaway }) => giveaway.id === first.ongoing.giveawayId,
        );
        const surprisePublic = publicGiveaways.find(
          ({ giveaway }) => giveaway.id === surprise.id,
        );

        expect(completedPublic?.giveaway.prizePools).toEqual([
          expect.objectContaining({
            presentation: {
              disclosure: "revealed",
              title: "Cafe Classico Helmet",
            },
          }),
        ]);
        expect(ongoingPublic?.giveaway.prizePools).toEqual([
          expect.objectContaining({
            presentation: {
              disclosure: "revealed",
              title: "Weekend Rider Gear Package",
            },
          }),
        ]);
        for (const publicGiveaway of [completedPublic, ongoingPublic]) {
          expect(publicGiveaway).toBeDefined();
          for (const prizePool of publicGiveaway!.giveaway.prizePools) {
            expect(prizePool).not.toHaveProperty("title");
            expect(prizePool).not.toHaveProperty("items");
          }
        }

        expect(surprisePublic?.giveaway.prizePools).toHaveLength(1);
        expect(
          surprisePublic?.giveaway.prizePools[0]?.presentation,
        ).toEqual({
          disclosure: "surprise",
          title: "Surprise prize",
        });
        expect(
          surprisePublic?.giveaway.prizePools[0]?.presentation,
        ).not.toHaveProperty("description");
        expect(
          surprisePublic?.giveaway.prizePools[0]?.presentation,
        ).not.toHaveProperty("image");
        expect(surprisePublic?.giveaway.prizePools[0]).not.toHaveProperty(
          "title",
        );
        expect(surprisePublic?.giveaway.prizePools[0]).not.toHaveProperty(
          "items",
        );
        const serializedSurprise = JSON.stringify(surprisePublic);
        expect(serializedSurprise).not.toContain('"items"');
        for (const hiddenValue of [
          "SENTINEL_INTERNAL_POOL_TITLE",
          "SENTINEL_INTERNAL_ITEM_TITLE",
          "SENTINEL_HIDDEN_PUBLIC_TITLE",
          "SENTINEL_HIDDEN_PUBLIC_DESCRIPTION",
        ]) {
          expect(serializedSurprise).not.toContain(hiddenValue);
        }
      } finally {
        await publicBackend.disconnect();
      }
    } finally {
      if (previousEncryptionKey === undefined) {
        delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      } else {
        process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousEncryptionKey;
      }
      await closePrismaIntegrationClientPair(clients);
    }
  });
});
