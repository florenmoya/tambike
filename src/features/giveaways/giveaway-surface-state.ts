import type {
  GiveawayEntryMode,
  GiveawayState,
  RiderGiveawayEntryStatus,
} from "./types";

const giveawayStateLabels: Record<GiveawayState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Entries open",
  paused: "Paused",
  locked: "Entries locked",
  drawing: "Drawing winners",
  claims_open: "Winners announced",
  completed: "Completed",
  cancelled: "Cancelled",
  suspended: "Suspended",
};

const giveawayEntryModeLabels: Record<GiveawayEntryMode, string> = {
  automatic: "Automatic entry",
  opt_in: "Opt-in entry",
  claim_code: "Code entry",
  manual_only: "Staff entry",
};

const riderGiveawayStatusLabels: Record<RiderGiveawayEntryStatus, string> = {
  not_eligible: "Not eligible yet",
  eligible: "Eligible",
  entered: "Entry recorded",
  selected: "Selected",
  pending_verification: "Awaiting verification",
  claimable: "Ready to claim",
  verified: "Claim verified",
  disqualified: "Not eligible",
  declined: "Declined",
  expired: "Claim expired",
  voided: "Award unavailable",
  claimed: "Claim received",
  fulfilled: "Fulfilled",
};

export function giveawayStateLabel(state: GiveawayState) {
  return giveawayStateLabels[state];
}

export function giveawayEntryModeLabel(entryMode: GiveawayEntryMode) {
  return giveawayEntryModeLabels[entryMode];
}

export function riderGiveawayStatusLabel(status: RiderGiveawayEntryStatus) {
  return riderGiveawayStatusLabels[status];
}

/** A credential can only be issued or presented while the claim is active. */
export function isGiveawayClaimActionable(status: RiderGiveawayEntryStatus) {
  return status === "pending_verification" || status === "claimable";
}

/** Notification links are server-issued, but the client still confines them to local routes. */
export function safeGiveawayNotificationHref(href?: string) {
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) {
    return undefined;
  }

  return href;
}

export function formatGiveawayMoment(value?: string, timeZone?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return undefined;
  }

  try {
    return new Intl.DateTimeFormat("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}
