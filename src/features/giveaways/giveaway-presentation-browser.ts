import {
  getGiveawayPresentationChannelName,
  parseGiveawayPresentationStageMessage,
} from "./giveaway-presentation-channel";
import { getGiveawayPresentationKeyboardIntent } from "./giveaway-presentation-runtime";

export const GIVEAWAY_PRESENTATION_STAGE_WINDOW_NAME = "tambike-live-raffle-stage";

const fragmentVersion = "1";
const digestPattern = /^[0-9a-f]{64}$/i;

type StageUrlInput = {
  eventId: string;
  giveawayId: string;
  channelId: string;
};

export function buildGiveawayPresentationStageUrl(input: StageUrlInput) {
  assertRouteIdentity(input.eventId);
  assertRouteIdentity(input.giveawayId);
  getGiveawayPresentationChannelName(input.channelId);
  return `/organizer/events/${encodeURIComponent(input.eventId)}/giveaways/${encodeURIComponent(input.giveawayId)}/present?channel=${encodeURIComponent(input.channelId.toLowerCase())}`;
}

type ResolveControllerConnectionInput = {
  fragment: string;
  drawId: string;
  resultDigest: string;
  createChannelId: () => string;
};

export type GiveawayPresentationControllerConnection = {
  channelId: string;
  fragment: string;
  reused: boolean;
};

export type GiveawayPresentationChannelIdentity = {
  channelId: string;
  drawId: string;
  resultDigest: string;
};

/** Prevents a newly supplied draw payload from ever crossing the previous draw's channel. */
export function getMatchingGiveawayPresentationChannelId(
  connection: GiveawayPresentationChannelIdentity | null,
  drawId: string,
  resultDigest: string,
) {
  if (
    !connection ||
    connection.drawId !== drawId ||
    connection.resultDigest.toLowerCase() !== resultDigest.toLowerCase()
  ) {
    return null;
  }
  try {
    getGiveawayPresentationChannelName(connection.channelId);
    return connection.channelId.toLowerCase();
  } catch {
    return null;
  }
}

/** Keeps label-free connection identity in the URL fragment, never presentation storage. */
export function resolveGiveawayPresentationControllerConnection(
  input: ResolveControllerConnectionInput,
): GiveawayPresentationControllerConnection {
  assertOpaqueIdentity(input.drawId);
  if (!digestPattern.test(input.resultDigest)) throw new Error("INVALID_PRESENTATION_IDENTITY");

  const recovered = parseControllerFragment(input.fragment);
  if (
    recovered &&
    recovered.drawId === input.drawId &&
    recovered.resultDigest.toLowerCase() === input.resultDigest.toLowerCase()
  ) {
    return {
      channelId: recovered.channelId,
      fragment: serializeControllerFragment(recovered),
      reused: true,
    };
  }

  const channelId = input.createChannelId().toLowerCase();
  getGiveawayPresentationChannelName(channelId);
  const metadata = {
    channelId,
    drawId: input.drawId,
    resultDigest: input.resultDigest.toLowerCase(),
  };
  return {
    channelId,
    fragment: serializeControllerFragment(metadata),
    reused: false,
  };
}

function parseControllerFragment(fragment: string) {
  if (typeof fragment !== "string") return null;
  const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  if (
    params.get("raffleVersion") !== fragmentVersion ||
    [...params.keys()].some(
      (key) => !["raffleVersion", "raffleChannel", "raffleDraw", "raffleDigest"].includes(key),
    )
  ) {
    return null;
  }
  const channelId = params.get("raffleChannel");
  const drawId = params.get("raffleDraw");
  const resultDigest = params.get("raffleDigest");
  if (!channelId || !drawId || !resultDigest) return null;
  try {
    getGiveawayPresentationChannelName(channelId);
    assertOpaqueIdentity(drawId);
  } catch {
    return null;
  }
  if (!digestPattern.test(resultDigest)) return null;
  return { channelId: channelId.toLowerCase(), drawId, resultDigest: resultDigest.toLowerCase() };
}

function serializeControllerFragment(metadata: {
  channelId: string;
  drawId: string;
  resultDigest: string;
}) {
  const params = new URLSearchParams({
    raffleVersion: fragmentVersion,
    raffleChannel: metadata.channelId,
    raffleDraw: metadata.drawId,
    raffleDigest: metadata.resultDigest,
  });
  return `#${params.toString()}`;
}

export type GiveawayPresentationWindowProxy = {
  closed?: boolean;
  focus?: () => void;
  document?: {
    documentElement?: { requestFullscreen?: () => Promise<void> | void };
  };
};

type OpenStageInput = {
  existingWindow: GiveawayPresentationWindowProxy | null;
  stageUrl: string;
  openWindow: (
    url: string,
    target: string,
  ) => GiveawayPresentationWindowProxy | null;
};

