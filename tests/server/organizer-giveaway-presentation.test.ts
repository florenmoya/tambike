import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createPublishedTestEvent, createTestActors } from "./support/tambike-fixtures";

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

type InternalEntry = {
  id: string;
  riderId: string;
};

type InternalSnapshotEntry = {
  id: string;
  entryId: string;
  riderId: string;
  opaquePublicReference: string;
  presentationLabel?: string;
};

type InternalSnapshot = {
  id: string;
  entries: InternalSnapshotEntry[];
};

type InternalGiveaway = {
  id: string;
  title: string;
  entriesByRider: Map<string, InternalEntry>;
  snapshot?: InternalSnapshot;
  prizePools: InternalPrizePool[];
  draws: InternalDraw[];
  awards: InternalAward[];
};

type InternalStore = {
  campaignsById: Map<string, InternalGiveaway>;
  entriesById: Map<string, InternalEntry>;
  snapshotsById: Map<string, InternalSnapshot>;
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
        publicPresentation: {
          disclosure: "revealed",
          title: "Synthetic helmet pool",
        },
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
  const { organizer, admin, outsider, rider: primaryRider } = await createTestActors(
    backend,
    "organizer-giveaway-presentation",
  );
  const secondRider = await backend.signUpRider({
    displayName: "Historical Legacy Rider",
    email: "presentation-legacy-rider@example.test",
    password: "password123",
    area: "Antipolo",
  });
  const event = await createPublishedTestEvent(backend, { organizer, admin }, {
    title: "Organizer presentation test event",
    type: "Bike Night",
    startDate: "2030-08-15",
    startTime: "19:00",
    endDate: "2030-08-15",
    endTime: "22:00",
    locationName: "Organizer Presentation Grounds",
    locationAddress: "15 Presentation Avenue, Antipolo",
    locationMapLink: "https://maps.example.test/organizer-presentation-grounds",
    area: "Antipolo",
    expectedRiders: 2,
    perkPreview: "Synthetic giveaway",
  });

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
    outsider,
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
      scenario.outsider.sessionToken,
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
      expect.arrayContaining(["Fixture R.", expect.stringMatching(/^Rider [0-9A-F]{4,8}$/)]),
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
    const randomAwardCount = draw.awardIds.length;
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
    draw.awardIds.push(manualAward.id);
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
    expect(presentation.slides).toHaveLength(randomAwardCount);
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

  test("rejects a canonical snapshot and award rewired to a cross-campaign entry", async () => {
    const scenario = await createScenario();
    const other = await createCompletedCampaign({
      backend: scenario.backend,
      organizerToken: scenario.organizer.sessionToken,
      adminToken: scenario.admin.sessionToken,
      eventId: scenario.eventId,
      title: "Cross-campaign source",
      idempotencyKey: "cross-campaign-source-draw",
    });
    const store = internalStore(scenario.backend);
    const giveaway = store.campaignsById.get(scenario.giveawayId)!;
    const otherGiveaway = store.campaignsById.get(other.giveawayId)!;
    const originalSnapshot = giveaway.snapshot!;
    const originalAward = giveaway.awards.find((award) => award.drawId === scenario.drawId)!;
    const originalAwardIndex = giveaway.awards.indexOf(originalAward);
    const originalSnapshotEntry = originalSnapshot.entries.find(
      (entry) => entry.id === originalAward.snapshotEntryId,
    )!;
    const crossCampaignEntry = [...otherGiveaway.entriesByRider.values()].find(
      (entry) => entry.riderId !== originalAward.winnerUserId,
    )!;
    const corruptedSnapshotEntry = {
      ...originalSnapshotEntry,
      entryId: crossCampaignEntry.id,
      riderId: crossCampaignEntry.riderId,
    };
    const corruptedSnapshot = {
      ...originalSnapshot,
      entries: originalSnapshot.entries.map((entry) =>
        entry.id === corruptedSnapshotEntry.id ? corruptedSnapshotEntry : entry,
      ),
    };
    const corruptedAward = {
      ...originalAward,
      entryId: crossCampaignEntry.id,
      winnerUserId: crossCampaignEntry.riderId,
    };

    giveaway.snapshot = corruptedSnapshot;
    store.snapshotsById.set(corruptedSnapshot.id, corruptedSnapshot);
    giveaway.awards[originalAwardIndex] = corruptedAward;
    store.awardsById.set(corruptedAward.id, corruptedAward);
    try {
      await expect(
        scenario.backend.getOrganizerGiveawayPresentation(
          scenario.organizer.sessionToken,
          scenario.giveawayId,
          scenario.drawId,
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    } finally {
      giveaway.snapshot = originalSnapshot;
      store.snapshotsById.set(originalSnapshot.id, originalSnapshot);
      giveaway.awards[originalAwardIndex] = originalAward;
      store.awardsById.set(originalAward.id, originalAward);
    }
  });

  test.each(["draw", "snapshot", "award"] as const)(
    "rejects a mismatched canonical %s registry record",
    async (recordKind) => {
      const scenario = await createScenario();
      const store = internalStore(scenario.backend);
      const giveaway = store.campaignsById.get(scenario.giveawayId)!;
      const draw = giveaway.draws.find((candidate) => candidate.id === scenario.drawId)!;
      const snapshot = giveaway.snapshot!;
      const award = giveaway.awards.find((candidate) => candidate.drawId === draw.id)!;

      if (recordKind === "draw") store.drawsById.set(draw.id, { ...draw });
      if (recordKind === "snapshot") {
        store.snapshotsById.set(snapshot.id, { ...snapshot, entries: [...snapshot.entries] });
      }
      if (recordKind === "award") store.awardsById.set(award.id, { ...award });
      try {
        await expect(
          scenario.backend.getOrganizerGiveawayPresentation(
            scenario.organizer.sessionToken,
            scenario.giveawayId,
            scenario.drawId,
          ),
        ).rejects.toMatchObject({
          code: recordKind === "award" ? "GIVEAWAY_AWARD_INVALID" : "INVALID_GIVEAWAY_STATE",
        });
      } finally {
        store.drawsById.set(draw.id, draw);
        store.snapshotsById.set(snapshot.id, snapshot);
        store.awardsById.set(award.id, award);
      }
    },
  );

  test("rejects a draw that references a missing canonical award", async () => {
    const scenario = await createScenario();
    const store = internalStore(scenario.backend);
    const giveaway = store.campaignsById.get(scenario.giveawayId)!;
    const draw = giveaway.draws.find((candidate) => candidate.id === scenario.drawId)!;
    draw.awardIds.push("missing-canonical-award");
    try {
      await expect(
        scenario.backend.getOrganizerGiveawayPresentation(
          scenario.organizer.sessionToken,
          scenario.giveawayId,
          scenario.drawId,
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    } finally {
      draw.awardIds.pop();
    }
  });

  test("rejects an extra draw-linked award absent from draw awardIds", async () => {
    const scenario = await createScenario();
    const store = internalStore(scenario.backend);
    const giveaway = store.campaignsById.get(scenario.giveawayId)!;
    const sourceAward = giveaway.awards.find((award) => award.drawId === scenario.drawId)!;
    const extraAward: InternalAward = {
      ...sourceAward,
      id: "extra-unreferenced-draw-award",
      opaqueClaimReference: "extra-unreferenced-claim",
    };
    giveaway.awards.push(extraAward);
    store.awardsById.set(extraAward.id, extraAward);
    try {
      await expect(
        scenario.backend.getOrganizerGiveawayPresentation(
          scenario.organizer.sessionToken,
          scenario.giveawayId,
          scenario.drawId,
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    } finally {
      giveaway.awards.pop();
      store.awardsById.delete(extraAward.id);
    }
  });

  test("rejects an aggregate-only draw-linked award absent from the canonical map and draw awardIds", async () => {
    const scenario = await createScenario();
    const store = internalStore(scenario.backend);
    const giveaway = store.campaignsById.get(scenario.giveawayId)!;
    const sourceAward = giveaway.awards.find((award) => award.drawId === scenario.drawId)!;
    const extraAward: InternalAward = {
      ...sourceAward,
      id: "aggregate-only-unreferenced-draw-award",
      opaqueClaimReference: "aggregate-only-unreferenced-claim",
    };
    giveaway.awards.push(extraAward);
    try {
      await expect(
        scenario.backend.getOrganizerGiveawayPresentation(
          scenario.organizer.sessionToken,
          scenario.giveawayId,
          scenario.drawId,
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    } finally {
      giveaway.awards.pop();
    }
  });

  test("rejects a canonical foreign-campaign award carrying the requested draw id", async () => {
    const scenario = await createScenario();
    const other = await createCompletedCampaign({
      backend: scenario.backend,
      organizerToken: scenario.organizer.sessionToken,
      adminToken: scenario.admin.sessionToken,
      eventId: scenario.eventId,
      title: "Foreign award owner",
      idempotencyKey: "foreign-award-owner-draw",
    });
    const store = internalStore(scenario.backend);
    const otherGiveaway = store.campaignsById.get(other.giveawayId)!;
    const foreignAward = otherGiveaway.awards.find((award) => award.drawId === other.drawId)!;
    const originalDrawId = foreignAward.drawId;
    foreignAward.drawId = scenario.drawId;
    try {
      await expect(
        scenario.backend.getOrganizerGiveawayPresentation(
          scenario.organizer.sessionToken,
          scenario.giveawayId,
          scenario.drawId,
        ),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    } finally {
      foreignAward.drawId = originalDrawId;
    }
  });
});
