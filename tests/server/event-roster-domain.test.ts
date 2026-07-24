import { describe, expect, test } from "vitest";

import {
  classifyRosterEntry,
  compareRosterRsvpIds,
  decodeRosterCursor,
  encodeRosterCursor,
  normalizeRosterPageLimit,
} from "../../src/server/member-profiles/roster-domain";
import { createTambikeTestBackend } from "../../src/server/testing";
import {
  createPublishedTestEvent,
  createTestActors,
} from "./support/tambike-fixtures";

const visibleProfile = {
  displayName: "Visible Rider",
  area: "Quezon City",
  bio: "Weekend rider.",
  visibility: "PUBLIC" as const,
  defaultRosterIdentity: "VISIBLE" as const,
};

describe("event roster policy helpers", () => {
  test("applies disabled, RSVP, publication, and privacy precedence", () => {
    expect(classifyRosterEntry({ enabled: false, rosterIdentity: "VISIBLE", profileSlug: "rider", profileVisibility: "PUBLIC" })).toBe("COUNT_ONLY");
    expect(classifyRosterEntry({ enabled: true, rosterIdentity: "ANONYMOUS", profileSlug: "rider", profileVisibility: "PUBLIC" })).toBe("ANONYMOUS");
    expect(classifyRosterEntry({ enabled: true, rosterIdentity: "VISIBLE", profileVisibility: "PUBLIC" })).toBe("ANONYMOUS");
    expect(classifyRosterEntry({ enabled: true, rosterIdentity: "VISIBLE", profileSlug: "rider", profileVisibility: "PRIVATE" })).toBe("ANONYMOUS");
    expect(classifyRosterEntry({ enabled: true, rosterIdentity: "VISIBLE", profileSlug: "rider", profileVisibility: "MEMBERS_ONLY" })).toBe("VISIBLE");
  });

  test("round-trips strict base64url composite cursors and rejects malformed tuples", () => {
    const value = { goingAt: "2026-07-22T01:02:03.000Z", rsvpId: "rsvp-123" };
    const encoded = encodeRosterCursor(value);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRosterCursor(encoded)).toEqual(value);

    for (const cursor of [
      "",
      "not+base64",
      Buffer.from("{}", "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([value.goingAt]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify(["not-a-date", "rsvp-123"]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([value.goingAt, ""]), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify([value.goingAt, value.rsvpId], null, 2), "utf8").toString("base64url"),
    ]) {
      expect(() => decodeRosterCursor(cursor)).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    }
  });

  test("orders RSVP ids by raw codepoint for the ASCII identifier alphabet", () => {
    const ids = ["rsvp-a", "rsvp-_", "rsvp-A", "rsvp-!"];
    expect(ids.sort(compareRosterRsvpIds)).toEqual(["rsvp-!", "rsvp-A", "rsvp-_", "rsvp-a"]);
  });

  test("defaults page size to 24, clamps to 50, and rejects invalid limits", () => {
    expect(normalizeRosterPageLimit()).toBe(24);
    expect(normalizeRosterPageLimit(50)).toBe(50);
    expect(normalizeRosterPageLimit(500)).toBe(50);
    for (const value of [0, -1, 1.5, Number.NaN]) {
      expect(() => normalizeRosterPageLimit(value)).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    }
  });
});

