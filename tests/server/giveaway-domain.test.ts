import { describe, expect, test } from "vitest";

import type {
  CreateGiveawayInput,
  PublicGiveawayCampaignSummary,
  RiderGiveawayState,
  UpdateGiveawayInput,
} from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";

type GiveawayCampaignView = {
  id: string;
  eventId: string;
  title: string;
  state: string;
  complianceStatus: string;
  mechanicsVersion: number;
};

type GiveawayBackend = Awaited<ReturnType<typeof createTambikeTestBackend>> & {
  createGiveaway(
    sessionToken: string,
    eventId: string,
    input: CreateGiveawayInput,
  ): Promise<GiveawayCampaignView>;
  updateGiveaway(sessionToken: string, input: UpdateGiveawayInput): Promise<GiveawayCampaignView>;
  listOrganizerGiveaways(sessionToken: string, eventId: string): Promise<GiveawayCampaignView[]>;
  getPublicGiveaway(
    giveawayId: string,
    sessionToken?: string,
  ): Promise<PublicGiveawayCampaignSummary>;
  getRiderGiveawayState(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState>;
  submitGiveawayForReview(sessionToken: string, giveawayId: string): Promise<GiveawayCampaignView>;
  reviewGiveawayCompliance(
    sessionToken: string,
    giveawayId: string,
    input: { decision: "approved" | "changes_requested" | "rejected"; reason?: string },
  ): Promise<GiveawayCampaignView>;
  openGiveaway(sessionToken: string, giveawayId: string): Promise<GiveawayCampaignView>;
  pauseGiveaway(sessionToken: string, giveawayId: string): Promise<GiveawayCampaignView>;
  lockGiveaway(sessionToken: string, giveawayId: string): Promise<GiveawayCampaignView>;
  cancelGiveaway(
    sessionToken: string,
    giveawayId: string,
    reason: string,
  ): Promise<GiveawayCampaignView>;
  suspendGiveaway(
    sessionToken: string,
    giveawayId: string,
    reason: string,
  ): Promise<GiveawayCampaignView>;
};

function asGiveawayBackend(
  backend: Awaited<ReturnType<typeof createTambikeTestBackend>>,
): GiveawayBackend {
  return backend as GiveawayBackend;
}

function automaticGiveawayInput(
  eventId: string,
  eligibilityGroups: CreateGiveawayInput["eligibilityGroups"] = [
    {
      id: "active-rider",
      label: "Going riders with an active pass",
      weight: 3,
      conditions: [{ source: "active_rsvp_pass" }],
    },
  ],
): CreateGiveawayInput {
  return {
    eventId,
    title: "Ride day giveaway",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 10_000,
    eligibilityGroups,
    mechanics: "Eligible riders are entered automatically.",
    terms: "One entry is subject to the posted giveaway terms.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    prizePools: [
      {
        id: "helmet-pool",
        title: "Helmet giveaway",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Tambike helmet" }],
      },
    ],
    publicVisibility: "event_page",
  };
}

async function sessions(backend: GiveawayBackend) {
  const [organizer, admin, rider, venue] = await Promise.all([
    backend.loginWithPassword("marco.organizer@example.com", "password123"),
    backend.loginWithPassword("admin@bayanko.ph", "secret_123"),
    backend.loginWithPassword("mina.rider@example.com", "password123"),
    backend.loginWithPassword("ana.venue@example.com", "password123"),
  ]);

  return { organizer, admin, rider, venue };
}

async function createPublishedOrganizerEvent(backend: GiveawayBackend) {
  const { organizer, admin, venue, rider } = await sessions(backend);
  const event = await backend.createEventDraft(organizer.sessionToken, {
    title: "Giveaway eligibility test ride",
    type: "Bike Night",
    venueId: "shell-pugon",
    date: "August 15, 2026",
    time: "7:00 PM - 10:00 PM",
    area: "Antipolo",
    expectedRiders: 20,
    perkPreview: "Giveaway entry",
  });
  await backend.approveVenueWithConditions(venue.sessionToken, event.id, "Approved for test");
  await backend.approvePublish(admin.sessionToken, event.id);
  return { eventId: event.id, organizer, admin, venue, rider };
}

