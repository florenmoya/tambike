import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import type {
  CreateGiveawayInput,
  EventGiveawayOperatorQueueItem,
  GiveawayCampaignListItem,
  GiveawayOperatorCandidate,
  OrganizerGiveawayWorkspace,
  PublicEventGiveaway,
  RiderEventGiveawayState,
  RiderGiveawayClaimContext,
} from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";

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

async function createPublishedGiveaway(backend: GiveawayUiDataBackend) {
  const [organizer, admin, venue, rider] = await Promise.all([
    backend.loginWithPassword("marco.organizer@example.com", "password123"),
    backend.loginWithPassword("admin@bayanko.ph", "secret_123"),
    backend.loginWithPassword("ana.venue@example.com", "password123"),
    backend.loginWithPassword("mina.rider@example.com", "password123"),
  ]);
  const event = await backend.createEventDraft(organizer.sessionToken, {
    title: "Scoped giveaway data ride",
    type: "Bike Night",
    venueId: "shell-pugon",
    date: "August 15, 2026",
    time: "7:00 PM - 10:00 PM",
    area: "Antipolo",
    expectedRiders: 20,
    perkPreview: "Scoped giveaway data",
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

  await withDrawEncryptionKey(async () => {
    await backend.lockGiveaway(organizer.sessionToken, giveaway.id);
    const result = await backend.runGiveawayDraw(organizer.sessionToken, {
      giveawayId: giveaway.id,
      idempotencyKey: "ui-data-contract-initial-draw",
      reason: "Exercise the scoped UI data contracts",
    });
    await backend.publishGiveawayDraw(organizer.sessionToken, giveaway.id, result.drawId);
    return result;
  });
  const riderState = await backend.getRiderGiveawayState(rider.sessionToken, giveaway.id);
  if (!riderState.award) throw new Error("TEST_AWARD_MISSING");

  return { organizer, admin, venue, rider, event, giveaway, awardId: riderState.award.awardId };
}

describe("giveaway UI data contracts", () => {
  test("lists only public campaign data and published opaque winner aliases for an event", async () => {
    const backend = asGiveawayUiDataBackend(await createTambikeTestBackend());
    const context = await createPublishedGiveaway(backend);
    const unpublished = await backend.createGiveaway(
      context.organizer.sessionToken,
      context.event.id,
      giveawayInput(context.event.id),
    );

    const campaigns = await backend.listPublicGiveawaysForEvent(context.event.id);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({
      giveaway: { id: context.giveaway.id, title: "Privacy-safe ride giveaway", state: "claims_open" },
      results: [{ prizePoolTitle: "Helmet prize", winnerAlias: expect.any(String) }],
    });
    expect(Object.keys(campaigns[0]!.results[0]!).sort()).toEqual(["prizePoolTitle", "winnerAlias"]);
    expect(JSON.stringify(campaigns)).not.toMatch(
      /mina\.rider@example\.com|winnerUserId|awardId|claimReference|claimToken|sourceFact|seed/i,
    );
    await expect(backend.getPublicGiveaway(unpublished.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
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
      backend.listEventGiveawayOperatorClaims(context.venue.sessionToken, context.event.id),
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
      /mina\.rider@example\.com|checksum|auditEvents|sourceFact|sourceSnapshot|seedRevealedAt|encryptedPayload|deliveryDetail/i,
    );

    await expect(
      backend.listGiveawayOperatorCandidates(context.venue.sessionToken, context.event.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.listEventGiveawayOperatorClaims(context.rider.sessionToken, context.event.id),
    ).resolves.toEqual([]);
  });
});

describe("giveaway UI data action contracts", () => {
  test("implements the same seven scoped reads in memory and Prisma backends", async () => {
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
    ]) {
      expect(source).toContain(`function ${name}`);
    }
  });
});
