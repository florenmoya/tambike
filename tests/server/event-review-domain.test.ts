import { describe, expect, test } from "vitest";
import { demoEvents } from "../../src/features/tambike-demo/data";
import type { CreateEventInput } from "../../src/features/tambike-demo/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createTestActors } from "./support/tambike-fixtures";

const validDraftInput: CreateEventInput = {
  title: "Lifecycle Review Night",
  type: "Bike Night",
  startDate: "2099-09-18",
  startTime: "18:00",
  endDate: "2099-09-18",
  endTime: "22:00",
  timeZone: "Asia/Manila",
  recurrence: "NONE",
  expectedRiders: 55,
  perkPreview: "A numbered event sticker",
  locationName: "Lifecycle Grounds",
  locationAddress: "101 Lifecycle Avenue, Quezon City",
  locationMapLink: "https://maps.example.test/lifecycle-grounds",
  area: "Quezon City",
};

async function createPendingEvent(namespace: string) {
  const backend = await createTambikeTestBackend();
  const actors = await createTestActors(backend, namespace);
  const event = await backend.createEventDraft(
    actors.organizer.sessionToken,
    { ...validDraftInput, title: `${validDraftInput.title} ${namespace}` },
  );
  return { backend, actors, event };
}

describe("memory event-review lifecycle", () => {
  test("publishes concise factual default event copy through public discovery", async () => {
    const { backend, actors, event } = await createPendingEvent(
      "rider-facing-brief",
    );
    const pending = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );
    await backend.reviewEvent(actors.admin.sessionToken, event.id, {
      decision: "PUBLISH",
      expectedUpdatedAt: pending.expectedUpdatedAt,
    });

    const publicEvent = backend
      .listEvents({ q: event.title })
      .find((candidate) => candidate.id === event.id);

    expect(publicEvent?.whatHappens).toBe(
      "Check the event details for the schedule, location, and participation instructions.",
    );
    expect(publicEvent?.whatHappens).toHaveLength(83);
    expect(
      publicEvent?.whatHappens.split(/[.!?]+(?:\s|$)/).filter(Boolean),
    ).toHaveLength(1);
    expect(publicEvent?.whatHappens).not.toMatch(
      /\b(?:submission|review|approval|publication|backend|admin|draft|exclusive|unlock)\b/i,
    );
  });

  test.each([
    ["PUBLISH", "PUBLISHED", "published", "ADMIN_PUBLISHED"],
    [
      "REQUEST_CHANGES",
      "NEEDS_CHANGES",
      "needs_changes",
      "EVENT_CHANGES_REQUESTED",
    ],
    ["REJECT", "REJECTED", "rejected", "EVENT_REJECTED"],
  ] as const)(
    "%s commits one decision, reviewer provenance, and audit",
    async (decision, status, historyDecision, auditAction) => {
      const { backend, actors, event } = await createPendingEvent(
        `review-${decision}`,
      );
      const before = await backend.getAdminEventReview(
        actors.admin.sessionToken,
        event.id,
      );

      const result = await backend.reviewEvent(
        actors.admin.sessionToken,
        event.id,
        {
          decision,
          reason:
            decision === "PUBLISH"
              ? undefined
              : "  A clear event review reason for the organizer.  ",
          expectedUpdatedAt: before.expectedUpdatedAt,
        },
      );

      expect(result.event.status).toBe(status);
      expect(result.submissionVersion).toBe(1);
      expect(result.expectedUpdatedAt > before.expectedUpdatedAt).toBe(true);
      expect(result.history).toHaveLength(1);
      expect(result.history[0]).toMatchObject({
        id: before.history[0]?.id,
        submissionVersion: 1,
        decision: historyDecision,
        reviewerName: actors.admin.user.displayName,
        ...(decision === "PUBLISH"
          ? {}
          : { reason: "A clear event review reason for the organizer." }),
      });
      expect(result.history[0]?.decidedAt).toBe(result.expectedUpdatedAt);
      expect(
        Date.parse(result.history[0]!.decidedAt!) >
          Date.parse(result.history[0]!.submittedAt),
      ).toBe(true);
      await expect(backend.auditCount(auditAction)).resolves.toBe(1);
    },
  );

  test("forbids non-admin and suspended-account review without changing the submission", async () => {
    const { backend, actors, event } = await createPendingEvent(
      "review-authorization",
    );
    const before = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );

    await expect(
      backend.reviewEvent(actors.organizer.sessionToken, event.id, {
        decision: "PUBLISH",
        expectedUpdatedAt: before.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const organizerAccount = (
      await backend.listAdminUserAccounts(actors.admin.sessionToken)
    ).find((account) => account.id === actors.organizer.user.id)!;
    await backend.suspendUser(
      actors.admin.sessionToken,
      actors.organizer.user.id,
      {
        reason: "Organizer access is paused for lifecycle verification.",
        expectedUpdatedAt: organizerAccount.updatedAt,
      },
    );
    await expect(
      backend.getOrganizerEventSubmission(
        actors.organizer.sessionToken,
        event.id,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const after = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );
    expect(after).toEqual(before);
  });

  test.each([
    ["REQUEST_CHANGES", undefined],
    ["REQUEST_CHANGES", " too short "],
    ["REQUEST_CHANGES", "x".repeat(1001)],
    ["REJECT", ""],
    ["REJECT", "ninechars"],
    ["REJECT", "x".repeat(1001)],
  ] as const)("%s rejects an invalid required reason", async (decision, reason) => {
    const { backend, actors, event } = await createPendingEvent(
      `invalid-reason-${decision}-${String(reason?.length)}`,
    );
    const before = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );

    await expect(
      backend.reviewEvent(actors.admin.sessionToken, event.id, {
        decision,
        reason,
        expectedUpdatedAt: before.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(backend.auditCount("EVENT_CHANGES_REQUESTED")).resolves.toBe(0);
    await expect(backend.auditCount("EVENT_REJECTED")).resolves.toBe(0);
  });

  test("rejects stale and duplicate decisions while preserving immutable history snapshots", async () => {
    const { backend, actors, event } = await createPendingEvent(
      "review-conflict",
    );
    const initial = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );

    await expect(
      backend.reviewEvent(actors.admin.sessionToken, event.id, {
        decision: "PUBLISH",
        expectedUpdatedAt: "1970-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const published = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision: "PUBLISH",
        expectedUpdatedAt: initial.expectedUpdatedAt,
      },
    );
    await expect(
      backend.reviewEvent(actors.admin.sessionToken, event.id, {
        decision: "REJECT",
        reason: "This second decision must never overwrite publication.",
        expectedUpdatedAt: published.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    published.history[0]!.decision = "rejected";
    published.history[0]!.reason = "mutated outside the backend";
    const reread = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );
    expect(reread.history[0]).toMatchObject({ decision: "published" });
    expect(reread.history[0]).not.toHaveProperty("reason");
    expect(initial.history[0]).toMatchObject({ decision: "pending" });
  });

  test("allows only the approved owner to update and resubmit NEEDS_CHANGES", async () => {
    const { backend, actors, event } = await createPendingEvent("resubmit-owner");
    const originalPerks = event.perks.map((perk) => ({ ...perk }));
    const pending = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );

    await expect(
      backend.resubmitEvent(actors.organizer.sessionToken, event.id, {
        event: validDraftInput,
        reason: "Updated the route and the attendance estimate.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const changes = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision: "REQUEST_CHANGES",
        reason: "Please clarify the venue and lower the rider estimate.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      },
    );
    await expect(
      backend.resubmitEvent(actors.outsider.sessionToken, event.id, {
        event: validDraftInput,
        reason: "An outsider must not revise this organizer submission.",
        expectedUpdatedAt: changes.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.resubmitEvent(actors.organizer.sessionToken, event.id, {
        event: validDraftInput,
        reason: "An otherwise valid note with a stale revision token.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const revisedInput: CreateEventInput = {
      ...validDraftInput,
      title: "  Revised Lifecycle Review Night  ",
      expectedRiders: 35,
      perkPreview: "  Revised check-in patch  ",
      locationName: "  Revised Lifecycle Grounds  ",
      locationAddress: "  202 Revised Avenue, Quezon City  ",
      area: "  Quezon City  ",
    };
    const result = await backend.resubmitEvent(
      actors.organizer.sessionToken,
      event.id,
      {
        event: revisedInput,
        reason: "  Updated the venue and reduced the rider estimate.  ",
        expectedUpdatedAt: changes.expectedUpdatedAt,
      },
    );

    expect(result.event).toMatchObject({
      id: event.id,
      title: "Revised Lifecycle Review Night",
      status: "PENDING_ADMIN_REVIEW",
      expectedRiders: 35,
      perkPreview: "Revised check-in patch",
      locationName: "Revised Lifecycle Grounds",
      locationAddress: "202 Revised Avenue, Quezon City",
      area: "Quezon City",
    });
    expect(result.event.perks).toEqual(originalPerks);
    expect(result.submissionVersion).toBe(2);
    expect(result.history.map((item) => item.decision)).toEqual([
      "needs_changes",
      "pending",
    ]);
    expect(result.history.map((item) => item.submissionVersion)).toEqual([1, 2]);
    expect(result.history[1]?.submittedAt).toBe(result.expectedUpdatedAt);
    expect(result.history[1]?.reason).toBe(
      "Updated the venue and reduced the rider estimate.",
    );
    expect(
      Date.parse(result.history[1]!.submittedAt) >
        Date.parse(result.history[0]!.decidedAt!),
    ).toBe(true);
    expect(changes.history[0]).toMatchObject({
      decision: "needs_changes",
      reason: "Please clarify the venue and lower the rider estimate.",
    });
    await expect(backend.auditCount("EVENT_RESUBMITTED")).resolves.toBe(1);
  });

  test.each(["short", "x".repeat(501)] as const)(
    "rejects an invalid resubmission note without appending a version",
    async (reason) => {
      const { backend, actors, event } = await createPendingEvent(
        `resubmit-reason-${reason.length}`,
      );
      const pending = await backend.getAdminEventReview(
        actors.admin.sessionToken,
        event.id,
      );
      const changes = await backend.reviewEvent(
        actors.admin.sessionToken,
        event.id,
        {
          decision: "REQUEST_CHANGES",
          reason: "Please supply a complete and safe resubmission.",
          expectedUpdatedAt: pending.expectedUpdatedAt,
        },
      );

      await expect(
        backend.resubmitEvent(actors.organizer.sessionToken, event.id, {
          event: validDraftInput,
          reason,
          expectedUpdatedAt: changes.expectedUpdatedAt,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      const after = await backend.getOrganizerEventSubmission(
        actors.organizer.sessionToken,
        event.id,
      );
      expect(after.submissionVersion).toBe(1);
      expect(after.history).toHaveLength(1);
    },
  );

  test("disables a published event, removes public discovery, and blocks new RSVP", async () => {
    const { backend, actors, event } = await createPendingEvent("disable");
    const pending = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );
    const published = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision: "PUBLISH",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      },
    );
    await backend.configureCheckIn(actors.organizer.sessionToken, event.id, {
      mode: "self_instant",
      state: "open",
      qrMode: "rotating",
    });
    const selfCheckInQr = await backend.issueSelfCheckInQr(
      actors.organizer.sessionToken,
      event.id,
    );
    const existingRegistration = await backend.registerForEvent(
      actors.rider.sessionToken,
      event.id,
      { status: "going", attendanceType: "direct" },
    );
    expect(existingRegistration.pass).not.toBeNull();

    await expect(
      backend.disableEvent(actors.organizer.sessionToken, event.id, {
        reason: "The organizer cannot disable through the admin lifecycle.",
        expectedUpdatedAt: published.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const disabled = await backend.disableEvent(
      actors.admin.sessionToken,
      event.id,
      {
        reason: "  Safety review requires this event to leave public discovery.  ",
        expectedUpdatedAt: published.expectedUpdatedAt,
      },
    );

    expect(disabled.event.status).toBe("DISABLED");
    expect(disabled.expectedUpdatedAt > published.expectedUpdatedAt).toBe(true);
    expect(backend.listEvents({ q: event.title })).toEqual([]);
    expect(
      backend
        .getSnapshot(actors.rider.sessionToken)
        .passes.some((pass) => pass.eventId === event.id),
    ).toBe(true);
    await expect(
      backend.getEventAttendeeSummary(event.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      backend.getPublicEventAttendeePreview(event.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      backend.registerForEvent(actors.outsider.sessionToken, event.id, {
        status: "going",
        attendanceType: "direct",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      backend.selfCheckIn(actors.rider.sessionToken, selfCheckInQr.token),
    ).rejects.toMatchObject({ code: "CHECK_IN_NOT_OPEN" });
    await expect(
      backend.exportAttendeesCsv(actors.admin.sessionToken, event.id),
    ).resolves.toContain(actors.rider.user.email);
    await expect(backend.auditCount("EVENT_DISABLED")).resolves.toBe(1);
  });

  test.each(["tiny", "x".repeat(501)] as const)(
    "validates disable and restore reasons without changing status",
    async (reason) => {
      const { backend, actors, event } = await createPendingEvent(
        `status-reason-${reason.length}`,
      );
      const pending = await backend.getAdminEventReview(
        actors.admin.sessionToken,
        event.id,
      );
      const published = await backend.reviewEvent(
        actors.admin.sessionToken,
        event.id,
        {
          decision: "PUBLISH",
          expectedUpdatedAt: pending.expectedUpdatedAt,
        },
      );
      await expect(
        backend.disableEvent(actors.admin.sessionToken, event.id, {
          reason,
          expectedUpdatedAt: published.expectedUpdatedAt,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      const stillPublished = await backend.getAdminEventReview(
        actors.admin.sessionToken,
        event.id,
      );
      expect(stillPublished.event.status).toBe("PUBLISHED");
    },
  );

  test("restores only to a new pending version and requires another publish decision", async () => {
    const { backend, actors, event } = await createPendingEvent("restore");
    const pending = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );
    const published = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision: "PUBLISH",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      },
    );
    const disabled = await backend.disableEvent(
      actors.admin.sessionToken,
      event.id,
      {
        reason: "A safety issue requires temporary event disablement.",
        expectedUpdatedAt: published.expectedUpdatedAt,
      },
    );

    await expect(
      backend.restoreEventToReview(actors.rider.sessionToken, event.id, {
        reason: "A rider cannot restore a disabled organizer event.",
        expectedUpdatedAt: disabled.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.restoreEventToReview(actors.admin.sessionToken, event.id, {
        reason: "The safety issue was resolved and documented for review.",
        expectedUpdatedAt: published.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const restored = await backend.restoreEventToReview(
      actors.admin.sessionToken,
      event.id,
      {
        reason: "  The safety issue was resolved and documented for review.  ",
        expectedUpdatedAt: disabled.expectedUpdatedAt,
      },
    );
    expect(restored.event.status).toBe("PENDING_ADMIN_REVIEW");
    expect(restored.submissionVersion).toBe(2);
    expect(restored.history.map((item) => item.decision)).toEqual([
      "published",
      "pending",
    ]);
    expect(restored.history[1]?.reason).toBe(
      "The safety issue was resolved and documented for review.",
    );
    expect(backend.listEvents({ q: event.title })).toEqual([]);
    await expect(
      backend.registerForEvent(actors.outsider.sessionToken, event.id, {
        status: "interested",
        attendanceType: "direct",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(backend.auditCount("EVENT_RESTORED_TO_REVIEW")).resolves.toBe(1);

    const republished = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision: "PUBLISH",
        expectedUpdatedAt: restored.expectedUpdatedAt,
      },
    );
    expect(republished.event.status).toBe("PUBLISHED");
    expect(republished.submissionVersion).toBe(2);
    expect(backend.listEvents({ q: event.title })).toHaveLength(1);
  });

  test("rejects stale disablement and invalid restoration reasons without partial state", async () => {
    const { backend, actors, event } = await createPendingEvent(
      "disable-restore-validation",
    );
    const pending = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );
    const published = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision: "PUBLISH",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      },
    );

    await expect(
      backend.disableEvent(actors.admin.sessionToken, event.id, {
        reason: "This stale request must not disable the published event.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      backend.getAdminEventReview(actors.admin.sessionToken, event.id),
    ).resolves.toMatchObject({ event: { status: "PUBLISHED" } });

    const disabled = await backend.disableEvent(
      actors.admin.sessionToken,
      event.id,
      {
        reason: "A valid reason moves this event out of public discovery.",
        expectedUpdatedAt: published.expectedUpdatedAt,
      },
    );
    await expect(
      backend.restoreEventToReview(actors.admin.sessionToken, event.id, {
        reason: "short",
        expectedUpdatedAt: disabled.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.restoreEventToReview(actors.admin.sessionToken, event.id, {
        reason: "x".repeat(501),
        expectedUpdatedAt: disabled.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.getAdminEventReview(actors.admin.sessionToken, event.id),
    ).resolves.toMatchObject({
      event: { status: "DISABLED" },
      submissionVersion: 1,
      history: [{ decision: "published" }],
    });
  });

  test("does not treat organizer CANCELLED as admin DISABLED", async () => {
    const cancelledEvent = {
      ...demoEvents[0]!,
      id: "cancelled-lifecycle-event",
      title: "Cancelled Lifecycle Event",
      status: "CANCELLED" as const,
    };
    const backend = await createTambikeTestBackend({
      fixture: { events: [cancelledEvent] } as never,
    });
    const actors = await createTestActors(backend, "cancelled-distinct");

    expect(backend.listEvents({ q: cancelledEvent.title })).toEqual([]);
    await expect(
      backend.restoreEventToReview(
        actors.admin.sessionToken,
        cancelledEvent.id,
        {
          reason: "Cancellation cannot be converted into an admin restoration.",
          expectedUpdatedAt: new Date().toISOString(),
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("keeps rejection final and exposes an owner-only clean copy source", async () => {
    const { backend, actors, event } = await createPendingEvent("rejected-copy");
    const pending = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );
    const rejected = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision: "REJECT",
        reason: "The event cannot be safely approved in its current form.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      },
    );

    await expect(
      backend.resubmitEvent(actors.organizer.sessionToken, event.id, {
        event: validDraftInput,
        reason: "A rejected version cannot be resubmitted in place.",
        expectedUpdatedAt: rejected.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      backend.getRejectedEventCopySource(actors.outsider.sessionToken, event.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const source = await backend.getRejectedEventCopySource(
      actors.organizer.sessionToken,
      event.id,
    );
    expect(source).toEqual({
      ...validDraftInput,
      title: `${validDraftInput.title} rejected-copy`,
    });
    expect(Object.keys(source).sort()).toEqual(
      [
        "area",
        "endDate",
        "endTime",
        "expectedRiders",
        "locationAddress",
        "locationMapLink",
        "locationName",
        "perkPreview",
        "recurrence",
        "startDate",
        "startTime",
        "timeZone",
        "title",
        "type",
      ].sort(),
    );
    expect(source).not.toHaveProperty("id");
    expect(source).not.toHaveProperty("status");
  });

  test.each([
    ["disable pending", "disableEvent", "PENDING_ADMIN_REVIEW"],
    ["restore pending", "restoreEventToReview", "PENDING_ADMIN_REVIEW"],
  ] as const)("rejects illegal transition: %s", async (_label, method, status) => {
    const { backend, actors, event } = await createPendingEvent(
      `illegal-${method}`,
    );
    const view = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );

    await expect(
      backend[method](actors.admin.sessionToken, event.id, {
        reason: "This transition is intentionally outside the matrix.",
        expectedUpdatedAt: view.expectedUpdatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      backend.getAdminEventReview(actors.admin.sessionToken, event.id),
    ).resolves.toMatchObject({ event: { status } });
  });
});
