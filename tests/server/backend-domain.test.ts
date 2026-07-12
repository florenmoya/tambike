import { describe, expect, test } from "vitest";
import { createTambikeTestBackend } from "../../src/server/testing";

describe("Tambike backend domain rules", () => {
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

  test("supports email and password login for seeded accounts", async () => {
    const backend = await createTambikeTestBackend();

    const result = await backend.loginWithPassword("mina.rider@example.com", "password123");

    expect(result.user).toMatchObject({
      email: "mina.rider@example.com",
      role: "rider",
    });
    await expect(backend.getCurrentUser(result.sessionToken)).resolves.toMatchObject({
      email: "mina.rider@example.com",
    });
  });

  test("exposes one seeded public account per role", async () => {
    const backend = await createTambikeTestBackend();

    const users = backend.getSnapshot().users;
    const roles = users.map((user) => user.role).sort();

    expect(roles).toEqual(["admin", "organizer", "rider", "venue"]);
    expect(users).toHaveLength(4);
    expect(users.map((user) => user.email).sort()).toEqual([
      "marco.organizer@example.com",
      "mina.rider@example.com",
      "admin@bayanko.ph",
      "ana.venue@example.com",
    ].sort());
  });

  test("allows approved organizers to create drafts while blocking riders from event creation", async () => {
    const backend = await createTambikeTestBackend();
    const riderSession = await backend.loginWithPassword("mina.rider@example.com", "password123");
    const organizerSession = await backend.loginWithPassword(
      "marco.organizer@example.com",
      "password123",
    );

    await expect(
      backend.createEventDraft(riderSession.sessionToken, {
        title: "Rider Attempt",
        type: "Bike Night",
        venueId: "shell-pugon",
        date: "Sat · July 18",
        time: "7:00 PM - 10:00 PM",
        area: "Katipunan, Quezon City",
        expectedRiders: 45,
        perkPreview: "Free sticker",
      }),
    ).rejects.toThrow("FORBIDDEN");

    const draft = await backend.createEventDraft(organizerSession.sessionToken, {
      title: "Tambike Night at Katipunan",
      type: "Bike Night",
      venueId: "shell-pugon",
      date: "Sat · July 18",
      time: "7:00 PM - 10:00 PM",
      area: "Katipunan, Quezon City",
      expectedRiders: 45,
      perkPreview: "Free sticker for checked-in riders",
    });

    expect(draft).toMatchObject({
      title: "Tambike Night at Katipunan",
      status: "PENDING_VENUE_APPROVAL",
      expectedRiders: 45,
    });
  });

  test("creates non-guessable pass tokens when a rider registers going", async () => {
    const backend = await createTambikeTestBackend();
    const riderSession = await backend.loginWithPassword("mina.rider@example.com", "password123");

    const first = await backend.registerForEvent(riderSession.sessionToken, "tambike-cafe-classico", {
      status: "going",
      attendanceType: "direct",
    });
    const second = await backend.registerForEvent(riderSession.sessionToken, "motoir-national-round-4", {
      status: "going",
      attendanceType: "club",
      clubName: "Davao Riders",
    });

    expect(first.pass?.qrToken).toMatch(/^tbk_[A-Za-z0-9_-]{32,}$/);
    expect(second.pass?.qrToken).toMatch(/^tbk_[A-Za-z0-9_-]{32,}$/);
    expect(first.pass?.qrToken).not.toContain("arai");
    expect(first.pass?.qrToken).not.toEqual(second.pass?.qrToken);
  });

  test("searches events by text query before returning public results", async () => {
    const backend = await createTambikeTestBackend();
    const searchableBackend = backend as typeof backend & {
      listEvents(input?: { q?: string }): ReturnType<typeof backend.listEvents>;
    };

    const results = searchableBackend.listEvents({ q: "makina" });

    expect(results.map((event) => event.title)).toEqual(["Makina Moto Expo Cebu"]);
  });

  test("blocks registration for explicit past-year events", async () => {
    const backend = await createTambikeTestBackend();
    const riderSession = await backend.loginWithPassword("mina.rider@example.com", "password123");

    await expect(
      backend.registerForEvent(riderSession.sessionToken, "fullprint-manila-tambike", {
        status: "going",
        attendanceType: "direct",
      }),
    ).rejects.toThrow("INVALID_INPUT");
  });

  test("enforces scanner event ownership while allowing admin overrides and blocking duplicates", async () => {
    const backend = await createTambikeTestBackend();
    const riderSession = await backend.loginWithPassword("mina.rider@example.com", "password123");
    const organizerSession = await backend.loginWithPassword(
      "marco.organizer@example.com",
      "password123",
    );
    const adminSession = await backend.loginWithPassword("admin@bayanko.ph", "secret_123");
    const registration = await backend.registerForEvent(
      riderSession.sessionToken,
      "tambike-cafe-classico",
      { status: "going", attendanceType: "direct" },
    );

    await expect(
      backend.scanPass(
        organizerSession.sessionToken,
        "tambike-cafe-classico",
        registration.pass!.qrToken,
        "staff_camera",
      ),
    ).rejects.toThrow("FORBIDDEN");

    await expect(
      backend.scanPass(
        riderSession.sessionToken,
        "tambike-cafe-classico",
        registration.pass!.qrToken,
        "staff_camera",
      ),
    ).rejects.toThrow("FORBIDDEN");

    await expect(
      backend.scanPass(
        adminSession.sessionToken,
        "tambike-cafe-classico",
        registration.pass!.qrToken,
        "rider_qr",
      ),
    ).rejects.toThrow("INVALID_INPUT");

    const checkIn = await backend.scanPass(
      adminSession.sessionToken,
      "tambike-cafe-classico",
      registration.pass!.qrToken,
      "staff_camera",
    );

    expect(checkIn.status).toBe("checked_in");
    await expect(
      backend.scanPass(
        adminSession.sessionToken,
        "motoir-national-round-4",
        registration.pass!.qrToken,
        "staff_camera",
      ),
    ).rejects.toThrow("WRONG_EVENT");
    await expect(
      backend.scanPass(
        adminSession.sessionToken,
        "tambike-cafe-classico",
        registration.pass!.qrToken,
        "staff_camera",
      ),
    ).rejects.toThrow("ALREADY_CHECKED_IN");
    expect(await backend.auditCount("CHECK_IN_CREATED")).toBe(1);
  });

  test("requires admin access for attendee CSV exports and logs the export", async () => {
    const backend = await createTambikeTestBackend();
    const organizerSession = await backend.loginWithPassword(
      "marco.organizer@example.com",
      "password123",
    );
    const adminSession = await backend.loginWithPassword("admin@bayanko.ph", "secret_123");

    await expect(
      backend.exportAttendeesCsv(organizerSession.sessionToken, "arai-hjc-charity-ride"),
    ).rejects.toThrow("FORBIDDEN");

    const csv = await backend.exportAttendeesCsv(adminSession.sessionToken, "arai-hjc-charity-ride");

    expect(csv).toContain("event_id,user_email,rsvp_status,pass_status,checked_in_at");
    expect(csv).toContain("arai-hjc-charity-ride");
    expect(await backend.auditCount("ATTENDEE_EXPORT_CREATED")).toBe(1);
  });
});
