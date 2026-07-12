export type GiveawayKind = "raffle" | "giveaway";

export type GiveawayState =
  | "draft"
  | "scheduled"
  | "open"
  | "paused"
  | "locked"
  | "drawing"
  | "claims_open"
  | "completed"
  | "cancelled"
  | "suspended";

export type GiveawayComplianceStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "changes_requested"
  | "rejected";

export type GiveawayEntryMode = "automatic" | "opt_in" | "claim_code" | "manual_only";

export type GiveawayEligibilitySource =
  | "active_rsvp_pass"
  | "confirmed_check_in"
  | "staff_confirmed_check_in"
  | "perk_redemption"
  | "campaign_code"
  | "manual";

export type GiveawayAwardMode =
  | "random_draw"
  | "first_come"
  | "guaranteed"
  | "manual_selection";

export type GiveawayFulfilmentMode = "onsite" | "digital_code" | "delivery" | "manual_contact";

export type GiveawayPublicVisibility =
  | "event_page"
  | "registered_riders"
  | "eligible_riders"
  | "hidden";

export type GiveawayEligibilityConditionInput =
  | { source: "active_rsvp_pass" }
  | { source: "confirmed_check_in" }
  | { source: "staff_confirmed_check_in" }
  | { source: "perk_redemption"; perkId: string }
  | { source: "campaign_code" }
  | { source: "manual" };

export interface GiveawayEligibilityGroupInput {
  id: string;
  label: string;
  /** Number of draw units a rider receives when this group qualifies them. */
  weight: number;
  conditions: GiveawayEligibilityConditionInput[];
}

export type GiveawayPrizeInventoryInput =
  | { kind: "unlimited" }
  | { kind: "finite"; quantity: number };

export interface GiveawayPrizeItemInput {
  id?: string;
  title: string;
  description?: string;
}

export interface GiveawayPrizePoolInput {
  id: string;
  title: string;
  awardMode: GiveawayAwardMode;
  fulfilmentMode: GiveawayFulfilmentMode;
  inventory: GiveawayPrizeInventoryInput;
  items: GiveawayPrizeItemInput[];
  eligibilityGroupIds?: string[];
  perRiderLimit?: number;
  presenceVerificationRequired?: boolean;
}

export interface GiveawayWinnerLimitsInput {
  perRider: number;
  total: number;
}

export interface CreateGiveawayInput {
  eventId: string;
  title: string;
  kind: GiveawayKind;
  entryMode: GiveawayEntryMode;
  eligibilityGroups: GiveawayEligibilityGroupInput[];
  mechanics: string;
  terms: string;
  timeZone: string;
  winnerLimits: GiveawayWinnerLimitsInput;
  organizerAttestation: true;
  prizePools: GiveawayPrizePoolInput[];
  entryOpensAt?: string;
  entryClosesAt?: string;
  drawAt?: string | null;
  claimDeadlineAt?: string | null;
  publicVisibility?: GiveawayPublicVisibility;
  sponsorDisclosure?: string;
  presenceVerificationRequired?: boolean;
}

export type GiveawayConfigurationUpdateBundle =
  | {
      eligibilityGroups: GiveawayEligibilityGroupInput[];
      prizePools: GiveawayPrizePoolInput[];
    }
  | {
      eligibilityGroups?: never;
      prizePools?: never;
    };

export type GiveawayScheduleUpdateBundle =
  | {
      entryOpensAt: string;
      entryClosesAt: string;
      drawAt: string | null;
      claimDeadlineAt: string | null;
    }
  | {
      entryOpensAt?: never;
      entryClosesAt?: never;
      drawAt?: never;
      claimDeadlineAt?: never;
    };

/**
 * Partial campaign update. Eligibility groups and prize pools are an atomic
 * replacement bundle, as are all schedule fields. This prevents validation
 * from relying on unknown persisted configuration.
 */
export type UpdateGiveawayInput = {
  id: string;
} &
  Partial<
    Omit<
      CreateGiveawayInput,
      | "eventId"
      | "eligibilityGroups"
      | "prizePools"
      | "entryOpensAt"
      | "entryClosesAt"
      | "drawAt"
      | "claimDeadlineAt"
    >
  > &
  GiveawayConfigurationUpdateBundle &
  GiveawayScheduleUpdateBundle;

export interface PublicGiveawayPrizePoolSummary {
  id: string;
  title: string;
  awardMode: GiveawayAwardMode;
  fulfilmentMode: GiveawayFulfilmentMode;
  inventoryKind: GiveawayPrizeInventoryInput["kind"];
  itemQuantity?: number;
  items: Array<Pick<GiveawayPrizeItemInput, "id" | "title" | "description">>;
  presenceVerificationRequired: boolean;
}

/** Public/event-page data only. It deliberately excludes entrants and operational secrets. */
export interface PublicGiveawayCampaignSummary {
  id: string;
  eventId: string;
  title: string;
  kind: GiveawayKind;
  state: GiveawayState;
  complianceStatus: GiveawayComplianceStatus;
  entryMode: GiveawayEntryMode;
  mechanics: string;
  terms: string;
  timeZone: string;
  publicVisibility: GiveawayPublicVisibility;
  sponsorDisclosure?: string;
  entryOpensAt?: string;
  entryClosesAt?: string;
  drawAt?: string;
  claimDeadlineAt?: string;
  prizePools: PublicGiveawayPrizePoolSummary[];
}

export type RiderGiveawayEntryStatus =
  | "not_eligible"
  | "eligible"
  | "entered"
  | "selected"
  | "disqualified"
  | "claimed"
  | "fulfilled";

export interface RiderGiveawayAwardSummary {
  awardId: string;
  prizePoolTitle: string;
  status: Exclude<RiderGiveawayEntryStatus, "not_eligible" | "eligible" | "entered">;
  claimDeadlineAt?: string;
  fulfilmentMode: GiveawayFulfilmentMode;
}

/** Rider-scoped state. It has no other-rider data, source facts, or claim secret. */
export interface RiderGiveawayState {
  giveawayId: string;
  status: RiderGiveawayEntryStatus;
  entryCount: number;
  award?: RiderGiveawayAwardSummary;
}

/** Staff/operator view for a single award after a claim token has been resolved server-side. */
export interface OperatorGiveawayClaimView {
  awardId: string;
  giveawayId: string;
  /** Opaque operator-facing reference; never a rider name, email, or phone number. */
  claimReference: string;
  prizePoolTitle: string;
  fulfilmentMode: GiveawayFulfilmentMode;
  presenceVerificationRequired: boolean;
  claimDeadlineAt?: string;
  status: "pending" | "verified" | "fulfilled" | "expired" | "voided";
}

/** Public fairness proof. `seed` is omitted until a draw is published. */
export interface PublicGiveawayDrawVerification {
  giveawayId: string;
  commitment: string;
  snapshotDigest: string;
  snapshotCount: number;
  algorithmVersion: string;
  drawDigest: string;
  seed?: string;
}