async function createApprovedOpenGiveaway(
  backend: GiveawayBackend,
  eligibilityGroups?: CreateGiveawayInput["eligibilityGroups"],
) {
  const { eventId, organizer, admin } = await createPublishedOrganizerEvent(backend);
  const giveaway = await backend.createGiveaway(
    organizer.sessionToken,
    eventId,
    automaticGiveawayInput(eventId, eligibilityGroups),
  );
  await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);
  await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, { decision: "approved" });
  return {
    giveaway: await backend.openGiveaway(organizer.sessionToken, giveaway.id),
    eventId,
    organizer,
    admin,
  };
}

describe("in-memory event giveaway lifecycle", () => {
  test("allows only the event owner or admin to create campaigns", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { eventId, organizer, admin, rider, venue } = await createPublishedOrganizerEvent(backend);

    const created = await backend.createGiveaway(
      organizer.sessionToken,
      eventId,
      automaticGiveawayInput(eventId),
    );

    expect(created).toMatchObject({
      eventId,
      state: "draft",
      complianceStatus: "draft",
      mechanicsVersion: 1,
    });
    await expect(
      backend.createGiveaway(organizer.sessionToken, "tambike-cafe-classico", {
        ...automaticGiveawayInput("tambike-cafe-classico"),
        eventId: "tambike-cafe-classico",
      }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      backend.createGiveaway(rider.sessionToken, eventId, automaticGiveawayInput(eventId)),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      backend.createGiveaway(venue.sessionToken, eventId, automaticGiveawayInput(eventId)),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      backend.createGiveaway(admin.sessionToken, eventId, automaticGiveawayInput(eventId)),
    ).resolves.toMatchObject({ eventId });
  });

  test("requires approval before opening and supports the constrained lifecycle", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { eventId, organizer, admin } = await createPublishedOrganizerEvent(backend);
    const { rider } = await sessions(backend);
    const created = await backend.createGiveaway(
      organizer.sessionToken,
      eventId,
      automaticGiveawayInput(eventId),
    );

    await expect(backend.openGiveaway(organizer.sessionToken, created.id)).rejects.toThrow(
      "GIVEAWAY_COMPLIANCE_REQUIRED",
    );
    const updated = await backend.updateGiveaway(organizer.sessionToken, {
      id: created.id,
      title: "Updated ride day giveaway",
    });
    expect(updated.mechanicsVersion).toBe(2);
    await expect(
      backend.submitGiveawayForReview(rider.sessionToken, created.id),
    ).rejects.toThrow("FORBIDDEN");
    await backend.submitGiveawayForReview(organizer.sessionToken, created.id);
    await expect(
      backend.reviewGiveawayCompliance(organizer.sessionToken, created.id, {
        decision: "approved",
      }),
    ).rejects.toThrow("FORBIDDEN");
    await backend.reviewGiveawayCompliance(admin.sessionToken, created.id, { decision: "approved" });
    await backend.openGiveaway(organizer.sessionToken, created.id);

    expect(await backend.listOrganizerGiveaways(organizer.sessionToken, eventId)).toEqual([
      expect.objectContaining({ id: created.id, state: "open", complianceStatus: "approved" }),
    ]);
    await backend.pauseGiveaway(organizer.sessionToken, created.id);
    await backend.cancelGiveaway(organizer.sessionToken, created.id, "Venue closure");
    await expect(backend.openGiveaway(organizer.sessionToken, created.id)).rejects.toThrow(
      "INVALID_GIVEAWAY_STATE",
    );
  });

  test("materializes and withdraws automatic RSVP-pass entries after committed RSVP changes", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId } = await createApprovedOpenGiveaway(backend);
    const { rider } = await sessions(backend);

    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 3,
    });

    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "interested",
      attendanceType: "direct",
    });
    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "not_eligible",
      entryCount: 0,
    });
  });

  test("caps automatic entry weight at the campaign maxEntriesPerRider limit", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { eventId, organizer, admin } = await createPublishedOrganizerEvent(backend);
    const input = automaticGiveawayInput(eventId, [
      {
        id: "base-entry",
        label: "Active RSVP",
        weight: 3,
        conditions: [{ source: "active_rsvp_pass" }],
      },
      {
        id: "bonus-entry",
        label: "Second active RSVP group",
        weight: 3,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ]) as CreateGiveawayInput & { maxEntriesPerRider: number };
    input.maxEntriesPerRider = 10_000;
    const giveaway = await backend.createGiveaway(organizer.sessionToken, eventId, input);
    await backend.updateGiveaway(organizer.sessionToken, {
      id: giveaway.id,
      maxEntriesPerRider: 4,
    });
    await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);
    await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, { decision: "approved" });
    await backend.openGiveaway(organizer.sessionToken, giveaway.id);
    const { rider } = await sessions(backend);

    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 4,
    });
  });

  test("does not change entry mode after automatic entries exist, even while paused", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId, organizer } = await createApprovedOpenGiveaway(backend);
    const { rider } = await sessions(backend);
    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await backend.pauseGiveaway(organizer.sessionToken, giveaway.id);

    await expect(
      backend.updateGiveaway(organizer.sessionToken, { id: giveaway.id, entryMode: "opt_in" }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_MODE_LOCKED" });
  });

  test("revalidates an equal-weight entry when its qualified source fingerprint changes", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId } = await createApprovedOpenGiveaway(backend);
    const { rider } = await sessions(backend);
    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });
    expect(await backend.auditCount("GIVEAWAY_ENTRY_RECONCILED")).toBe(1);

    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "club",
      clubName: "Equal-weight source change",
    });

    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 3,
    });
    expect(await backend.auditCount("GIVEAWAY_ENTRY_RECONCILED")).toBe(2);
  });

  test("rejects malformed review decisions and lifecycle reasons with a stable invalid-input error", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { eventId, organizer, admin } = await createPublishedOrganizerEvent(backend);
    const giveaway = await backend.createGiveaway(
      organizer.sessionToken,
      eventId,
      automaticGiveawayInput(eventId),
    );
    await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);

    await expect(
      backend.reviewGiveawayCompliance(
        admin.sessionToken,
        giveaway.id,
        null as unknown as { decision: "approved" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.reviewGiveawayCompliance(
        admin.sessionToken,
        giveaway.id,
        { decision: "invalid" } as unknown as { decision: "approved" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.reviewGiveawayCompliance(
        admin.sessionToken,
        giveaway.id,
        { decision: "approved", reason: { unexpected: true } } as unknown as { decision: "approved" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.reviewGiveawayCompliance(
        admin.sessionToken,
        giveaway.id,
        { decision: "approved", reason: "" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.cancelGiveaway(organizer.sessionToken, giveaway.id, {} as unknown as string),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.suspendGiveaway(admin.sessionToken, giveaway.id, 42 as unknown as string),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("does not turn campaign-code or manual conditions into automatic entries", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId } = await createApprovedOpenGiveaway(backend, [
      {
        id: "non-automatic-sources",
        label: "Code or manual grant only",
        weight: 9,
        conditions: [{ source: "campaign_code" }, { source: "manual" }],
      },
    ]);
    const { rider } = await sessions(backend);

    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "not_eligible",
      entryCount: 0,
    });
  });

  test("keeps pending rider QR arrivals ineligible until staff confirms them", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId, organizer, admin } = await createApprovedOpenGiveaway(
      backend,
      [
        {
          id: "staff-arrivals",
          label: "Staff confirmed arrivals",
          weight: 5,
          conditions: [
            { source: "active_rsvp_pass" },
            { source: "staff_confirmed_check_in" },
          ],
        },
      ],
    );
    const { rider } = await sessions(backend);
    await backend.configureCheckIn(organizer.sessionToken, eventId, {
      mode: "self_review",
      state: "open",
      qrMode: "fixed",
      fixedQrAcknowledged: true,
    });
    const qr = await backend.issueSelfCheckInQr(organizer.sessionToken, eventId);
    const registration = await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await expect(backend.selfCheckIn(rider.sessionToken, qr.token)).resolves.toMatchObject({
      status: "pending",
    });
    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "not_eligible",
      entryCount: 0,
    });

    await backend.scanPass(admin.sessionToken, eventId, registration.pass!.qrToken, "staff_upload");
    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 5,
    });
  });

  test("counts self-instant rider QR arrivals as confirmed but not staff-confirmed", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId, organizer } = await createApprovedOpenGiveaway(
      backend,
      [
        {
          id: "confirmed-arrivals",
          label: "Confirmed arrivals",
          weight: 2,
          conditions: [
            { source: "active_rsvp_pass" },
            { source: "confirmed_check_in" },
          ],
        },
        {
          id: "staff-arrivals",
          label: "Staff arrivals",
          weight: 7,
          conditions: [{ source: "staff_confirmed_check_in" }],
        },
      ],
    );
    const { rider } = await sessions(backend);
    await backend.configureCheckIn(organizer.sessionToken, eventId, {
      mode: "self_instant",
      state: "open",
      qrMode: "fixed",
      fixedQrAcknowledged: true,
    });
    const qr = await backend.issueSelfCheckInQr(organizer.sessionToken, eventId);
    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await expect(backend.selfCheckIn(rider.sessionToken, qr.token)).resolves.toMatchObject({
      status: "confirmed",
    });
    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 2,
    });
  });

  test("does not mutate a locked campaign when later source activity changes", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId, organizer, admin } = await createApprovedOpenGiveaway(backend);
    const { rider } = await sessions(backend);
    const registration = await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await backend.lockGiveaway(organizer.sessionToken, giveaway.id);

    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "interested",
      attendanceType: "direct",
    });
    await backend.scanPass(admin.sessionToken, eventId, registration.pass!.qrToken, "staff_camera");
    await expect(backend.getRiderGiveawayState(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 3,
    });
    await expect(
      backend.updateGiveaway(organizer.sessionToken, { id: giveaway.id, title: "Too late" }),
    ).rejects.toThrow("INVALID_GIVEAWAY_STATE");
  });

  test("returns privacy-safe public and rider DTOs without other-rider facts or operational secrets", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId } = await createApprovedOpenGiveaway(backend);
    const { rider } = await sessions(backend);
    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });

    const [publicGiveaway, riderState] = await Promise.all([
      backend.getPublicGiveaway(giveaway.id),
      backend.getRiderGiveawayState(rider.sessionToken, giveaway.id),
    ]);
    const payload = JSON.stringify({ publicGiveaway, riderState });

    expect(publicGiveaway).toMatchObject({ id: giveaway.id, eventId });
    expect(riderState).toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 3,
    });
    for (const forbiddenValue of [
      "email",
      "phone",
      "sourceSnapshot",
      "audit",
      "claimToken",
      "ciphertext",
      "userId",
      "riderId",
      "scan-rider@seed.tambike.local",
    ]) {
      expect(payload).not.toContain(forbiddenValue);
    }
  });

  test("allows only admins to suspend a campaign", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, organizer, admin } = await createApprovedOpenGiveaway(backend);

    await expect(
      backend.suspendGiveaway(organizer.sessionToken, giveaway.id, "Organizer request"),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      backend.suspendGiveaway(admin.sessionToken, giveaway.id, "Compliance hold"),
    ).resolves.toMatchObject({ id: giveaway.id, state: "suspended" });
  });
});
