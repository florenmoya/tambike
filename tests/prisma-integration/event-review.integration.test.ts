import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import type { CreateEventInput } from "../../src/features/tambike-demo/types";
import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";
import { createPrismaEventFixture } from "./fixtures";

const draftInput = (suffix: string): CreateEventInput => ({
  title: `Prisma Review ${suffix}`,
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
});

function createBackends() {
  return createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
    const backend = PrismaTambikeBackend.create(databaseUrl);
    return { backend, $disconnect: () => backend.disconnect() };
  });
}

describe("Prisma event review lifecycle", () => {
  test("returns detached current and historical review projections to authorized actors", async () => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      const adminView = await backends.primary.backend.getAdminEventReview(
        fixture.adminSession,
        fixture.eventId,
      );
      expect(adminView).toMatchObject({
        event: { id: fixture.eventId, status: "PUBLISHED" },
        organizerName: "Integration Organizer",
        submissionVersion: 1,
        history: [{ submissionVersion: 1, decision: "published" }],
      });
      const organizerView = await backends.primary.backend.getOrganizerEventSubmission(
        fixture.organizerSession,
        fixture.eventId,
      );
      expect(organizerView.latestDecision).toMatchObject({
        submissionVersion: 1,
        decision: "published",
      });

      adminView.event.tags.push("caller mutation");
      adminView.history[0]!.decision = "rejected";
      organizerView.history[0]!.reason = "caller mutation";
      const reread = await backends.secondary.backend.getAdminEventReview(
        fixture.adminSession,
        fixture.eventId,
      );
      expect(reread.event.tags).not.toContain("caller mutation");
      expect(reread.history[0]).toMatchObject({ decision: "published" });
      expect(reread.history[0]).not.toHaveProperty("reason");
      await expect(
        backends.primary.backend.getAdminEventReview(
          fixture.riders[0]!.sessionToken,
          fixture.eventId,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });

  test("request changes and owner resubmission commit versioned history and audit atomically", async () => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      const created = await backends.primary.backend.createEventDraft(
        fixture.organizerSession,
        draftInput(suffix),
      );
      const pending = await backends.primary.backend.getAdminEventReview(
        fixture.adminSession,
        created.id,
      );
      const changes = await backends.primary.backend.reviewEvent(
        fixture.adminSession,
        created.id,
        {
          decision: "REQUEST_CHANGES",
          reason: "Please clarify the venue and lower the rider estimate.",
          expectedUpdatedAt: pending.expectedUpdatedAt,
        },
      );

      const afterChanges = await raw.secondary.event.findUniqueOrThrow({
        where: { id: created.id },
        include: { approvals: true },
      });
      expect(afterChanges.status).toBe("NEEDS_CHANGES");
      expect(afterChanges.approvals).toHaveLength(1);
      expect(afterChanges.approvals[0]).toMatchObject({
        submissionVersion: 1,
        reviewerId: fixture.adminId,
        decision: "needs_changes",
        notes: "Please clarify the venue and lower the rider estimate.",
        decidedAt: expect.any(Date),
      });
      await expect(raw.secondary.auditLog.count({
        where: { action: "EVENT_CHANGES_REQUESTED", targetId: created.id },
      })).resolves.toBe(1);
      await expect(raw.secondary.notification.count({
        where: { userId: fixture.organizerId, kind: "EVENT_CHANGES_REQUESTED" },
      })).resolves.toBe(1);

      const revised = { ...draftInput(suffix), title: `Revised Prisma Review ${suffix}` };
      const resubmitted = await backends.primary.backend.resubmitEvent(
        fixture.organizerSession,
        created.id,
        {
          event: revised,
          reason: "Updated the venue and reduced the rider estimate.",
          expectedUpdatedAt: changes.expectedUpdatedAt,
        },
      );
      expect(resubmitted).toMatchObject({
        event: { status: "PENDING_ADMIN_REVIEW", title: revised.title },
        submissionVersion: 2,
        history: [
          { submissionVersion: 1, decision: "needs_changes" },
          {
            submissionVersion: 2,
            decision: "pending",
            reason: "Updated the venue and reduced the rider estimate.",
          },
        ],
      });
      const persisted = await raw.secondary.event.findUniqueOrThrow({
        where: { id: created.id },
        include: { approvals: { orderBy: { submissionVersion: "asc" } } },
      });
      expect(persisted.submissionVersion).toBe(2);
      expect(persisted.approvals.map((approval) => approval.decision)).toEqual([
        "needs_changes",
        "pending",
      ]);
      expect(persisted.approvals[1]?.submittedAt.getTime()).toBe(
        persisted.updatedAt.getTime(),
      );
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });

  test.each([
    ["publish/publish", "PUBLISH", "PUBLISH"],
    ["changes/reject", "REQUEST_CHANGES", "REJECT"],
    ["reject/changes", "REJECT", "REQUEST_CHANGES"],
  ] as const)("serializes %s from the same revision with exactly one durable decision", async (_label, leftDecision, rightDecision) => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      const event = await backends.primary.backend.createEventDraft(
        fixture.organizerSession,
        draftInput(suffix),
      );
      const view = await backends.primary.backend.getAdminEventReview(
        fixture.adminSession,
        event.id,
      );
      const invoke = (backend: PrismaTambikeBackend, decision: typeof leftDecision | typeof rightDecision) =>
        backend.reviewEvent(fixture.adminSession, event.id, {
          decision,
          ...(decision === "PUBLISH" ? {} : { reason: `A complete ${decision.toLowerCase()} concurrency reason.` }),
          expectedUpdatedAt: view.expectedUpdatedAt,
        });
      const settled = await Promise.allSettled([
        invoke(backends.primary.backend, leftDecision),
        invoke(backends.secondary.backend, rightDecision),
      ]);
      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ code: "CONFLICT" }) }),
      ]);
      const persisted = await raw.primary.event.findUniqueOrThrow({
        where: { id: event.id },
        include: { approvals: true },
      });
      expect(persisted.approvals).toHaveLength(1);
      expect(persisted.approvals[0]?.decision).not.toBe("pending");
      expect(persisted.approvals[0]?.decidedAt).toEqual(expect.any(Date));
      await expect(raw.primary.auditLog.count({
        where: { targetId: event.id, action: { in: ["ADMIN_PUBLISHED", "EVENT_CHANGES_REQUESTED", "EVENT_REJECTED"] } },
      })).resolves.toBe(1);
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });

  test("rejects stale or already-decided current versions without rewriting history", async () => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      const event = await backends.primary.backend.createEventDraft(fixture.organizerSession, draftInput(suffix));
      const initial = await backends.primary.backend.getAdminEventReview(fixture.adminSession, event.id);
      await expect(backends.primary.backend.reviewEvent(fixture.adminSession, event.id, {
        decision: "PUBLISH",
        expectedUpdatedAt: "1970-01-01T00:00:00.000Z",
      })).rejects.toMatchObject({ code: "CONFLICT" });
      await raw.primary.eventApproval.update({
        where: { eventId_submissionVersion: { eventId: event.id, submissionVersion: 1 } },
        data: { decision: "published", reviewerId: fixture.adminId, decidedAt: new Date() },
      });
      await expect(backends.primary.backend.reviewEvent(fixture.adminSession, event.id, {
        decision: "REJECT",
        reason: "This already decided version must never be overwritten.",
        expectedUpdatedAt: initial.expectedUpdatedAt,
      })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(raw.secondary.event.findUniqueOrThrow({ where: { id: event.id }, select: { status: true } })).resolves.toEqual({ status: "PENDING_ADMIN_REVIEW" });
      await expect(raw.secondary.eventApproval.count({ where: { eventId: event.id } })).resolves.toBe(1);
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });

  test("publish, disable, and restore produces a new pending version and hides public endpoints", async () => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      const event = await backends.primary.backend.createEventDraft(fixture.organizerSession, draftInput(suffix));
      const pending = await backends.primary.backend.getAdminEventReview(fixture.adminSession, event.id);
      const published = await backends.primary.backend.reviewEvent(fixture.adminSession, event.id, { decision: "PUBLISH", expectedUpdatedAt: pending.expectedUpdatedAt });
      const disabled = await backends.primary.backend.disableEvent(fixture.adminSession, event.id, {
        reason: "A safety issue requires temporary event disablement.",
        expectedUpdatedAt: published.expectedUpdatedAt,
      });
      await expect(backends.primary.backend.registerForEvent(fixture.riders[0]!.sessionToken, event.id, { status: "going", attendanceType: "direct" })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(backends.primary.backend.getPublicEventAttendeePreview(event.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const restored = await backends.primary.backend.restoreEventToReview(fixture.adminSession, event.id, {
        reason: "The safety issue was resolved and documented for review.",
        expectedUpdatedAt: disabled.expectedUpdatedAt,
      });
      expect(restored).toMatchObject({ event: { status: "PENDING_ADMIN_REVIEW" }, submissionVersion: 2 });
      expect(restored.history.map((item) => item.decision)).toEqual(["published", "pending"]);
      const persisted = await raw.secondary.event.findUniqueOrThrow({ where: { id: event.id }, include: { approvals: { orderBy: { submissionVersion: "asc" } } } });
      expect(persisted).toMatchObject({ status: "PENDING_ADMIN_REVIEW", submissionVersion: 2, disabledAt: null, disabledByUserId: null, disableReason: null });
      expect(persisted.approvals).toHaveLength(2);
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });

  test("disabled events retain operator data but block public roster and check-in mutation", async () => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      await backends.primary.backend.configureEventRoster(
        fixture.organizerSession,
        fixture.eventId,
        { enabled: true },
      );
      const published = await backends.primary.backend.getAdminEventReview(
        fixture.adminSession,
        fixture.eventId,
      );
      await backends.primary.backend.disableEvent(fixture.adminSession, fixture.eventId, {
        reason: "A safety issue requires temporary event disablement.",
        expectedUpdatedAt: published.expectedUpdatedAt,
      });

      await expect(backends.primary.backend.getEventAttendeeSummary(fixture.eventId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(backends.primary.backend.getPublicEventAttendeePreview(fixture.eventId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(backends.primary.backend.listEventAttendees(fixture.riders[0]!.sessionToken, fixture.eventId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(backends.primary.backend.listEventAttendees(fixture.organizerSession, fixture.eventId)).resolves.toMatchObject({ summary: { goingCount: 1 } });
      await expect(backends.primary.backend.scanPass(
        fixture.organizerSession,
        fixture.eventId,
        `integration-pass-token-1-${suffix}`,
        "staff_manual",
      )).rejects.toMatchObject({ code: "CHECK_IN_NOT_OPEN" });
      await expect(raw.secondary.pass.findUniqueOrThrow({ where: { id: fixture.riders[0]!.passId }, select: { status: true } })).resolves.toEqual({ status: "active" });
      const snapshot = await backends.primary.backend.getSnapshot(fixture.riders[0]!.sessionToken);
      expect(snapshot.events.some((event) => event.id === fixture.eventId)).toBe(false);
      expect(snapshot.passes.some((pass) => pass.eventId === fixture.eventId)).toBe(true);
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });

  test("enforces the transition matrix, reason bounds, retained-session status, and clean rejected copy", async () => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      const event = await backends.primary.backend.createEventDraft(fixture.organizerSession, draftInput(suffix));
      const pending = await backends.primary.backend.getAdminEventReview(fixture.adminSession, event.id);
      await expect(backends.primary.backend.disableEvent(fixture.adminSession, event.id, {
        reason: "Pending review cannot be disabled through this transition.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(backends.primary.backend.restoreEventToReview(fixture.adminSession, event.id, {
        reason: "Pending review cannot be restored through this transition.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(backends.primary.backend.resubmitEvent(fixture.organizerSession, event.id, {
        event: draftInput(suffix),
        reason: "Pending review cannot be resubmitted through this transition.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(backends.primary.backend.reviewEvent(fixture.adminSession, event.id, {
        decision: "REJECT",
        reason: "short",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      const rejected = await backends.primary.backend.reviewEvent(fixture.adminSession, event.id, {
        decision: "REJECT",
        reason: "The event cannot be safely approved in its current form.",
        expectedUpdatedAt: pending.expectedUpdatedAt,
      });
      const source = await backends.primary.backend.getRejectedEventCopySource(fixture.organizerSession, event.id);
      expect(source).toEqual(draftInput(suffix));
      expect(source).not.toHaveProperty("id");
      expect(source).not.toHaveProperty("status");
      await expect(backends.primary.backend.resubmitEvent(fixture.organizerSession, event.id, {
        event: source,
        reason: "Rejected submissions cannot be resubmitted in place.",
        expectedUpdatedAt: rejected.expectedUpdatedAt,
      })).rejects.toMatchObject({ code: "CONFLICT" });

      await raw.primary.user.update({
        where: { id: fixture.organizerId },
        data: { accountStatus: "SUSPENDED" },
      });
      await expect(backends.primary.backend.getOrganizerEventSubmission(fixture.organizerSession, event.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await raw.primary.user.update({
        where: { id: fixture.adminId },
        data: { accountStatus: "SUSPENDED" },
      });
      await expect(backends.primary.backend.getAdminEventReview(fixture.adminSession, event.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });

  test("outsiders cannot mutate or copy any lifecycle state", async () => {
    const raw = createPrismaIntegrationClients();
    const backends = createBackends();
    const suffix = randomUUID();
    try {
      const fixture = await createPrismaEventFixture(raw.primary, { suffix });
      const event = await backends.primary.backend.createEventDraft(fixture.organizerSession, draftInput(suffix));
      const before = await raw.primary.event.findUniqueOrThrow({ where: { id: event.id }, include: { approvals: true } });
      const expectedUpdatedAt = before.updatedAt.toISOString();
      await expect(backends.primary.backend.reviewEvent(fixture.riders[0]!.sessionToken, event.id, { decision: "PUBLISH", expectedUpdatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(backends.primary.backend.disableEvent(fixture.riders[0]!.sessionToken, event.id, { reason: "An outsider cannot disable this event lifecycle.", expectedUpdatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(backends.primary.backend.restoreEventToReview(fixture.riders[0]!.sessionToken, event.id, { reason: "An outsider cannot restore this event lifecycle.", expectedUpdatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(backends.primary.backend.resubmitEvent(fixture.riders[0]!.sessionToken, event.id, { event: draftInput(suffix), reason: "An outsider cannot resubmit this organizer event.", expectedUpdatedAt })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(backends.primary.backend.getRejectedEventCopySource(fixture.riders[0]!.sessionToken, event.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const after = await raw.secondary.event.findUniqueOrThrow({ where: { id: event.id }, include: { approvals: true } });
      expect(after).toEqual(before);
      await expect(raw.secondary.auditLog.count({ where: { targetId: event.id, action: { not: "EVENT_DRAFT_CREATED" } } })).resolves.toBe(0);
    } finally {
      await closePrismaIntegrationClientPair(backends);
      await closePrismaIntegrationClientPair(raw);
    }
  });
});
