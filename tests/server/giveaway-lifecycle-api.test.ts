import { describe, expect, test } from "vitest";

import type { CreateGiveawayInput, GiveawayPrizeItemInput } from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createPublishedTestEvent, createTestActors } from "./support/tambike-fixtures";

type GiveawayLifecycleBackend = Awaited<ReturnType<typeof createTambikeTestBackend>> & {
  createGiveaway(
    sessionToken: string,
    eventId: string,
    input: CreateGiveawayInput,
  ): Promise<{ id: string; state: string }>;
  submitGiveawayForReview(sessionToken: string, giveawayId: string): Promise<unknown>;
  reviewGiveawayCompliance(
    sessionToken: string,
    giveawayId: string,
    input: { decision: "approved" },
  ): Promise<unknown>;
  scheduleGiveaway(sessionToken: string, giveawayId: string): Promise<{ state: string }>;
  openGiveaway(sessionToken: string, giveawayId: string): Promise<{ state: string }>;
  pauseGiveaway(sessionToken: string, giveawayId: string): Promise<{ state: string }>;
  listOrganizerGiveaways(sessionToken: string, eventId: string): Promise<Array<{ id: string; state: string }>>;
  recoverExpiredDirectGiveawayAward(
    sessionToken: string,
    input: { awardId: string; reason: string; claimDeadlineAt: string },
  ): Promise<{ awardId: string | null }>;
  settleGiveawayAward(sessionToken: string, awardId: string, reason: string): Promise<{ id: string }>;
  completeGiveawayClaims(sessionToken: string, giveawayId: string): Promise<{ completed: true }>;
  declineGiveawayAward(sessionToken: string, awardId: string, reason: string): Promise<unknown>;
  advanceScheduledGiveawayLifecycle(now: Date): Promise<{
    opened: number;
    locked: number;
    drawn: number;
    expired: number;
    completed: number;
  }>;
};

function asLifecycleBackend(backend: Awaited<ReturnType<typeof createTambikeTestBackend>>) {
  return backend as GiveawayLifecycleBackend;
}

function scheduledGiveawayInput(
  eventId: string,
  now: Date,
  options: {
    directPrize?: boolean;
    directItemCount?: number;
    directAwardMode?: "first_come" | "guaranteed";
    winnerTotal?: number;
  } = {},
): CreateGiveawayInput {
  const directItemCount = options.directItemCount ?? 1;
  const directItems = [
    { title: "Prize item 1" },
    ...Array.from({ length: Math.max(0, directItemCount - 1) }, (_, index) => ({
      title: `Prize item ${index + 2}`,
    })),
  ] as [GiveawayPrizeItemInput, ...GiveawayPrizeItemInput[]];
  const directPrizePools: CreateGiveawayInput["prizePools"] =
    options.directAwardMode === "guaranteed"
      ? [
          {
            id: "direct-prize",
            title: "Direct prize",
            awardMode: "guaranteed",
            fulfilmentMode: "onsite",
            publicPresentation: {
              disclosure: "revealed",
              title: "Direct prize",
            },
            inventory: { kind: "unlimited" },
            items: [],
          },
        ]
      : [
          {
            id: "direct-prize",
            title: "Direct prize",
            awardMode: "first_come",
            fulfilmentMode: "onsite",
            publicPresentation: {
              disclosure: "revealed",
              title: "Prize item 1",
            },
            inventory: { kind: "finite", quantity: directItemCount },
            items: directItems,
          },
        ];
  return {
    eventId,
    title: "Scheduled fair draw",
    kind: "raffle",
    entryMode: "automatic",
    maxEntriesPerRider: 10,
    mechanics: "One active-pass rider receives one draw unit.",
    terms: "Cron may open, lock, and run the scheduled initial draw exactly once.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: options.winnerTotal ?? 1 },
    organizerAttestation: true,
    publicVisibility: "hidden",
    entryOpensAt: new Date(now.getTime() + 60_000).toISOString(),
    entryClosesAt: new Date(now.getTime() + 120_000).toISOString(),
    drawAt: new Date(now.getTime() + 180_000).toISOString(),
    claimDeadlineAt: new Date(now.getTime() + 240_000).toISOString(),
    eligibilityGroups: [
      {
        id: "active-pass",
        label: "Active pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: options.directPrize
      ? directPrizePools
      : [
          {
            id: "draw-prize",
            title: "Prize",
            awardMode: "random_draw",
            fulfilmentMode: "onsite",
            publicPresentation: {
              disclosure: "revealed",
              title: "Prize item",
            },
            inventory: { kind: "finite", quantity: 1 },
            items: [{ title: "Prize item" }],
          },
        ],
  };
}

async function createScheduledCampaign(
  backend: GiveawayLifecycleBackend,
  now: Date,
  options: {
    directPrize?: boolean;
    directItemCount?: number;
    directAwardMode?: "first_come" | "guaranteed";
    winnerTotal?: number;
  } = {},
) {
  const { organizer, admin, rider } = await createTestActors(
    backend,
    `giveaway-lifecycle-${++lifecycleFixtureSequence}`,
  );
  const event = await createPublishedTestEvent(backend, { organizer, admin }, {
    title: "Scheduled lifecycle test",
    type: "Bike Night",
    locationName: "Lifecycle Test Grounds",
    locationAddress: "15 Lifecycle Avenue, Antipolo",
    locationMapLink: "https://maps.example.test/lifecycle-test-grounds",
    area: "Antipolo",
    expectedRiders: 20,
    perkPreview: "Lifecycle",
  });
  const giveaway = await backend.createGiveaway(
    organizer.sessionToken,
    event.id,
    scheduledGiveawayInput(event.id, now, options),
  );
  await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);
  await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, { decision: "approved" });
  await backend.scheduleGiveaway(organizer.sessionToken, giveaway.id);
  return { organizer, admin, rider, event, giveaway };
}

