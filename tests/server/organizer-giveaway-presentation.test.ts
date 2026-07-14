import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";

type TestBackend = Awaited<ReturnType<typeof createTambikeTestBackend>>;

type InternalPrizeItem = {
  id: string;
  position: number;
  title: string;
  description?: string;
  status: "available" | "reserved" | "fulfilled" | "voided";
};

type InternalPrizePool = {
  id: string;
  position: number;
  title: string;
  awardMode: "random_draw" | "first_come" | "guaranteed" | "manual_selection";
  fulfilmentMode: "onsite" | "digital_code" | "delivery" | "manual_contact";
  inventoryKind: "finite" | "unlimited";
  inventoryLimit?: number;
  perRiderLimit?: number;
  presenceVerificationRequired: boolean;
  eligibilityGroupIds: string[];
  items: InternalPrizeItem[];
};

type InternalDraw = {
  id: string;
  snapshotId: string;
  sequence: number;
  type: "initial" | "redraw";
  status: "completed" | "published" | "pending";
  idempotencyKey: string;
  algorithmVersion: "hmac-sha256-v1" | "manual-selection-v1";
  inputDigest: string;
  resultDigest: string;
  initiatedByUserId: string;
  completedAt: string;
  awardIds: string[];
};

type InternalAward = {
  id: string;
  entryId: string;
  drawId?: string;
  prizePoolId: string;
  prizeItemId?: string;
  snapshotEntryId?: string;
  winnerUserId: string;
  status: string;
  isCurrent: boolean;
  opaqueClaimReference: string;
  claimTokenVersion: number;
  createdAt: string;
  updatedAt: string;
};

type InternalGiveaway = {
  id: string;
  title: string;
  snapshot?: {
    id: string;
    entries: ReadonlyArray<{
      id: string;
      entryId: string;
      riderId: string;
      opaquePublicReference: string;
      presentationLabel?: string;
    }>;
  };
  prizePools: InternalPrizePool[];
  draws: InternalDraw[];
  awards: InternalAward[];
};

type InternalStore = {
  campaignsById: Map<string, InternalGiveaway>;
  drawsById: Map<string, InternalDraw>;
  awardsById: Map<string, InternalAward>;
  prizePoolsById: Map<string, InternalPrizePool>;
  prizeItemsById: Map<string, InternalPrizeItem>;
};

const previousEncryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 83).toString("base64");
});

