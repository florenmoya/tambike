import { describe, expect, test } from "vitest";

import type { OrganizerGiveawayPresentation } from "../../src/features/giveaways/types";
import {
  GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
  GIVEAWAY_PRESENTATION_HEARTBEAT_INTERVAL_MS,
  GIVEAWAY_PRESENTATION_STAGE_DISCONNECT_AFTER_MS,
  getGiveawayPresentationChannelName,
  isGiveawayPresentationStageDisconnected,
  parseGiveawayPresentationChannelName,
  parseGiveawayPresentationControllerStateMessage,
  parseGiveawayPresentationStageMessage,
} from "../../src/features/giveaways/giveaway-presentation-channel";

const channelId = "2b9ef419-8c5d-4b4d-84d2-6c0f5c5c6b73";
const presentation: OrganizerGiveawayPresentation = {
  giveawayId: "giveaway-opaque",
  eventId: "event-opaque",
  drawId: "draw-opaque",
  giveawayTitle: "Night ride raffle",
  drawStatus: "completed",
  resultDigest: "c".repeat(64),
  candidateCount: 2,
  labelBank: ["Mina R.", "Rider 7F4K"],
  slides: [
    {
      position: 1,
      prizePoolTitle: "Helmet pool",
      prizeItemTitle: "Helmet one",
      winnerLabel: "Rider 7F4K",
    },
  ],
};
const state = { phase: "ready", slideIndex: 0, mode: "normal", soundEnabled: false } as const;
const message = {
  version: GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
  type: "controller-state",
  channelId,
  eventId: presentation.eventId,
  giveawayId: presentation.giveawayId,
  drawId: presentation.drawId,
  resultDigest: presentation.resultDigest,
  state,
  presentation,
} as const;

describe("giveaway presentation BroadcastChannel protocol", () => {
  test("strictly builds and parses the versioned UUID channel name", () => {
    const name = `tambike:giveaway-presentation:v1:${channelId}`;
    expect(getGiveawayPresentationChannelName(channelId)).toBe(name);
    expect(parseGiveawayPresentationChannelName(name)).toBe(channelId);
    for (const invalid of [
      "",
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      "2b9ef4198c5d4b4d84d26c0f5c5c6b73",
      `tambike:giveaway-presentation:v2:${channelId}`,
    ]) {
      expect(() => getGiveawayPresentationChannelName(invalid)).toThrow("INVALID_PRESENTATION_CHANNEL");
      expect(parseGiveawayPresentationChannelName(invalid)).toBeNull();
    }
  });

  test("accepts only exact versioned ready and heartbeat messages for the expected channel", () => {
    for (const type of ["stage-ready", "stage-heartbeat"] as const) {
      const value = { version: 1, type, channelId };
      expect(parseGiveawayPresentationStageMessage(value, channelId)).toEqual(value);
      expect(parseGiveawayPresentationStageMessage({ ...value, version: 2 }, channelId)).toBeNull();
      expect(parseGiveawayPresentationStageMessage({ ...value, type: "winner" }, channelId)).toBeNull();
      expect(parseGiveawayPresentationStageMessage({ ...value, riderId: "leak" }, channelId)).toBeNull();
      expect(
        parseGiveawayPresentationStageMessage(value, "aa7117ad-00ad-4bb2-b37a-7af3ff5df98f"),
      ).toBeNull();
    }
  });

  test("accepts an exact full state snapshot and optional ephemeral fullscreen request", () => {
    const expected = {
      channelId,
      eventId: presentation.eventId,
      giveawayId: presentation.giveawayId,
      drawId: presentation.drawId,
      resultDigest: presentation.resultDigest,
    };
    expect(parseGiveawayPresentationControllerStateMessage(message, expected)).toEqual(message);
    expect(
      parseGiveawayPresentationControllerStateMessage(
        { ...message, fullscreenRequestId: 3 },
        expected,
      ),
    ).toEqual({ ...message, fullscreenRequestId: 3 });
    expect(
      parseGiveawayPresentationControllerStateMessage(
        { ...message, fullscreenRequestId: null },
        expected,
      ),
    ).toEqual({ ...message, fullscreenRequestId: null });
    for (const fullscreenRequestId of [-1, 1.5, "3"]) {
      expect(
        parseGiveawayPresentationControllerStateMessage(
          { ...message, fullscreenRequestId },
          expected,
        ),
      ).toBeNull();
    }
  });

  test("rejects wrong versions, identities, progress, indices, and non-sequential slides", () => {
    const expected = {
      channelId,
      eventId: presentation.eventId,
      giveawayId: presentation.giveawayId,
      drawId: presentation.drawId,
      resultDigest: presentation.resultDigest,
    };
    for (const invalid of [
      { ...message, version: 2 },
      { ...message, channelId: "aa7117ad-00ad-4bb2-b37a-7af3ff5df98f" },
      { ...message, eventId: "other-event" },
      { ...message, giveawayId: "other-giveaway" },
      { ...message, drawId: "other-draw" },
      { ...message, resultDigest: "d".repeat(64) },
      { ...message, state: { ...state, phase: "unknown" } },
      { ...message, state: { ...state, slideIndex: 1 } },
      {
        ...message,
        presentation: {
          ...presentation,
          slides: [{ ...presentation.slides[0], position: 2 }],
        },
      },
    ]) {
      expect(parseGiveawayPresentationControllerStateMessage(invalid, expected)).toBeNull();
    }
  });

  test("rejects payload/envelope mismatches and any extra sensitive DTO field", () => {
    const expected = { channelId, eventId: presentation.eventId, giveawayId: presentation.giveawayId };
    for (const invalid of [
      { ...message, presentation: { ...presentation, giveawayId: "other" } },
      { ...message, presentation: { ...presentation, drawId: "other" } },
      { ...message, presentation: { ...presentation, resultDigest: "e".repeat(64) } },
      { ...message, presentation: { ...presentation, riderId: "sensitive" } },
      {
        ...message,
        presentation: {
          ...presentation,
          slides: [{ ...presentation.slides[0], awardId: "sensitive" }],
        },
      },
      { ...message, seed: "sensitive" },
      { ...message, presentation: { ...presentation, labelBank: Array(25).fill("Rider 7F4K") } },
    ]) {
      expect(parseGiveawayPresentationControllerStateMessage(invalid, expected)).toBeNull();
    }
  });

  test("uses a 2-second heartbeat and marks the stage disconnected after 6 seconds", () => {
    expect(GIVEAWAY_PRESENTATION_HEARTBEAT_INTERVAL_MS).toBe(2_000);
    expect(GIVEAWAY_PRESENTATION_STAGE_DISCONNECT_AFTER_MS).toBe(6_000);
    expect(isGiveawayPresentationStageDisconnected(10_000, 15_999)).toBe(false);
    expect(isGiveawayPresentationStageDisconnected(10_000, 16_000)).toBe(true);
    expect(isGiveawayPresentationStageDisconnected(null, 16_000)).toBe(true);
    expect(isGiveawayPresentationStageDisconnected(17_000, 16_000)).toBe(true);
  });
});
