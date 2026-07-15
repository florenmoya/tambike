import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import type {
  CreateGiveawayInput,
  EventGiveawayOperatorQueueItem,
  GiveawayCampaignListItem,
  GiveawayOperatorCandidate,
  GiveawayWinnerPublicationInput,
  OrganizerGiveawayWorkspace,
  PublicEventGiveaway,
  RiderGiveawayState,
  RiderEventGiveawayState,
  RiderGiveawayClaimContext,
} from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createPublishedTestEvent, createTestActors } from "./support/tambike-fixtures";

type GiveawayUiDataBackend = Awaited<ReturnType<typeof createTambikeTestBackend>> & {
  listPublicGiveawaysForEvent(eventId: string, sessionToken?: string): Promise<PublicEventGiveaway[]>;
  listRiderGiveawayStatesForEvent(
    sessionToken: string,
    eventId: string,
  ): Promise<RiderEventGiveawayState[]>;
  getRiderGiveawayClaimContext(
    sessionToken: string,
    awardId: string,
  ): Promise<RiderGiveawayClaimContext>;
  listAdminGiveaways(sessionToken: string): Promise<GiveawayCampaignListItem[]>;
  listEventGiveawayOperatorClaims(
    sessionToken: string,
    eventId: string,
  ): Promise<EventGiveawayOperatorQueueItem[]>;
  listGiveawayOperatorCandidates(
    sessionToken: string,
    eventId: string,
  ): Promise<GiveawayOperatorCandidate[]>;
  getOrganizerGiveawayWorkspace(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OrganizerGiveawayWorkspace>;
  listGiveawayCampaignCodes(
    sessionToken: string,
    giveawayId: string,
  ): Promise<
    Array<{
      id: string;
      maxUses: number;
      usedUses: number;
      expiresAt: string;
      createdAt: string;
      status: "active" | "expired" | "exhausted" | "revoked";
    }>
  >;
  listGiveawayManualEntryCandidates(
    sessionToken: string,
    giveawayId: string,
  ): Promise<Array<{ riderId: string; label: string }>>;
  setGiveawayWinnerPublication(
    sessionToken: string,
    awardId: string,
    input: GiveawayWinnerPublicationInput,
  ): Promise<RiderGiveawayState>;
};

function asGiveawayUiDataBackend(
  backend: Awaited<ReturnType<typeof createTambikeTestBackend>>,
): GiveawayUiDataBackend {
  return backend as GiveawayUiDataBackend;
}

function giveawayInput(eventId: string, visibility: CreateGiveawayInput["publicVisibility"] = "event_page") {
  return {
    eventId,
    title: "Privacy-safe ride giveaway",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 10,
    mechanics: "Active riders receive an automatic draw entry.",
    terms: "One current rider may receive one prize.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: visibility,
    eligibilityGroups: [
      {
        id: "active-rider",
        label: "Active rider",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "helmet-pool",
        title: "Helmet prize",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Tambike helmet", description: "One event helmet" }],
        eligibilityGroupIds: ["active-rider"],
      },
    ],
  } satisfies CreateGiveawayInput;
}

async function withDrawEncryptionKey<T>(callback: () => Promise<T>) {
  const prior = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
  process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString("base64");
  try {
    return await callback();
  } finally {
    if (prior === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = prior;
  }
}

async function createPublishedGiveaway(
  backend: GiveawayUiDataBackend,
  options: { publish?: boolean } = {},
) {
  const { organizer, admin, rider, outsider } = await createTestActors(
    backend,
    `giveaway-ui-published-${++uiFixtureSequence}`,
  );
  const event = await createPublishedTestEvent(backend, { organizer, admin }, {
    title: "Scoped giveaway data ride",
    type: "Bike Night",
    date: "August 15, 2026",
    time: "7:00 PM - 10:00 PM",
    locationName: "Scoped Giveaway Grounds",
    locationAddress: "15 Scoped Avenue, Antipolo",
    locationMapLink: "https://maps.example.test/scoped-giveaway-grounds",
    area: "Antipolo",
    expectedRiders: 20,
    perkPreview: "Scoped giveaway data",
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

  await withDrawEncryptionKey(async () => {
    await backend.lockGiveaway(organizer.sessionToken, giveaway.id);
    const result = await backend.runGiveawayDraw(organizer.sessionToken, {
      giveawayId: giveaway.id,
      idempotencyKey: "ui-data-contract-initial-draw",
      reason: "Exercise the scoped UI data contracts",
    });
    if (options.publish !== false) {
      await backend.publishGiveawayDraw(organizer.sessionToken, giveaway.id, result.drawId);
    }
    return result;
  });
  const riderState = await withDrawEncryptionKey(() =>
    backend.getRiderGiveawayState(rider.sessionToken, giveaway.id),
  );
  if (!riderState.award) throw new Error("TEST_AWARD_MISSING");

  return { organizer, admin, outsider, rider, event, giveaway, awardId: riderState.award.awardId };
}

async function createOpenEntryGiveaway(
  backend: GiveawayUiDataBackend,
  entryMode: "claim_code" | "manual_only",
) {
  const { organizer, admin, rider, outsider } = await createTestActors(
    backend,
    `giveaway-ui-entry-${++uiFixtureSequence}`,
  );
  const event = await createPublishedTestEvent(backend, { organizer, admin }, {
    title: `${entryMode} organizer controls`,
    type: "Bike Night",
    date: "August 21, 2026",
    time: "7:00 PM - 10:00 PM",
    locationName: "Entry Control Grounds",
    locationAddress: "21 Entry Avenue, Antipolo",
    area: "Antipolo",
    expectedRiders: 20,
    perkPreview: "Flexible entry controls",
  });
  const giveaway = await backend.createGiveaway(organizer.sessionToken, event.id, {
    ...giveawayInput(event.id),
    title: `${entryMode} campaign`,
    entryMode,
    eligibilityGroups: [
      {
        id: "entry-group",
        label: entryMode === "claim_code" ? "Code claimant" : "Manual event entrant",
        weight: 1,
        conditions:
          entryMode === "claim_code"
            ? [{ source: "campaign_code" }]
            : [{ source: "manual" }, { source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "entry-prize-pool",
        title: "Entry prize",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Ride prize" }],
        eligibilityGroupIds: ["entry-group"],
      },
    ],
  });
  await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);
  await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, { decision: "approved" });
  await backend.openGiveaway(organizer.sessionToken, giveaway.id);

  return { organizer, admin, outsider, rider, event, giveaway };
}

let uiFixtureSequence = 0;

describe("giveaway UI data contracts", () => {
  test("publishes only a safe draw receipt and opted-in winner aliases", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createPublishedGiveaway(backend);
    const unpublished = await backend.createGiveaway(
      context.organizer.sessionToken,
      context.event.id,
      giveawayInput(context.event.id),
    );

    const campaigns = await withDrawEncryptionKey(() =>
      backend.listPublicGiveawaysForEvent(context.event.id),
    );

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({
      giveaway: { id: context.giveaway.id, title: "Privacy-safe ride giveaway", state: "claims_open" },
      results: [],
      drawVerifications: [
        {
          giveawayId: context.giveaway.id,
          commitment: expect.stringMatching(/^[a-f0-9]{64}$/),
          snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          snapshotCount: 1,
          algorithmVersion: "hmac-sha256-v1",
          drawDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          seed: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
        },
      ],
    });
    expect(Object.keys(campaigns[0]!).sort()).toEqual(["drawVerifications", "giveaway", "results"]);
    expect(Object.keys(campaigns[0]!.drawVerifications[0] ?? {}).sort()).toEqual([
      "algorithmVersion",
      "commitment",
      "drawDigest",
      "giveawayId",
      "seed",
      "snapshotCount",
      "snapshotDigest",
    ]);
    expect(JSON.stringify(campaigns)).not.toMatch(
      /winnerUserId|awardId|claimReference|claimToken|sourceFact|encrypted|ciphertext|delivery/i,
    );
    await expect(backend.getPublicGiveaway(unpublished.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await backend.setGiveawayWinnerPublication(context.rider.sessionToken, context.awardId, {
      published: true,
      alias: "Fixture R.",
    });
    const optedIn = await withDrawEncryptionKey(() =>
      backend.listPublicGiveawaysForEvent(context.event.id),
    );
    expect(optedIn[0]?.results).toEqual([
      { prizePoolTitle: "Helmet prize", winnerAlias: "Fixture R." },
    ]);

    await backend.setGiveawayWinnerPublication(context.rider.sessionToken, context.awardId, {
      published: false,
    });
    const revoked = await withDrawEncryptionKey(() =>
      backend.listPublicGiveawaysForEvent(context.event.id),
    );
    expect(revoked[0]?.results).toEqual([]);

    await backend.setGiveawayWinnerPublication(context.rider.sessionToken, context.awardId, {
      published: true,
      alias: "Fixture Rejoined",
    });
    const reopted = await withDrawEncryptionKey(() =>
      backend.listPublicGiveawaysForEvent(context.event.id),
    );
    expect(reopted[0]?.results).toEqual([
      { prizePoolTitle: "Helmet prize", winnerAlias: "Fixture Rejoined" },
    ]);
  });

  test("withholds public proof before publication and scopes a rider proof to their own entry", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const unpublished = await createPublishedGiveaway(backend, { publish: false });

    const publicBeforePublish = await backend.listPublicGiveawaysForEvent(unpublished.event.id);
    expect(publicBeforePublish).toEqual([
      expect.objectContaining({ giveaway: expect.objectContaining({ id: unpublished.giveaway.id }), results: [] }),
    ]);
    expect(publicBeforePublish[0]?.drawVerifications).toEqual([]);
    await expect(
      withDrawEncryptionKey(() =>
        backend.getRiderGiveawayState(unpublished.rider.sessionToken, unpublished.giveaway.id),
      ),
    ).resolves.not.toHaveProperty("proof");

    const published = await createPublishedGiveaway(backend);
    const ownerState = await withDrawEncryptionKey(() =>
      backend.getRiderGiveawayState(published.rider.sessionToken, published.giveaway.id),
    );
    const publicAfterPublish = await withDrawEncryptionKey(() =>
      backend.listPublicGiveawaysForEvent(published.event.id),
    );
    const publicCampaign = publicAfterPublish.find((campaign) => campaign.giveaway.id === published.giveaway.id);
    expect(ownerState.proof).toEqual({
      entryReference: expect.stringMatching(/^entry_/),
      drawVerifications: publicCampaign?.drawVerifications,
    });
    expect(JSON.stringify(ownerState)).not.toMatch(
      /email|winnerUserId|sourceFact|sourceSnapshot|claimToken|ciphertext|delivery/i,
    );
    await expect(
      backend.setGiveawayWinnerPublication(published.rider.sessionToken, published.awardId, {
        published: true,
        alias: ownerState.proof?.entryReference ?? "entry_missing",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const anotherRider = await backend.signUpRider({
      displayName: "Proof snooper",
      email: "proof-snooper@example.com",
      password: "password123",
      area: "Antipolo",
    });
    await expect(
      backend.getRiderGiveawayState(anotherRider.sessionToken, published.giveaway.id),
    ).resolves.toEqual({ giveawayId: published.giveaway.id, status: "not_eligible", entryCount: 0 });
    await expect(
      backend.setGiveawayWinnerPublication(anotherRider.sessionToken, published.awardId, {
        published: true,
        alias: "Not mine",
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
  });

  test("returns a rider-owned claim context without a credential or eligibility facts", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createPublishedGiveaway(backend);

    const states = await backend.listRiderGiveawayStatesForEvent(
      context.rider.sessionToken,
      context.event.id,
    );
    const claim = await backend.getRiderGiveawayClaimContext(
      context.rider.sessionToken,
      context.awardId,
    );

    expect(states).toEqual([
      expect.objectContaining({
        giveawayId: context.giveaway.id,
        giveawayTitle: "Privacy-safe ride giveaway",
        giveawayState: "claims_open",
        riderState: expect.objectContaining({ award: expect.objectContaining({ awardId: context.awardId }) }),
      }),
    ]);
    expect(claim).toEqual({
      awardId: context.awardId,
      giveawayId: context.giveaway.id,
      giveawayTitle: "Privacy-safe ride giveaway",
      giveawayState: "claims_open",
      award: {
        prizePoolTitle: "Helmet prize",
        status: "claimable",
        fulfilmentMode: "onsite",
      },
      deliveryDetailsSubmitted: false,
      claimCredentialIssued: false,
    });

    const issued = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);
    const refreshed = await backend.getRiderGiveawayClaimContext(
      context.rider.sessionToken,
      context.awardId,
    );
    expect(refreshed.claimCredentialIssued).toBe(true);
    expect(JSON.stringify(refreshed)).not.toContain(issued.token);
    expect(JSON.stringify(refreshed)).not.toMatch(/claimToken|sourceFact|sourceSnapshot|opaque|email/i);

    const anotherRider = await backend.signUpRider({
      displayName: "Wrong rider",
      email: "wrong-rider@example.com",
      password: "password123",
      area: "Antipolo",
    });
    await expect(
      backend.getRiderGiveawayClaimContext(anotherRider.sessionToken, context.awardId),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
  });

  test("scopes admin, organizer, and operator reads without entrant or delivery detail leakage", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createPublishedGiveaway(backend);

    const [adminCampaigns, workspace, candidates, queue] = await Promise.all([
      backend.listAdminGiveaways(context.admin.sessionToken),
      backend.getOrganizerGiveawayWorkspace(context.organizer.sessionToken, context.giveaway.id),
      backend.listGiveawayOperatorCandidates(context.organizer.sessionToken, context.event.id),
      backend.listEventGiveawayOperatorClaims(context.organizer.sessionToken, context.event.id),
    ]);

    expect(adminCampaigns).toContainEqual(
      expect.objectContaining({ id: context.giveaway.id, eventId: context.event.id }),
    );
    expect(workspace).toMatchObject({
      id: context.giveaway.id,
      eventId: context.event.id,
      mechanics: "Active riders receive an automatic draw entry.",
      terms: "One current rider may receive one prize.",
      eligibilityGroups: [expect.objectContaining({ label: "Active rider", weight: 1 })],
      prizePools: [expect.objectContaining({ title: "Helmet prize", items: [expect.any(Object)] })],
    });
    const candidate = candidates.find((value) => value.id === context.rider.user.id);
    expect(candidate).toBeDefined();
    expect(Object.keys(candidate ?? {}).sort()).toEqual(["id", "label"]);
    expect(queue).toEqual([
      expect.objectContaining({
        awardId: context.awardId,
        giveawayId: context.giveaway.id,
        giveawayTitle: "Privacy-safe ride giveaway",
        prizePoolTitle: "Helmet prize",
      }),
    ]);
    expect(JSON.stringify({ workspace, candidates, queue })).not.toMatch(
      /checksum|auditEvents|sourceFact|sourceSnapshot|seedRevealedAt|encryptedPayload|deliveryDetail/i,
    );

    await expect(
      backend.listGiveawayOperatorCandidates(context.outsider.sessionToken, context.event.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.listEventGiveawayOperatorClaims(context.rider.sessionToken, context.event.id),
    ).resolves.toEqual([]);
  });

  test("lists organizer campaign-code summaries without a raw code or token hash", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createOpenEntryGiveaway(backend, "claim_code");
    const issued = await backend.createGiveawayCampaignCode(
      context.organizer.sessionToken,
      context.giveaway.id,
      { maxUses: 1, expiresAt: "2026-08-22T00:00:00.000Z" },
    );

    const summaries = await backend.listGiveawayCampaignCodes(
      context.organizer.sessionToken,
      context.giveaway.id,
    );

    expect(summaries).toEqual([
      {
        id: issued.id,
        maxUses: 1,
        usedUses: 0,
        expiresAt: "2026-08-22T00:00:00.000Z",
        createdAt: expect.any(String),
        status: "active",
      },
    ]);
    expect(Object.keys(summaries[0] ?? {}).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
      "maxUses",
      "status",
      "usedUses",
    ]);
    expect(JSON.stringify(summaries)).not.toContain(issued.code);
    expect(JSON.stringify(summaries)).not.toMatch(/tokenHash|claimedRider|rawCode|email/i);

    await backend.claimGiveawayCampaignCode(
      context.rider.sessionToken,
      context.giveaway.id,
      issued.code,
    );
    await expect(
      backend.listGiveawayCampaignCodes(context.admin.sessionToken, context.giveaway.id),
    ).resolves.toEqual([
      expect.objectContaining({ id: issued.id, usedUses: 1, status: "exhausted" }),
    ]);
    await expect(
      backend.listGiveawayCampaignCodes(context.outsider.sessionToken, context.giveaway.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("does not create or expose campaign-code inventory outside claim-code mode", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createOpenEntryGiveaway(backend, "manual_only");

    await expect(
      backend.createGiveawayCampaignCode(context.organizer.sessionToken, context.giveaway.id, {
        maxUses: 1,
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_MODE_INVALID" });
    await expect(
      backend.listGiveawayCampaignCodes(context.organizer.sessionToken, context.giveaway.id),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_MODE_INVALID" });
  });

  test("lists only event-qualified manual-entry candidates with safe labels", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createOpenEntryGiveaway(backend, "manual_only");
    await backend.registerForEvent(context.rider.sessionToken, context.event.id, {
      status: "going",
      attendanceType: "direct",
    });
    const unrelatedRider = await backend.signUpRider({
      displayName: "Unrelated rider",
      email: "unrelated-entry@example.com",
      password: "password123",
      area: "Antipolo",
    });

    const candidates = await backend.listGiveawayManualEntryCandidates(
      context.organizer.sessionToken,
      context.giveaway.id,
    );

    expect(candidates).toEqual([
      { riderId: context.rider.user.id, label: context.rider.user.displayName },
    ]);
    expect(candidates.some((candidate) => candidate.riderId === unrelatedRider.user.id)).toBe(false);
    expect(Object.keys(candidates[0] ?? {}).sort()).toEqual(["label", "riderId"]);
    expect(JSON.stringify(candidates)).not.toMatch(/passId|sourceFact|phone/i);
    await expect(
      backend.listGiveawayManualEntryCandidates(context.admin.sessionToken, context.giveaway.id),
    ).resolves.toEqual(candidates);
    await expect(
      backend.listGiveawayManualEntryCandidates(context.rider.sessionToken, context.giveaway.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("keeps an active manual entry selectable for revocation after the rider is suspended", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createOpenEntryGiveaway(backend, "manual_only");
    const unenteredRider = await backend.signUpRider({
      displayName: "Suspended without manual entry",
      email: "suspended-without-manual-entry@example.com",
      password: "password123",
      area: "Antipolo",
    });
    await Promise.all([
      backend.registerForEvent(context.rider.sessionToken, context.event.id, {
        status: "going",
        attendanceType: "direct",
      }),
      backend.registerForEvent(unenteredRider.sessionToken, context.event.id, {
        status: "going",
        attendanceType: "direct",
      }),
    ]);
    await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
      giveawayId: context.giveaway.id,
      riderId: context.rider.user.id,
      reason: "Accepted paper entry before account review",
    });

    const store = backend as unknown as {
      users: Map<string, { verificationStatus: string }>;
      giveaways: {
        campaignsById: Map<
          string,
          {
            entriesByRider: Map<
              string,
              { status: string; manualGrantActive?: boolean }
            >;
          }
        >;
      };
    };
    for (const riderId of [context.rider.user.id, unenteredRider.user.id]) {
      const rider = store.users.get(riderId);
      if (!rider) throw new Error("TEST_RIDER_MISSING");
      rider.verificationStatus = "SUSPENDED";
    }

    await expect(
      backend.listGiveawayManualEntryCandidates(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toEqual([{ riderId: context.rider.user.id, label: context.rider.user.displayName }]);

    await expect(
      backend.revokeManualGiveawayEntry(
        context.organizer.sessionToken,
        context.giveaway.id,
        context.rider.user.id,
        "Withdraw manual entry after account suspension",
      ),
    ).resolves.toMatchObject({
      giveawayId: context.giveaway.id,
      status: "not_eligible",
      entryCount: 0,
    });
    const entry = store.giveaways.campaignsById
      .get(context.giveaway.id)
      ?.entriesByRider.get(context.rider.user.id);
    expect(entry).toMatchObject({ status: "withdrawn", manualGrantActive: false });
  });

  test("does not revoke a manually deactivated entry with a stale eligible status", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createOpenEntryGiveaway(backend, "manual_only");
    await backend.registerForEvent(context.rider.sessionToken, context.event.id, {
      status: "going",
      attendanceType: "direct",
    });
    await backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
      giveawayId: context.giveaway.id,
      riderId: context.rider.user.id,
      reason: "Accepted paper entry for the rider",
    });
    const store = backend as unknown as {
      giveaways: {
        campaignsById: Map<
          string,
          {
            entriesByRider: Map<
              string,
              { status: string; manualGrantActive?: boolean }
            >;
          }
        >;
      };
    };
    const entry = store.giveaways.campaignsById
      .get(context.giveaway.id)
      ?.entriesByRider.get(context.rider.user.id);
    if (!entry) throw new Error("TEST_MANUAL_ENTRY_MISSING");
    entry.manualGrantActive = false;

    await expect(
      backend.revokeManualGiveawayEntry(
        context.organizer.sessionToken,
        context.giveaway.id,
        context.rider.user.id,
        "Reject stale deactivated manual entry",
      ),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_NOT_ELIGIBLE" });
    expect(entry).toMatchObject({ status: "eligible", manualGrantActive: false });
  });

  test("rejects a suspended rider even when an authorized organizer submits a direct manual grant", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createOpenEntryGiveaway(backend, "manual_only");
    await backend.registerForEvent(context.rider.sessionToken, context.event.id, {
      status: "going",
      attendanceType: "direct",
    });
    const store = backend as unknown as {
      users: Map<string, { verificationStatus: string }>;
    };
    const rider = store.users.get(context.rider.user.id);
    if (!rider) throw new Error("TEST_RIDER_MISSING");
    rider.verificationStatus = "SUSPENDED";

    await expect(
      backend.grantManualGiveawayEntry(context.organizer.sessionToken, {
        giveawayId: context.giveaway.id,
        riderId: context.rider.user.id,
        reason: "Paper entry rejected after account suspension",
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_ENTRY_NOT_ELIGIBLE" });
  });
});

describe("giveaway UI data action contracts", () => {
  test("renders published draw receipts and a rider-controlled winner alias", async () => {
    const [publicPanel, riderPanel] = await Promise.all([
      readFile(new URL("../../src/features/giveaways/public-giveaway-panel.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../../src/features/giveaways/rider-giveaway-status-panel.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(publicPanel).toContain("Draw receipts");
    expect(publicPanel).toContain("drawVerifications");
    expect(publicPanel).not.toContain("opaque entry reference");
    expect(riderPanel).toContain("Your draw receipt");
    expect(riderPanel).toContain("setGiveawayWinnerPublicationAction");
    expect(riderPanel).toContain("Publish alias");
    expect(riderPanel).toContain("Hide public alias");
  });

  test("implements the same scoped reads in memory and Prisma backends", async () => {
    const [memorySource, prismaSource] = await Promise.all([
      readFile(new URL("../../src/server/backend.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/server/prisma-backend.ts", import.meta.url), "utf8"),
    ]);

    for (const name of [
      "listPublicGiveawaysForEvent",
      "listRiderGiveawayStatesForEvent",
      "getRiderGiveawayClaimContext",
      "listAdminGiveaways",
      "listEventGiveawayOperatorClaims",
      "listGiveawayOperatorCandidates",
      "getOrganizerGiveawayWorkspace",
      "listGiveawayCampaignCodes",
      "listGiveawayManualEntryCandidates",
      "setGiveawayWinnerPublication",
    ]) {
      expect(memorySource).toContain(`async ${name}`);
      expect(prismaSource).toContain(`async ${name}`);
    }
  });

  test("exposes only the scoped read action names", async () => {
    const source = await readFile(
      new URL("../../src/server/giveaway-actions.ts", import.meta.url),
      "utf8",
    );

    for (const name of [
      "listPublicGiveawaysForEventAction",
      "listRiderGiveawayStatesForEventAction",
      "getRiderGiveawayClaimContextAction",
      "listAdminGiveawaysAction",
      "listEventGiveawayOperatorClaimsAction",
      "listGiveawayOperatorCandidatesAction",
      "getOrganizerGiveawayWorkspaceAction",
      "listGiveawayCampaignCodesAction",
      "listGiveawayManualEntryCandidatesAction",
      "setGiveawayWinnerPublicationAction",
    ]) {
      expect(source).toContain(`function ${name}`);
    }
  });

  test("uses typed organizer campaign-code and manual-entry action inputs", async () => {
    const source = await readFile(
      new URL("../../src/server/giveaway-actions.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("input: CreateGiveawayCampaignCodeInput");
    expect(source).toContain("input: GrantManualGiveawayEntryInput");
    expect(source).toContain("input: RevokeManualGiveawayEntryInput");
  });

  test("declares every giveaway server action as asynchronous for Next server-function calls", async () => {
    const source = await readFile(
      new URL("../../src/server/giveaway-actions.ts", import.meta.url),
      "utf8",
    );

    expect(source.match(/^export function /gm) ?? []).toEqual([]);
    expect(source.match(/^export async function /gm)?.length).toBeGreaterThan(0);
  });
});
