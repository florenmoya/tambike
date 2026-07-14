import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
  parseGiveawayPresentationControllerStateMessage,
} from "../../src/features/giveaways/giveaway-presentation-channel";
import { buildOrganizerGiveawayPresentation } from "../../src/server/giveaways/presentation";

function source(overrides: Record<string, unknown> = {}) {
  return {
    giveawayId: "giveaway-a",
    eventId: "event-a",
    giveawayTitle: "Safe presentation",
    draw: {
      id: "draw-a",
      snapshotId: "snapshot-a",
      type: "initial",
      status: "completed",
      algorithmVersion: "hmac-sha256-v1",
      resultDigest: "result-digest-a",
    },
    snapshot: {
      id: "snapshot-a",
      giveawayId: "giveaway-a",
      candidateCount: 0,
      entries: [],
    },
    prizePools: [],
    awards: [],
    ...overrides,
  };
}

describe("organizer giveaway presentation model", () => {
  test("makes historical persisted titles safe and sendable without leaking truncated data", () => {
    const forbiddenTail = "riderId=private-rider-after-the-channel-cap";
    const entry = {
      id: "snapshot-entry-a",
      giveawayId: "giveaway-a",
      entryId: "entry-a",
      riderId: "rider-a",
      opaquePublicReference: "opaque-a",
      presentationLabel: "Rider SAFE",
    };
    const presentation = buildOrganizerGiveawayPresentation(
      source({
        giveawayTitle: `Night\u0000 ride\u202e ${"G".repeat(600)}${forbiddenTail}`,
        draw: {
          id: "draw-a",
          snapshotId: "snapshot-a",
          type: "initial",
          status: "completed",
          algorithmVersion: "hmac-sha256-v1",
          resultDigest: "a".repeat(64),
        },
        snapshot: {
          id: "snapshot-a",
          giveawayId: "giveaway-a",
          candidateCount: 1,
          entries: [entry],
        },
        prizePools: [
          {
            id: "pool-a",
            position: 0,
            title: `Helmet\u0007 pool ${"P".repeat(600)}${forbiddenTail}`,
            awardMode: "random_draw",
            items: [
              {
                id: "item-a",
                position: 0,
                title: `${"\u0000\u200b".repeat(300)}`,
              },
            ],
          },
        ],
        awards: [
          {
            id: "award-a",
            giveawayId: "giveaway-a",
            drawId: "draw-a",
            entryId: "entry-a",
            winnerUserId: "rider-a",
            snapshotEntryId: "snapshot-entry-a",
            prizePoolId: "pool-a",
            prizeItemId: "item-a",
          },
        ],
      }),
    );
    const slide = presentation.slides[0]!;
    for (const title of [
      presentation.giveawayTitle,
      slide.prizePoolTitle,
      slide.prizeItemTitle,
    ]) {
      expect(title.trim()).not.toBe("");
      expect(Array.from(title).length).toBeLessThanOrEqual(500);
      expect(title).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      expect(title).not.toContain(forbiddenTail);
    }

    const channelId = "123e4567-e89b-42d3-a456-426614174000";
    const message = {
      version: GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
      type: "controller-state" as const,
      channelId,
      eventId: presentation.eventId,
      giveawayId: presentation.giveawayId,
      drawId: presentation.drawId,
      resultDigest: presentation.resultDigest,
      state: { phase: "ready" as const, slideIndex: 0, mode: "normal" as const, soundEnabled: false },
      presentation,
    };
    expect(
      parseGiveawayPresentationControllerStateMessage(message, {
        channelId,
        eventId: presentation.eventId,
        giveawayId: presentation.giveawayId,
        drawId: presentation.drawId,
        resultDigest: presentation.resultDigest,
      }),
    ).toEqual(message);
    expect(slide.prizeItemTitle).toBe("Prize");
    expect(JSON.stringify(presentation)).not.toContain(forbiddenTail);
    expect(JSON.stringify(presentation)).not.toContain("rider-a");
  });

  test("samples a deterministic label bank by digest and caps it at 24 labels", () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      id: `snapshot-entry-${index.toString().padStart(2, "0")}`,
      giveawayId: "giveaway-a",
      entryId: `entry-${index}`,
      riderId: `rider-${index}`,
      opaquePublicReference: `opaque-${index}`,
      presentationLabel: `Safe label ${index}`,
    }));
    const input = source({
      snapshot: {
        id: "snapshot-a",
        giveawayId: "giveaway-a",
        candidateCount: entries.length,
        entries,
      },
    });

    const first = buildOrganizerGiveawayPresentation(input);
    const second = buildOrganizerGiveawayPresentation(input);
    const expected = entries
      .map((entry) => ({
        label: entry.presentationLabel,
        sortKey: createHash("sha256")
          .update(`result-digest-a:${entry.id}`)
          .digest("hex")
          .toLowerCase(),
      }))
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .slice(0, 24)
      .map((entry) => entry.label);

    expect(first.labelBank).toEqual(expected);
    expect(first.labelBank).toHaveLength(24);
    expect(second.labelBank).toEqual(first.labelBank);
  });

  test("derives historical null labels as snapshot-wide masked labels without using rider names", () => {
    const entries = [
      {
        id: "snapshot-entry-a",
        giveawayId: "giveaway-a",
        entryId: "entry-a",
        riderId: "rider-a",
        opaquePublicReference: "ref-131",
        presentationLabel: null,
      },
      {
        id: "snapshot-entry-b",
        giveawayId: "giveaway-a",
        entryId: "entry-b",
        riderId: "rider-b",
        opaquePublicReference: "ref-342",
        presentationLabel: "Frozen B.",
      },
    ];
    const presentation = buildOrganizerGiveawayPresentation(
      source({
        snapshot: {
          id: "snapshot-a",
          giveawayId: "giveaway-a",
          candidateCount: entries.length,
          entries,
        },
        prizePools: [
          {
            id: "pool-a",
            position: 0,
            title: "Helmet",
            awardMode: "random_draw",
            items: [{ id: "item-a", position: 0, title: "Helmet A" }],
          },
        ],
        awards: [
          {
            id: "award-a",
            giveawayId: "giveaway-a",
            drawId: "draw-a",
            entryId: "entry-a",
            winnerUserId: "rider-a",
            snapshotEntryId: "snapshot-entry-a",
            prizePoolId: "pool-a",
            prizeItemId: "item-a",
          },
        ],
      }),
    );

    expect(presentation.labelBank).toEqual(
      expect.arrayContaining(["Rider 443630", "Frozen B."]),
    );
    expect(presentation.slides).toEqual([
      {
        position: 1,
        prizePoolTitle: "Helmet",
        prizeItemTitle: "Helmet A",
        winnerLabel: "Rider 443630",
      },
    ]);
    expect(JSON.stringify(presentation)).not.toContain("rider-a");
  });

  test("orders random-draw slides by pool, item, and stable award id while excluding other modes", () => {
    const entries = ["a", "b", "c", "d", "manual"].map((suffix) => ({
      id: `snapshot-${suffix}`,
      giveawayId: "giveaway-a",
      entryId: `entry-${suffix}`,
      riderId: `rider-${suffix}`,
      opaquePublicReference: `opaque-${suffix}`,
      presentationLabel: `Winner ${suffix.toUpperCase()}`,
    }));
    const presentation = buildOrganizerGiveawayPresentation(
      source({
        snapshot: {
          id: "snapshot-a",
          giveawayId: "giveaway-a",
          candidateCount: entries.length,
          entries,
        },
        prizePools: [
          {
            id: "pool-later",
            position: 5,
            title: "Later pool",
            awardMode: "random_draw",
            items: [{ id: "item-later", position: 0, title: "Later item" }],
          },
          {
            id: "pool-first",
            position: 1,
            title: "First pool",
            awardMode: "random_draw",
            items: [
              { id: "item-second", position: 3, title: "Second item" },
              { id: "item-first", position: 0, title: "First item" },
            ],
          },
          {
            id: "pool-manual",
            position: 0,
            title: "Manual pool",
            awardMode: "manual_selection",
            items: [{ id: "item-manual", position: 0, title: "Manual item" }],
          },
        ],
        awards: [
          {
            id: "award-later",
            giveawayId: "giveaway-a",
            drawId: "draw-a",
            entryId: "entry-d",
            winnerUserId: "rider-d",
            snapshotEntryId: "snapshot-d",
            prizePoolId: "pool-later",
            prizeItemId: "item-later",
          },
          {
            id: "award-z",
            giveawayId: "giveaway-a",
            drawId: "draw-a",
            entryId: "entry-b",
            winnerUserId: "rider-b",
            snapshotEntryId: "snapshot-b",
            prizePoolId: "pool-first",
            prizeItemId: "item-first",
          },
          {
            id: "award-second",
            giveawayId: "giveaway-a",
            drawId: "draw-a",
            entryId: "entry-c",
            winnerUserId: "rider-c",
            snapshotEntryId: "snapshot-c",
            prizePoolId: "pool-first",
            prizeItemId: "item-second",
          },
          {
            id: "award-a",
            giveawayId: "giveaway-a",
            drawId: "draw-a",
            entryId: "entry-a",
            winnerUserId: "rider-a",
            snapshotEntryId: "snapshot-a",
            prizePoolId: "pool-first",
            prizeItemId: "item-first",
          },
          {
            id: "award-manual",
            giveawayId: "giveaway-a",
            drawId: "draw-a",
            entryId: "entry-manual",
            winnerUserId: "rider-manual",
            snapshotEntryId: "snapshot-manual",
            prizePoolId: "pool-manual",
            prizeItemId: "item-manual",
          },
        ],
      }),
    );

    expect(presentation.slides).toEqual([
      {
        position: 1,
        prizePoolTitle: "First pool",
        prizeItemTitle: "First item",
        winnerLabel: "Winner A",
      },
      {
        position: 2,
        prizePoolTitle: "First pool",
        prizeItemTitle: "First item",
        winnerLabel: "Winner B",
      },
      {
        position: 3,
        prizePoolTitle: "First pool",
        prizeItemTitle: "Second item",
        winnerLabel: "Winner C",
      },
      {
        position: 4,
        prizePoolTitle: "Later pool",
        prizeItemTitle: "Later item",
        winnerLabel: "Winner D",
      },
    ]);
  });

  test("fails closed when an award or its frozen entry belongs to another giveaway", () => {
    const entry = {
      id: "snapshot-entry-a",
      giveawayId: "giveaway-a",
      entryId: "entry-a",
      riderId: "rider-a",
      opaquePublicReference: "opaque-a",
      presentationLabel: "Safe A.",
    };
    const award = {
      id: "award-a",
      giveawayId: "giveaway-a",
      drawId: "draw-a",
      entryId: "entry-a",
      winnerUserId: "rider-a",
      snapshotEntryId: "snapshot-entry-a",
      prizePoolId: "pool-a",
      prizeItemId: "item-a",
    };
    const base = {
      snapshot: {
        id: "snapshot-a",
        giveawayId: "giveaway-a",
        candidateCount: 1,
        entries: [entry],
      },
      prizePools: [
        {
          id: "pool-a",
          position: 0,
          title: "Helmet",
          awardMode: "random_draw",
          items: [{ id: "item-a", position: 0, title: "Helmet A" }],
        },
      ],
      awards: [award],
    };

    expect(() =>
      buildOrganizerGiveawayPresentation(
        source({ ...base, awards: [{ ...award, giveawayId: "giveaway-b" }] }),
      ),
    ).toThrowError("GIVEAWAY_AWARD_INVALID");
    expect(() =>
      buildOrganizerGiveawayPresentation(
        source({
          ...base,
          snapshot: {
            ...base.snapshot,
            entries: [{ ...entry, giveawayId: "giveaway-b" }],
          },
        }),
      ),
    ).toThrowError("GIVEAWAY_AWARD_INVALID");
    expect(() =>
      buildOrganizerGiveawayPresentation(
        source({
          ...base,
          snapshot: { ...base.snapshot, giveawayId: "giveaway-b" },
        }),
      ),
    ).toThrowError("INVALID_GIVEAWAY_STATE");
  });

  test("fails closed when the persisted candidate count does not match the snapshot", () => {
    expect(() =>
      buildOrganizerGiveawayPresentation(
        source({
          snapshot: {
            id: "snapshot-a",
            giveawayId: "giveaway-a",
            candidateCount: 2,
            entries: [
              {
                id: "snapshot-entry-a",
                giveawayId: "giveaway-a",
                entryId: "entry-a",
                riderId: "rider-a",
                opaquePublicReference: "opaque-a",
                presentationLabel: "Safe A.",
              },
            ],
          },
        }),
      ),
    ).toThrowError("INVALID_GIVEAWAY_STATE");
  });
});
