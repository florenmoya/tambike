import { describe, expect, test, vi } from "vitest";

import {
  GIVEAWAY_PRESENTATION_STAGE_WINDOW_NAME,
  buildGiveawayPresentationStageUrl,
  createGiveawayPresentationWinnerChimePlayer,
  getGiveawayPresentationKeyboardEventIntent,
  getMatchingGiveawayPresentationChannelId,
  getPrefersReducedGiveawayMotion,
  openOrFocusGiveawayPresentationStage,
  playGiveawayPresentationWinnerChime,
  resolveGiveawayPresentationControllerConnection,
  resolveGiveawayPresentationStagePulse,
  tryGiveawayPresentationFullscreen,
} from "../../src/features/giveaways/giveaway-presentation-browser";

const channelA = "123e4567-e89b-42d3-a456-426614174000";
const channelB = "123e4567-e89b-42d3-a456-426614174001";
const digest = "a".repeat(64);

describe("giveaway presentation browser boundary", () => {
  test("builds one encoded same-origin stage path with a stable projector name", () => {
    expect(
      buildGiveawayPresentationStageUrl({
        eventId: "event / one",
        giveawayId: "giveaway?one",
        channelId: channelA,
      }),
    ).toBe(
      "/organizer/events/event%20%2F%20one/giveaways/giveaway%3Fone/present?channel=123e4567-e89b-42d3-a456-426614174000",
    );
    expect(GIVEAWAY_PRESENTATION_STAGE_WINDOW_NAME).toBe("tambike-live-raffle-stage");
    expect(() =>
      buildGiveawayPresentationStageUrl({
        eventId: "event-1",
        giveawayId: "giveaway-1",
        channelId: "not-a-channel",
      }),
    ).toThrow("INVALID_PRESENTATION_CHANNEL");
  });

  test("recovers matching label-free fragment metadata and replaces stale identity", () => {
    const created = vi.fn(() => channelA);
    const fresh = resolveGiveawayPresentationControllerConnection({
      fragment: "",
      drawId: "draw-1",
      resultDigest: digest,
      createChannelId: created,
    });

    expect(fresh).toEqual({
      channelId: channelA,
      fragment: expect.stringContaining("raffleChannel=123e4567-e89b-42d3-a456-426614174000"),
      reused: false,
    });
    expect(fresh.fragment).toContain("raffleDraw=draw-1");
    expect(fresh.fragment).toContain(`raffleDigest=${digest}`);
    expect(fresh.fragment).not.toMatch(/winner|rider|helmet|label/i);

    expect(
      resolveGiveawayPresentationControllerConnection({
        fragment: fresh.fragment,
        drawId: "draw-1",
        resultDigest: digest,
        createChannelId: () => channelB,
      }),
    ).toEqual({ ...fresh, reused: true });

    expect(
      resolveGiveawayPresentationControllerConnection({
        fragment: fresh.fragment,
        drawId: "draw-2",
        resultDigest: digest,
        createChannelId: () => channelB,
      }),
    ).toMatchObject({ channelId: channelB, reused: false });
  });

  test("suppresses an old channel until its draw and digest identity both match", () => {
    const connection = {
      channelId: channelA,
      drawId: "draw-1",
      resultDigest: digest,
    };
    expect(getMatchingGiveawayPresentationChannelId(connection, "draw-1", digest)).toBe(channelA);
    expect(getMatchingGiveawayPresentationChannelId(connection, "draw-2", digest)).toBeNull();
    expect(getMatchingGiveawayPresentationChannelId(connection, "draw-1", "b".repeat(64)))
      .toBeNull();
  });

  test("focuses a retained stage window and reports a blocked first popup without changing URLs", () => {
    const existing = { closed: false, focus: vi.fn() };
    const openWindow = vi.fn();
    expect(
      openOrFocusGiveawayPresentationStage({
        existingWindow: existing,
        stageUrl: "/stage?channel=same",
        openWindow,
      }),
    ).toEqual({ windowProxy: existing, blocked: false, reused: true });
    expect(existing.focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();

    openWindow.mockReturnValueOnce(null);
    expect(
      openOrFocusGiveawayPresentationStage({
        existingWindow: null,
        stageUrl: "/stage?channel=same",
        openWindow,
      }),
    ).toEqual({ windowProxy: null, blocked: true, reused: false });
    expect(openWindow).toHaveBeenCalledWith(
      "/stage?channel=same",
      GIVEAWAY_PRESENTATION_STAGE_WINDOW_NAME,
    );
  });

  test("filters modified, repeated, composing, and form-target keyboard events", () => {
    expect(
      getGiveawayPresentationKeyboardEventIntent({
        key: " ",
        target: { tagName: "DIV" },
      }),
    ).toBe("reveal-or-next");
    expect(
      getGiveawayPresentationKeyboardEventIntent({
        key: "s",
        target: { tagName: "DIV" },
      }),
    ).toBe("skip-current");
    for (const event of [
      { key: " ", target: { tagName: "INPUT" } },
      { key: " ", target: { tagName: "DIV" }, repeat: true },
      { key: " ", target: { tagName: "DIV" }, isComposing: true },
      { key: " ", target: { tagName: "DIV" }, ctrlKey: true },
      { key: "s", target: { tagName: "DIV" }, altKey: true },
      { key: "s", target: { tagName: "DIV" }, metaKey: true },
      { key: "s", target: { tagName: "DIV" }, shiftKey: true },
    ]) {
      expect(getGiveawayPresentationKeyboardEventIntent(event)).toBeNull();
    }
  });

  test("reads reduced motion only through an injected or guarded media query", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    expect(getPrefersReducedGiveawayMotion(matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(getPrefersReducedGiveawayMotion(undefined)).toBe(false);
  });

  test("turns valid ready and heartbeat pulses into a reconnect plus full-state sync", () => {
    for (const type of ["stage-ready", "stage-heartbeat"] as const) {
      expect(
        resolveGiveawayPresentationStagePulse(
          { version: 1, type, channelId: channelA },
          channelA,
          12_345,
        ),
      ).toEqual({ connected: true, lastHeartbeatAt: 12_345, shouldSendSnapshot: true });
    }
    expect(
      resolveGiveawayPresentationStagePulse(
        { version: 1, type: "stage-ready", channelId: channelB },
        channelA,
        12_345,
      ),
    ).toBeNull();
    expect(
      resolveGiveawayPresentationStagePulse(
        { version: 1, type: "stage-ready", channelId: channelA },
        channelA,
        Number.NaN,
      ),
    ).toBeNull();
  });

  test("tries same-origin fullscreen and fails closed when activation is rejected", async () => {
    const requestFullscreen = vi.fn(async () => undefined);
    expect(
      await tryGiveawayPresentationFullscreen({
        document: { documentElement: { requestFullscreen } },
      }),
    ).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledOnce();

    requestFullscreen.mockRejectedValueOnce(new Error("activation"));
    expect(
      await tryGiveawayPresentationFullscreen({
        document: { documentElement: { requestFullscreen } },
      }),
    ).toBe(false);
    expect(await tryGiveawayPresentationFullscreen(null)).toBe(false);
  });

  test("plays one restrained injectable winner chime and degrades silently", () => {
    const start = vi.fn();
    const stop = vi.fn();
    const oscillator = {
      type: "sine",
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start,
      stop,
    };
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    const context = {
      currentTime: 10,
      destination: {},
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      resume: vi.fn(),
    };

    expect(playGiveawayPresentationWinnerChime(() => context)).toBe(true);
    expect(start).toHaveBeenCalledWith(10);
    expect(stop).toHaveBeenCalledWith(10.24);
    expect(playGiveawayPresentationWinnerChime(() => {
      throw new Error("unavailable");
    })).toBe(false);
  });

  test("primes one reusable audio context during the sound gesture before settle", () => {
    const resume = vi.fn();
    const starts: number[] = [];
    const createOscillator = vi.fn(() => ({
      type: "sine",
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: (time: number) => starts.push(time),
      stop: vi.fn(),
    }));
    const context = {
      currentTime: 3,
      destination: {},
      createOscillator,
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      })),
      resume,
      close: vi.fn(),
    };
    const factory = vi.fn(() => context);

    const player = createGiveawayPresentationWinnerChimePlayer(factory);
    expect(factory).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(player?.play()).toBe(true);
    expect(player?.play()).toBe(true);
    expect(factory).toHaveBeenCalledOnce();
    expect(createOscillator).toHaveBeenCalledTimes(2);
    expect(starts).toEqual([3, 3]);
    player?.close();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
