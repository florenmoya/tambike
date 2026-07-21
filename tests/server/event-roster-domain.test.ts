import { describe, expect, test } from "vitest";

import {
  classifyRosterEntry,
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
    ]) {
      expect(() => decodeRosterCursor(cursor)).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    }
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
      rosterIdentity: "VISIBLE",
    });
    await backend.updateMemberProfile(actors.rider.sessionToken, visibleProfile);

    await expect(backend.listEventAttendees(undefined, event.id, {})).resolves.toMatchObject({
      summary: { rosterEnabled: false, goingCount: 1, visibleCount: 0, anonymousCount: 1 },
      attendees: [],
      pageSize: 24,
    });
    await expect(backend.configureEventRoster(actors.outsider.sessionToken, event.id, { enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
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
    await backend.registerForEvent(actors.rider.sessionToken, event.id, { status: "going", attendanceType: "direct", rosterIdentity: "VISIBLE" });

    await backend.updateMemberProfile(actors.outsider.sessionToken, { ...visibleProfile, displayName: "Anonymous Rider" });
    await backend.registerForEvent(actors.outsider.sessionToken, event.id, { status: "going", attendanceType: "direct", rosterIdentity: "ANONYMOUS" });

    const privateRider = await backend.signUpRider({ displayName: "Private Rider", email: "private-roster@example.test", password: "password123", area: "Pasig" });
    await backend.updateMemberProfile(privateRider.sessionToken, { ...visibleProfile, displayName: "Private Rider", visibility: "PRIVATE" });
    await backend.registerForEvent(privateRider.sessionToken, event.id, { status: "going", attendanceType: "direct", rosterIdentity: "VISIBLE" });

    const unpublished = await backend.signUpRider({ displayName: "Unpublished Rider", email: "unpublished-roster@example.test", password: "password123", area: "Pasig" });
    await backend.registerForEvent(unpublished.sessionToken, event.id, { status: "going", attendanceType: "direct", rosterIdentity: "VISIBLE" });

    const interested = await backend.signUpRider({ displayName: "Interested Rider", email: "interested-roster@example.test", password: "password123", area: "Pasig" });
    await backend.updateMemberProfile(interested.sessionToken, { ...visibleProfile, displayName: "Interested Rider" });
    await backend.registerForEvent(interested.sessionToken, event.id, { status: "interested", attendanceType: "direct", rosterIdentity: "VISIBLE" });

    await expect(backend.listEventAttendees(undefined, event.id, {})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const page = await backend.listEventAttendees(actors.rider.sessionToken, event.id, {});
    expect(page.summary).toMatchObject({ goingCount: 4, visibleCount: 1, anonymousCount: 3 });
    expect(page.attendees).toEqual([
      expect.objectContaining({ displayName: "Visible Rider", slug: "visible-rider" }),
    ]);
    expect(JSON.stringify(page)).not.toContain("email");
    expect(JSON.stringify(page)).not.toContain("userId");
  });

  test("snapshots the saved default on creation, preserves existing choices, and supports per-event override", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "roster-defaults");
    const event = await createPublishedTestEvent(backend, actors);
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, { enabled: true });
    await backend.updateMemberProfile(actors.rider.sessionToken, visibleProfile);

    await expect(backend.registerForEvent(actors.rider.sessionToken, event.id, { status: "going", attendanceType: "direct" })).resolves.toMatchObject({ rsvp: { rosterIdentity: "VISIBLE" } });
    await backend.updateMemberProfile(actors.rider.sessionToken, { ...visibleProfile, defaultRosterIdentity: "ANONYMOUS" });
    await expect(backend.registerForEvent(actors.rider.sessionToken, event.id, { status: "going", attendanceType: "direct" })).resolves.toMatchObject({ rsvp: { rosterIdentity: "VISIBLE" } });
    await expect(backend.updateEventRosterIdentity(actors.rider.sessionToken, event.id, { rosterIdentity: "ANONYMOUS" })).resolves.toMatchObject({ rosterIdentity: "ANONYMOUS" });
    await expect(backend.listEventAttendees(actors.outsider.sessionToken, event.id, {})).resolves.toMatchObject({ summary: { visibleCount: 0, anonymousCount: 1 } });
    await expect(backend.updateEventRosterIdentity(actors.rider.sessionToken, "missing-event", { rosterIdentity: "VISIBLE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("paginates visible attendees by goingAt then RSVP id without duplicates and keeps full aggregates", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "roster-pages");
    const event = await createPublishedTestEvent(backend, actors);
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, { enabled: true });

    for (let index = 0; index < 4; index += 1) {
      const rider = await backend.signUpRider({ displayName: `Paged Rider ${index}`, email: `paged-${index}@example.test`, password: "password123", area: "Manila" });
      await backend.updateMemberProfile(rider.sessionToken, { ...visibleProfile, displayName: `Paged Rider ${index}` });
      await backend.registerForEvent(rider.sessionToken, event.id, { status: "going", attendanceType: "direct", rosterIdentity: index === 3 ? "ANONYMOUS" : "VISIBLE" });
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
