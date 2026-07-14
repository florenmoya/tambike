import { describe, expect, test, vi } from "vitest";

import type { CreateGiveawayInput } from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";

type TestBackend = Awaited<ReturnType<typeof createTambikeTestBackend>>;

type InternalGiveaway = {
  entriesByRider: Map<
    string,
    {
      id: string;
      riderId: string;
      opaquePublicReference: string;
    }
  >;
  snapshot?: {
    snapshotDigest: string;
    entries: ReadonlyArray<{
      id: string;
      entryId: string;
      frozenWeight: number;
      eligibilityCycleAt: string;
      qualifiedSourceFingerprint: string;
      qualifiedGroupIds: readonly string[];
      qualifiedEligibilityGroupTimings: ReadonlyArray<{ groupId: string; eligibleAt: string }>;
      rankSourceDigest: string;
      presentationLabel?: string;
      presentationLabelKind?: "consented_name" | "masked";
    }>;
  };
  draws: Array<{ inputDigest: string; resultDigest: string }>;
  awards: Array<{
    winnerUserId: string;
    prizePoolId: string;
    prizeItemId?: string;
    snapshotEntryId?: string;
    rank?: number;
    status: string;
    isCurrent: boolean;
  }>;
};

function createResettableUuidFactory() {
  let nextValue = 1;
  return {
    next: () => {
      const suffix = nextValue.toString(16).padStart(12, "0");
      nextValue += 1;
      return `00000000-0000-4000-8000-${suffix}`;
    },
    reset: (value: number) => {
      nextValue = value;
    },
  };
}

function giveawayInput(eventId: string): CreateGiveawayInput {
  return {
    eventId,
    title: "Deterministic presentation comparison",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 5,
    mechanics: "Each eligible rider receives one deterministic entry.",
    terms: "Synthetic deterministic comparison terms.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
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
        title: "Synthetic helmet",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Synthetic prize item" }],
      },
    ],
  };
}

