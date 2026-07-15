import { describe, expect, test } from "vitest";
import {
  TAMBIKE_ORGANIZER_PROFILE_ID,
  TAMBIKE_ORGANIZER_USER_ID,
} from "../../src/features/tambike-demo/data";
import {
  EVENT_LOCATION_LIMITS,
  normalizeEventLocation,
} from "../../src/features/tambike-demo/event-location";
import type { CreateEventInput } from "../../src/features/tambike-demo/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import {
  createPublishedTestEvent,
  createTestActors,
  registerTestPass,
} from "./support/tambike-fixtures";

const validDraftInput: CreateEventInput = {
  title: "Tambike Night at Katipunan",
  type: "Bike Night",
  date: "Sat · July 18",
  time: "7:00 PM - 10:00 PM",
  expectedRiders: 45,
  perkPreview: "Free sticker for checked-in riders",
  locationName: "Katipunan Community Grounds",
  locationAddress: "123 Katipunan Avenue, Quezon City",
  locationMapLink: "https://maps.example.test/katipunan-community-grounds",
  area: "Katipunan, Quezon City",
};

describe("Tambike backend domain rules", () => {
  test("seeds only the canonical organizer and admin with curated location snapshots", async () => {
    const backend = await createTambikeTestBackend();
    const snapshot = backend.getSnapshot();

    expect(snapshot.users).toHaveLength(2);
    expect(snapshot.users.map((user) => user.email).sort()).toEqual([
      "admin@bayanko.ph",
      "organizer@bayanko.ph",
    ]);
    expect(snapshot.users.find((user) => user.id === TAMBIKE_ORGANIZER_USER_ID)).toMatchObject({
      displayName: "Tambike Organizer",
      organizerProfileId: TAMBIKE_ORGANIZER_PROFILE_ID,
      role: "organizer",
    });
    expect(snapshot.users.some((user) => user.role === "venue")).toBe(false);
    expect(
      snapshot.users.some((user) =>
        [
          "mina.rider@example.com",
          "scan-rider@seed.tambike.local",
          "ana.venue@example.com",
        ].includes(user.email),
      ),
    ).toBe(false);
    expect(snapshot.users.some((user) => user.email.endsWith("@seed.tambike.local"))).toBe(false);

    expect(snapshot.events).toHaveLength(24);
    expect(snapshot.events.every((event) => event.organizerId === TAMBIKE_ORGANIZER_PROFILE_ID)).toBe(
      true,
    );
    expect(snapshot.events.every((event) => normalizeEventLocation(event) !== null)).toBe(true);
    expect(snapshot.passes).toEqual([]);
    expect(backend).not.toHaveProperty("applyAsOrganizer");
    expect(backend).not.toHaveProperty("reviewOrganizerApplication");
    expect(backend).not.toHaveProperty("createOrganizerForAdmin");
    expect(backend).not.toHaveProperty("listOrganizerVerifications");
  });

  test("signs up a rider with an unverified role and a server session", async () => {
    const backend = await createTambikeTestBackend();

    const result = await backend.signUpRider({
      displayName: "Jay New Rider",
      email: "jay.new@example.com",
      password: "passw0rd!",
      area: "Quezon City",
      bikeModel: "Honda Click 160",
      clubName: "QC Night Riders",
    });

    expect(result.user).toMatchObject({
      displayName: "Jay New Rider",
      email: "jay.new@example.com",
      role: "rider",
      verificationStatus: "UNVERIFIED",
      area: "Quezon City",
      bikeModel: "Honda Click 160",
      clubName: "QC Night Riders",
    });
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    await expect(backend.getCurrentUser(result.sessionToken)).resolves.toMatchObject({
      email: "jay.new@example.com",
    });
  });

  test("requires a real signup password", async () => {
    const backend = await createTambikeTestBackend();

    await expect(
      backend.signUpRider({
        displayName: "No Password Rider",
        email: "no.password@example.com",
        password: "",
        area: "Quezon City",
      }),
    ).rejects.toThrow("INVALID_INPUT");
  });

  test("supports email and password login for canonical accounts", async () => {
    const backend = await createTambikeTestBackend();

    const result = await backend.loginWithPassword("organizer@bayanko.ph", "password123");

    expect(result.user).toMatchObject({
      id: TAMBIKE_ORGANIZER_USER_ID,
      email: "organizer@bayanko.ph",
      role: "organizer",
      organizerProfileId: TAMBIKE_ORGANIZER_PROFILE_ID,
    });
    await expect(backend.getCurrentUser(result.sessionToken)).resolves.toMatchObject({
      email: "organizer@bayanko.ph",
    });
  });

  test("allows the approved organizer to submit an arbitrary location directly for admin review", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "domain-create");

    await expect(
      backend.createEventDraft(actors.rider.sessionToken, {
        ...validDraftInput,
        title: "Rider Attempt",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      backend.createEventDraft(actors.organizer.sessionToken, {
        ...validDraftInput,
        locationName: "  Katipunan Community Grounds  ",
        locationAddress: "  123 Katipunan Avenue, Quezon City  ",
        locationMapLink: "  https://maps.example.test/katipunan-community-grounds  ",
        area: "  Katipunan, Quezon City  ",
      }),
    ).resolves.toMatchObject({
      title: validDraftInput.title,
      status: "PENDING_ADMIN_REVIEW",
      organizerId: TAMBIKE_ORGANIZER_PROFILE_ID,
      locationName: "Katipunan Community Grounds",
      locationAddress: "123 Katipunan Avenue, Quezon City",
      locationMapLink: "https://maps.example.test/katipunan-community-grounds",
      area: "Katipunan, Quezon City",
      expectedRiders: 45,
    });
  });

  test.each([
    ["blank location name", { locationName: "   " }],
    ["over-limit address", { locationAddress: "x".repeat(EVENT_LOCATION_LIMITS.address + 1) }],
    ["unsafe map URL", { locationMapLink: "javascript:alert(1)" }],
  ])("rejects %s", async (_label, locationOverride) => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, `invalid-${_label}`);

    await expect(
      backend.createEventDraft(actors.organizer.sessionToken, {
        ...validDraftInput,
        ...locationOverride,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("publishes directly from admin review without a venue transition", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "domain-publish");

    const published = await createPublishedTestEvent(backend, actors, {
      title: "Direct Review Event",
    });

    expect(published).toMatchObject({
      title: "Direct Review Event",
      status: "PUBLISHED",
      organizerId: TAMBIKE_ORGANIZER_PROFILE_ID,
    });
    expect(backend).not.toHaveProperty("approveVenueWithConditions");
  });

  test("creates non-guessable pass tokens through explicit rider fixtures", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "domain-pass");
    const firstEvent = await createPublishedTestEvent(backend, actors, {
      title: "First Pass Event",
    });
    const secondEvent = await createPublishedTestEvent(backend, actors, {
      title: "Second Pass Event",
    });

    const first = await registerTestPass(backend, actors.rider, firstEvent.id);
    const second = await registerTestPass(backend, actors.rider, secondEvent.id);

    expect(first.qrToken).toMatch(/^tbk_[A-Za-z0-9_-]{32,}$/);
    expect(second.qrToken).toMatch(/^tbk_[A-Za-z0-9_-]{32,}$/);
    expect(first.qrToken).not.toEqual(second.qrToken);
  });

  test("searches events by text query before returning public results", async () => {
    const backend = await createTambikeTestBackend();

    const results = backend.listEvents({ q: "makina" });

    expect(results.map((event) => event.title)).toEqual(["Makina Moto Expo Cebu"]);
  });

  test("blocks registration for explicit past-year events", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "domain-past-event");

    await expect(
      backend.registerForEvent(actors.rider.sessionToken, "fullprint-manila-tambike", {
        status: "going",
        attendanceType: "direct",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("requires admin access for attendee CSV exports and logs the export", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "domain-export");

    await expect(
      backend.exportAttendeesCsv(actors.organizer.sessionToken, "arai-hjc-charity-ride"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const csv = await backend.exportAttendeesCsv(
      actors.admin.sessionToken,
      "arai-hjc-charity-ride",
    );

    expect(csv).toContain("event_id,user_email,rsvp_status,pass_status,checked_in_at");
    expect(csv).toContain("arai-hjc-charity-ride");
    expect(await backend.auditCount("ATTENDEE_EXPORT_CREATED")).toBe(1);
  });
});
