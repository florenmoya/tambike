import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";
import { createPrismaEventFixture } from "./fixtures";

describe("Prisma event rosters", () => {
  test("matches ownership, privacy precedence, RSVP snapshots, audits, and keyset paging", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix, riderCount: 5 });
      const [publicRider, memberRider, privateRider, unpublishedRider, interestedRider] = fixture.riders;
      if (!publicRider || !memberRider || !privateRider || !unpublishedRider || !interestedRider) {
        throw new Error("ROSTER_FIXTURE_RIDERS_MISSING");
      }

      await expect(backendClients.primary.backend.listEventAttendees(undefined, fixture.eventId, {})).resolves.toMatchObject({
        summary: { rosterEnabled: false, goingCount: 5, visibleCount: 0, anonymousCount: 5 },
        attendees: [],
        pageSize: 24,
      });
      await expect(backendClients.primary.backend.configureEventRoster(publicRider.sessionToken, fixture.eventId, { enabled: "bad" as never })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(backendClients.primary.backend.configureEventRoster(fixture.organizerSession, "missing-event", { enabled: "bad" as never })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await backendClients.primary.backend.configureEventRoster(fixture.organizerSession, fixture.eventId, { enabled: true });
      await expect(backendClients.primary.backend.listEventAttendees(undefined, fixture.eventId, { cursor: "malformed", limit: 0 })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

      const baseProfile = {
        area: "Antipolo",
        bio: "Integration roster rider.",
        defaultRosterIdentity: "VISIBLE" as const,
      };
      await backendClients.primary.backend.updateMemberProfile(publicRider.sessionToken, { ...baseProfile, displayName: "Public Roster Rider", visibility: "PUBLIC" });
      await backendClients.primary.backend.updateMemberProfile(memberRider.sessionToken, { ...baseProfile, displayName: "Member Roster Rider", visibility: "MEMBERS_ONLY" });
      await backendClients.primary.backend.updateMemberProfile(privateRider.sessionToken, { ...baseProfile, displayName: "Private Roster Rider", visibility: "PRIVATE" });
      await backendClients.primary.backend.updateMemberProfile(interestedRider.sessionToken, { ...baseProfile, displayName: "Interested Roster Rider", visibility: "PUBLIC" });

      const baseTime = new Date("2030-08-15T01:00:00.000Z");
      await rawClients.primary.rSVP.update({ where: { eventId_userId: { eventId: fixture.eventId, userId: publicRider.userId } }, data: { rosterIdentity: "VISIBLE", goingAt: baseTime } });
      await rawClients.primary.rSVP.update({ where: { eventId_userId: { eventId: fixture.eventId, userId: memberRider.userId } }, data: { rosterIdentity: "VISIBLE", goingAt: baseTime } });
      await rawClients.primary.rSVP.update({ where: { eventId_userId: { eventId: fixture.eventId, userId: privateRider.userId } }, data: { rosterIdentity: "VISIBLE", goingAt: new Date("2030-08-15T01:01:00.000Z") } });
      await rawClients.primary.rSVP.update({ where: { eventId_userId: { eventId: fixture.eventId, userId: unpublishedRider.userId } }, data: { rosterIdentity: "VISIBLE", goingAt: new Date("2030-08-15T01:02:00.000Z") } });
      await rawClients.primary.rSVP.update({ where: { eventId_userId: { eventId: fixture.eventId, userId: interestedRider.userId } }, data: { rosterIdentity: "VISIBLE", status: "interested", goingAt: null } });

      const first = await backendClients.primary.backend.listEventAttendees(publicRider.sessionToken, fixture.eventId, { limit: 1 });
      expect(first.summary).toMatchObject({ goingCount: 4, visibleCount: 2, anonymousCount: 2 });
      expect(first.attendees).toHaveLength(1);
      expect(first.nextCursor).toBeTypeOf("string");
      const second = await backendClients.secondary.backend.listEventAttendees(publicRider.sessionToken, fixture.eventId, { limit: 1, cursor: first.nextCursor });
      expect(second.attendees).toHaveLength(1);
      expect(second.nextCursor).toBeUndefined();
      expect(new Set([...first.attendees, ...second.attendees].map((entry) => entry.slug)).size).toBe(2);
      expect(second.summary).toEqual(first.summary);
      expect(JSON.stringify([first, second])).not.toContain("email");
      await expect(backendClients.primary.backend.listEventAttendees(publicRider.sessionToken, fixture.eventId, { cursor: "malformed" })).rejects.toMatchObject({ code: "INVALID_INPUT" });

      await backendClients.primary.backend.configureEventRoster(fixture.adminSession, fixture.eventId, { enabled: false });
      const audits = await rawClients.secondary.auditLog.findMany({ where: { action: "ROSTER_SETTINGS_UPDATED", targetId: fixture.eventId }, orderBy: { createdAt: "asc" } });
      expect(audits.map((audit) => audit.metadata)).toEqual([
        { previousEnabled: false, nextEnabled: true },
        { previousEnabled: true, nextEnabled: false },
      ]);
      expect(JSON.stringify(audits.map((audit) => audit.metadata))).not.toContain(publicRider.userId);
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("uses the current global roster privacy for an existing RSVP", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix });
      const rider = fixture.riders[0];
      if (!rider) throw new Error("ROSTER_FIXTURE_RIDER_MISSING");
      const profileInput = {
        area: "Antipolo",
        bio: "Integration roster rider.",
        defaultRosterIdentity: "VISIBLE" as const,
        displayName: "Current Global Roster Rider",
        visibility: "PUBLIC" as const,
      };

      const profile = await backendClients.primary.backend.updateMemberProfile(
        rider.sessionToken,
        profileInput,
      );
      expect(profile.slug).toBeTypeOf("string");
      await backendClients.primary.backend.configureEventRoster(
        fixture.organizerSession,
        fixture.eventId,
        { enabled: true },
      );
      await rawClients.primary.pass.delete({ where: { id: rider.passId! } });
      await rawClients.primary.rSVP.delete({
        where: { eventId_userId: { eventId: fixture.eventId, userId: rider.userId } },
      });

      await backendClients.primary.backend.registerForEvent(rider.sessionToken, fixture.eventId, {
        status: "going",
        attendanceType: "direct",
      });
      await expect(
        rawClients.primary.rSVP.findUniqueOrThrow({
          where: { eventId_userId: { eventId: fixture.eventId, userId: rider.userId } },
          select: { rosterIdentity: true },
        }),
      ).resolves.toEqual({ rosterIdentity: "VISIBLE" });

      await backendClients.primary.backend.updateMemberProfile(rider.sessionToken, {
        ...profileInput,
        defaultRosterIdentity: "ANONYMOUS",
      });
      await expect(
        backendClients.primary.backend.listEventAttendees(rider.sessionToken, fixture.eventId),
      ).resolves.toMatchObject({
        summary: { goingCount: 1, visibleCount: 0, anonymousCount: 1 },
        attendees: [],
      });

      await backendClients.primary.backend.updateMemberProfile(rider.sessionToken, profileInput);
      await expect(
        backendClients.primary.backend.listEventAttendees(rider.sessionToken, fixture.eventId),
      ).resolves.toMatchObject({
        summary: { goingCount: 1, visibleCount: 1, anonymousCount: 0 },
        attendees: [{ slug: profile.slug }],
      });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
