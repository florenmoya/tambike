import type {
  ProfileVisibility,
  RosterIdentity,
} from "@/features/member-profiles/types";
import { BackendError } from "../backend";

export const DEFAULT_ROSTER_PAGE_LIMIT = 24;
export const MAX_ROSTER_PAGE_LIMIT = 50;
export const PUBLIC_ATTENDEE_PREVIEW_LIMIT = 4;

export type RosterCursorValue = {
  goingAt: string;
  rsvpId: string;
};

export function compareRosterRsvpIds(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function invalidInput(): never {
  throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
}

export function normalizeRosterPageLimit(limit?: number) {
  if (limit === undefined) return DEFAULT_ROSTER_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) invalidInput();
  return Math.min(limit, MAX_ROSTER_PAGE_LIMIT);
}

export function encodeRosterCursor(value: RosterCursorValue) {
  return Buffer.from(JSON.stringify([value.goingAt, value.rsvpId]), "utf8").toString(
    "base64url",
  );
}

export function decodeRosterCursor(cursor: string): RosterCursorValue {
  if (typeof cursor !== "string" || !cursor || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    invalidInput();
  }

  let decoded: unknown;
  try {
    const buffer = Buffer.from(cursor, "base64url");
    if (buffer.toString("base64url") !== cursor) invalidInput();
    decoded = JSON.parse(buffer.toString("utf8"));
  } catch {
    invalidInput();
  }

  const goingAt = Array.isArray(decoded) && typeof decoded[0] === "string"
    ? new Date(decoded[0])
    : null;
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    typeof decoded[0] !== "string" ||
    !goingAt ||
    Number.isNaN(goingAt.getTime()) ||
    goingAt.toISOString() !== decoded[0] ||
    typeof decoded[1] !== "string" ||
    !decoded[1]
  ) {
    invalidInput();
  }

  const value = { goingAt: decoded[0], rsvpId: decoded[1] };
  if (encodeRosterCursor(value) !== cursor) invalidInput();
  return value;
}

export function classifyRosterEntry(input: {
  enabled: boolean;
  rosterIdentity: RosterIdentity;
  profileSlug?: string;
  profileVisibility: ProfileVisibility;
}) {
  if (!input.enabled) return "COUNT_ONLY" as const;
  if (input.rosterIdentity === "ANONYMOUS") return "ANONYMOUS" as const;
  if (!input.profileSlug || input.profileVisibility === "PRIVATE") {
    return "ANONYMOUS" as const;
  }
  return "VISIBLE" as const;
}
