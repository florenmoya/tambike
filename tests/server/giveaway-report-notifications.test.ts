import { describe, expect, test } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createPublishedTestEvent, createTestActors } from "./support/tambike-fixtures";

type ReportNotificationBackend = Awaited<ReturnType<typeof createTambikeTestBackend>> & {
  createGiveaway(
    sessionToken: string,
    eventId: string,
    input: CreateGiveawayInput,
  ): Promise<{ id: string }>;
  submitGiveawayForReview(sessionToken: string, giveawayId: string): Promise<unknown>;
  reviewGiveawayCompliance(
    sessionToken: string,
    giveawayId: string,
    input: { decision: "approved" },
  ): Promise<unknown>;
  openGiveaway(sessionToken: string, giveawayId: string): Promise<unknown>;
  listGiveawayNotifications(sessionToken: string): Promise<
    Array<{ kind: string; title: string; body: string; href?: string }>
  >;
  getOrganizerGiveawayReport(
    sessionToken: string,
    giveawayId: string,
  ): Promise<Record<string, unknown>>;
  getAdminGiveawayAudit(
    sessionToken: string,
    giveawayId: string,
  ): Promise<{ events: Array<Record<string, unknown>> }>;
};

function asReportNotificationBackend(backend: Awaited<ReturnType<typeof createTambikeTestBackend>>) {
  return backend as ReportNotificationBackend;
}

function giveawayInput(eventId: string): CreateGiveawayInput {
  return {
    eventId,
    title: "Notification-safe giveaway",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 10,
    mechanics: "An active pass creates an entry.",
    terms: "Entries and claim updates are sent in-app only.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "hidden",
    eligibilityGroups: [
      {
        id: "active-pass",
        label: "Active pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "onsite-prize",
        title: "Onsite prize",
        awardMode: "first_come",
        fulfilmentMode: "onsite",
        publicPresentation: {
          disclosure: "revealed",
          title: "Prize",
        },
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Prize" }],
      },
    ],
  };
}

describe("giveaway report and notification privacy", () => {
  test("creates deduplicated nonsecret entry notifications outside the global snapshot", async () => {
    const backend = asReportNotificationBackend(await createTambikeTestBackend());
    const { organizer, admin, rider } = await createTestActors(
      backend,
      "giveaway-report-notifications-entry",
    );
    const event = await createPublishedTestEvent(backend, { organizer, admin }, {
      title: "Notification event",
      type: "Bike Night",
      startDate: "2026-08-15",
      startTime: "19:00",
      endDate: "2026-08-15",
      endTime: "22:00",
      locationName: "Notification Test Grounds",
      locationAddress: "15 Notification Avenue, Antipolo",
      area: "Antipolo",
      expectedRiders: 20,
      perkPreview: "Notification prize",
    });
    const giveaway = await backend.createGiveaway(
      organizer.sessionToken,
      event.id,
      giveawayInput(event.id),
    );
    await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);
    await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, { decision: "approved" });
    await backend.openGiveaway(organizer.sessionToken, giveaway.id);
    await backend.registerForEvent(rider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
    });

    const notifications = await backend.listGiveawayNotifications(rider.sessionToken);
    expect(notifications).toHaveLength(2);
    expect(notifications.map((notification) => notification.kind).sort()).toEqual([
      "giveaway_entry",
      "giveaway_winner",
    ]);
    expect(JSON.stringify(notifications)).not.toContain("tbk_gc1_");
    expect(JSON.stringify(notifications)).not.toContain("sourceFacts");
    expect(JSON.stringify(await backend.getSnapshot(rider.sessionToken))).not.toContain("giveaway_entry");
  });

  test("keeps aggregate reports identity-free and admin audit events payload-free", async () => {
    const backend = asReportNotificationBackend(await createTambikeTestBackend());
    const { organizer, admin } = await createTestActors(
      backend,
      "giveaway-report-notifications-audit",
    );
    const event = await createPublishedTestEvent(backend, { organizer, admin }, {
      title: "Report event",
      type: "Bike Night",
      startDate: "2026-08-16",
      startTime: "19:00",
      endDate: "2026-08-16",
      endTime: "22:00",
      locationName: "Report Test Grounds",
      locationAddress: "16 Report Avenue, Antipolo",
      area: "Antipolo",
      expectedRiders: 20,
      perkPreview: "Report prize",
    });
    const giveaway = await backend.createGiveaway(
      organizer.sessionToken,
      event.id,
      giveawayInput(event.id),
    );

    const report = await backend.getOrganizerGiveawayReport(organizer.sessionToken, giveaway.id);
    expect(report).toMatchObject({ giveawayId: giveaway.id });
    expect(JSON.stringify(report)).not.toContain("riderId");
    expect(JSON.stringify(report)).not.toContain("email");

    const audit = await backend.getAdminGiveawayAudit(admin.sessionToken, giveaway.id);
    expect(audit.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('"payload"');
    expect(JSON.stringify(audit)).not.toContain('"canonicalPayload"');
  });
});
