import "server-only";

import type { GiveawayNotificationKind } from "@/features/giveaways/types";

const claimSecretPattern = /tbk_gc1_[A-Za-z0-9_-]{43}|TAMBIKE:GIVEAWAY-CLAIM:v1:/i;

export type GiveawayNotificationDraft = {
  userId: string;
  kind: GiveawayNotificationKind;
  dedupeKey: string;
  title: string;
  body: string;
  href?: string;
};

type GiveawayNotificationSubject = {
  userId: string;
  giveawayId: string;
  giveawayTitle: string;
  awardId?: string;
};

/**
 * Produces the only notification copy used by giveaway domain writes. The
 * payload is deliberately nonsecret and carries an opaque route reference,
 * never a raw claim token, a delivery address, or eligibility source facts.
 */
export function createGiveawayNotificationDraft(
  kind: GiveawayNotificationKind,
  subject: GiveawayNotificationSubject,
): GiveawayNotificationDraft {
  assertSafeNotificationIdentifier(subject.userId);
  assertSafeNotificationIdentifier(subject.giveawayId);
  if (kind !== "giveaway_entry") {
    assertSafeNotificationIdentifier(subject.awardId);
  }

  const giveawayHref = `/giveaways/${encodeURIComponent(subject.giveawayId)}`;
  const awardHref = subject.awardId
    ? `/giveaway-claims/${encodeURIComponent(subject.awardId)}`
    : giveawayHref;
  // A campaign title is organizer-authored content. It must not make an
  // otherwise-valid domain write fail merely because it happens to resemble a
  // claim token, so substitute a generic label instead of persisting it.
  const title = claimSecretPattern.test(subject.giveawayTitle) ? "Giveaway" : subject.giveawayTitle;

  switch (kind) {
    case "giveaway_entry":
      return {
        userId: subject.userId,
        kind,
        dedupeKey: `giveaway-entry:${subject.giveawayId}:${subject.userId}`,
        title: `Entry confirmed: ${title}`,
        body: "Your giveaway entry is recorded. Any winner claim QR is issued only from your signed-in award screen.",
        href: giveawayHref,
      };
    case "giveaway_winner":
      return {
        userId: subject.userId,
        kind,
        dedupeKey: `giveaway-winner:${subject.awardId}`,
        title: `You were selected: ${title}`,
        body: "Open your award to review the next claim step.",
        href: awardHref,
      };
    case "giveaway_claim_verified":
      return {
        userId: subject.userId,
        kind,
        dedupeKey: `giveaway-claim-verified:${subject.awardId}`,
        title: `Claim verified: ${title}`,
        body: "Your claim has been verified and is ready for fulfilment.",
        href: awardHref,
      };
    case "giveaway_claim_expired":
      return {
        userId: subject.userId,
        kind,
        dedupeKey: `giveaway-claim-expired:${subject.awardId}`,
        title: `Claim expired: ${title}`,
        body: "The claim deadline has passed. Contact the organizer if you need help.",
        href: awardHref,
      };
    case "giveaway_fulfilled":
      return {
        userId: subject.userId,
        kind,
        dedupeKey: `giveaway-fulfilled:${subject.awardId}`,
        title: `Prize fulfilled: ${title}`,
        body: "Your prize fulfilment has been recorded.",
        href: awardHref,
      };
  }
}

export function assertSafeGiveawayNotification(draft: GiveawayNotificationDraft) {
  for (const value of [draft.title, draft.body, draft.href ?? "", draft.dedupeKey]) {
    assertSafeNotificationCopy(value);
  }
}

function assertSafeNotificationIdentifier(value: string | undefined): asserts value is string {
  if (typeof value !== "string" || !value || claimSecretPattern.test(value)) {
    throw new Error("INVALID_GIVEAWAY_NOTIFICATION");
  }
}

function assertSafeNotificationCopy(value: string) {
  if (claimSecretPattern.test(value)) {
    throw new Error("GIVEAWAY_NOTIFICATION_SECRET");
  }
}
