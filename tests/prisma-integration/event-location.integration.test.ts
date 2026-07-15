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
          date: " July 31, 2030 ",
          time: " 6:00 PM - 9:00 PM ",
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
        date: "July 31, 2030",
        time: "6:00 PM - 9:00 PM",
        expectedRiders: 12,
        perkPreview: "Location-only perk",
        locationName: "Shell Pugon",
        locationAddress: "Antipolo, Rizal",
        locationMapLink: "https://maps.example.test/shell-pugon",
        area: "Antipolo",
      };

      for (const override of [
        { title: " " },
        { date: " " },
        { time: " " },
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
