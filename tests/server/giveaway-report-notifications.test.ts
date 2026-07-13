import { describe, expect, test } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";

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
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Prize" }],
      },
    ],
  };
}

describe("giveaway report and notification privacy", () => {
  test("creates deduplicated nonsecret entry notifications outside the global snapshot", async () => {
    const backend = asReportNotificationBackend(await createTambikeTestBackend());
    const [organizer, admin, venue, rider] = await Promise.all([
      backend.loginWithPassword("marco.organizer@example.com", "password123"),
      backend.loginWithPassword("admin@bayanko.ph", "secret_123"),
      backend.loginWithPassword("ana.venue@example.com", "password123"),
      backend.loginWithPassword("mina.rider@example.com", "password123"),
    ]);
    const event = await backend.createEventDraft(organizer.sessionToken, {
      title: "Notification event",
      type: "Bike Night",
      venueId: "shell-pugon",
      date: "August 15, 2026",
      time: "7:00 PM - 10:00 PM",
      area: "Antipolo",
      expectedRiders: 20,
      perkPreview: "Notification prize",
    });
    await backend.approveVenueWithConditions(venue.sessionToken, event.id, "Approved");
    await backend.approvePublish(admin.sessionToken, event.id);
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
    const [organizer, admin, venue] = await Promise.all([
      backend.loginWithPassword("marco.organizer@example.com", "password123"),
      backend.loginWithPassword("admin@bayanko.ph", "secret_123"),
      backend.loginWithPassword("ana.venue@example.com", "password123"),
    ]);
    const event = await backend.createEventDraft(organizer.sessionToken, {
      title: "Report event",
      type: "Bike Night",
      venueId: "shell-pugon",
      date: "August 16, 2026",
      time: "7:00 PM - 10:00 PM",
      area: "Antipolo",
      expectedRiders: 20,
      perkPreview: "Report prize",
    });
    await backend.approveVenueWithConditions(venue.sessionToken, event.id, "Approved");
    await backend.approvePublish(admin.sessionToken, event.id);
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