async function createOpenScenario(backend: TestBackend) {
  const [organizer, admin, venue, primaryRider] = await Promise.all([
    backend.loginWithPassword("marco.organizer@example.com", "password123"),
    backend.loginWithPassword("admin@bayanko.ph", "secret_123"),
    backend.loginWithPassword("ana.venue@example.com", "password123"),
    backend.loginWithPassword("mina.rider@example.com", "password123"),
  ]);
  const secondRider = await backend.signUpRider({
    displayName: "Synthetic Second Rider",
    email: "synthetic-second-rider@example.test",
    password: "password123",
    area: "Antipolo",
  });
  const event = await backend.createEventDraft(organizer.sessionToken, {
    title: "Deterministic presentation comparison event",
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
  const created = await backend.createGiveaway(
    organizer.sessionToken,
    event.id,
    giveawayInput(event.id),
  );
  await backend.submitGiveawayForReview(organizer.sessionToken, created.id);
  await backend.reviewGiveawayCompliance(admin.sessionToken, created.id, {
    decision: "approved",
  });
  await backend.openGiveaway(organizer.sessionToken, created.id);
  for (const rider of [primaryRider, secondRider]) {
    await backend.registerForEvent(rider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
    });
  }
  return { backend, organizer, primaryRider, secondRider, giveawayId: created.id };
}

function internalGiveaway(backend: TestBackend, giveawayId: string) {
  const store = backend as unknown as {
    giveaways: { campaignsById: Map<string, InternalGiveaway> };
  };
  const giveaway = store.giveaways.campaignsById.get(giveawayId);
  if (!giveaway) throw new Error("TEST_GIVEAWAY_MISSING");
  return giveaway;
}

function normalizeOpaqueEntryReferences(scenario: Awaited<ReturnType<typeof createOpenScenario>>) {
  const giveaway = internalGiveaway(scenario.backend, scenario.giveawayId);
  [...giveaway.entriesByRider.values()]
    .sort((left, right) => left.riderId.localeCompare(right.riderId))
    .forEach((entry, index) => {
      entry.opaquePublicReference = `entry_synthetic_${index + 1}`;
    });
}

function frozenSelectionInputs(giveaway: InternalGiveaway) {
  if (!giveaway.snapshot) throw new Error("TEST_SNAPSHOT_MISSING");
  return giveaway.snapshot.entries.map((entry) => ({
    id: entry.id,
    entryId: entry.entryId,
    frozenWeight: entry.frozenWeight,
    eligibilityCycleAt: entry.eligibilityCycleAt,
    qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
    qualifiedGroupIds: entry.qualifiedGroupIds,
    qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
    rankSourceDigest: entry.rankSourceDigest,
  }));
}

function selectedResult(giveaway: InternalGiveaway) {
  return giveaway.awards.map((award) => ({
    winnerUserId: award.winnerUserId,
    prizePoolId: award.prizePoolId,
    prizeItemId: award.prizeItemId,
    snapshotEntryId: award.snapshotEntryId,
    rank: award.rank,
    status: award.status,
    isCurrent: award.isCurrent,
  }));
}

describe("live-raffle presentation contracts", () => {
  test("consent changes only frozen presentation labels, never selection inputs or the fixed-seed result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-08-15T10:00:00.000Z"));
    const previousEncryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 53).toString("base64");
    const seed = Buffer.alloc(32, 71);
    const baselineIds = createResettableUuidFactory();
    const consentedIds = createResettableUuidFactory();

    try {
      const baseline = await createOpenScenario(
        await createTambikeTestBackend({
          generateGiveawayDrawSeed: () => Buffer.from(seed),
          generateGiveawayUuid: baselineIds.next,
        }),
      );
      const consented = await createOpenScenario(
        await createTambikeTestBackend({
          generateGiveawayDrawSeed: () => Buffer.from(seed),
          generateGiveawayUuid: consentedIds.next,
        }),
      );
      expect(consented.giveawayId).toBe(baseline.giveawayId);
      expect(consented.primaryRider.user.id).toBe(baseline.primaryRider.user.id);
      expect(consented.secondRider.user.id).toBe(baseline.secondRider.user.id);

      normalizeOpaqueEntryReferences(baseline);
      normalizeOpaqueEntryReferences(consented);
      await consented.backend.setGiveawayLivePresentationPreference(
        consented.primaryRider.sessionToken,
        consented.giveawayId,
        true,
      );

      baselineIds.reset(10_000);
      consentedIds.reset(10_000);
      const [baselineLock, consentedLock] = await Promise.all([
        baseline.backend.lockGiveaway(baseline.organizer.sessionToken, baseline.giveawayId),
        consented.backend.lockGiveaway(consented.organizer.sessionToken, consented.giveawayId),
      ]);
      const baselineGiveaway = internalGiveaway(baseline.backend, baseline.giveawayId);
      const consentedGiveaway = internalGiveaway(consented.backend, consented.giveawayId);
      const primaryEntryId = baselineGiveaway.entriesByRider.get(baseline.primaryRider.user.id)?.id;
      expect(primaryEntryId).toBe(
        consentedGiveaway.entriesByRider.get(consented.primaryRider.user.id)?.id,
      );
      const baselinePrimaryFrozen = baselineGiveaway.snapshot?.entries.find(
        (entry) => entry.entryId === primaryEntryId,
      );
      const consentedPrimaryFrozen = consentedGiveaway.snapshot?.entries.find(
        (entry) => entry.entryId === primaryEntryId,
      );

      expect(baselinePrimaryFrozen?.presentationLabelKind).toBe("masked");
      expect(consentedPrimaryFrozen?.presentationLabelKind).toBe("consented_name");
      expect(consentedPrimaryFrozen?.presentationLabel).not.toBe(
        baselinePrimaryFrozen?.presentationLabel,
      );
      expect(frozenSelectionInputs(consentedGiveaway)).toEqual(
        frozenSelectionInputs(baselineGiveaway),
      );
      expect(consentedLock.snapshot.snapshotDigest).toBe(baselineLock.snapshot.snapshotDigest);

      const [baselineDraw, consentedDraw] = await Promise.all([
        baseline.backend.runGiveawayDraw(baseline.organizer.sessionToken, {
          giveawayId: baseline.giveawayId,
          idempotencyKey: "fixed-seed-draw",
        }),
        consented.backend.runGiveawayDraw(consented.organizer.sessionToken, {
          giveawayId: consented.giveawayId,
          idempotencyKey: "fixed-seed-draw",
        }),
      ]);

      expect(consentedDraw).toEqual(baselineDraw);
      expect(consentedGiveaway.draws).toEqual(baselineGiveaway.draws);
      expect(selectedResult(consentedGiveaway)).toEqual(selectedResult(baselineGiveaway));
      expect(selectedResult(baselineGiveaway)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      if (previousEncryptionKey === undefined) {
        delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
      } else {
        process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = previousEncryptionKey;
      }
    }
  });
});
