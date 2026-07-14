import { describe, expect, test } from "vitest";

import {
  GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS,
  GIVEAWAY_PRESENTATION_SESSION_VERSION,
  buildGiveawayPresentationReelLabels,
  getGiveawayPresentationKeyboardIntent,
  getGiveawayPresentationSessionKey,
  parseGiveawayPresentationSessionState,
  reduceGiveawayPresentationRuntime,
  restoreGiveawayPresentationSessionState,
  serializeGiveawayPresentationSessionState,
  type GiveawayPresentationRuntimeState,
} from "../../src/features/giveaways/giveaway-presentation-runtime";

const ready: GiveawayPresentationRuntimeState = {
  phase: "ready",
  slideIndex: 0,
  mode: "normal",
  soundEnabled: false,
};

describe("giveaway presentation runtime", () => {
  test("uses a six-second Normal reveal and loads a neutral payload state", () => {
    expect(GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS).toBe(6_000);
    expect(
      reduceGiveawayPresentationRuntime(
        { ...ready, phase: "standby" },
        { type: "payload-loaded", slideCount: 2, drawStatus: "completed" },
      ),
    ).toEqual(ready);
    expect(
      reduceGiveawayPresentationRuntime(
        { ...ready, phase: "standby" },
        { type: "payload-loaded", slideCount: 0, drawStatus: "completed" },
      ),
    ).toEqual({ ...ready, phase: "complete" });
    expect(
      reduceGiveawayPresentationRuntime(ready, {
        type: "payload-loaded",
        slideCount: 2,
        drawStatus: "published",
      }),
    ).toEqual({ ...ready, phase: "published" });
  });

  test("runs Normal, Skip, Instant, and reduced-motion reveals to the same fixed winner", () => {
    const spinning = reduceGiveawayPresentationRuntime(ready, {
      type: "reveal",
      slideCount: 2,
      reducedMotion: false,
    });
    expect(spinning).toEqual({ ...ready, phase: "spinning" });
    expect(
      reduceGiveawayPresentationRuntime(spinning, { type: "skip-current", slideCount: 2 }),
    ).toEqual({ ...ready, phase: "winner" });
    expect(
      reduceGiveawayPresentationRuntime(
        { ...ready, mode: "instant" },
        { type: "reveal", slideCount: 2, reducedMotion: false },
      ),
    ).toEqual({ ...ready, mode: "instant", phase: "winner" });
    expect(
      reduceGiveawayPresentationRuntime(ready, {
        type: "reveal",
        slideCount: 2,
        reducedMotion: true,
      }),
    ).toEqual({ ...ready, phase: "winner" });

    const fixedWinner = "Rider 7F4K";
    const reel = buildGiveawayPresentationReelLabels({
      labelBank: ["Mina R.", "Rider 2ABC", fixedWinner],
      resultDigest: "a".repeat(64),
      slidePosition: 1,
      winnerLabel: fixedWinner,
      length: 18,
    });
    expect(reel).toHaveLength(18);
    expect(reel.at(-1)).toBe(fixedWinner);
    expect(reel.every((label) => ["Mina R.", "Rider 2ABC", fixedWinner].includes(label))).toBe(
      true,
    );
    expect(
      buildGiveawayPresentationReelLabels({
        labelBank: ["Mina R.", "Rider 2ABC", fixedWinner],
        resultDigest: "a".repeat(64),
        slidePosition: 1,
        winnerLabel: fixedWinner,
        length: 18,
      }),
    ).toEqual(reel);
  });

  test("holds each non-final winner for manual Next and retains the final winner at complete", () => {
    const winner = reduceGiveawayPresentationRuntime(
      { ...ready, phase: "spinning" },
      { type: "settle", slideCount: 2 },
    );
    expect(winner).toEqual({ ...ready, phase: "winner" });
    expect(reduceGiveawayPresentationRuntime(winner, { type: "next", slideCount: 2 })).toEqual({
      ...ready,
      slideIndex: 1,
    });
    expect(
      reduceGiveawayPresentationRuntime(
        { ...ready, phase: "spinning", slideIndex: 1 },
        { type: "settle", slideCount: 2 },
      ),
    ).toEqual({ ...ready, phase: "complete", slideIndex: 1 });
  });

  test("changes settings, restarts visually, and fails closed for invalid events and indices", () => {
    expect(
      reduceGiveawayPresentationRuntime(ready, { type: "set-mode", mode: "instant" }),
    ).toEqual({ ...ready, mode: "instant" });
    expect(
      reduceGiveawayPresentationRuntime(ready, { type: "set-sound", soundEnabled: true }),
    ).toEqual({ ...ready, soundEnabled: true });
    expect(
      reduceGiveawayPresentationRuntime(
        { ...ready, phase: "complete", slideIndex: 2, soundEnabled: true },
        { type: "restart", slideCount: 3 },
      ),
    ).toEqual({ ...ready, soundEnabled: true });
    expect(
      reduceGiveawayPresentationRuntime(
        { ...ready, phase: "complete", slideIndex: 2 },
        { type: "instant-replay", slideCount: 3 },
      ),
    ).toEqual({ ...ready, mode: "instant" });
    expect(
      reduceGiveawayPresentationRuntime({ ...ready, slideIndex: 9 }, { type: "restart", slideCount: 2 }),
    ).toEqual({ ...ready, slideIndex: 9 });
    expect(
      reduceGiveawayPresentationRuntime(ready, { type: "skip-current", slideCount: 2 }),
    ).toBe(ready);
    expect(reduceGiveawayPresentationRuntime(ready, { type: "next", slideCount: 2 })).toBe(
      ready,
    );
    expect(
      reduceGiveawayPresentationRuntime(
        { ...ready, phase: "complete", slideIndex: 1 },
        { type: "next", slideCount: 2 },
      ),
    ).toEqual({ ...ready, phase: "complete", slideIndex: 1 });
    expect(
      reduceGiveawayPresentationRuntime(ready, { type: "published", slideCount: 2 }),
    ).toEqual({ ...ready, phase: "published" });
    expect(reduceGiveawayPresentationRuntime(ready, null as never)).toBe(ready);
    expect(
      reduceGiveawayPresentationRuntime(ready, { type: "reroll", slideCount: 2 } as never),
    ).toBe(ready);
  });
});