afterAll(() => {
  if (previousEncryptionKey === undefined) {
    delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
  } else {
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

function giveawayInput(eventId: string, title: string): CreateGiveawayInput {
  return {
    eventId,
    title,
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 5,
    mechanics: "Each eligible synthetic rider receives one entry.",
    terms: "Synthetic presentation test terms.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 2 },
    organizerAttestation: true,
    publicVisibility: "hidden",
    eligibilityGroups: [
      {
        id: "active-pass",
        label: "Active RSVP and pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "random-prize",
        title: "Synthetic helmet pool",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 2 },
        items: [{ title: "Helmet A" }, { title: "Helmet B" }],
      },
    ],
  };
}

async function createCompletedCampaign(input: {
  backend: TestBackend;
  organizerToken: string;
  adminToken: string;
  eventId: string;
  title: string;
  idempotencyKey: string;
}) {
  const created = await input.backend.createGiveaway(
    input.organizerToken,
    input.eventId,
    giveawayInput(input.eventId, input.title),
  );
  await input.backend.submitGiveawayForReview(input.organizerToken, created.id);
  await input.backend.reviewGiveawayCompliance(input.adminToken, created.id, {
    decision: "approved",
  });
  await input.backend.openGiveaway(input.organizerToken, created.id);
  await input.backend.lockGiveaway(input.organizerToken, created.id);
  const draw = await input.backend.runGiveawayDraw(input.organizerToken, {
    giveawayId: created.id,
    idempotencyKey: input.idempotencyKey,
  });
  return { giveawayId: created.id, drawId: draw.drawId };
}

async function createScenario(options: { withRiders?: boolean } = {}) {
  const backend = await createTambikeTestBackend();
  const [organizer, admin, venue, primaryRider] = await Promise.all([
    backend.loginWithPassword("marco.organizer@example.com", "password123"),
    backend.loginWithPassword("admin@bayanko.ph", "secret_123"),
    backend.loginWithPassword("ana.venue@example.com", "password123"),
    backend.loginWithPassword("mina.rider@example.com", "password123"),
  ]);
  const secondRider = await backend.signUpRider({
    displayName: "Historical Legacy Rider",
    email: "presentation-legacy-rider@example.test",
    password: "password123",
    area: "Antipolo",
  });
  const event = await backend.createEventDraft(organizer.sessionToken, {
    title: "Organizer presentation test event",
    type: "Bike Night",
    venueId: "shell-pugon",
    date: "August 15, 2030",
    time: "7:00 PM - 10:00 PM",
    area: "Antipolo",
    expectedRiders: 2,
    perkPreview: "Synthetic giveaway",
  });
  await backend.approveVenueWithConditions(venue.sessionToken, event.id, "Synthetic approval");
  await backend.approvePublish(admin.sessionToken, event.id);

  if (options.withRiders !== false) {
    for (const rider of [primaryRider, secondRider]) {
      await backend.registerForEvent(rider.sessionToken, event.id, {
        status: "going",
        attendanceType: "direct",
      });
    }
  }

  const created = await backend.createGiveaway(
    organizer.sessionToken,
    event.id,
    giveawayInput(event.id, "Organizer-safe live raffle"),
  );
  await backend.submitGiveawayForReview(organizer.sessionToken, created.id);
  await backend.reviewGiveawayCompliance(admin.sessionToken, created.id, {
    decision: "approved",
  });
  await backend.openGiveaway(organizer.sessionToken, created.id);
  if (options.withRiders !== false) {
    await backend.setGiveawayLivePresentationPreference(
      primaryRider.sessionToken,
      created.id,
      true,
    );
  }
  await backend.lockGiveaway(organizer.sessionToken, created.id);
  const draw = await backend.runGiveawayDraw(organizer.sessionToken, {
    giveawayId: created.id,
    idempotencyKey: "organizer-presentation-initial",
  });

  return {
    backend,
    organizer,
    admin,
    venue,
    primaryRider,
    secondRider,
    eventId: event.id,
    giveawayId: created.id,
    drawId: draw.drawId,
  };
}

function internalStore(backend: TestBackend) {
  return (backend as unknown as { giveaways: InternalStore }).giveaways;
}

describe("organizer giveaway presentation read", () => {
  test("requires a giveaway configurator and binds the draw to the requested giveaway", async () => {
    const scenario = await createScenario();

    await expect(
      scenario.backend.getOrganizerGiveawayPresentation(
        "not-a-session",
        scenario.giveawayId,
        scenario.drawId,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    for (const sessionToken of [
      scenario.primaryRider.sessionToken,
      scenario.venue.sessionToken,
    ]) {
      await expect(
        scenario.backend.getOrganizerGiveawayPresentation(
          sessionToken,
          scenario.giveawayId,
          scenario.drawId,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      scenario.backend.getOrganizerGiveawayPresentation(
        scenario.organizer.sessionToken,
        scenario.giveawayId,
        "missing-draw",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const other = await createCompletedCampaign({
      backend: scenario.backend,
      organizerToken: scenario.organizer.sessionToken,
      adminToken: scenario.admin.sessionToken,
      eventId: scenario.eventId,
      title: "Other giveaway",
      idempotencyKey: "other-initial-draw",
    });
    await expect(
      scenario.backend.getOrganizerGiveawayPresentation(
        scenario.organizer.sessionToken,
        scenario.giveawayId,
        other.drawId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      scenario.backend.getOrganizerGiveawayPresentation(
        scenario.organizer.sessionToken,
        other.giveawayId,
        scenario.drawId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("fails closed for the wrong snapshot, draw type, algorithm, status, or empty digest", async () => {
    const scenario = await createScenario();
    const giveaway = internalStore(scenario.backend).campaignsById.get(scenario.giveawayId)!;
    const draw = giveaway.draws.find((candidate) => candidate.id === scenario.drawId)!;
    const original = { ...draw };
    const invalidPatches: Array<Partial<InternalDraw>> = [
      { snapshotId: "wrong-snapshot" },
      { type: "redraw" },
      { algorithmVersion: "manual-selection-v1" },
      { status: "pending" },
      { resultDigest: "" },
      { resultDigest: "   " },
    ];

    for (const patch of invalidPatches) {
      Object.assign(draw, original, patch);
      await expect(
        scenario.backend.getOrganizerGiveawayPresentation(
          scenario.organizer.sessionToken,
          scenario.giveawayId,
          scenario.drawId,
        ),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
    }
    Object.assign(draw, original);
  });

  test("replays completed and published presentations with exact safe output keys", async () => {
    const scenario = await createScenario();
    const first = await scenario.backend.getOrganizerGiveawayPresentation(
      scenario.organizer.sessionToken,
      scenario.giveawayId,
      scenario.drawId,
    );
    const reloaded = await scenario.backend.getOrganizerGiveawayPresentation(
      scenario.organizer.sessionToken,
      scenario.giveawayId,
      scenario.drawId,
    );

    expect(reloaded).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(
      [
        "candidateCount",
        "drawId",
        "drawStatus",
        "eventId",
        "giveawayId",
        "giveawayTitle",
        "labelBank",
        "resultDigest",
        "slides",
      ].sort(),
    );
    expect(first.drawStatus).toBe("completed");
    expect(first.candidateCount).toBe(2);
    expect(first.labelBank).toHaveLength(2);
    expect(first.labelBank).toEqual(
      expect.arrayContaining(["Mina R.", expect.stringMatching(/^Rider [0-9A-F]{4,8}$/)]),
    );
    expect(first.slides).toHaveLength(2);
    for (const slide of first.slides) {
      expect(Object.keys(slide).sort()).toEqual(
        ["position", "prizeItemTitle", "prizePoolTitle", "winnerLabel"].sort(),
      );
    }

    await scenario.backend.publishGiveawayDraw(
      scenario.organizer.sessionToken,
      scenario.giveawayId,
      scenario.drawId,
    );
    const published = await scenario.backend.getOrganizerGiveawayPresentation(
      scenario.organizer.sessionToken,
      scenario.giveawayId,
      scenario.drawId,
    );
    expect(published).toEqual({ ...first, drawStatus: "published" });
  });

  test("returns only exact-draw random awards and does not invent a winner for an empty draw", async () => {
    const scenario = await createScenario();
    const store = internalStore(scenario.backend);
    const giveaway = store.campaignsById.get(scenario.giveawayId)!;
    const draw = giveaway.draws.find((candidate) => candidate.id === scenario.drawId)!;
    const randomPool = giveaway.prizePools[0];
    const randomAward = giveaway.awards[0];
    const manualItem: InternalPrizeItem = {
      ...randomPool.items[0],
      id: "presentation-manual-item",
      title: "Manual item must not render",
    };
    const manualPool: InternalPrizePool = {
      ...randomPool,
      id: "presentation-manual-pool",
      position: -1,
      title: "Manual pool must not render",
      awardMode: "manual_selection",
      items: [manualItem],
    };
    const manualAward: InternalAward = {
      ...randomAward,
      id: "presentation-manual-award",
      prizePoolId: manualPool.id,
      prizeItemId: manualItem.id,
    };
    const redraw: InternalDraw = {
      ...draw,
      id: "presentation-redraw",
      sequence: draw.sequence + 1,
      type: "redraw",
      idempotencyKey: "presentation-redraw",
      awardIds: ["presentation-redraw-award"],
    };
    const redrawAward: InternalAward = {
      ...randomAward,
      id: "presentation-redraw-award",
      drawId: redraw.id,
    };
    giveaway.prizePools.push(manualPool);
    giveaway.draws.push(redraw);
    giveaway.awards.push(manualAward, redrawAward);
    store.prizePoolsById.set(manualPool.id, manualPool);
    store.prizeItemsById.set(manualItem.id, manualItem);
    store.drawsById.set(redraw.id, redraw);
    store.awardsById.set(manualAward.id, manualAward);
    store.awardsById.set(redrawAward.id, redrawAward);

    const presentation = await scenario.backend.getOrganizerGiveawayPresentation(
      scenario.organizer.sessionToken,
      scenario.giveawayId,
      scenario.drawId,
    );
    expect(presentation.slides).toHaveLength(draw.awardIds.length);
    expect(JSON.stringify(presentation.slides)).not.toContain("Manual");

    const empty = await createScenario({ withRiders: false });
    const emptyPresentation = await empty.backend.getOrganizerGiveawayPresentation(
      empty.organizer.sessionToken,
      empty.giveawayId,
      empty.drawId,
    );
    expect(emptyPresentation.candidateCount).toBe(0);
    expect(emptyPresentation.labelBank).toEqual([]);
    expect(emptyPresentation.slides).toEqual([]);
  });
});
