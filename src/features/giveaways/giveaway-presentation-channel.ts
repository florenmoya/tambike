import type { OrganizerGiveawayPresentation } from "./types";
import {
  isGiveawayPresentationRuntimeStateValid,
  type GiveawayPresentationRuntimeState,
} from "./giveaway-presentation-runtime";

export const GIVEAWAY_PRESENTATION_CHANNEL_VERSION = 1;
export const GIVEAWAY_PRESENTATION_HEARTBEAT_INTERVAL_MS = 2_000;
export const GIVEAWAY_PRESENTATION_STAGE_DISCONNECT_AFTER_MS = 6_000;

const channelPrefix = "tambike:giveaway-presentation:v1:";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GiveawayPresentationStageMessage = {
  version: typeof GIVEAWAY_PRESENTATION_CHANNEL_VERSION;
  type: "stage-ready" | "stage-heartbeat";
  channelId: string;
};

export type GiveawayPresentationControllerStateMessage = {
  version: typeof GIVEAWAY_PRESENTATION_CHANNEL_VERSION;
  type: "controller-state";
  channelId: string;
  eventId: string;
  giveawayId: string;
  drawId: string;
  resultDigest: string;
  state: GiveawayPresentationRuntimeState;
  presentation: OrganizerGiveawayPresentation;
  /** Ephemeral user-activation request; it is never part of persisted presentation state. */
  fullscreenRequestId?: number | null;
};

export function getGiveawayPresentationChannelName(channelId: string) {
  if (!isUuid(channelId)) throw new Error("INVALID_PRESENTATION_CHANNEL");
  return `${channelPrefix}${channelId.toLowerCase()}`;
}

export function parseGiveawayPresentationChannelName(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(channelPrefix)) return null;
  const channelId = value.slice(channelPrefix.length);
  return isUuid(channelId) && value === `${channelPrefix}${channelId}`
    ? channelId.toLowerCase()
    : null;
}

export function parseGiveawayPresentationStageMessage(
  value: unknown,
  expectedChannelId: string,
): GiveawayPresentationStageMessage | null {
  if (!isUuid(expectedChannelId) || !isRecord(value)) return null;
  if (!hasExactKeys(value, ["version", "type", "channelId"])) return null;
  if (
    value.version !== GIVEAWAY_PRESENTATION_CHANNEL_VERSION ||
    !["stage-ready", "stage-heartbeat"].includes(value.type as string) ||
    typeof value.channelId !== "string" ||
    value.channelId.toLowerCase() !== expectedChannelId.toLowerCase() ||
    !isUuid(value.channelId)
  ) {
    return null;
  }
  return value as GiveawayPresentationStageMessage;
}

type ExpectedControllerIdentity = {
  channelId: string;
  eventId: string;
  giveawayId: string;
  drawId?: string;
  resultDigest?: string;
};

export function parseGiveawayPresentationControllerStateMessage(
  value: unknown,
  expected: ExpectedControllerIdentity,
): GiveawayPresentationControllerStateMessage | null {
  if (!isUuid(expected.channelId) || !isRecord(value)) return null;
  const requiredKeys = [
    "version",
    "type",
    "channelId",
    "eventId",
    "giveawayId",
    "drawId",
    "resultDigest",
    "state",
    "presentation",
  ];
  const keys = Object.keys(value);
  if (
    !keys.every((key) => [...requiredKeys, "fullscreenRequestId"].includes(key)) ||
    !requiredKeys.every((key) => keys.includes(key))
  ) {
    return null;
  }
  if (
    value.version !== GIVEAWAY_PRESENTATION_CHANNEL_VERSION ||
    value.type !== "controller-state" ||
    typeof value.channelId !== "string" ||
    !isUuid(value.channelId) ||
    value.channelId.toLowerCase() !== expected.channelId.toLowerCase() ||
    value.eventId !== expected.eventId ||
    value.giveawayId !== expected.giveawayId ||
    (expected.drawId !== undefined && value.drawId !== expected.drawId) ||
    (expected.resultDigest !== undefined && value.resultDigest !== expected.resultDigest) ||
    !isSafeOpaqueId(value.eventId) ||
    !isSafeOpaqueId(value.giveawayId) ||
    !isSafeOpaqueId(value.drawId) ||
    typeof value.resultDigest !== "string" ||
    !/^[0-9a-f]{64}$/i.test(value.resultDigest) ||
    ("fullscreenRequestId" in value &&
      value.fullscreenRequestId !== null &&
      (!Number.isInteger(value.fullscreenRequestId) || (value.fullscreenRequestId as number) < 0))
  ) {
    return null;
  }

  const presentation = parseSafePresentation(value.presentation);
  if (
    !presentation ||
    presentation.eventId !== value.eventId ||
    presentation.giveawayId !== value.giveawayId ||
    presentation.drawId !== value.drawId ||
    presentation.resultDigest !== value.resultDigest ||
    !isGiveawayPresentationRuntimeStateValid(value.state, presentation.slides.length)
  ) {
    return null;
  }
  return value as GiveawayPresentationControllerStateMessage;
}

function parseSafePresentation(value: unknown): OrganizerGiveawayPresentation | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "giveawayId",
      "eventId",
      "drawId",
      "giveawayTitle",
      "drawStatus",
      "resultDigest",
      "candidateCount",
      "labelBank",
      "slides",
    ]) ||
    !isSafeOpaqueId(value.giveawayId) ||
    !isSafeOpaqueId(value.eventId) ||
    !isSafeOpaqueId(value.drawId) ||
    !isSafeText(value.giveawayTitle, 500) ||
    !["completed", "published"].includes(value.drawStatus as string) ||
    typeof value.resultDigest !== "string" ||
    !/^[0-9a-f]{64}$/i.test(value.resultDigest) ||
    !Number.isInteger(value.candidateCount) ||
    (value.candidateCount as number) < 0 ||
    !Array.isArray(value.labelBank) ||
    value.labelBank.length > 24 ||
    !value.labelBank.every((label) => isSafeText(label, 40)) ||
    !Array.isArray(value.slides)
  ) {
    return null;
  }

  for (let index = 0; index < value.slides.length; index += 1) {
    const slide = value.slides[index];
    if (
      !isRecord(slide) ||
      !hasExactKeys(slide, ["position", "prizePoolTitle", "prizeItemTitle", "winnerLabel"]) ||
      slide.position !== index + 1 ||
      !isSafeText(slide.prizePoolTitle, 500) ||
      !isSafeText(slide.prizeItemTitle, 500) ||
      !isSafeText(slide.winnerLabel, 40)
    ) {
      return null;
    }
  }
  return value as unknown as OrganizerGiveawayPresentation;
}

export function isGiveawayPresentationStageDisconnected(
  lastHeartbeatAt: number | null,
  now: number,
) {
  return (
    lastHeartbeatAt === null ||
    !Number.isFinite(lastHeartbeatAt) ||
    !Number.isFinite(now) ||
    lastHeartbeatAt > now ||
    now - lastHeartbeatAt >= GIVEAWAY_PRESENTATION_STAGE_DISCONNECT_AFTER_MS
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isSafeOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\p{Cc}\p{Cf}\s]/u.test(value)
  );
}

function isSafeText(value: unknown, maximumCharacters: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= maximumCharacters &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