describe("giveaway presentation session recovery", () => {
  const drawId = "giveaway-draw-opaque";
  const resultDigest = "b".repeat(64);
  const storageKey = `tambike:giveaway-presentation:${drawId}:${resultDigest}`;

  test("keys and serializes exactly the label-free controller state", () => {
    expect(getGiveawayPresentationSessionKey(drawId, resultDigest)).toBe(storageKey);
    const serialized = serializeGiveawayPresentationSessionState({
      ...ready,
      phase: "winner",
      soundEnabled: true,
    });
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      "version",
      "phase",
      "slideIndex",
      "mode",
      "soundEnabled",
    ]);
    expect(JSON.parse(serialized)).toEqual({
      version: GIVEAWAY_PRESENTATION_SESSION_VERSION,
      phase: "winner",
      slideIndex: 0,
      mode: "normal",
      soundEnabled: true,
    });
    for (const forbidden of ["label", "payload", "title", "channel", drawId, resultDigest]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  test("rejects corrupt, stale, future, extra-field, out-of-range, and identity-mismatched data", () => {
    const options = { storageKey, drawId, resultDigest, slideCount: 2 };
    const valid = serializeGiveawayPresentationSessionState({ ...ready, phase: "winner" });
    expect(parseGiveawayPresentationSessionState(valid, options)).toEqual({
      ...ready,
      phase: "winner",
    });
    expect(parseGiveawayPresentationSessionState("not-json", options)).toBeNull();
    expect(
      parseGiveawayPresentationSessionState(
        JSON.stringify({ ...JSON.parse(valid), version: GIVEAWAY_PRESENTATION_SESSION_VERSION + 1 }),
        options,
      ),
    ).toBeNull();
    expect(
      parseGiveawayPresentationSessionState(
        JSON.stringify({ ...JSON.parse(valid), version: 0 }),
        options,
      ),
    ).toBeNull();
    expect(
      parseGiveawayPresentationSessionState(
        JSON.stringify({ ...JSON.parse(valid), winnerLabel: "leak" }),
        options,
      ),
    ).toBeNull();
    expect(
      parseGiveawayPresentationSessionState(
        JSON.stringify({ ...JSON.parse(valid), slideIndex: 2 }),
        options,
      ),
    ).toBeNull();
    expect(
      parseGiveawayPresentationSessionState(valid, {
        ...options,
        storageKey: getGiveawayPresentationSessionKey("other-draw", resultDigest),
      }),
    ).toBeNull();
  });

  test("settles interrupted animation, honors publication, and gives absent data a neutral start", () => {
    const common = { storageKey, drawId, resultDigest, slideCount: 2, drawStatus: "completed" as const };
    expect(
      restoreGiveawayPresentationSessionState({
        ...common,
        serialized: serializeGiveawayPresentationSessionState({ ...ready, phase: "spinning" }),
      }),
    ).toEqual({ ...ready, phase: "winner" });
    expect(
      restoreGiveawayPresentationSessionState({
        ...common,
        serialized: serializeGiveawayPresentationSessionState({
          ...ready,
          phase: "spinning",
          slideIndex: 1,
        }),
      }),
    ).toEqual({ ...ready, phase: "complete", slideIndex: 1 });
    expect(
      restoreGiveawayPresentationSessionState({ ...common, serialized: null }),
    ).toEqual(ready);
    expect(
      restoreGiveawayPresentationSessionState({ ...common, serialized: null, slideCount: 0 }),
    ).toEqual({ ...ready, phase: "complete" });
    expect(
      restoreGiveawayPresentationSessionState({
        ...common,
        serialized: serializeGiveawayPresentationSessionState(ready),
        drawStatus: "published",
      }),
    ).toEqual({ ...ready, phase: "published" });
    expect(
      restoreGiveawayPresentationSessionState({
        ...common,
        serialized: serializeGiveawayPresentationSessionState({ ...ready, phase: "published" }),
      }),
    ).toEqual(ready);
    expect(
      restoreGiveawayPresentationSessionState({
        ...common,
        serialized: serializeGiveawayPresentationSessionState({ ...ready, phase: "standby" }),
      }),
    ).toEqual(ready);
  });
});

describe("giveaway presentation keyboard intents", () => {
  test("maps Space and S only outside form and editable controls", () => {
    expect(getGiveawayPresentationKeyboardIntent(" ", { tagName: "DIV" })).toBe(
      "reveal-or-next",
    );
    expect(getGiveawayPresentationKeyboardIntent("s", { tagName: "DIV" })).toBe(
      "skip-current",
    );
    for (const tagName of ["INPUT", "SELECT", "TEXTAREA", "BUTTON"]) {
      expect(getGiveawayPresentationKeyboardIntent(" ", { tagName })).toBeNull();
      expect(getGiveawayPresentationKeyboardIntent("S", { tagName })).toBeNull();
    }
    expect(
      getGiveawayPresentationKeyboardIntent(" ", {
        tagName: "DIV",
        isContentEditable: true,
      }),
    ).toBeNull();
    expect(getGiveawayPresentationKeyboardIntent("Enter", { tagName: "DIV" })).toBeNull();
  });
});