export function openOrFocusGiveawayPresentationStage(input: OpenStageInput) {
  if (input.existingWindow && input.existingWindow.closed !== true) {
    try {
      input.existingWindow.focus?.();
      return { windowProxy: input.existingWindow, blocked: false, reused: true };
    } catch {
      // A stale cross-process proxy is replaced below under the same user gesture.
    }
  }
  const windowProxy = input.openWindow(
    input.stageUrl,
    GIVEAWAY_PRESENTATION_STAGE_WINDOW_NAME,
  );
  windowProxy?.focus?.();
  return { windowProxy, blocked: windowProxy === null, reused: false };
}

type KeyboardEventLike = {
  key: string;
  target?: unknown;
  repeat?: boolean;
  isComposing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export function getGiveawayPresentationKeyboardEventIntent(event: KeyboardEventLike) {
  if (
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return null;
  }
  return getGiveawayPresentationKeyboardIntent(event.key, event.target);
}

type MatchMedia = (query: string) => { matches: boolean };

export function getPrefersReducedGiveawayMotion(matchMedia?: MatchMedia) {
  const guardedMatchMedia =
    matchMedia ??
    (typeof globalThis.matchMedia === "function" ? globalThis.matchMedia.bind(globalThis) : null);
  try {
    return guardedMatchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export function resolveGiveawayPresentationStagePulse(
  value: unknown,
  expectedChannelId: string,
  now: number,
) {
  if (!Number.isFinite(now)) return null;
  const message = parseGiveawayPresentationStageMessage(value, expectedChannelId);
  if (!message) return null;
  return { connected: true, lastHeartbeatAt: now, shouldSendSnapshot: true } as const;
}

export async function tryGiveawayPresentationFullscreen(
  target: GiveawayPresentationWindowProxy | null,
) {
  try {
    const requestFullscreen = target?.document?.documentElement?.requestFullscreen;
    if (!requestFullscreen) return false;
    await requestFullscreen.call(target.document?.documentElement);
    return true;
  } catch {
    return false;
  }
}

type AudioParamLike = {
  setValueAtTime: (value: number, time: number) => void;
  exponentialRampToValueAtTime: (value: number, time: number) => void;
};

type AudioNodeLike = { connect: (target: unknown) => unknown };

type AudioContextLike = {
  currentTime: number;
  destination: unknown;
  resume?: () => unknown;
  close?: () => unknown;
  createOscillator: () => AudioNodeLike & {
    type: string;
    frequency: AudioParamLike;
    start: (time: number) => void;
    stop: (time: number) => void;
  };
  createGain: () => AudioNodeLike & { gain: AudioParamLike };
};

type AudioContextConstructor = new () => AudioContextLike;

export function playGiveawayPresentationWinnerChime(
  createAudioContext?: () => AudioContextLike,
) {
  return createGiveawayPresentationWinnerChimePlayer(createAudioContext)?.play() ?? false;
}

export type GiveawayPresentationWinnerChimePlayer = {
  play: () => boolean;
  close: () => void;
};

/** Create/resume this during the Sound toggle gesture, then reuse it when a winner settles. */
export function createGiveawayPresentationWinnerChimePlayer(
  createAudioContext?: () => AudioContextLike,
): GiveawayPresentationWinnerChimePlayer | null {
  try {
    let context: AudioContextLike;
    if (createAudioContext) {
      context = createAudioContext();
    } else {
      const constructor = ((
        globalThis as typeof globalThis & {
          AudioContext?: AudioContextConstructor;
          webkitAudioContext?: AudioContextConstructor;
        }
      ).AudioContext ??
        (
          globalThis as typeof globalThis & {
            webkitAudioContext?: AudioContextConstructor;
          }
        ).webkitAudioContext) as AudioContextConstructor | undefined;
      if (!constructor) return null;
      context = new constructor();
    }
    safelyIgnorePromise(context.resume?.());
    return {
      play: () => playWinnerChimeOnContext(context),
      close: () => {
        try {
          safelyIgnorePromise(context.close?.());
        } catch {
          // Closing audio is best-effort during controller teardown.
        }
      },
    };
  } catch {
    return null;
  }
}

function safelyIgnorePromise(value: unknown) {
  if (value && typeof (value as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(value).catch(() => undefined);
  }
}

function playWinnerChimeOnContext(context: AudioContextLike) {
  try {
    const startAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(520, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(780, startAt + 0.16);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.07, startAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.24);
    return true;
  } catch {
    return false;
  }
}

function assertRouteIdentity(value: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error("INVALID_PRESENTATION_ROUTE");
  }
}

function assertOpaqueIdentity(value: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    /[\p{Cc}\p{Cf}\s:]/u.test(value)
  ) {
    throw new Error("INVALID_PRESENTATION_IDENTITY");
  }
}