describe("in-memory organizer-controlled event rosters", () => {
  test("defaults to counts-only, authorizes owner/admin changes, and audits booleans only", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "roster-config");
    const event = await createPublishedTestEvent(backend, actors);
    await backend.registerForEvent(actors.rider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
    });
    await backend.updateMemberProfile(actors.rider.sessionToken, visibleProfile);

    await expect(backend.listEventAttendees(undefined, event.id, {})).resolves.toMatchObject({
      summary: { rosterEnabled: false, goingCount: 1, visibleCount: 0, anonymousCount: 1 },
      attendees: [],
      pageSize: 24,
    });
    await expect(backend.configureEventRoster(actors.outsider.sessionToken, event.id, { enabled: "bad" as never })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(backend.configureEventRoster(actors.organizer.sessionToken, "missing-event", { enabled: "bad" as never })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.configureEventRoster(actors.organizer.sessionToken, event.id, { enabled: true })).resolves.toMatchObject({ rosterEnabled: true });
    await expect(backend.configureEventRoster(actors.admin.sessionToken, event.id, { enabled: false })).resolves.toMatchObject({ rosterEnabled: false });

    const records = (backend as unknown as { audits: Array<{ action: string; metadata?: unknown }> }).audits.filter((audit) => audit.action === "ROSTER_SETTINGS_UPDATED");
    expect(records.map((audit) => audit.metadata)).toEqual([
      { previousEnabled: false, nextEnabled: true },
      { previousEnabled: true, nextEnabled: false },
    ]);
    expect(JSON.stringify(records)).not.toContain("userId");
    expect(JSON.stringify(records)).not.toContain("displayName");
  });

  test("requires authentication when enabled and returns only Going visible published profiles", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "roster-precedence");
    const event = await createPublishedTestEvent(backend, actors);
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, { enabled: true });

    await backend.updateMemberProfile(actors.rider.sessionToken, visibleProfile);
    await backend.registerForEvent(actors.rider.sessionToken, event.id, { status: "going", attendanceType: "direct" });

    await backend.updateMemberProfile(actors.outsider.sessionToken, { ...visibleProfile, displayName: "Anonymous Rider", defaultRosterIdentity: "ANONYMOUS" });
    await backend.registerForEvent(actors.outsider.sessionToken, event.id, { status: "going", attendanceType: "direct" });

    const privateRider = await backend.signUpRider({ displayName: "Private Rider", email: "private-roster@example.test", password: "password123", area: "Pasig" });
    await backend.updateMemberProfile(privateRider.sessionToken, { ...visibleProfile, displayName: "Private Rider", visibility: "PRIVATE" });
    await backend.registerForEvent(privateRider.sessionToken, event.id, { status: "going", attendanceType: "direct" });

    const unpublished = await backend.signUpRider({ displayName: "Unpublished Rider", email: "unpublished-roster@example.test", password: "password123", area: "Pasig" });
    await backend.registerForEvent(unpublished.sessionToken, event.id, { status: "going", attendanceType: "direct" });

    const interested = await backend.signUpRider({ displayName: "Interested Rider", email: "interested-roster@example.test", password: "password123", area: "Pasig" });
    await backend.updateMemberProfile(interested.sessionToken, { ...visibleProfile, displayName: "Interested Rider" });
    await backend.registerForEvent(interested.sessionToken, event.id, { status: "interested", attendanceType: "direct" });

    await expect(backend.listEventAttendees(undefined, event.id, { cursor: "broken", limit: 0 })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const page = await backend.listEventAttendees(actors.rider.sessionToken, event.id, {});
    expect(page.summary).toMatchObject({ goingCount: 4, visibleCount: 1, anonymousCount: 3 });
    expect(page.attendees).toEqual([
      expect.objectContaining({ displayName: "Visible Rider", slug: "visible-rider" }),
    ]);
    expect(JSON.stringify(page)).not.toContain("email");
    expect(JSON.stringify(page)).not.toContain("userId");
  });

  test("uses the same raw RSVP-id order for equal-time sorting and cursor boundaries", async () => {
    const eventId = "tambike-cafe-classico";
    const goingAt = "2026-07-22T08:00:00.000Z";
    const fixtures = [
      { id: "rsvp-a", userId: "user-roster-lower", displayName: "Lower Rider", email: "lower-roster@example.test" },
      { id: "rsvp-_", userId: "user-roster-underscore", displayName: "Underscore Rider", email: "underscore-roster@example.test" },
      { id: "rsvp-A", userId: "user-roster-upper", displayName: "Upper Rider", email: "upper-roster@example.test" },
      { id: "rsvp-!", userId: "user-roster-punctuation", displayName: "Punctuation Rider", email: "punctuation-roster@example.test" },
    ];
    const backend = await createTambikeTestBackend({
      fixture: {
        users: fixtures.map((fixture) => ({
          id: fixture.userId,
          displayName: fixture.displayName,
          email: fixture.email,
          password: "password123",
          role: "rider" as const,
          verificationStatus: "UNVERIFIED" as const,
          area: "Manila",
          joinedAt: "July 22, 2026",
        })),
        rsvps: fixtures.map((fixture) => ({
          id: fixture.id,
          eventId,
          userId: fixture.userId,
          status: "going" as const,
          attendanceType: "direct" as const,
          rosterIdentity: "VISIBLE" as const,
          goingAt,
        })),
      },
    });
    const organizer = await backend.loginWithPassword("organizer@bayanko.ph", "password123");
    for (const fixture of fixtures) {
      const rider = await backend.loginWithPassword(fixture.email, "password123");
      await backend.updateMemberProfile(rider.sessionToken, {
        ...visibleProfile,
        displayName: fixture.displayName,
      });
    }
    await backend.configureEventRoster(organizer.sessionToken, eventId, { enabled: true });

    const first = await backend.listEventAttendees(organizer.sessionToken, eventId, { limit: 2 });
    const second = await backend.listEventAttendees(organizer.sessionToken, eventId, { limit: 2, cursor: first.nextCursor });
    expect([...first.attendees, ...second.attendees].map((entry) => entry.displayName)).toEqual([
      "Punctuation Rider",
      "Upper Rider",
      "Underscore Rider",
      "Lower Rider",
    ]);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.attendees, ...second.attendees].map((entry) => entry.slug)).size).toBe(4);
  });

  test("uses the current global profile preference for an existing RSVP", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "roster-defaults");
    const event = await createPublishedTestEvent(backend, actors);
    await backend.updateMemberProfile(actors.rider.sessionToken, visibleProfile);

    await expect(backend.registerForEvent(actors.rider.sessionToken, event.id, { status: "going", attendanceType: "direct" })).resolves.toMatchObject({ rsvp: { rosterIdentity: "VISIBLE" } });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, { enabled: true });
    await expect(backend.listEventAttendees(actors.outsider.sessionToken, event.id, {})).resolves.toMatchObject({
      summary: { visibleCount: 1, anonymousCount: 0 },
      attendees: [{ slug: "visible-rider" }],
    });

    await backend.updateMemberProfile(actors.rider.sessionToken, { ...visibleProfile, defaultRosterIdentity: "ANONYMOUS" });
    await expect(backend.listEventAttendees(actors.outsider.sessionToken, event.id, {})).resolves.toMatchObject({
      summary: { visibleCount: 0, anonymousCount: 1 },
      attendees: [],
    });
    await backend.updateMemberProfile(actors.rider.sessionToken, visibleProfile);
    await expect(backend.listEventAttendees(actors.outsider.sessionToken, event.id, {})).resolves.toMatchObject({
      summary: { visibleCount: 1, anonymousCount: 0 },
      attendees: [{ slug: "visible-rider" }],
    });
  });

  test("paginates visible attendees by goingAt then RSVP id without duplicates and keeps full aggregates", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "roster-pages");
    const event = await createPublishedTestEvent(backend, actors);
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, { enabled: true });

    for (let index = 0; index < 4; index += 1) {
      const rider = await backend.signUpRider({ displayName: `Paged Rider ${index}`, email: `paged-${index}@example.test`, password: "password123", area: "Manila" });
      await backend.updateMemberProfile(rider.sessionToken, {
        ...visibleProfile,
        displayName: `Paged Rider ${index}`,
        defaultRosterIdentity: index === 3 ? "ANONYMOUS" : "VISIBLE",
      });
      await backend.registerForEvent(rider.sessionToken, event.id, { status: "going", attendanceType: "direct" });
    }

    const first = await backend.listEventAttendees(actors.rider.sessionToken, event.id, { limit: 2 });
    expect(first.summary).toMatchObject({ goingCount: 4, visibleCount: 3, anonymousCount: 1 });
    expect(first.attendees).toHaveLength(2);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = await backend.listEventAttendees(actors.rider.sessionToken, event.id, { limit: 2, cursor: first.nextCursor });
    expect(second.attendees).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.attendees, ...second.attendees].map((attendee) => attendee.slug)).size).toBe(3);
    expect(second.summary).toEqual(first.summary);
    await expect(backend.listEventAttendees(actors.rider.sessionToken, event.id, { cursor: "broken" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
