import { describe, expect, test, vi } from "vitest";
import { createTambikeTestBackend } from "../../src/server/testing";
import {
  createPublishedTestEvent,
  createTestActors,
  registerTestPass,
} from "./support/tambike-fixtures";

async function signInForCheckInPolicy() {
  const backend = await createTambikeTestBackend();
  const actors = await createTestActors(backend, "check-in-policy");
  const event = await createPublishedTestEvent(backend, actors, {
    title: "Check-in policy test event",
  });
  const pass = await registerTestPass(backend, actors.rider, event.id);

  return {
    backend,
    operator: actors.organizer,
    admin: actors.admin,
    rider: actors.rider,
    outsider: actors.outsider,
    eventId: event.id,
    pass,
  };
}

describe("event self-check-in policies", () => {
  test("blocks staff confirmation and fresh scans after event disablement without losing retained operations data", async () => {
    const { backend, operator, admin, rider, outsider, eventId } =
      await signInForCheckInPolicy();
    const freshPass = await registerTestPass(backend, outsider, eventId);
    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_review",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);
    const pending = await backend.selfCheckIn(rider.sessionToken, qr.token);
    expect(pending).toMatchObject({ status: "pending", pass: { status: "active" } });

    const published = await backend.getAdminEventReview(admin.sessionToken, eventId);
    await backend.disableEvent(admin.sessionToken, eventId, {
      reason: "Disable staff check-in while retaining existing event operations data.",
      expectedUpdatedAt: published.expectedUpdatedAt,
    });

    await expect(
      backend.scanPass(
        operator.sessionToken,
        eventId,
        pending.pass.qrToken,
        "staff_camera",
      ),
    ).rejects.toMatchObject({ code: "CHECK_IN_NOT_OPEN" });
    await expect(
      backend.scanPass(
        admin.sessionToken,
        eventId,
        freshPass.qrToken,
        "staff_manual",
      ),
    ).rejects.toMatchObject({ code: "CHECK_IN_NOT_OPEN" });

    for (const sessionToken of [operator.sessionToken, admin.sessionToken]) {
      const retainedEvent = backend
        .getSnapshot(sessionToken)
        .events.find((event) => event.id === eventId);
      expect(retainedEvent).toMatchObject({
        status: "DISABLED",
        confirmedCheckIns: 0,
        pendingCheckIns: 1,
      });
    }
    expect(
      backend
        .getSnapshot(rider.sessionToken)
        .passes.find((pass) => pass.eventId === eventId),
    ).toMatchObject({ status: "active" });
    expect(
      backend
        .getSnapshot(outsider.sessionToken)
        .passes.find((pass) => pass.eventId === eventId),
    ).toMatchObject({ status: "active" });
    await expect(backend.auditCount("CHECK_IN_CONFIRMED")).resolves.toBe(0);
    await expect(backend.auditCount("CHECK_IN_CREATED")).resolves.toBe(0);
  });

  test("rejects a previously issued rider QR after the organizer switches to staff-only", async () => {
    const { backend, operator, rider, eventId } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);
    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "staff_only",
      state: "closed",
      qrMode: "rotating",
    });

    await expect(backend.selfCheckIn(rider.sessionToken, qr.token)).rejects.toThrow(
      "SELF_CHECK_IN_DISABLED",
    );
    await expect(backend.getSelfCheckInContext(qr.token)).rejects.toThrow(
      "SELF_CHECK_IN_DISABLED",
    );
  });

  test("holds a review-mode rider request until staff scans the pass", async () => {
    const { backend, operator, rider, eventId } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_review",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);
    const pending = await backend.selfCheckIn(rider.sessionToken, qr.token);

    expect(pending.status).toBe("pending");
    expect(pending.pass.status).toBe("active");

    const confirmed = await backend.scanPass(
      operator.sessionToken,
      eventId,
      pending.pass.qrToken,
      "staff_camera",
    );

    expect(confirmed.status).toBe("checked_in");
  });

  test("reports the staff confirmation time rather than the pending request time", async () => {
    const { backend, operator, admin, rider, eventId, pass } = await signInForCheckInPolicy();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-11T01:00:00.000Z"));
      await backend.configureCheckIn(operator.sessionToken, eventId, {
        mode: "self_review",
        state: "open",
        qrMode: "rotating",
      });
      const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);
      await backend.selfCheckIn(rider.sessionToken, qr.token);

      vi.advanceTimersByTime(60_000);
      await backend.scanPass(operator.sessionToken, eventId, pass.qrToken, "staff_upload");
      const csv = await backend.exportAttendeesCsv(admin.sessionToken, eventId);

      expect(csv).toContain("2026-07-11T01:01:00.000Z");
      expect(csv).not.toContain("2026-07-11T01:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  test("confirms an active rider pass immediately in automatic mode", async () => {
    const { backend, operator, rider, eventId } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "fixed",
      fixedQrAcknowledged: true,
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);

    const result = await backend.selfCheckIn(rider.sessionToken, qr.token);

    expect(result.status).toBe("confirmed");
    expect(result.pass.status).toBe("checked_in");
    await expect(backend.selfCheckIn(rider.sessionToken, qr.token)).rejects.toThrow(
      "ALREADY_CHECKED_IN",
    );
  });

  test("requires an explicit acknowledgement before an organizer can enable a fixed QR", async () => {
    const { backend, operator, eventId } = await signInForCheckInPolicy();

    await expect(
      backend.configureCheckIn(operator.sessionToken, eventId, {
        mode: "self_instant",
        state: "open",
        qrMode: "fixed",
      }),
    ).rejects.toThrow("INVALID_INPUT");
  });

  test("does not accept a guessed fixed link while the event uses rotating QR sessions", async () => {
    const { backend, operator, rider, eventId } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });

    await expect(backend.selfCheckIn(rider.sessionToken, `fixed:${eventId}`)).rejects.toThrow(
      "QR_EXPIRED",
    );
  });

  test("does not let another organizer or a rider configure the event policy", async () => {
    const backend = await createTambikeTestBackend({
      fixture: {
        users: [
          {
            id: "user-unrelated-organizer-check-in",
            displayName: "Unrelated Organizer",
            email: "unrelated-organizer-check-in@example.test",
            password: "password123",
            role: "organizer",
            verificationStatus: "APPROVED",
            area: "Cebu City",
            joinedAt: "July 15, 2026",
            organizerProfileId: "unrelated-organizer-profile-check-in",
          },
        ],
      },
    });
    const actors = await createTestActors(backend, "check-in-policy-denial");
    const event = await createPublishedTestEvent(backend, actors, {
      title: "Check-in policy denial test event",
    });
    const eventId = event.id;
    const unrelatedOrganizer = await backend.loginWithPassword(
      "unrelated-organizer-check-in@example.test",
      "password123",
    );

    await expect(
      backend.configureCheckIn(unrelatedOrganizer.sessionToken, eventId, {
        mode: "self_instant",
        state: "open",
        qrMode: "rotating",
      }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      backend.configureCheckIn(actors.outsider.sessionToken, eventId, {
        mode: "self_instant",
        state: "open",
        qrMode: "rotating",
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  test("accepts self check-in only from a rider account with its own active pass", async () => {
    const { backend, operator, rider, eventId } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);

    await expect(backend.selfCheckIn(operator.sessionToken, qr.token)).rejects.toThrow("FORBIDDEN");
    await expect(backend.selfCheckIn(rider.sessionToken, qr.token)).resolves.toMatchObject({
      status: "confirmed",
    });
  });

  test("pauses rider self-check-in without blocking an authorized staff scan", async () => {
    const { backend, operator, rider, eventId, pass } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);
    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "paused",
      qrMode: "rotating",
    });

    await expect(backend.selfCheckIn(rider.sessionToken, qr.token)).rejects.toThrow(
      "CHECK_IN_NOT_OPEN",
    );
    await expect(
      backend.scanPass(operator.sessionToken, eventId, pass.qrToken, "staff_manual"),
    ).resolves.toMatchObject({ status: "checked_in" });
  });

  test("rejects expired rotating QRs and requires the rider's own active pass", async () => {
    const { backend, operator, eventId } = await signInForCheckInPolicy();
    const unregisteredRider = await backend.signUpRider({
      displayName: "No Pass Rider",
      email: "no-pass-rider@example.com",
      password: "password123",
      area: "Marikina",
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-11T02:00:00.000Z"));
      await backend.configureCheckIn(operator.sessionToken, eventId, {
        mode: "self_instant",
        state: "open",
        qrMode: "rotating",
      });
      const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);

      await expect(backend.selfCheckIn(unregisteredRider.sessionToken, qr.token)).rejects.toThrow(
        "NOT_FOUND",
      );

      vi.advanceTimersByTime(90_001);
      await expect(backend.selfCheckIn(unregisteredRider.sessionToken, qr.token)).rejects.toThrow(
        "QR_EXPIRED",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("records exactly one confirmed arrival for simultaneous automatic check-in attempts", async () => {
    const { backend, operator, rider, eventId } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);
    const attempts = await Promise.allSettled([
      backend.selfCheckIn(rider.sessionToken, qr.token),
      backend.selfCheckIn(rider.sessionToken, qr.token),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(
      backend.getSnapshot(rider.sessionToken).events.find((event) => event.id === eventId),
    ).toMatchObject({ confirmedCheckIns: 1, pendingCheckIns: 0 });
  });

  test("keeps separate active passes and confirmed arrivals for two riders at one event", async () => {
    const { backend, operator, rider, eventId, pass } = await signInForCheckInPolicy();
    const secondRider = await backend.signUpRider({
      displayName: "Second Rider",
      email: "second-rider@example.com",
      password: "password123",
      area: "Davao City",
    });
    const secondRegistration = await backend.registerForEvent(secondRider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);

    expect(secondRegistration.pass?.id).not.toBe(pass.id);
    await expect(backend.selfCheckIn(rider.sessionToken, qr.token)).resolves.toMatchObject({
      status: "confirmed",
      pass: { id: pass.id },
    });
    await expect(backend.selfCheckIn(secondRider.sessionToken, qr.token)).resolves.toMatchObject({
      status: "confirmed",
      pass: { id: secondRegistration.pass?.id },
    });
    expect(
      backend.getSnapshot(rider.sessionToken).events.find((event) => event.id === eventId),
    ).toMatchObject({ confirmedCheckIns: 2, pendingCheckIns: 0 });
  });

  test("resolves an open organizer QR to its event before a rider checks in", async () => {
    const { backend, operator, eventId } = await signInForCheckInPolicy();

    await backend.configureCheckIn(operator.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });
    const qr = await backend.issueSelfCheckInQr(operator.sessionToken, eventId);

    await expect(backend.getSelfCheckInContext(qr.token)).resolves.toMatchObject({
      event: { id: eventId, title: "Check-in policy test event" },
      mode: "self_instant",
      state: "open",
      available: true,
    });
  });
});