let lifecycleFixtureSequence = 0;

describe("scheduled giveaway lifecycle", () => {
  test("advances only scheduled/open campaigns and records one initial cron draw", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now);
    const previousKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

    try {
      await expect(
        backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000)),
      ).resolves.toMatchObject({ opened: 1, locked: 1, drawn: 1 });
      await expect(
        backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000)),
      ).resolves.toMatchObject({ opened: 0, locked: 0, drawn: 0 });
    } finally {
      if (previousKey === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousKey;
    }

    const campaigns = await backend.listOrganizerGiveaways(
      context.organizer.sessionToken,
      context.event.id,
    );
    expect(campaigns.find((campaign) => campaign.id === context.giveaway.id)).toMatchObject({
      id: context.giveaway.id,
      state: "drawing",
    });
  });

  test("never opens an unapproved draft or reopens a paused campaign", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now);
    await backend.openGiveaway(context.organizer.sessionToken, context.giveaway.id);
    await backend.pauseGiveaway(context.organizer.sessionToken, context.giveaway.id);

    await backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000));
    const campaigns = await backend.listOrganizerGiveaways(
      context.organizer.sessionToken,
      context.event.id,
    );
    expect(campaigns.find((campaign) => campaign.id === context.giveaway.id)?.state).toBe("paused");
  });

  test("lets an owner pause an approved scheduled campaign before cron opens it", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now);

    await expect(
      backend.pauseGiveaway(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ state: "paused" });
    await expect(
      backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000)),
    ).resolves.toMatchObject({ opened: 0, locked: 0, drawn: 0 });
    const campaigns = await backend.listOrganizerGiveaways(
      context.organizer.sessionToken,
      context.event.id,
    );
    expect(campaigns.find((campaign) => campaign.id === context.giveaway.id)?.state).toBe("paused");
  });

  test("does not use a suspended creator as cron provenance, including an admin-shaped record", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now);
    const store = backend as unknown as {
      users: Map<string, { role: string; accountStatus: string }>;
    };
    const creator = store.users.get(context.organizer.user.id);
    if (!creator) throw new Error("TEST_CREATOR_MISSING");
    creator.role = "admin";
    creator.accountStatus = "SUSPENDED";

    await expect(
      backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000)),
    ).resolves.toMatchObject({ opened: 0, locked: 0, drawn: 0 });
    const campaigns = await backend.listOrganizerGiveaways(
      context.admin.sessionToken,
      context.event.id,
    );
    expect(campaigns.find((campaign) => campaign.id === context.giveaway.id)?.state).toBe("scheduled");
  });

  test("runs retention purge as a system cron action even when campaign lifecycle has no eligible actor", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now);
    const store = backend as unknown as {
      users: Map<string, { role: string; accountStatus: string }>;
      giveaways: {
        campaignsById: Map<
          string,
          {
            deliveryDetails: Array<{
              id: string;
              awardId: string;
              encryptedPayload?: string;
              encryptedIv?: string;
              encryptedAuthTag?: string;
              retentionExpiresAt: string;
              purgedAt?: string;
            }>;
            auditEvents: Array<{ action: string; actorUserId?: string; payload: Record<string, unknown> }>;
          }
        >;
        deliveryDetailsByAwardId: Map<string, unknown>;
      };
    };
    const creator = store.users.get(context.organizer.user.id);
    const campaign = store.giveaways.campaignsById.get(context.giveaway.id);
    if (!creator || !campaign) throw new Error("TEST_RETENTION_SETUP_MISSING");
    creator.role = "admin";
    creator.accountStatus = "SUSPENDED";
    const detail = {
      id: "expired-system-retention-detail",
      awardId: "expired-system-retention-award",
      encryptedPayload: "ciphertext",
      encryptedIv: "iv",
      encryptedAuthTag: "tag",
      retentionExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    };
    campaign.deliveryDetails.push(detail);
    store.giveaways.deliveryDetailsByAwardId.set(detail.awardId, detail);

    await expect(backend.advanceScheduledGiveawayLifecycle(new Date())).resolves.toMatchObject({
      purgedDeliveryDetails: 1,
    });
    expect(detail).toMatchObject({
      encryptedPayload: undefined,
      encryptedIv: undefined,
      encryptedAuthTag: undefined,
      purgedAt: expect.any(String),
    });
    expect(campaign.auditEvents.at(-1)).toMatchObject({
      action: "GIVEAWAY_DELIVERY_PURGED",
      actorUserId: undefined,
      payload: expect.objectContaining({ reason: "retention_expired", initiatedVia: "cron" }),
    });
  });

  test("keeps claims open after cron expiry while a direct award is recoverable", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now, { directPrize: true });
    const rider = context.rider;
    const replacementRider = await backend.signUpRider({
      displayName: "Lifecycle replacement rider",
      email: "lifecycle-replacement@example.com",
      password: "password123",
      area: "Antipolo",
    });
    await backend.registerForEvent(rider.sessionToken, context.event.id, {
      status: "going",
      attendanceType: "direct",
    });
    await backend.registerForEvent(replacementRider.sessionToken, context.event.id, {
      status: "going",
      attendanceType: "direct",
    });
    const previousKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

    try {
      await backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000));
      const store = backend as unknown as {
        giveaways: {
          campaignsById: Map<
            string,
            {
              state: string;
              draws: Array<{ id: string }>;
              awards: Array<{
                id: string;
                drawId?: string;
                isCurrent: boolean;
                status: string;
                claimDeadlineAt?: string;
              }>;
            }
          >;
        };
      };
      const campaign = store.giveaways.campaignsById.get(context.giveaway.id);
      const drawId = campaign?.draws[0]?.id;
      const directAward = campaign?.awards.find((award) => !award.drawId && award.isCurrent);
      if (!campaign || !drawId || !directAward) throw new Error("TEST_DIRECT_AWARD_MISSING");
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, drawId);
      directAward.claimDeadlineAt = new Date(Date.now() - 1_000).toISOString();

      await backend.advanceScheduledGiveawayLifecycle(new Date());
      expect(campaign.state).toBe("claims_open");
      await expect(
        backend.recoverExpiredDirectGiveawayAward(context.organizer.sessionToken, {
          awardId: directAward.id,
          reason: "Re-offer the returned prize",
          claimDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      ).resolves.toMatchObject({ awardId: expect.any(String) });
    } finally {
      if (previousKey === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousKey;
    }
  });

  test("requires an explicit audited settlement when an expired direct source has no replacement", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now, { directPrize: true });
    const rider = context.rider;
    await backend.registerForEvent(rider.sessionToken, context.event.id, {
      status: "going",
      attendanceType: "direct",
    });
    const previousKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");

    try {
      await backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000));
      const store = backend as unknown as {
        giveaways: {
          campaignsById: Map<
            string,
            {
              state: string;
              draws: Array<{ id: string }>;
              awards: Array<{
                id: string;
                drawId?: string;
                isCurrent: boolean;
                status: string;
                claimDeadlineAt?: string;
                recoveryClosedAt?: string;
              }>;
              auditEvents: Array<{ action: string; payload: Record<string, unknown> }>;
            }
          >;
        };
      };
      const campaign = store.giveaways.campaignsById.get(context.giveaway.id);
      const drawId = campaign?.draws[0]?.id;
      const source = campaign?.awards.find((award) => !award.drawId && award.isCurrent);
      if (!campaign || !drawId || !source) throw new Error("TEST_RECOVERY_CLOSE_SETUP_MISSING");
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, drawId);
      source.claimDeadlineAt = new Date(Date.now() - 1_000).toISOString();

      await backend.advanceScheduledGiveawayLifecycle(new Date());
      await expect(
        backend.recoverExpiredDirectGiveawayAward(context.organizer.sessionToken, {
          awardId: source.id,
          reason: "No eligible replacement remains in the frozen candidate set",
          claimDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      ).resolves.toEqual({ awardId: null });
      await expect(
        backend.completeGiveawayClaims(context.organizer.sessionToken, context.giveaway.id),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });

      await expect(
        backend.settleGiveawayAward(
          context.organizer.sessionToken,
          source.id,
          "No frozen candidate remains; close the recovery source permanently.",
        ),
      ).resolves.toEqual({ id: source.id });
      expect(source.recoveryClosedAt).toEqual(expect.any(String));
      expect(campaign.auditEvents.at(-1)).toMatchObject({
        action: "GIVEAWAY_AWARD_SETTLED",
        payload: expect.objectContaining({ recoveryClosed: true }),
      });
      await expect(
        backend.recoverExpiredDirectGiveawayAward(context.organizer.sessionToken, {
          awardId: source.id,
          reason: "This irreversible source must not be reopened",
          claimDeadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
      await expect(
        backend.completeGiveawayClaims(context.organizer.sessionToken, context.giveaway.id),
      ).resolves.toEqual({ completed: true });
    } finally {
      if (previousKey === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousKey;
    }
  });

  test("does not complete past an unclosed pre-deadline direct source", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now, { directPrize: true });
    const rider = context.rider;
    await backend.registerForEvent(rider.sessionToken, context.event.id, {
      status: "going",
      attendanceType: "direct",
    });
    const previousKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");

    try {
      await backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000));
      const store = backend as unknown as {
        giveaways: {
          campaignsById: Map<
            string,
            {
              draws: Array<{ id: string }>;
              awards: Array<{ id: string; drawId?: string; isCurrent: boolean }>;
            }
          >;
        };
      };
      const campaign = store.giveaways.campaignsById.get(context.giveaway.id);
      const drawId = campaign?.draws[0]?.id;
      const source = campaign?.awards.find((award) => !award.drawId && award.isCurrent);
      if (!drawId || !source) throw new Error("TEST_PREDEADLINE_SOURCE_SETUP_MISSING");
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, drawId);
      await backend.declineGiveawayAward(rider.sessionToken, source.id, "I must decline before the claim window closes.");

      await expect(
        backend.completeGiveawayClaims(context.organizer.sessionToken, context.giveaway.id),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
      await backend.settleGiveawayAward(
        context.organizer.sessionToken,
        source.id,
        "No eligible replacement is available; settle this direct source.",
      );
      await expect(
        backend.completeGiveawayClaims(context.organizer.sessionToken, context.giveaway.id),
      ).resolves.toEqual({ completed: true });
    } finally {
      if (previousKey === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousKey;
    }
  });

  test("links and closes a source when a normal direct decline auto-reallocates it", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now, {
      directPrize: true,
      directAwardMode: "guaranteed",
      winnerTotal: 1,
    });
    const firstRider = context.rider;
    const secondRider = await backend.signUpRider({
      displayName: "Automatic replacement rider",
      email: "automatic-replacement@example.com",
      password: "password123",
      area: "Antipolo",
    });
    for (const rider of [firstRider, secondRider]) {
      await backend.registerForEvent(rider.sessionToken, context.event.id, {
        status: "going",
        attendanceType: "direct",
      });
    }
    const previousKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");

    try {
      await backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000));
      const store = backend as unknown as {
        giveaways: {
          campaignsById: Map<
            string,
            {
              draws: Array<{ id: string }>;
              awards: Array<{
                id: string;
                winnerUserId: string;
                drawId?: string;
                isCurrent: boolean;
                status: string;
                recoveryClosedAt?: string;
                recoverySourceAwardId?: string;
              }>;
            }
          >;
        };
      };
      const campaign = store.giveaways.campaignsById.get(context.giveaway.id);
      const drawId = campaign?.draws[0]?.id;
      const source = campaign?.awards.find((award) => !award.drawId && award.isCurrent);
      if (!campaign || !drawId || !source) throw new Error("TEST_AUTOMATIC_LINK_SETUP_MISSING");
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, drawId);
      const winner = source.winnerUserId === firstRider.user.id ? firstRider : secondRider;

      await backend.declineGiveawayAward(winner.sessionToken, source.id, "I cannot accept this prize.");
      const replacement = campaign.awards.find((award) => award.recoverySourceAwardId === source.id);
      expect(source.recoveryClosedAt).toEqual(expect.any(String));
      expect(replacement).toMatchObject({
        isCurrent: true,
        recoverySourceAwardId: source.id,
      });
    } finally {
      if (previousKey === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousKey;
    }
  });

  test("recovers exactly one expired direct-award slot even when extra inventory is free", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now, {
      directPrize: true,
      directItemCount: 2,
      winnerTotal: 4,
    });
    const rider = context.rider;
    const extraRiders = await Promise.all(
      ["slot-one", "slot-two", "slot-three"].map((suffix) =>
        backend.signUpRider({
          displayName: `Recovery ${suffix}`,
          email: `recovery-${suffix}@example.com`,
          password: "password123",
          area: "Antipolo",
        }),
      ),
    );
    for (const candidate of [rider, ...extraRiders]) {
      await backend.registerForEvent(candidate.sessionToken, context.event.id, {
        status: "going",
        attendanceType: "direct",
      });
    }
    const previousKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

    try {
      await backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000));
      const store = backend as unknown as {
        giveaways: {
          campaignsById: Map<
            string,
            {
              draws: Array<{ id: string }>;
              awards: Array<{
                id: string;
                prizePoolId: string;
                prizeItemId?: string;
                drawId?: string;
                isCurrent: boolean;
                status: string;
                claimDeadlineAt?: string;
              }>;
              prizePools: Array<{
                id: string;
                items: Array<{ id: string; title: string; status: string; position: number }>;
              }>;
            }
          >;
        };
      };
      const campaign = store.giveaways.campaignsById.get(context.giveaway.id);
      const drawId = campaign?.draws[0]?.id;
      const source = campaign?.awards.find((award) => !award.drawId && award.isCurrent);
      const pool = campaign?.prizePools.find((candidate) => candidate.id === source?.prizePoolId);
      if (!campaign || !drawId || !source || !pool || !source.prizeItemId) {
        throw new Error("TEST_SLOT_RECOVERY_SETUP_MISSING");
      }
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, drawId);
      const sourceItem = pool.items.find((item) => item.id === source.prizeItemId);
      if (!sourceItem) throw new Error("TEST_SOURCE_ITEM_MISSING");
      source.isCurrent = false;
      source.status = "expired";
      source.claimDeadlineAt = new Date(Date.now() - 1_000).toISOString();
      sourceItem.status = "available";
      pool.items.push({
        id: "unrelated-free-slot",
        title: "Unrelated free slot",
        status: "available",
        position: 99,
      });

      const before = campaign.awards.filter((award) => award.isCurrent).length;
      await expect(
        backend.recoverExpiredDirectGiveawayAward(context.organizer.sessionToken, {
          awardId: source.id,
          reason: "Re-offer only this released prize",
          claimDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      ).resolves.toMatchObject({ awardId: expect.any(String) });
      expect(campaign.awards.filter((award) => award.isCurrent)).toHaveLength(before + 1);
      expect(pool.items.find((item) => item.id === "unrelated-free-slot")?.status).toBe("available");
    } finally {
      if (previousKey === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousKey;
    }
  });

  test("consumes an unlimited guaranteed recovery source exactly once", async () => {
    const backend = asLifecycleBackend(await createTambikeTestBackend());
    const now = new Date(Date.now() + 60_000);
    const context = await createScheduledCampaign(backend, now, {
      directPrize: true,
      directAwardMode: "guaranteed",
      winnerTotal: 2,
    });
    const initialRider = context.rider;
    const extraRiders = await Promise.all(
      ["unlimited-one", "unlimited-two", "unlimited-three"].map((suffix) =>
        backend.signUpRider({
          displayName: `Unlimited recovery ${suffix}`,
          email: `unlimited-${suffix}@example.com`,
          password: "password123",
          area: "Antipolo",
        }),
      ),
    );
    for (const rider of [initialRider, ...extraRiders]) {
      await backend.registerForEvent(rider.sessionToken, context.event.id, {
        status: "going",
        attendanceType: "direct",
      });
    }
    const previousKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64");

    try {
      await backend.advanceScheduledGiveawayLifecycle(new Date(now.getTime() + 300_000));
      const store = backend as unknown as {
        giveaways: {
          campaignsById: Map<
            string,
            {
              draws: Array<{ id: string }>;
              awards: Array<{
                id: string;
                drawId?: string;
                isCurrent: boolean;
                status: string;
                claimDeadlineAt?: string;
                recoveryClosedAt?: string;
                recoverySourceAwardId?: string;
              }>;
            }
          >;
        };
      };
      const campaign = store.giveaways.campaignsById.get(context.giveaway.id);
      const drawId = campaign?.draws[0]?.id;
      const source = campaign?.awards.find((award) => !award.drawId && award.isCurrent);
      if (!campaign || !drawId || !source) throw new Error("TEST_UNLIMITED_RECOVERY_SETUP_MISSING");
      await backend.publishGiveawayDraw(context.organizer.sessionToken, context.giveaway.id, drawId);
      source.isCurrent = false;
      source.status = "expired";
      source.claimDeadlineAt = new Date(Date.now() - 1_000).toISOString();

      const firstRecovery = await backend.recoverExpiredDirectGiveawayAward(
        context.organizer.sessionToken,
        {
          awardId: source.id,
          reason: "Re-offer this one unlimited recovery slot",
          claimDeadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      );
      if (!firstRecovery.awardId) throw new Error("TEST_UNLIMITED_RECOVERY_MISSING");
      const replacement = campaign.awards.find((award) => award.id === firstRecovery.awardId);
      const otherCurrentAward = campaign.awards.find(
        (award) => award.id !== firstRecovery.awardId && award.id !== source.id && award.isCurrent,
      );
      if (!replacement || !otherCurrentAward) throw new Error("TEST_UNLIMITED_RECOVERY_AWARD_MISSING");
      expect(source.recoveryClosedAt).toEqual(expect.any(String));
      expect(replacement.recoverySourceAwardId).toBe(source.id);

      // Make campaign capacity available again. A missing source-resolution
      // guard would now use the fourth rider to issue a second award from the
      // same unlimited source because no finite item can block it.
      otherCurrentAward.isCurrent = false;
      otherCurrentAward.status = "fulfilled";
      const currentBeforeRetry = campaign.awards.filter((award) => award.isCurrent).length;
      await expect(
        backend.recoverExpiredDirectGiveawayAward(context.organizer.sessionToken, {
          awardId: source.id,
          reason: "This source was already consumed by the first recovery",
          claimDeadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
      expect(campaign.awards.filter((award) => award.isCurrent)).toHaveLength(currentBeforeRetry);
    } finally {
      if (previousKey === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousKey;
    }
  });
});
