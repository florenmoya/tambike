import { describe, expect, test, vi } from "vitest";

import type {
  CreateGiveawayInput,
  PublicGiveawayDrawVerification,
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

type GiveawayLockResult = GiveawayCampaignView & {
  snapshot: {
    id: string;
    candidateCount: number;
    snapshotDigest: string;
    commitment: string;
    algorithmVersion: string;
  };
};

type GiveawayDrawResult = {
  drawId: string;
  verification: PublicGiveawayDrawVerification;
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
  lockGiveaway(sessionToken: string, giveawayId: string): Promise<GiveawayLockResult>;
  optInToGiveaway(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState>;
  createGiveawayCampaignCode(
    sessionToken: string,
    giveawayId: string,
    input: { maxUses: number; expiresAt?: string },
  ): Promise<{ id: string; code: string; maxUses: number; expiresAt?: string }>;
  claimGiveawayCampaignCode(
    sessionToken: string,
    giveawayId: string,
    code: string,
  ): Promise<RiderGiveawayState>;
  grantManualGiveawayEntry(
    sessionToken: string,
    input: { giveawayId: string; riderId: string; reason: string },
  ): Promise<RiderGiveawayState>;
  revokeManualGiveawayEntry(
    sessionToken: string,
    giveawayId: string,
    riderId: string,
    reason: string,
  ): Promise<RiderGiveawayState>;
  redeemGiveawayPerk(
    sessionToken: string,
    perkId: string,
  ): Promise<{ perkId: string; status: "redeemed" }>;
  runGiveawayDraw(
    sessionToken: string,
    input: { giveawayId: string; idempotencyKey: string; reason?: string },
  ): Promise<GiveawayDrawResult>;
  publishGiveawayDraw(
    sessionToken: string,
    giveawayId: string,
    drawId: string,
  ): Promise<PublicGiveawayDrawVerification>;
  declineGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: string,
  ): Promise<RiderGiveawayState>;
  voidGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: string,
  ): Promise<RiderGiveawayState>;
  disqualifyGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: string,
  ): Promise<RiderGiveawayState>;
  redrawGiveawayAward(
    sessionToken: string,
    input: { awardId: string; idempotencyKey: string; reason: string },
  ): Promise<GiveawayDrawResult>;
  selectManualGiveawayAward(
    sessionToken: string,
    input: {
      giveawayId: string;
      prizePoolId: string;
      riderId: string;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<GiveawayDrawResult>;
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

function internalGiveawayEntry(
  backend: GiveawayBackend,
  giveawayId: string,
  riderId: string,
): {
  currentWeight: number;
  eligibilityCycleAt: string;
  qualifiedSourceFingerprint: string;
  qualifiedGroupIds: string[];
  qualifiedEligibilityGroupTimings: Array<{ groupId: string; eligibleAt: string }>;
} {
  const store = backend as unknown as {
    giveaways: {
      campaignsById: Map<
        string,
        {
          entriesByRider: Map<
            string,
            {
              currentWeight: number;
              eligibilityCycleAt: string;
              qualifiedSourceFingerprint: string;
              qualifiedGroupIds: string[];
              qualifiedEligibilityGroupTimings: Array<{ groupId: string; eligibleAt: string }>;
            }
          >;
        }
      >;
    };
  };
  const entry = store.giveaways.campaignsById.get(giveawayId)?.entriesByRider.get(riderId);
  if (!entry) throw new Error("TEST_GIVEAWAY_ENTRY_MISSING");
  return entry;
}

function internalGiveawayCampaign(
  backend: GiveawayBackend,
  giveawayId: string,
): {
  awards: Array<{
    id: string;
    winnerUserId: string;
    prizePoolId: string;
    prizeItemId?: string;
    drawId?: string;
    snapshotEntryId?: string;
    predecessorAwardId?: string;
    recoveryClosedAt?: string;
    recoverySourceAwardId?: string;
    rank?: number;
    status: string;
    isCurrent: boolean;
  }>;
  prizePools: Array<{
    id: string;
    items: Array<{ id: string; status: string }>;
  }>;
} {
  const store = backend as unknown as {
    giveaways: {
      campaignsById: Map<
        string,
        {
          awards: Array<{
            id: string;
            winnerUserId: string;
            prizePoolId: string;
            prizeItemId?: string;
            drawId?: string;
            snapshotEntryId?: string;
            predecessorAwardId?: string;
            recoveryClosedAt?: string;
            recoverySourceAwardId?: string;
            rank?: number;
            status: string;
            isCurrent: boolean;
          }>;
          prizePools: Array<{
            id: string;
            items: Array<{ id: string; status: string }>;
          }>;
        }
      >;
    };
  };
  const campaign = store.giveaways.campaignsById.get(giveawayId);
  if (!campaign) throw new Error("TEST_GIVEAWAY_CAMPAIGN_MISSING");
  return campaign;
}

function setInternalGiveawayDrawStatus(
  backend: GiveawayBackend,
  giveawayId: string,
  drawId: string,
  status: string,
) {
  const store = backend as unknown as {
    giveaways: {
      campaignsById: Map<string, { draws: Array<{ id: string; status: string }> }>;
    };
  };
  const draw = store.giveaways.campaignsById
    .get(giveawayId)
    ?.draws.find((candidate) => candidate.id === drawId);
  if (!draw) throw new Error("TEST_GIVEAWAY_DRAW_MISSING");
  draw.status = status;
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

function giveawayInput(
  eventId: string,
  overrides: Partial<CreateGiveawayInput>,
): CreateGiveawayInput {
  return {
    ...automaticGiveawayInput(eventId),
    ...overrides,
  } as CreateGiveawayInput;
}

async function withDrawEncryptionKey<T>(callback: () => Promise<T>) {
  const prior = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
  process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 37).toString("base64");
  try {
    return await callback();
  } finally {
    if (prior === undefined) {
      delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    } else {
      process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = prior;
    }
  }
}

async function createApprovedOpenCustomGiveaway(
  backend: GiveawayBackend,
  inputForEvent: (eventId: string) => CreateGiveawayInput,
) {
  const context = await createPublishedOrganizerEvent(backend);
  const created = await backend.createGiveaway(
    context.organizer.sessionToken,
    context.eventId,
    inputForEvent(context.eventId),
  );
  await backend.submitGiveawayForReview(context.organizer.sessionToken, created.id);
  await backend.reviewGiveawayCompliance(context.admin.sessionToken, created.id, {
    decision: "approved",
  });
  return {
    ...context,
    giveaway: await backend.openGiveaway(context.organizer.sessionToken, created.id),
  };
}

async function createExtraRider(backend: GiveawayBackend, suffix: string) {
  return backend.signUpRider({
    displayName: `Task four rider ${suffix}`,
    email: `task-four-${suffix}@example.com`,
    password: "password123",
    area: "Antipolo",
  });
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
  const { eventId, organizer, admin, rider, venue } = await createPublishedOrganizerEvent(backend);
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
    rider,
    venue,
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
    expect(updated.mechanicsVersion).toBe(1);
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

  test("freezes campaign and pool winner limits after a direct award exists", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { eventId, organizer, admin, rider } = await createPublishedOrganizerEvent(backend);
    const eligibilityGroups: CreateGiveawayInput["eligibilityGroups"] = [
      {
        id: "active-rider",
        label: "Going riders with an active pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ];
    const prizePools: CreateGiveawayInput["prizePools"] = [
      {
        id: "limited-first-come",
        title: "Limited first-come prize",
        awardMode: "first_come",
        fulfilmentMode: "onsite",
        eligibilityGroupIds: ["active-rider"],
        perRiderLimit: 1,
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Frozen winner limit prize" }],
      },
    ];
    const giveaway = await backend.createGiveaway(
      organizer.sessionToken,
      eventId,
      giveawayInput(eventId, {
        eligibilityGroups,
        prizePools,
        winnerLimits: { perRider: 1, total: 1 },
      }),
    );
    await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);
    await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, { decision: "approved" });
    await backend.openGiveaway(organizer.sessionToken, giveaway.id);
    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await backend.pauseGiveaway(organizer.sessionToken, giveaway.id);

    await expect(
      backend.updateGiveaway(organizer.sessionToken, {
        id: giveaway.id,
        title: "Winner-limit change must not partially update",
        winnerLimits: { perRider: 2, total: 2 },
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED" });
    await expect(backend.listOrganizerGiveaways(organizer.sessionToken, eventId)).resolves.toEqual([
      expect.objectContaining({ id: giveaway.id, title: "Ride day giveaway" }),
    ]);
    await expect(
      backend.updateGiveaway(organizer.sessionToken, {
        id: giveaway.id,
        eligibilityGroups,
        prizePools: [
          {
            id: "limited-first-come",
            title: "Limited first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            eligibilityGroupIds: ["active-rider"],
            perRiderLimit: 2,
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Frozen winner limit prize" }],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED" });
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
    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(organizer.sessionToken, giveaway.id);
    });

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

  test("lets an eligible rider explicitly opt in only while an opt-in campaign is open", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId, organizer, rider } = await createApprovedOpenCustomGiveaway(
      backend,
      (createdEventId) =>
        giveawayInput(createdEventId, {
          entryMode: "opt_in",
          mechanics: "Tap to acknowledge these current mechanics and enter.",
        }),
    );

    await expect(backend.optInToGiveaway(rider.sessionToken, giveaway.id)).rejects.toMatchObject({
      code: "GIVEAWAY_ENTRY_NOT_ELIGIBLE",
    });
    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(backend.optInToGiveaway(rider.sessionToken, giveaway.id)).resolves.toEqual({
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: 3,
    });

    await backend.pauseGiveaway(organizer.sessionToken, giveaway.id);
    await expect(backend.optInToGiveaway(rider.sessionToken, giveaway.id)).rejects.toMatchObject({
      code: "GIVEAWAY_ENTRY_NOT_OPEN",
    });
    await backend.openGiveaway(organizer.sessionToken, giveaway.id);
    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(organizer.sessionToken, giveaway.id);
    });
    await expect(backend.optInToGiveaway(rider.sessionToken, giveaway.id)).rejects.toMatchObject({
      code: "GIVEAWAY_ENTRY_NOT_OPEN",
    });

    const wrongMode = await createApprovedOpenCustomGiveaway(backend, (createdEventId) =>
      automaticGiveawayInput(createdEventId),
    );
    await expect(backend.optInToGiveaway(rider.sessionToken, wrongMode.giveaway.id)).rejects.toMatchObject({
      code: "GIVEAWAY_ENTRY_MODE_INVALID",
    });
  });

  test("uses hashed expiring campaign codes only for eligible claim-code entries", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId, organizer, rider } = await createApprovedOpenCustomGiveaway(
      backend,
      (createdEventId) =>
        giveawayInput(createdEventId, {
          entryMode: "claim_code",
          eligibilityGroups: [
            {
              id: "coded-active-rider",
              label: "Active rider with campaign code",
              weight: 2,
              conditions: [{ source: "active_rsvp_pass" }, { source: "campaign_code" }],
            },
          ],
        }),
    );
    const extra = await createExtraRider(backend, "code-claim");
    await Promise.all([
      backend.registerForEvent(rider.sessionToken, eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(extra.sessionToken, eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);

    const createdCode = await backend.createGiveawayCampaignCode(
      organizer.sessionToken,
      giveaway.id,
      { maxUses: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    );
    await expect(
      backend.claimGiveawayCampaignCode(rider.sessionToken, giveaway.id, "not-the-campaign-code"),
    ).rejects.toMatchObject({ code: "GIVEAWAY_CODE_INVALID" });
    await expect(
      backend.claimGiveawayCampaignCode(rider.sessionToken, giveaway.id, createdCode.code),
    ).resolves.toEqual({ giveawayId: giveaway.id, status: "entered", entryCount: 2 });
    await expect(
      backend.claimGiveawayCampaignCode(extra.sessionToken, giveaway.id, createdCode.code),
    ).rejects.toMatchObject({ code: "GIVEAWAY_CODE_UNAVAILABLE" });

    await expect(
      backend.createGiveawayCampaignCode(organizer.sessionToken, giveaway.id, {
        maxUses: 1,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(await backend.getPublicGiveaway(giveaway.id))).not.toContain(createdCode.code);
  });

  test("keeps manual grants and perk redemptions separate and authorization-scoped", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const manual = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        entryMode: "manual_only",
        eligibilityGroups: [
          {
            id: "staff-granted",
            label: "Staff granted entry",
            weight: 1,
            conditions: [{ source: "manual" }],
          },
        ],
      }),
    );
    const { rider } = await sessions(backend);
    await expect(
      backend.grantManualGiveawayEntry(rider.sessionToken, {
        giveawayId: manual.giveaway.id,
        riderId: rider.user.id,
        reason: "Trying to grant myself",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.grantManualGiveawayEntry(manual.organizer.sessionToken, {
        giveawayId: manual.giveaway.id,
        riderId: rider.user.id,
        reason: "Verified paper registration",
      }),
    ).resolves.toEqual({ giveawayId: manual.giveaway.id, status: "entered", entryCount: 1 });
    await expect(
      backend.revokeManualGiveawayEntry(
        manual.organizer.sessionToken,
        manual.giveaway.id,
        rider.user.id,
        "Paper registration was voided",
      ),
    ).resolves.toEqual({ giveawayId: manual.giveaway.id, status: "not_eligible", entryCount: 0 });

    const perkCampaign = await createApprovedOpenCustomGiveaway(backend, (eventId) => {
      const perkId = backend.getSnapshot().events.find((event) => event.id === eventId)?.perks[0]?.id;
      if (!perkId) throw new Error("TEST_PERK_MISSING");
      return giveawayInput(eventId, {
        eligibilityGroups: [
          {
            id: "redeemed-perk",
            label: "Redeemed event perk",
            weight: 4,
            conditions: [{ source: "perk_redemption", perkId }],
          },
        ],
      });
    });
    const perkId = backend
      .getSnapshot()
      .events.find((event) => event.id === perkCampaign.eventId)?.perks[0]?.id;
    if (!perkId) throw new Error("TEST_PERK_MISSING");
    await backend.registerForEvent(rider.sessionToken, perkCampaign.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(
      backend.getRiderGiveawayState(rider.sessionToken, perkCampaign.giveaway.id),
    ).resolves.toEqual({ giveawayId: perkCampaign.giveaway.id, status: "not_eligible", entryCount: 0 });
    await expect(backend.redeemGiveawayPerk(rider.sessionToken, perkId)).resolves.toEqual({
      perkId,
      status: "redeemed",
    });
    await expect(
      backend.getRiderGiveawayState(rider.sessionToken, perkCampaign.giveaway.id),
    ).resolves.toEqual({ giveawayId: perkCampaign.giveaway.id, status: "entered", entryCount: 4 });
  });

  test("fails closed before lock when the draw key is invalid, then freezes one idempotent snapshot", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const { giveaway, eventId, organizer, rider } = await createApprovedOpenGiveaway(backend);
    await backend.registerForEvent(rider.sessionToken, eventId, {
      status: "going",
      attendanceType: "direct",
    });

    const prior = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    try {
      await expect(backend.lockGiveaway(organizer.sessionToken, giveaway.id)).rejects.toMatchObject({
        code: "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
      });
    } finally {
      if (prior === undefined) {
        delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      } else {
        process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = prior;
      }
    }
    await expect(backend.listOrganizerGiveaways(organizer.sessionToken, eventId)).resolves.toEqual([
      expect.objectContaining({ id: giveaway.id, state: "open" }),
    ]);

    await withDrawEncryptionKey(async () => {
      const first = await backend.lockGiveaway(organizer.sessionToken, giveaway.id);
      await backend.registerForEvent(rider.sessionToken, eventId, {
        status: "interested",
        attendanceType: "direct",
      });
      const second = await backend.lockGiveaway(organizer.sessionToken, giveaway.id);
      expect(first.snapshot).toMatchObject({ candidateCount: 1, algorithmVersion: "hmac-sha256-v1" });
      expect(second.snapshot).toEqual(first.snapshot);
    });
  });

  test("runs a weighted random draw once, honors winner caps, and keeps prepublication responses private", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) => {
      const perkId = backend.getSnapshot().events.find((event) => event.id === eventId)?.perks[0]?.id;
      if (!perkId) throw new Error("TEST_PERK_MISSING");
      return giveawayInput(eventId, {
        eligibilityGroups: [
          {
            id: "base-active-rider",
            label: "Active rider",
            weight: 1,
            conditions: [{ source: "active_rsvp_pass" }],
          },
          {
            id: "perk-bonus",
            label: "Redeemed perk bonus",
            weight: 4,
            conditions: [{ source: "perk_redemption", perkId }],
          },
        ],
        winnerLimits: { perRider: 1, total: 2 },
        prizePools: [
          {
            id: "two-helmets",
            title: "Two helmets",
            awardMode: "random_draw",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 2 },
            items: [{ title: "Helmet one" }, { title: "Helmet two" }],
          },
        ],
      });
    });
    const secondRider = await createExtraRider(backend, "weighted-draw");
    const eventPerkId = backend
      .getSnapshot()
      .events.find((event) => event.id === context.eventId)?.perks[0]?.id;
    if (!eventPerkId) throw new Error("TEST_PERK_MISSING");
    await Promise.all([
      backend.registerForEvent(context.rider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(secondRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);
    await backend.redeemGiveawayPerk(context.rider.sessionToken, eventPerkId);
    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toEqual({ giveawayId: context.giveaway.id, status: "entered", entryCount: 5 });
    await expect(
      backend.getRiderGiveawayState(secondRider.sessionToken, context.giveaway.id),
    ).resolves.toEqual({ giveawayId: context.giveaway.id, status: "entered", entryCount: 1 });

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const first = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "weighted-initial-draw",
      });
      const replay = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "weighted-initial-draw",
      });
      expect(replay).toEqual(first);
      expect(first.verification.seed).toBeUndefined();
      await expect(
        backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
      ).resolves.toMatchObject({ status: "claimable", entryCount: 5, award: expect.any(Object) });
      await expect(
        backend.getRiderGiveawayState(secondRider.sessionToken, context.giveaway.id),
      ).resolves.toMatchObject({ status: "claimable", entryCount: 1, award: expect.any(Object) });
      const payload = JSON.stringify(first);
      for (const forbiddenValue of ["seed", "userId", "riderId", "ciphertext", "claimToken"]) {
        expect(payload).not.toContain(forbiddenValue);
      }
    });
  });

  test("allocates unlimited guaranteed and finite first-come awards at entry time", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const guaranteed = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        entryMode: "opt_in",
        winnerLimits: { perRider: 1, total: 10 },
        prizePools: [
          {
            id: "unlimited-sticker",
            title: "Unlimited sticker",
            awardMode: "guaranteed",
            fulfilmentMode: "onsite",
            inventory: { kind: "unlimited" },
            items: [],
          },
        ],
      }),
    );
    await backend.registerForEvent(guaranteed.rider.sessionToken, guaranteed.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(
      backend.optInToGiveaway(guaranteed.rider.sessionToken, guaranteed.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });

    const firstCome = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        entryMode: "opt_in",
        winnerLimits: { perRider: 1, total: 2 },
        prizePools: [
          {
            id: "one-cap",
            title: "One cap",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Limited cap" }],
          },
        ],
      }),
    );
    const laterRider = await createExtraRider(backend, "first-come");
    await Promise.all([
      backend.registerForEvent(firstCome.rider.sessionToken, firstCome.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(laterRider.sessionToken, firstCome.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);
    await expect(
      backend.optInToGiveaway(firstCome.rider.sessionToken, firstCome.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
    await expect(
      backend.optInToGiveaway(laterRider.sessionToken, firstCome.giveaway.id),
    ).resolves.toEqual({ giveawayId: firstCome.giveaway.id, status: "entered", entryCount: 3 });
  });

  test("finalizes a declined direct first-come award, releases its item, and reallocates it", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "declinable-first-come",
            title: "Declinable first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Reallocatable prize" }],
          },
        ],
      }),
    );
    const nextRider = await createExtraRider(backend, "declined-direct-award");
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    const initial = await backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id);
    if (!initial.award) throw new Error("TEST_DIRECT_AWARD_MISSING");
    const initialAwardId = initial.award.awardId;
    await backend.registerForEvent(nextRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await expect(
      backend.declineGiveawayAward(
        context.rider.sessionToken,
        initialAwardId,
        "Unable to use this prize",
      ),
    ).resolves.toMatchObject({ status: "declined" });

    const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
    const historicalAward = campaign.awards.find((award) => award.id === initialAwardId);
    const replacement = campaign.awards.find(
      (award) => award.isCurrent && award.winnerUserId === nextRider.user.id,
    );
    expect(historicalAward).toMatchObject({ isCurrent: false, status: "declined" });
    expect(replacement?.prizeItemId).toBe(historicalAward?.prizeItemId);
    await expect(
      backend.getRiderGiveawayState(nextRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
    expect(await backend.auditCount("GIVEAWAY_AWARD_DECLINED")).toBe(1);
  });

  test("reallocates a declined direct first-come award from frozen candidates in claims_open", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "post-lock-first-come",
            title: "Post-lock first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Frozen-candidate prize" }],
          },
        ],
      }),
    );
    const nextRider = await createExtraRider(backend, "post-lock-direct-award");
    const lateRider = await createExtraRider(backend, "post-lock-late-direct-award");
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    const initial = await backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id);
    if (!initial.award) throw new Error("TEST_DIRECT_AWARD_MISSING");
    const initialAwardId = initial.award.awardId;
    await backend.registerForEvent(nextRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      await backend.registerForEvent(lateRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      });
      const draw = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "post-lock-direct-draw",
      });
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, draw.drawId);
      await expect(
        backend.declineGiveawayAward(
          context.rider.sessionToken,
          initialAwardId,
          "Please reassign this prize after lock",
        ),
      ).resolves.toMatchObject({ status: "declined" });
      const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
      const declinedDirectAward = campaign.awards.find((award) => award.id === initialAwardId);
      expect(declinedDirectAward).toMatchObject({ isCurrent: false, status: "declined" });
      expect(declinedDirectAward?.drawId).toBeUndefined();
      expect(declinedDirectAward?.snapshotEntryId).toBeUndefined();
      const currentDirectReplacement = campaign.awards.find(
        (award) => award.isCurrent && award.id !== initialAwardId,
      );
      if (!currentDirectReplacement) throw new Error("TEST_DIRECT_REPLACEMENT_MISSING");
      expect(currentDirectReplacement).toMatchObject({ isCurrent: true });
      expect(currentDirectReplacement.drawId).toBeUndefined();
      expect(currentDirectReplacement.snapshotEntryId).toBeUndefined();
      await expect(
        backend.redrawGiveawayAward(context.organizer.sessionToken, {
          awardId: currentDirectReplacement.id,
          idempotencyKey: "reject-direct-award-redraw",
          reason: "Direct allocations are replaced without a redraw",
        }),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    });

    const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
    expect(campaign.awards.find((award) => award.id === initialAwardId)).toMatchObject({
      isCurrent: false,
      status: "declined",
    });
    await expect(
      backend.getRiderGiveawayState(nextRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
    await expect(
      backend.getRiderGiveawayState(lateRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "not_eligible", entryCount: 0 });
  });

  test("refuses a post-lock direct finalization when memory entry provenance no longer matches its snapshot", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "tamper-guard-first-come",
            title: "Tamper-guard first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Frozen provenance prize" }],
          },
        ],
      }),
    );
    const replacementRider = await createExtraRider(backend, "memory-provenance-guard");
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    const initial = await backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id);
    if (!initial.award) throw new Error("TEST_DIRECT_AWARD_MISSING");
    const initialAwardId = initial.award.awardId;
    await backend.registerForEvent(replacementRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const draw = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "memory-provenance-guard-draw",
      });
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, draw.drawId);

      const entry = internalGiveawayEntry(backend, context.giveaway.id, context.rider.user.id);
      const frozenFingerprint = entry.qualifiedSourceFingerprint;
      entry.qualifiedSourceFingerprint = "tampered-after-lock";
      await expect(
        backend.declineGiveawayAward(
          context.rider.sessionToken,
          initialAwardId,
          "This must not mutate before frozen provenance is checked",
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
      expect(
        internalGiveawayCampaign(backend, context.giveaway.id).awards.find(
          (award) => award.id === initialAwardId,
        ),
      ).toMatchObject({ isCurrent: true });

      entry.qualifiedSourceFingerprint = frozenFingerprint;
      await expect(
        backend.declineGiveawayAward(
          context.rider.sessionToken,
          initialAwardId,
          "Frozen provenance restored for direct replacement",
        ),
      ).resolves.toMatchObject({ status: "declined" });
    });

    await expect(
      backend.getRiderGiveawayState(replacementRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
  });

  test("lets an admin void a direct first-come award without leaving its item or winner cap stuck", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "voidable-first-come",
            title: "Voidable first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Released after admin void" }],
          },
        ],
      }),
    );
    const nextRider = await createExtraRider(backend, "voided-direct-award");
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    const initial = await backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id);
    if (!initial.award) throw new Error("TEST_DIRECT_AWARD_MISSING");
    await backend.registerForEvent(nextRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await expect(
      backend.voidGiveawayAward(
        context.admin.sessionToken,
        initial.award.awardId,
        "Inventory was assigned incorrectly",
      ),
    ).resolves.toMatchObject({ status: "voided" });

    const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
    const historicalAward = campaign.awards.find((award) => award.id === initial.award?.awardId);
    const replacement = campaign.awards.find(
      (award) => award.isCurrent && award.winnerUserId === nextRider.user.id,
    );
    expect(historicalAward).toMatchObject({ isCurrent: false, status: "voided" });
    expect(replacement?.prizeItemId).toBe(historicalAward?.prizeItemId);
    await expect(
      backend.getRiderGiveawayState(nextRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
    expect(await backend.auditCount("GIVEAWAY_AWARD_VOIDED")).toBe(1);
  });

  test("keeps a disqualified direct guaranteed award historical so its original rider cannot win it again", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "disqualifiable-guaranteed",
            title: "Disqualifiable guaranteed prize",
            awardMode: "guaranteed",
            fulfilmentMode: "onsite",
            inventory: { kind: "unlimited" },
            items: [],
          },
        ],
      }),
    );
    const nextRider = await createExtraRider(backend, "disqualified-direct-award");
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    const initial = await backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id);
    if (!initial.award) throw new Error("TEST_DIRECT_AWARD_MISSING");
    await backend.registerForEvent(nextRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await expect(
      backend.disqualifyGiveawayAward(
        context.admin.sessionToken,
        initial.award.awardId,
        "Rider is not eligible for this campaign",
      ),
    ).resolves.toMatchObject({ status: "disqualified" });

    const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
    const historicalAward = campaign.awards.find((award) => award.id === initial.award?.awardId);
    expect(historicalAward).toMatchObject({ isCurrent: false, status: "disqualified" });
    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "disqualified" });
    await expect(
      backend.getRiderGiveawayState(nextRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
    expect(await backend.auditCount("GIVEAWAY_AWARD_DISQUALIFIED")).toBe(1);
  });

  test("requires a frozen snapshot and explicit reason for manual selection", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        prizePools: [
          {
            id: "manual-helmet",
            title: "Manual helmet",
            awardMode: "manual_selection",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Manual choice helmet" }],
          },
        ],
      }),
    );
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    const pool = (await backend.getPublicGiveaway(context.giveaway.id)).prizePools[0];
    if (!pool) throw new Error("TEST_POOL_MISSING");
    const selectionInput = {
      giveawayId: context.giveaway.id,
      prizePoolId: pool.id,
      riderId: context.rider.user.id,
      reason: "Community service recognition",
      idempotencyKey: "manual-choice-1",
    };
    await expect(
      backend.selectManualGiveawayAward(context.organizer.sessionToken, selectionInput),
    ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      await expect(
        backend.selectManualGiveawayAward(context.organizer.sessionToken, {
          ...selectionInput,
          reason: " ",
          idempotencyKey: "manual-choice-missing-reason",
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        backend.selectManualGiveawayAward(context.organizer.sessionToken, selectionInput),
      ).resolves.toMatchObject({ verification: { algorithmVersion: "manual-selection-v1" } });
    });
    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
  });

  test("publishes the committed seed only after publication and redraws the next frozen candidate", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenGiveaway(backend);
    const secondRider = await createExtraRider(backend, "redraw");
    await Promise.all([
      backend.registerForEvent(context.rider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(secondRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const initial = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "initial-redraw-draw",
      });
      expect(initial.verification.seed).toBeUndefined();
      const published = await backend.publishGiveawayDraw(
        context.organizer.sessionToken,
        context.giveaway.id,
        initial.drawId,
      );
      expect(published).toMatchObject({
        giveawayId: context.giveaway.id,
        commitment: initial.verification.commitment,
        snapshotDigest: initial.verification.snapshotDigest,
      });
      expect(published.seed).toMatch(/^[A-Za-z0-9_-]+$/);

      const riderStates = await Promise.all([
        backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id).then((state) => ({
          sessionToken: context.rider.sessionToken,
          state,
        })),
        backend.getRiderGiveawayState(secondRider.sessionToken, context.giveaway.id).then((state) => ({
          sessionToken: secondRider.sessionToken,
          state,
        })),
      ]);
      const selected = riderStates.find((candidate) => candidate.state.award);
      const notSelected = riderStates.find((candidate) => !candidate.state.award);
      if (!selected?.state.award || !notSelected) throw new Error("TEST_DRAW_SELECTION_MISSING");

      await expect(
        backend.declineGiveawayAward(
          selected.sessionToken,
          selected.state.award.awardId,
          "Unable to claim this prize",
        ),
      ).resolves.toMatchObject({ status: "declined" });
      const redrawn = await backend.redrawGiveawayAward(context.organizer.sessionToken, {
        awardId: selected.state.award.awardId,
        idempotencyKey: "redraw-after-decline",
        reason: "Winner declined",
      });
      const replay = await backend.redrawGiveawayAward(context.organizer.sessionToken, {
        awardId: selected.state.award.awardId,
        idempotencyKey: "redraw-after-decline",
        reason: "Winner declined",
      });
      expect(replay).toEqual(redrawn);
      await expect(
        backend.redrawGiveawayAward(context.organizer.sessionToken, {
          awardId: selected.state.award.awardId,
          idempotencyKey: "redraw-after-decline",
          reason: "A different redraw reason must not replay",
        }),
      ).rejects.toMatchObject({ code: "GIVEAWAY_IDEMPOTENCY_CONFLICT" });
      expect(redrawn.drawId).not.toBe(initial.drawId);
      expect(redrawn.verification).toMatchObject({
        commitment: published.commitment,
        snapshotDigest: published.snapshotDigest,
      });
      await expect(
        backend.getRiderGiveawayState(notSelected.sessionToken, context.giveaway.id),
      ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
    });
  });

  test("redraws an unused weighted unit when the same rider can still receive another pool award", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        maxEntriesPerRider: 3,
        eligibilityGroups: [
          {
            id: "triple-weight-rider",
            label: "Going rider with three weighted units",
            weight: 3,
            conditions: [{ source: "active_rsvp_pass" }],
          },
        ],
        winnerLimits: { perRider: 2, total: 1 },
        prizePools: [
          {
            id: "weighted-prize",
            title: "Weighted prize",
            awardMode: "random_draw",
            fulfilmentMode: "onsite",
            perRiderLimit: 2,
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Weighted prize" }],
          },
        ],
      }),
    );
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const initialDraw = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "one-unit-initial-draw",
      });
      const initialAwards = internalGiveawayCampaign(backend, context.giveaway.id).awards.filter(
        (award) => award.drawId === initialDraw.drawId,
      );
      expect(initialAwards).toHaveLength(1);
      const declinedAward = initialAwards[0];
      if (!declinedAward) throw new Error("TEST_WEIGHTED_AWARD_MISSING");
      const consumedRanks = new Set(initialAwards.map((award) => award.rank));

      await backend.declineGiveawayAward(
        context.rider.sessionToken,
        declinedAward.id,
        "Please redraw this weighted prize",
      );
      await expect(
        backend.redrawGiveawayAward(context.organizer.sessionToken, {
          awardId: declinedAward.id,
          idempotencyKey: "redraw-unused-weighted-unit",
          reason: "Use the next unconsumed weighted unit",
        }),
      ).resolves.toMatchObject({ drawId: expect.any(String) });

      const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
      const replacement = campaign.awards.find(
        (award) => award.predecessorAwardId === declinedAward.id && award.isCurrent,
      );
      expect(campaign.awards.find((award) => award.id === declinedAward.id)).toMatchObject({
        isCurrent: false,
        status: "superseded",
      });
      expect(replacement?.rank).toBeDefined();
      expect(consumedRanks.has(replacement?.rank)).toBe(false);
      expect(campaign.awards.filter((award) => award.isCurrent)).toHaveLength(1);
    });
  });

  test("does not reveal a committed seed for a non-completed draw", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenGiveaway(backend);
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const draw = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "non-completed-publication",
      });
      setInternalGiveawayDrawStatus(backend, context.giveaway.id, draw.drawId, "voided");

      await expect(
        backend.publishGiveawayDraw(
          context.organizer.sessionToken,
          context.giveaway.id,
          draw.drawId,
        ),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
    });
  });

  test("allows only an admin to void or disqualify a drawn award before a same-seed redraw", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenGiveaway(backend);
    const secondRider = await createExtraRider(backend, "admin-void-redraw");
    await Promise.all([
      backend.registerForEvent(context.rider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(secondRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const initial = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "admin-void-initial",
      });
      await backend.publishGiveawayDraw(
        context.organizer.sessionToken,
        context.giveaway.id,
        initial.drawId,
      );
      const selected = await Promise.all([
        backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
        backend.getRiderGiveawayState(secondRider.sessionToken, context.giveaway.id),
      ]);
      const awardId = selected.find((state) => state.award)?.award?.awardId;
      if (!awardId) throw new Error("TEST_DRAW_SELECTION_MISSING");

      await expect(
        backend.voidGiveawayAward(context.organizer.sessionToken, awardId, "Organizer cannot void"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        backend.voidGiveawayAward(context.admin.sessionToken, awardId, " "),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        backend.voidGiveawayAward(context.admin.sessionToken, awardId, "Incorrect allocation"),
      ).resolves.toMatchObject({ giveawayId: context.giveaway.id, status: "voided" });
      expect(await backend.auditCount("GIVEAWAY_AWARD_VOIDED")).toBe(1);

      const replacement = await backend.redrawGiveawayAward(context.organizer.sessionToken, {
        awardId,
        idempotencyKey: "admin-void-redraw",
        reason: "Admin voided the original allocation",
      });
      expect(replacement.verification).toMatchObject({
        commitment: initial.verification.commitment,
        snapshotDigest: initial.verification.snapshotDigest,
      });
    });
  });

  test("keeps a disqualified drawn award current until its deterministic replacement succeeds", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenGiveaway(backend);
    const secondRider = await createExtraRider(backend, "admin-disqualify-redraw");
    await Promise.all([
      backend.registerForEvent(context.rider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(secondRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const initial = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "admin-disqualify-initial",
      });
      await backend.publishGiveawayDraw(
        context.organizer.sessionToken,
        context.giveaway.id,
        initial.drawId,
      );
      const selected = await Promise.all([
        backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
        backend.getRiderGiveawayState(secondRider.sessionToken, context.giveaway.id),
      ]);
      const awardId = selected.find((state) => state.award)?.award?.awardId;
      if (!awardId) throw new Error("TEST_DRAW_SELECTION_MISSING");

      await expect(
        backend.disqualifyGiveawayAward(context.admin.sessionToken, awardId, "Ineligible winner"),
      ).resolves.toMatchObject({ giveawayId: context.giveaway.id, status: "disqualified" });
      expect(await backend.auditCount("GIVEAWAY_AWARD_DISQUALIFIED")).toBe(1);
      await expect(
        backend.redrawGiveawayAward(context.organizer.sessionToken, {
          awardId,
          idempotencyKey: "admin-disqualify-redraw",
          reason: "Administrator disqualified the winner",
        }),
      ).resolves.toMatchObject({
        verification: {
          commitment: initial.verification.commitment,
          snapshotDigest: initial.verification.snapshotDigest,
        },
      });
    });
  });

  test("processes mixed manual and random pools before publication, then freezes selection after publication", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        winnerLimits: { perRider: 2, total: 4 },
        prizePools: [
          {
            id: "mixed-random",
            title: "Random helmet",
            awardMode: "random_draw",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Random helmet" }],
          },
          {
            id: "mixed-manual",
            title: "Manual recognition prize",
            awardMode: "manual_selection",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 3 },
            items: [
              { title: "Manual prize one" },
              { title: "Manual prize two" },
              { title: "Manual prize three" },
            ],
          },
        ],
      }),
    );
    const secondRider = await createExtraRider(backend, "mixed-second");
    const thirdRider = await createExtraRider(backend, "mixed-third");
    await Promise.all([
      backend.registerForEvent(context.rider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(secondRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(thirdRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);
    const pools = (await backend.getPublicGiveaway(context.giveaway.id)).prizePools;
    const manualPool = pools.find((pool) => pool.awardMode === "manual_selection");
    if (!manualPool) throw new Error("TEST_MANUAL_POOL_MISSING");

    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      await backend.selectManualGiveawayAward(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        prizePoolId: manualPool.id,
        riderId: context.rider.user.id,
        reason: "First manual award before random draw",
        idempotencyKey: "mixed-manual-before-random",
      });
      await expect(
        backend.selectManualGiveawayAward(context.organizer.sessionToken, {
          giveawayId: context.giveaway.id,
          prizePoolId: manualPool.id,
          riderId: secondRider.user.id,
          reason: "A different manual selection must not replay",
          idempotencyKey: "mixed-manual-before-random",
        }),
      ).rejects.toMatchObject({ code: "GIVEAWAY_IDEMPOTENCY_CONFLICT" });
      const random = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "mixed-random-draw",
      });
      await expect(
        backend.selectManualGiveawayAward(context.organizer.sessionToken, {
          giveawayId: context.giveaway.id,
          prizePoolId: manualPool.id,
          riderId: secondRider.user.id,
          reason: "Manual award after random draw",
          idempotencyKey: "mixed-manual-after-random",
        }),
      ).resolves.toMatchObject({ drawId: expect.any(String) });
      await backend.publishGiveawayDraw(
        context.organizer.sessionToken,
        context.giveaway.id,
        random.drawId,
      );
      await expect(
        backend.selectManualGiveawayAward(context.organizer.sessionToken, {
          giveawayId: context.giveaway.id,
          prizePoolId: manualPool.id,
          riderId: thirdRider.user.id,
          reason: "Too late after publication",
          idempotencyKey: "mixed-manual-after-publication",
        }),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
    });
  });

  test("releases a first-come prize when automatic eligibility is withdrawn before lock", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        prizePools: [
          {
            id: "automatic-first-come",
            title: "Automatic first-come cap",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Released cap" }],
          },
        ],
      }),
    );
    const nextRider = await createExtraRider(backend, "automatic-release");
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable" });
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "interested",
      attendanceType: "direct",
    });
    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toEqual({ giveawayId: context.giveaway.id, status: "not_eligible", entryCount: 0 });
    await backend.registerForEvent(nextRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(
      backend.getRiderGiveawayState(nextRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
  });

  test("voids and reallocates a direct pool award when a rider keeps global eligibility but loses the pool group", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        eligibilityGroups: [
          {
            id: "rsvp-pass",
            label: "Going rider with an active pass",
            weight: 1,
            conditions: [{ source: "active_rsvp_pass" }],
          },
          {
            id: "checked-in",
            label: "Confirmed attendee",
            weight: 1,
            conditions: [{ source: "confirmed_check_in" }],
          },
        ],
        prizePools: [
          {
            id: "rsvp-only-first-come",
            title: "RSVP-only first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            eligibilityGroupIds: ["rsvp-pass"],
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Released RSVP prize" }],
          },
          {
            id: "check-in-only-first-come",
            title: "Check-in-only first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            eligibilityGroupIds: ["checked-in"],
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Confirmed attendee prize" }],
          },
        ],
        winnerLimits: { perRider: 1, total: 2 },
      }),
    );
    const nextRider = await createExtraRider(backend, "pool-specific-release");
    const registration = await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    if (!registration.pass) throw new Error("TEST_PASS_MISSING");
    await backend.scanPass(
      context.admin.sessionToken,
      context.eventId,
      registration.pass.qrToken,
      "staff_camera",
    );
    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({
      status: "claimable",
      entryCount: 2,
      award: { prizePoolTitle: "RSVP-only first-come prize" },
    });

    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "interested",
      attendanceType: "direct",
    });
    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({
      giveawayId: context.giveaway.id,
      status: "claimable",
      entryCount: 1,
      award: { prizePoolTitle: "Check-in-only first-come prize" },
    });
    expect(await backend.auditCount("GIVEAWAY_AWARD_VOIDED")).toBe(1);

    await backend.registerForEvent(nextRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(
      backend.getRiderGiveawayState(nextRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({
      status: "claimable",
      award: { prizePoolTitle: "RSVP-only first-come prize" },
    });
  });

  test("releases direct first-come inventory when a manual entry is revoked before lock", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        entryMode: "manual_only",
        eligibilityGroups: [
          {
            id: "manual-entry",
            label: "Manual entry",
            weight: 1,
            conditions: [{ source: "manual" }],
          },
        ],
        prizePools: [
          {
            id: "manual-first-come",
            title: "Manual first-come cap",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Manual released cap" }],
          },
        ],
      }),
    );
    const nextRider = await createExtraRider(backend, "manual-release");
    await expect(
      backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        riderId: context.rider.user.id,
        reason: "Initial paper entry",
      }),
    ).resolves.toMatchObject({ status: "claimable" });
    const source = internalGiveawayCampaign(backend, context.giveaway.id).awards.find(
      (award) => award.winnerUserId === context.rider.user.id && award.isCurrent,
    );
    if (!source) throw new Error("TEST_MANUAL_REVOKE_SOURCE_MISSING");
    await backend.revokeManualGiveawayEntry(
      context.organizer.sessionToken,
      context.giveaway.id,
      context.rider.user.id,
      "Paper entry invalidated",
    );
    expect(source.recoveryClosedAt).toEqual(expect.any(String));
    await expect(
      backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        riderId: nextRider.user.id,
        reason: "Replacement paper entry",
      }),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
  });

  test("reallocates paused manual-only direct capacity when the campaign reopens", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        entryMode: "manual_only",
        eligibilityGroups: [
          {
            id: "manual-entry",
            label: "Audited manual entry",
            weight: 1,
            conditions: [{ source: "manual" }],
          },
        ],
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "paused-manual-first-come",
            title: "Paused manual first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Reopened capacity prize" }],
          },
        ],
      }),
    );
    const replacementRider = await createExtraRider(backend, "paused-manual-reopen");
    const firstState = await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
      giveawayId: context.giveaway.id,
      riderId: context.rider.user.id,
      reason: "First audited paper entry",
    });
    if (!firstState.award) throw new Error("TEST_DIRECT_AWARD_MISSING");
    await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
      giveawayId: context.giveaway.id,
      riderId: replacementRider.user.id,
      reason: "Second audited paper entry",
    });
    await backend.pauseGiveaway(context.organizer.sessionToken, context.giveaway.id);
    await expect(
      backend.declineGiveawayAward(
        context.rider.sessionToken,
        firstState.award.awardId,
        "Declined while the manual campaign is paused",
      ),
    ).resolves.toMatchObject({ status: "declined" });
    await expect(
      backend.getRiderGiveawayState(replacementRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "entered" });

    await expect(
      backend.openGiveaway(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ state: "open" });
    await expect(
      backend.getRiderGiveawayState(replacementRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });

    const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
    const source = campaign.awards.find((award) => award.id === firstState.award?.awardId);
    const replacement = campaign.awards.find(
      (award) => award.recoverySourceAwardId === firstState.award?.awardId,
    );
    expect(source).toMatchObject({
      isCurrent: false,
      status: "declined",
      recoveryClosedAt: expect.any(String),
    });
    expect(replacement).toMatchObject({
      isCurrent: true,
      winnerUserId: replacementRider.user.id,
      recoverySourceAwardId: source?.id,
    });
  });

  test("links a later manual direct allocation to the unresolved released source", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        entryMode: "manual_only",
        eligibilityGroups: [
          {
            id: "manual-entry",
            label: "Audited manual entry",
            weight: 1,
            conditions: [{ source: "manual" }],
          },
        ],
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "later-manual-first-come",
            title: "Later manual first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Later capacity prize" }],
          },
        ],
      }),
    );
    const replacementRider = await createExtraRider(backend, "later-manual-recovery");
    const firstState = await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
      giveawayId: context.giveaway.id,
      riderId: context.rider.user.id,
      reason: "First audited paper entry",
    });
    if (!firstState.award) throw new Error("TEST_DIRECT_AWARD_MISSING");
    await expect(
      backend.declineGiveawayAward(
        context.rider.sessionToken,
        firstState.award.awardId,
        "Declined before another manual candidate existed",
      ),
    ).resolves.toMatchObject({ status: "declined" });

    await expect(
      backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        riderId: replacementRider.user.id,
        reason: "Later audited paper entry",
      }),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });

    const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
    const source = campaign.awards.find((award) => award.id === firstState.award?.awardId);
    const replacement = campaign.awards.find(
      (award) => award.recoverySourceAwardId === firstState.award?.awardId,
    );
    expect(source).toMatchObject({
      isCurrent: false,
      status: "declined",
      recoveryClosedAt: expect.any(String),
    });
    expect(replacement).toMatchObject({
      isCurrent: true,
      winnerUserId: replacementRider.user.id,
      recoverySourceAwardId: source?.id,
    });
  });

  test("keeps an elapsed direct source prize item out of generic allocation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-01T06:30:00.000Z"));
      const backend = asGiveawayBackend(await createTambikeTestBackend());
      const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
        giveawayInput(eventId, {
          entryMode: "manual_only",
          entryOpensAt: "2026-08-01T06:00:00.000Z",
          entryClosesAt: "2026-08-01T07:00:00.000Z",
          drawAt: "2026-08-01T08:00:00.000Z",
          claimDeadlineAt: "2026-08-01T09:00:00.000Z",
          eligibilityGroups: [
            {
              id: "manual-entry",
              label: "Audited manual entry",
              weight: 1,
              conditions: [{ source: "manual" }],
            },
          ],
          winnerLimits: { perRider: 1, total: 2 },
          prizePools: [
            {
              id: "elapsed-source-finite",
              title: "Elapsed source finite prize",
              awardMode: "first_come",
              fulfilmentMode: "onsite",
              inventory: { kind: "finite", quantity: 2 },
              items: [{ title: "Reserved recovery item" }, { title: "Still allocatable item" }],
            },
          ],
        }),
      );
      const replacementRider = await createExtraRider(backend, "elapsed-source-finite");
      const firstState = await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        riderId: context.rider.user.id,
        reason: "Initial item holder",
      });
      if (!firstState.award) throw new Error("TEST_ELAPSED_SOURCE_AWARD_MISSING");

      vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"));
      await backend.voidGiveawayAward(
        context.admin.sessionToken,
        firstState.award.awardId,
        "Hold this expired direct source for explicit recovery",
      );
      await expect(
        backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
          giveawayId: context.giveaway.id,
          riderId: replacementRider.user.id,
          reason: "Later audited entry",
        }),
      ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });

      const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
      const source = campaign.awards.find((award) => award.id === firstState.award?.awardId);
      const replacement = campaign.awards.find(
        (award) => award.winnerUserId === replacementRider.user.id && award.isCurrent,
      );
      expect(source).toMatchObject({ status: "voided", isCurrent: false });
      expect(source?.recoveryClosedAt).toBeUndefined();
      expect(replacement?.prizeItemId).toBeDefined();
      expect(replacement?.prizeItemId).not.toBe(source?.prizeItemId);
    } finally {
      vi.useRealTimers();
    }
  });

  test("reserves elapsed unlimited direct capacity from generic allocation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-01T06:30:00.000Z"));
      const backend = asGiveawayBackend(await createTambikeTestBackend());
      const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
        giveawayInput(eventId, {
          entryMode: "manual_only",
          entryOpensAt: "2026-08-01T06:00:00.000Z",
          entryClosesAt: "2026-08-01T07:00:00.000Z",
          drawAt: "2026-08-01T08:00:00.000Z",
          claimDeadlineAt: "2026-08-01T09:00:00.000Z",
          eligibilityGroups: [
            {
              id: "manual-entry",
              label: "Audited manual entry",
              weight: 1,
              conditions: [{ source: "manual" }],
            },
          ],
          winnerLimits: { perRider: 1, total: 1 },
          prizePools: [
            {
              id: "elapsed-source-unlimited",
              title: "Elapsed source unlimited prize",
              awardMode: "guaranteed",
              fulfilmentMode: "onsite",
              inventory: { kind: "unlimited" },
              items: [],
            },
          ],
        }),
      );
      const replacementRider = await createExtraRider(backend, "elapsed-source-unlimited");
      const firstState = await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        riderId: context.rider.user.id,
        reason: "Initial unlimited holder",
      });
      if (!firstState.award) throw new Error("TEST_ELAPSED_UNLIMITED_SOURCE_AWARD_MISSING");

      vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"));
      await backend.voidGiveawayAward(
        context.admin.sessionToken,
        firstState.award.awardId,
        "Hold this expired unlimited source for explicit recovery",
      );
      await expect(
        backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
          giveawayId: context.giveaway.id,
          riderId: replacementRider.user.id,
          reason: "Later audited entry",
        }),
      ).resolves.toMatchObject({ status: "entered" });

      const campaign = internalGiveawayCampaign(backend, context.giveaway.id);
      const source = campaign.awards.find((award) => award.id === firstState.award?.awardId);
      expect(source).toMatchObject({ status: "voided", isCurrent: false });
      expect(source?.recoveryClosedAt).toBeUndefined();
      expect(
        campaign.awards.some((award) => award.winnerUserId === replacementRider.user.id && award.isCurrent),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not let organizers publish or redraw a campaign after admin suspension", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenGiveaway(backend);
    const secondRider = await createExtraRider(backend, "suspended-redraw");
    await Promise.all([
      backend.registerForEvent(context.rider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(secondRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);
    await withDrawEncryptionKey(async () => {
      await backend.lockGiveaway(context.organizer.sessionToken, context.giveaway.id);
      const draw = await backend.runGiveawayDraw(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        idempotencyKey: "suspended-draw",
      });
      const riderStates = await Promise.all([
        backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id).then((state) => ({
          sessionToken: context.rider.sessionToken,
          state,
        })),
        backend.getRiderGiveawayState(secondRider.sessionToken, context.giveaway.id).then((state) => ({
          sessionToken: secondRider.sessionToken,
          state,
        })),
      ]);
      const selected = riderStates.find((candidate) => candidate.state.award);
      if (!selected?.state.award) throw new Error("TEST_DRAW_SELECTION_MISSING");
      await backend.declineGiveawayAward(
        selected.sessionToken,
        selected.state.award.awardId,
        "Declined before suspension",
      );
      await backend.suspendGiveaway(context.admin.sessionToken, context.giveaway.id, "Compliance hold");
      await expect(
        backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, draw.drawId),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
      await expect(
        backend.redrawGiveawayAward(context.organizer.sessionToken, {
          awardId: selected.state.award.awardId,
          idempotencyKey: "suspended-redraw-attempt",
          reason: "Should be blocked",
        }),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
    });
  });

  test("rejects a finite perk redemption before it can create another eligibility entry", async () => {
    const backend = asGiveawayBackend(
      await createTambikeTestBackend({ perkQuantities: { "classic-coffee-discount": 1 } }),
    );
    const { admin, rider } = await sessions(backend);
    const eventId = "tambike-cafe-classico";
    const perkId = "classic-coffee-discount";
    const giveaway = await backend.createGiveaway(
      admin.sessionToken,
      eventId,
      giveawayInput(eventId, {
        eligibilityGroups: [
          {
            id: "finite-perk-entry",
            label: "Finite perk redemption",
            weight: 1,
            conditions: [{ source: "perk_redemption", perkId }],
          },
        ],
      }),
    );
    await backend.submitGiveawayForReview(admin.sessionToken, giveaway.id);
    await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, {
      decision: "approved",
    });
    await backend.openGiveaway(admin.sessionToken, giveaway.id);
    const secondRider = await createExtraRider(backend, "finite-perk");
    await Promise.all([
      backend.registerForEvent(rider.sessionToken, eventId, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(secondRider.sessionToken, eventId, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);
    await backend.redeemGiveawayPerk(rider.sessionToken, perkId);
    await expect(
      backend.getRiderGiveawayState(rider.sessionToken, giveaway.id),
    ).resolves.toEqual({ giveawayId: giveaway.id, status: "entered", entryCount: 1 });
    await expect(backend.redeemGiveawayPerk(secondRider.sessionToken, perkId)).rejects.toMatchObject({
      code: "GIVEAWAY_PERK_UNAVAILABLE",
    });
    await expect(
      backend.getRiderGiveawayState(secondRider.sessionToken, giveaway.id),
    ).resolves.toEqual({ giveawayId: giveaway.id, status: "not_eligible", entryCount: 0 });
  });
});

describe("giveaway first-come fairness and entrant-facing configuration freezes", () => {
  test("clears active timing rows when a manual entry is revoked", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        entryMode: "manual_only",
        eligibilityGroups: [
          {
            id: "manual-entry",
            label: "Manual entry",
            weight: 1,
            conditions: [{ source: "manual" }],
          },
        ],
      }),
    );
    await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
      giveawayId: context.giveaway.id,
      riderId: context.rider.user.id,
      reason: "Audited paper entry",
    });
    const activeEntry = internalGiveawayEntry(backend, context.giveaway.id, context.rider.user.id);
    await backend.revokeManualGiveawayEntry(
      context.organizer.sessionToken,
      context.giveaway.id,
      context.rider.user.id,
      "Paper entry revoked",
    );

    expect(internalGiveawayEntry(backend, context.giveaway.id, context.rider.user.id)).toMatchObject({
      eligibilityCycleAt: activeEntry.eligibilityCycleAt,
      qualifiedGroupIds: [],
      qualifiedEligibilityGroupTimings: [],
    });
  });

  test("uses a new RSVP going transition for requalified first-come priority at campaign opening", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createPublishedOrganizerEvent(backend);
    const laterRequalifiedRider = context.rider;
    const earlierCurrentRider = await createExtraRider(backend, "rsvp-priority");
    const giveaway = await backend.createGiveaway(
      context.organizer.sessionToken,
      context.eventId,
      giveawayInput(context.eventId, {
        winnerLimits: { perRider: 1, total: 1 },
        prizePools: [
          {
            id: "opened-first-come",
            title: "Opening first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Opening cap" }],
          },
        ],
      }),
    );

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-01T09:00:00.000Z"));
      await backend.registerForEvent(laterRequalifiedRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      });
      vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"));
      await backend.registerForEvent(earlierCurrentRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      });
      vi.setSystemTime(new Date("2026-08-01T11:00:00.000Z"));
      await backend.registerForEvent(laterRequalifiedRider.sessionToken, context.eventId, {
        status: "interested",
        attendanceType: "direct",
      });
      vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
      await backend.registerForEvent(laterRequalifiedRider.sessionToken, context.eventId, {
        status: "going",
        attendanceType: "direct",
      });
    } finally {
      vi.useRealTimers();
    }

    await backend.submitGiveawayForReview(context.organizer.sessionToken, giveaway.id);
    await backend.reviewGiveawayCompliance(context.admin.sessionToken, giveaway.id, {
      decision: "approved",
    });
    await backend.openGiveaway(context.organizer.sessionToken, giveaway.id);

    await expect(
      backend.getRiderGiveawayState(earlierCurrentRider.sessionToken, giveaway.id),
    ).resolves.toMatchObject({ status: "claimable", award: expect.any(Object) });
    await expect(
      backend.getRiderGiveawayState(laterRequalifiedRider.sessionToken, giveaway.id),
    ).resolves.toEqual({ giveawayId: giveaway.id, status: "entered", entryCount: 3 });
  });

  test("refills a released pool from an already eligible rider when the prior winner loses only that pool group", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenCustomGiveaway(backend, (eventId) =>
      giveawayInput(eventId, {
        eligibilityGroups: [
          {
            id: "rsvp-pass",
            label: "Going rider with an active pass",
            weight: 1,
            conditions: [{ source: "active_rsvp_pass" }],
          },
          {
            id: "checked-in",
            label: "Confirmed attendee",
            weight: 1,
            conditions: [{ source: "confirmed_check_in" }],
          },
        ],
        prizePools: [
          {
            id: "rsvp-first-come",
            title: "RSVP first-come prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            eligibilityGroupIds: ["rsvp-pass"],
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Reserved RSVP prize" }],
          },
        ],
        winnerLimits: { perRider: 1, total: 1 },
      }),
    );
    const alreadyEligibleRider = await createExtraRider(backend, "already-eligible-refill");
    const registration = await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    if (!registration.pass) throw new Error("TEST_PASS_MISSING");
    await backend.scanPass(
      context.admin.sessionToken,
      context.eventId,
      registration.pass.qrToken,
      "staff_camera",
    );
    await backend.registerForEvent(alreadyEligibleRider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await expect(
      backend.getRiderGiveawayState(alreadyEligibleRider.sessionToken, context.giveaway.id),
    ).resolves.toEqual({ giveawayId: context.giveaway.id, status: "entered", entryCount: 1 });

    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "interested",
      attendanceType: "direct",
    });

    await expect(
      backend.getRiderGiveawayState(alreadyEligibleRider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({
      giveawayId: context.giveaway.id,
      status: "claimable",
      award: { prizePoolTitle: "RSVP first-come prize" },
    });
  });

  test("freezes entrant-facing mechanics after automatic entry history while preserving operational edits", async () => {
    const backend = asGiveawayBackend(await createTambikeTestBackend());
    const context = await createApprovedOpenGiveaway(backend);
    await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
      status: "going",
      attendanceType: "direct",
    });
    await backend.pauseGiveaway(context.organizer.sessionToken, context.giveaway.id);

    await expect(
      backend.updateGiveaway(context.organizer.sessionToken, {
        id: context.giveaway.id,
        mechanics: "Changed mechanics would silently alter an existing entrant's consent.",
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED" });
    await expect(
      backend.updateGiveaway(context.organizer.sessionToken, {
        id: context.giveaway.id,
        title: "Operationally renamed giveaway",
        publicVisibility: "eligible_riders",
        timeZone: "UTC",
        entryOpensAt: "2026-08-15T01:00:00.000Z",
        entryClosesAt: "2026-08-15T02:00:00.000Z",
        drawAt: null,
        claimDeadlineAt: null,
      }),
    ).resolves.toMatchObject({
      title: "Operationally renamed giveaway",
      mechanicsVersion: 1,
    });
  });

  test.each(["automatic", "opt_in", "claim_code", "manual_only"] as const)(
    "freezes entrant-facing configuration after %s entry history",
    async (entryMode) => {
      const backend = asGiveawayBackend(await createTambikeTestBackend());
      const context = await createPublishedOrganizerEvent(backend);
      const input = giveawayInput(context.eventId, {
        entryMode,
        eligibilityGroups:
          entryMode === "claim_code"
            ? [
                {
                  id: "campaign-code",
                  label: "Campaign code claim",
                  weight: 1,
                  conditions: [{ source: "campaign_code" }],
                },
              ]
            : entryMode === "manual_only"
              ? [
                  {
                    id: "manual-entry",
                    label: "Audited manual entry",
                    weight: 1,
                    conditions: [{ source: "manual" }],
                  },
                ]
              : automaticGiveawayInput(context.eventId).eligibilityGroups,
      });
      const giveaway = await backend.createGiveaway(context.organizer.sessionToken, context.eventId, input);
      await backend.submitGiveawayForReview(context.organizer.sessionToken, giveaway.id);
      await backend.reviewGiveawayCompliance(context.admin.sessionToken, giveaway.id, {
        decision: "approved",
      });
      await backend.openGiveaway(context.organizer.sessionToken, giveaway.id);

      if (entryMode === "automatic") {
        await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
          status: "going",
          attendanceType: "direct",
        });
      } else if (entryMode === "opt_in") {
        await backend.registerForEvent(context.rider.sessionToken, context.eventId, {
          status: "going",
          attendanceType: "direct",
        });
        await backend.optInToGiveaway(context.rider.sessionToken, giveaway.id);
      } else if (entryMode === "claim_code") {
        const code = await backend.createGiveawayCampaignCode(
          context.organizer.sessionToken,
          giveaway.id,
          { maxUses: 1 },
        );
        await backend.claimGiveawayCampaignCode(context.rider.sessionToken, giveaway.id, code.code);
      } else {
        await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
          giveawayId: giveaway.id,
          riderId: context.rider.user.id,
          reason: "Audited paper entry",
        });
      }
      await backend.pauseGiveaway(context.organizer.sessionToken, giveaway.id);

      await expect(
        backend.updateGiveaway(context.organizer.sessionToken, {
          id: giveaway.id,
          maxEntriesPerRider: 2,
        }),
      ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED" });
    },
  );
});
