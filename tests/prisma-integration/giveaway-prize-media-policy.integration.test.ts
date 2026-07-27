import { randomUUID } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import type {
  MemberMediaStore,
  StoredMemberMediaObject,
} from "../../src/server/member-media/store";
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
    title: "Prize media policy integration raffle",
    kind: "raffle",
    entryMode: "automatic",
    maxEntriesPerRider: 1,
    mechanics: "Going riders receive one entry.",
    terms: "One prize per rider.",
    timeZone: "Asia/Manila",
    entryOpensAt: "2099-07-25T10:00:00.000Z",
    entryClosesAt: "2099-07-25T12:00:00.000Z",
    drawAt: "2099-07-25T12:30:00.000Z",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "event_page",
    eligibilityGroups: [
      {
        id: "going-rider",
        label: "Going rider",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "helmet-pool",
        title: "Internal helmet inventory",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        publicPresentation: {
          disclosure: "revealed",
          title: "Weekend Rider Helmet",
        },
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Internal helmet SKU" }],
        eligibilityGroupIds: ["going-rider"],
      },
    ],
  };
}

describe("Prisma giveaway prize media policy", () => {
  test("resets compliance, audits safely, locks entrant history, and hides stale surprise media", async () => {
    const suffix = randomUUID();
    const objects = new Map<string, StoredMemberMediaObject>();
    let generated = 0;
    const store: MemberMediaStore = {
      createPresignedPost: vi.fn(async (input) => ({
        url: "https://uploads.example.test",
        fields: { key: input.key, "Content-Type": input.mimeType },
      })),
      getObject: vi.fn(async (key) => {
        const object = objects.get(key);
        if (!object) {
          throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        }
        return object;
      }),
      putObject: vi.fn(async (input) => {
        objects.set(input.key, {
          body: input.body,
          contentType: input.mimeType,
          contentLength: input.body.byteLength,
        });
      }),
      deleteObject: vi.fn(async (key) => {
        objects.delete(key);
      }),
    };
    const giveawayPrizeMedia = {
      store,
      createUuid: () => `prize-policy-${suffix}-${++generated}`,
      normalize: vi.fn(async () => ({
        bytes: Buffer.from("normalized-webp"),
        mimeType: "image/webp" as const,
        width: 1200,
        height: 900,
      })),
    };
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(
      process.env,
      (databaseUrl) => {
        const backend = PrismaTambikeBackend.create(databaseUrl, {
          giveawayPrizeMedia,
        });
        return { backend, $disconnect: () => backend.disconnect() };
      },
    );

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix,
        riderCount: 1,
      });
      const giveaway = await backendClients.primary.backend.createGiveaway(
        fixture.organizerSession,
        fixture.eventId,
        giveawayInput(fixture.eventId),
      );
      const workspace =
        await backendClients.primary.backend.getOrganizerGiveawayWorkspace(
          fixture.organizerSession,
          giveaway.id,
        );
      const prizePoolId = workspace.prizePools[0]?.id;
      if (!prizePoolId) throw new Error("PRIZE_POLICY_POOL_MISSING");

      await backendClients.primary.backend.submitGiveawayForReview(
        fixture.organizerSession,
        giveaway.id,
      );
      await backendClients.primary.backend.reviewGiveawayCompliance(
        fixture.adminSession,
        giveaway.id,
        { decision: "approved" },
      );
      await backendClients.primary.backend.scheduleGiveaway(
        fixture.organizerSession,
        giveaway.id,
      );
      const upload =
        await backendClients.primary.backend.createGiveawayPrizeImageUpload(
          fixture.organizerSession,
          giveaway.id,
          prizePoolId,
          "image/png",
        );
      objects.set(upload.key, {
        body: Buffer.from("png"),
        contentType: "image/png",
        contentLength: 3,
        lastModified: new Date(),
      });
      const image =
        await backendClients.primary.backend.finalizeGiveawayPrizeImage(
          fixture.organizerSession,
          {
            giveawayId: giveaway.id,
            prizePoolId,
            tempKey: upload.key,
            claimedMimeType: "image/png",
          },
        );

      await expect(
        rawClients.secondary.eventGiveaway.findUniqueOrThrow({
          where: { id: giveaway.id },
          select: {
            status: true,
            complianceStatus: true,
            complianceReviewerId: true,
            complianceReviewedAt: true,
            complianceReviewReason: true,
          },
        }),
      ).resolves.toEqual({
        status: "scheduled",
        complianceStatus: "draft",
        complianceReviewerId: null,
        complianceReviewedAt: null,
        complianceReviewReason: null,
      });
      await expect(
        rawClients.secondary.giveawayAuditEvent.findFirstOrThrow({
          where: {
            giveawayId: giveaway.id,
            action: "GIVEAWAY_UPDATED",
          },
          orderBy: { sequence: "desc" },
          select: {
            actorUserId: true,
            targetType: true,
            targetId: true,
            canonicalPayload: true,
            payload: true,
          },
        }),
      ).resolves.toEqual({
        actorUserId: fixture.organizerId,
        targetType: "giveaway",
        targetId: giveaway.id,
        canonicalPayload:
          '{"change":"public_prize_image","complianceStatus":"draft","operation":"replaced"}',
        payload: {
          change: "public_prize_image",
          complianceStatus: "draft",
          operation: "replaced",
        },
      });

      await backendClients.primary.backend.submitGiveawayForReview(
        fixture.organizerSession,
        giveaway.id,
      );
      await backendClients.primary.backend.reviewGiveawayCompliance(
        fixture.adminSession,
        giveaway.id,
        { decision: "approved" },
      );
      await rawClients.primary.giveawayPrizePool.update({
        where: { id: prizePoolId },
        data: {
          publicDisclosure: "surprise",
          publicTitle: null,
          publicDescription: null,
        },
      });
      await expect(
        backendClients.primary.backend.getGiveawayPrizeImageMedia(
          undefined,
          image.mediaId,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await rawClients.primary.giveawayPrizePool.update({
        where: { id: prizePoolId },
        data: {
          publicDisclosure: "revealed",
          publicTitle: "Weekend Rider Helmet",
        },
      });
      await backendClients.primary.backend.openGiveaway(
        fixture.organizerSession,
        giveaway.id,
      );
      await backendClients.primary.backend.pauseGiveaway(
        fixture.organizerSession,
        giveaway.id,
      );

      await expect(
        backendClients.primary.backend.deleteGiveawayPrizeImage(
          fixture.organizerSession,
          giveaway.id,
          prizePoolId,
          image.mediaId,
        ),
      ).rejects.toMatchObject({
        code: "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED",
      });
      await expect(
        rawClients.secondary.giveawayPrizeImage.findUnique({
          where: { mediaId: image.mediaId },
          select: { mediaId: true },
        }),
      ).resolves.toEqual({ mediaId: image.mediaId });
      await expect(
        rawClients.secondary.eventGiveaway.findUniqueOrThrow({
          where: { id: giveaway.id },
          select: { status: true, complianceStatus: true },
        }),
      ).resolves.toEqual({
        status: "paused",
        complianceStatus: "approved",
      });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
