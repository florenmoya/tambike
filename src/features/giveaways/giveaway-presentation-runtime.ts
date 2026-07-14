export const GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS = 6_000;
export const GIVEAWAY_PRESENTATION_SESSION_VERSION = 1;

export type GiveawayPresentationPhase =
  | "standby"
  | "ready"
  | "spinning"
  | "winner"
  | "complete"
  | "published";

export type GiveawayPresentationMode = "normal" | "instant";

export interface GiveawayPresentationRuntimeState {
  phase: GiveawayPresentationPhase;
  slideIndex: number;
  mode: GiveawayPresentationMode;
  soundEnabled: boolean;
}

export type GiveawayPresentationRuntimeEvent =
  | { type: "payload-loaded"; slideCount: number; drawStatus: "completed" | "published" }
  | { type: "set-mode"; mode: GiveawayPresentationMode }
  | { type: "set-sound"; soundEnabled: boolean }
  | { type: "reveal"; slideCount: number; reducedMotion: boolean }
  | { type: "settle"; slideCount: number }
  | { type: "skip-current"; slideCount: number }
  | { type: "next"; slideCount: number }
  | { type: "restart"; slideCount: number }
  | { type: "instant-replay"; slideCount: number }
  | { type: "published"; slideCount: number };

const phases = new Set<GiveawayPresentationPhase>([
  "standby",
  "ready",
  "spinning",
  "winner",
  "complete",
  "published",
]);
const modes = new Set<GiveawayPresentationMode>(["normal", "instant"]);

/** Pure state transition; winner identity always remains in the server payload. */
export function reduceGiveawayPresentationRuntime(
  state: GiveawayPresentationRuntimeState,
  event: GiveawayPresentationRuntimeEvent,
): GiveawayPresentationRuntimeState {
  if (!isStructurallyValidRuntimeState(state) || !isRecord(event)) return state;
  if (event.type === "set-mode") {
    return modes.has(event.mode) ? { ...state, mode: event.mode } : state;
  }
  if (event.type === "set-sound") {
    return typeof event.soundEnabled === "boolean"
      ? { ...state, soundEnabled: event.soundEnabled }
      : state;
  }
  if (!isSlideCount(event.slideCount) || !isStateIndexInRange(state, event.slideCount)) {
    return state;
  }

  if (event.type === "payload-loaded") {
    if (event.drawStatus === "published") return { ...state, phase: "published" };
    if (event.drawStatus !== "completed") return state;
    return {
      ...state,
      phase: event.slideCount === 0 ? "complete" : "ready",
      slideIndex: 0,
    };
  }
  if (event.type === "published") return { ...state, phase: "published" };
  if (event.type === "restart" || event.type === "instant-replay") {
    return {
      ...state,
      phase: event.slideCount === 0 ? "complete" : "ready",
      slideIndex: 0,
      ...(event.type === "instant-replay" ? { mode: "instant" as const } : {}),
    };
  }
  if (event.type === "reveal") {
    if (state.phase !== "ready" || typeof event.reducedMotion !== "boolean") return state;
    if (event.slideCount === 0) return { ...state, phase: "complete", slideIndex: 0 };
    if (state.mode === "instant" || event.reducedMotion) {
      return settleCurrentSlide(state, event.slideCount);
    }
    return { ...state, phase: "spinning" };
  }
  if (event.type === "settle" || event.type === "skip-current") {
    if (state.phase !== "spinning") return state;
    return settleCurrentSlide(state, event.slideCount);
  }
  if (event.type === "next") {
    if (state.phase !== "winner" || state.slideIndex >= event.slideCount - 1) return state;
    return { ...state, phase: "ready", slideIndex: state.slideIndex + 1 };
  }
  return state;
}

function settleCurrentSlide(
  state: GiveawayPresentationRuntimeState,
  slideCount: number,
): GiveawayPresentationRuntimeState {
  return {
    ...state,
    phase: state.slideIndex === slideCount - 1 ? "complete" : "winner",
  };
}

export function isGiveawayPresentationRuntimeStateValid(
  value: unknown,
  slideCount: number,
): value is GiveawayPresentationRuntimeState {
  if (!isStructurallyValidRuntimeState(value) || !isSlideCount(slideCount)) return false;
  if (!isStateIndexInRange(value, slideCount)) return false;
  if (slideCount === 0) {
    return value.slideIndex === 0 && ["standby", "complete", "published"].includes(value.phase);
  }
  if (value.phase === "winner" && value.slideIndex >= slideCount - 1) return false;
  if (value.phase === "complete" && value.slideIndex !== slideCount - 1) return false;
  if (value.phase === "standby" && value.slideIndex !== 0) return false;
  return true;
}

function isStructurallyValidRuntimeState(value: unknown): value is GiveawayPresentationRuntimeState {
  if (!isRecord(value) || !hasExactKeys(value, ["phase", "slideIndex", "mode", "soundEnabled"])) {
    return false;
  }
  return (
    typeof value.phase === "string" &&
    phases.has(value.phase as GiveawayPresentationPhase) &&
    Number.isInteger(value.slideIndex) &&
    (value.slideIndex as number) >= 0 &&
    typeof value.mode === "string" &&
    modes.has(value.mode as GiveawayPresentationMode) &&
    typeof value.soundEnabled === "boolean"
  );
}

function isSlideCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isStateIndexInRange(state: GiveawayPresentationRuntimeState, slideCount: number) {
  return slideCount === 0 ? state.slideIndex === 0 : state.slideIndex < slideCount;
}

type ReelLabelsInput = {
  labelBank: readonly string[];
  resultDigest: string;
  slidePosition: number;
  winnerLabel: string;
  length?: number;
};

/** Builds a deterministic safe-label reel whose only terminal value is the fixed server winner. */
export function buildGiveawayPresentationReelLabels(input: ReelLabelsInput): string[] {
  const length = input.length ?? 28;
  if (
    !Array.isArray(input.labelBank) ||
    !input.labelBank.every((label) => typeof label === "string" && label.trim().length > 0) ||
    typeof input.resultDigest !== "string" ||
    input.resultDigest.length === 0 ||
    !Number.isInteger(input.slidePosition) ||
    input.slidePosition < 1 ||
    typeof input.winnerLabel !== "string" ||
    input.winnerLabel.trim().length === 0 ||
    !Number.isInteger(length) ||
    length < 1
  ) {
    return [];
  }

  const labels = [...new Set(input.labelBank)];
  if (!labels.includes(input.winnerLabel)) labels.push(input.winnerLabel);
  const result: string[] = [];
  let randomState = hashString32(`${input.resultDigest}:${input.slidePosition}`) || 0x9e3779b9;
  for (let index = 0; index < length - 1; index += 1) {
    randomState = xorshift32(randomState);
    result.push(labels[randomState % labels.length] ?? input.winnerLabel);
  }
  result.push(input.winnerLabel);
  return result;
}

function hashString32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function xorshift32(value: number) {
  let result = value >>> 0;
  result ^= result << 13;
  result ^= result >>> 17;
  result ^= result << 5;
  return result >>> 0;
}

export function getGiveawayPresentationSessionKey(drawId: string, resultDigest: string) {
  if (!isSafeIdentityPart(drawId) || !/^[0-9a-f]{64}$/i.test(resultDigest)) {
    throw new Error("INVALID_PRESENTATION_IDENTITY");
  }
  return `tambike:giveaway-presentation:${drawId}:${resultDigest}`;
}

export function serializeGiveawayPresentationSessionState(
  state: GiveawayPresentationRuntimeState,
) {
  if (!isStructurallyValidRuntimeState(state)) throw new Error("INVALID_PRESENTATION_STATE");
  return JSON.stringify({
    version: GIVEAWAY_PRESENTATION_SESSION_VERSION,
    phase: state.phase,
    slideIndex: state.slideIndex,
    mode: state.mode,
    soundEnabled: state.soundEnabled,
  });
}

type ParseSessionOptions = {
  storageKey: string;
  drawId: string;
  resultDigest: string;
  slideCount: number;
};

export function parseGiveawayPresentationSessionState(
  serialized: string | null | undefined,
  options: ParseSessionOptions,
): GiveawayPresentationRuntimeState | null {
  if (!serialized || !isSlideCount(options.slideCount)) return null;
  let expectedKey: string;
  try {
    expectedKey = getGiveawayPresentationSessionKey(options.drawId, options.resultDigest);
  } catch {
    return null;
  }
  if (options.storageKey !== expectedKey) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "phase", "slideIndex", "mode", "soundEnabled"]) ||
    value.version !== GIVEAWAY_PRESENTATION_SESSION_VERSION
  ) {
    return null;
  }
  const state = {
    phase: value.phase,
    slideIndex: value.slideIndex,
    mode: value.mode,
    soundEnabled: value.soundEnabled,
  };
  return isGiveawayPresentationRuntimeStateValid(state, options.slideCount) ? state : null;
}

type RestoreSessionOptions = ParseSessionOptions & {
  serialized: string | null | undefined;
  drawStatus: "completed" | "published";
};

export function restoreGiveawayPresentationSessionState(
  options: RestoreSessionOptions,
): GiveawayPresentationRuntimeState {
  const neutral: GiveawayPresentationRuntimeState = {
    phase: options.slideCount === 0 ? "complete" : "ready",
    slideIndex: 0,
    mode: "normal",
    soundEnabled: false,
  };
  const stored = parseGiveawayPresentationSessionState(options.serialized, options);
  const restored = stored ?? neutral;
  if (options.drawStatus === "published") return { ...restored, phase: "published" };
  if (["standby", "published"].includes(restored.phase)) return neutral;
  if (restored.phase !== "spinning") return restored;
  return settleCurrentSlide(restored, options.slideCount);
}

export type GiveawayPresentationKeyboardIntent = "reveal-or-next" | "skip-current";

export function getGiveawayPresentationKeyboardIntent(
  key: string,
  target: unknown,
): GiveawayPresentationKeyboardIntent | null {
  if (isKeyboardControlTarget(target)) return null;
  if (key === " " || key === "Space" || key === "Spacebar") return "reveal-or-next";
  if (key.toLowerCase() === "s") return "skip-current";
  return null;
}

function isKeyboardControlTarget(target: unknown) {
  if (!isRecord(target)) return false;
  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (["input", "select", "textarea", "button"].includes(tagName)) return true;
  if (target.isContentEditable === true) return true;
  if (typeof target.contentEditable === "string" && target.contentEditable.toLowerCase() === "true") {
    return true;
  }
  return false;
}

function isSafeIdentityPart(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\s:]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
