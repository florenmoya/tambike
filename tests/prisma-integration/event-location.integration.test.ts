import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";
import { createPrismaEventFixture } from "./fixtures";

describe("Prisma event-owned locations", () => {
  test("round-trips an arbitrary organizer location through create and publish", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix,
        riderCount: 1,
      });
      const created = await backendClients.primary.backend.createEventDraft(
        fixture.organizerSession,
        {
          title: `  Unique Prisma Location ${suffix}  `,
          type: "Bike Night",
          startDate: "2030-07-31",
          startTime: "18:00",
          endDate: "2030-07-31",
          endTime: "21:00",
          timeZone: "Asia/Manila",
          recurrence: "NONE",
          expectedRiders: 12,
          perkPreview: "  Location-only perk  ",
          locationName: "  Shell Pugon  ",
          locationAddress: "  Antipolo, Rizal  ",
          locationMapLink: " https://maps.example.test/shell-pugon ",
          area: " Antipolo ",
        },
      );

      expect(created).toMatchObject({
        status: "PENDING_ADMIN_REVIEW",
        organizerId: fixture.organizerProfileId,
        locationName: "Shell Pugon",
        locationAddress: "Antipolo, Rizal",
        locationMapLink: "https://maps.example.test/shell-pugon",
        area: "Antipolo",
      });

      const published = await backendClients.primary.backend.approvePublish(
        fixture.adminSession,
        created.id,
      );
      expect(published).toMatchObject({
        status: "PUBLISHED",
        locationName: "Shell Pugon",
        locationAddress: "Antipolo, Rizal",
        locationMapLink: "https://maps.example.test/shell-pugon",
        area: "Antipolo",
      });

      const reloaded = await rawClients.secondary.event.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          organizerId: true,
          locationName: true,
          locationAddress: true,
          locationMapLink: true,
          area: true,
          status: true,
        },
      });
      expect(reloaded).toEqual({
        organizerId: fixture.organizerProfileId,
        locationName: "Shell Pugon",
        locationAddress: "Antipolo, Rizal",
        locationMapLink: "https://maps.example.test/shell-pugon",
        area: "Antipolo",
        status: "PUBLISHED",
      });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("publishes the current arbitrary-ID approval version without rewriting history", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix,
        riderCount: 1,
      });
      const firstApprovalId = `legacy-published-${suffix}`;
      const currentApprovalId = `approval-admin-${suffix}`;

      await rawClients.primary.event.update({
        where: { id: fixture.eventId },
        data: { status: "PENDING_ADMIN_REVIEW", submissionVersion: 2 },
      });
      await rawClients.primary.eventApproval.createMany({
        data: [
          {
            id: firstApprovalId,
            eventId: fixture.eventId,
            submissionVersion: 1,
            reviewerId: fixture.adminId,
            decision: "published",
            submittedAt: new Date("2026-07-30T01:00:00.000Z"),
            decidedAt: new Date("2026-07-30T02:00:00.000Z"),
          },
          {
            id: currentApprovalId,
            eventId: fixture.eventId,
            submissionVersion: 2,
            decision: "pending",
            submittedAt: new Date("2026-07-31T01:00:00.000Z"),
          },
        ],
      });

      await expect(
        backendClients.primary.backend.approvePublish(fixture.adminSession, fixture.eventId),
      ).resolves.toMatchObject({ status: "PUBLISHED" });

      const approvals = await rawClients.secondary.eventApproval.findMany({
        where: { eventId: fixture.eventId },
        orderBy: { submissionVersion: "asc" },
        select: {
          id: true,
          submissionVersion: true,
          reviewerId: true,
          decision: true,
          decidedAt: true,
        },
      });
      expect(approvals).toEqual([
        {
          id: firstApprovalId,
          submissionVersion: 1,
          reviewerId: fixture.adminId,
          decision: "published",
          decidedAt: new Date("2026-07-30T02:00:00.000Z"),
        },
        {
          id: currentApprovalId,
          submissionVersion: 2,
          reviewerId: fixture.adminId,
          decision: "published",
          decidedAt: expect.any(Date),
        },
      ]);
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("matches in-memory draft validation for required fields and rider counts", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix,
        riderCount: 1,
      });
      const validDraft = {
        title: `Prisma validation ${suffix}`,
        type: "Bike Night" as const,
        startDate: "2030-07-31",
        startTime: "18:00",
        endDate: "2030-07-31",
        endTime: "21:00",
        timeZone: "Asia/Manila",
        recurrence: "NONE" as const,
        expectedRiders: 12,
        perkPreview: "Location-only perk",
        locationName: "Shell Pugon",
        locationAddress: "Antipolo, Rizal",
        locationMapLink: "https://maps.example.test/shell-pugon",
        area: "Antipolo",
      };

      for (const override of [
        { title: " " },
        { startDate: " " },
        { startTime: " " },
        { endDate: " " },
        { endTime: " " },
        { perkPreview: " " },
        { expectedRiders: 0 },
        { expectedRiders: -1 },
        { expectedRiders: 1.5 },
      ]) {
        await expect(
          backendClients.primary.backend.createEventDraft(fixture.organizerSession, {
            ...validDraft,
            ...override,
          }),
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      }
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("allows publication only from direct admin review", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix, riderCount: 1 });

      await expect(
        backendClients.primary.backend.approvePublish(fixture.adminSession, fixture.eventId),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      await rawClients.primary.event.update({
        where: { id: fixture.eventId },
        data: { status: "PENDING_ADMIN_REVIEW" },
      });
      await expect(
        backendClients.primary.backend.approvePublish(fixture.adminSession, fixture.eventId),
      ).resolves.toMatchObject({ status: "PUBLISHED" });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
