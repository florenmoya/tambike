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
] as const;

const ongoingAuditActions = [
  "GIVEAWAY_CREATED",
  "GIVEAWAY_SUBMITTED_FOR_REVIEW",
  "GIVEAWAY_COMPLIANCE_REVIEWED",
  "GIVEAWAY_OPENED",
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
        where: { email: "ops@tambike.example" },
        create: {
          id: `integration-sample-raffle-admin-${suffix}`,
          displayName: "Integration Sample Raffle Administrator",
          email: "ops@tambike.example",
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
        const provisioner = createPrismaSampleRaffleProvisioner(
          databaseUrl,
          databaseUrl,
          manifest,
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
          winnerAlias: "Raffle Sample Rider",
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
        awards: [{
          isCurrent: true,
          status: "fulfilled",
          publicWinnerAlias: "Raffle Sample Rider",
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
        snapshot: null,
        draws: [],
        awards: [],
      });
      expect(ongoing.auditEvents.map((event) => event.action)).toEqual(
        ongoingAuditActions,
      );
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
