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

export interface GiveawayUnlimitedPrizeInventoryInput {
  kind: "unlimited";
}

export interface GiveawayFinitePrizeInventoryInput {
  kind: "finite";
  quantity: number;
}

export type GiveawayPrizeInventoryInput =
  | GiveawayUnlimitedPrizeInventoryInput
  | GiveawayFinitePrizeInventoryInput;

export interface GiveawayPrizeItemInput {
  id?: string;
  title: string;
  description?: string;
}

export interface GiveawayPrizePoolBaseInput {
  id: string;
  title: string;
  fulfilmentMode: GiveawayFulfilmentMode;
  eligibilityGroupIds?: string[];
  perRiderLimit?: number;
  presenceVerificationRequired?: boolean;
}

export interface GiveawayGuaranteedPrizePoolInput extends GiveawayPrizePoolBaseInput {
  awardMode: "guaranteed";
  inventory: GiveawayUnlimitedPrizeInventoryInput;
  /** Guaranteed unlimited pools create no finite prize-item rows. */
  items: [];
}

export interface GiveawayFinitePrizePoolInput extends GiveawayPrizePoolBaseInput {
  awardMode: Exclude<GiveawayAwardMode, "guaranteed">;
  inventory: GiveawayFinitePrizeInventoryInput;
  /** One input creates one authoritative finite prize-item row. */
  items: [GiveawayPrizeItemInput, ...GiveawayPrizeItemInput[]];
}

export type GiveawayPrizePoolInput =
  | GiveawayGuaranteedPrizePoolInput
  | GiveawayFinitePrizePoolInput;

export interface GiveawayWinnerLimitsInput {
  perRider: number;
  total: number;
}

export interface CreateGiveawayInput {
  eventId: string;
  title: string;
  kind: GiveawayKind;
  entryMode: GiveawayEntryMode;
  /** Hard safety ceiling for automatic draw units granted to one rider. */
  maxEntriesPerRider: number;
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
  /** Number of authoritative finite item rows, when the pool is finite. */
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

/** One public winner result. It exists only after the winning rider explicitly opts in. */
export interface PublicGiveawayResult {
  prizePoolTitle: string;
  winnerAlias: string;
}

/** Event-page campaign data, with draw receipts/results only after publication. */
export interface PublicEventGiveaway {
  giveaway: PublicGiveawayCampaignSummary;
  results: PublicGiveawayResult[];
  drawVerifications: PublicGiveawayDrawVerification[];
}

/** Minimal campaign list item for organizer and administrator rails. */
export interface GiveawayCampaignListItem {
  id: string;
  eventId: string;
  title: string;
  state: GiveawayState;
  complianceStatus: GiveawayComplianceStatus;
  mechanicsVersion: number;
}

export type RiderGiveawayEntryStatus =
  | "not_eligible"
  | "eligible"
  | "entered"
  | "selected"
  | "pending_verification"
  | "claimable"
  | "verified"
  | "disqualified"
  | "declined"
  | "expired"
  | "voided"
  | "claimed"
  | "fulfilled";

export interface RiderGiveawayAwardSummary {
  awardId: string;
  prizePoolTitle: string;
  status: Exclude<RiderGiveawayEntryStatus, "not_eligible" | "eligible" | "entered">;
  claimDeadlineAt?: string;
  fulfilmentMode: GiveawayFulfilmentMode;
  /** The winning rider controls this public-only alias; it is never inferred from an entry reference. */
  winnerPublication?: {
    isPublic: boolean;
    alias?: string;
  };
}

/** A self-only receipt for a frozen entry after at least one draw is published. */
export interface RiderGiveawayDrawProof {
  entryReference: string;
  drawVerifications: PublicGiveawayDrawVerification[];
}

/** Rider-scoped state. It has no other-rider data, source facts, or claim secret. */
export interface RiderGiveawayState {
  giveawayId: string;
  status: RiderGiveawayEntryStatus;
  entryCount: number;
  award?: RiderGiveawayAwardSummary;
  proof?: RiderGiveawayDrawProof;
}

/** A rider's own campaign state when loading the giveaways for one event. */
export interface RiderEventGiveawayState {
  giveawayId: string;
  giveawayTitle: string;
  giveawayState: GiveawayState;
  entryMode: GiveawayEntryMode;
  riderState: RiderGiveawayState;
}

/**
 * Narrow award-id read for the authenticated winner's claim page. It never
 * includes a raw credential, its hash/version, entrant facts, or delivery PII.
 */
export interface RiderGiveawayClaimContext {
  awardId: string;
  giveawayId: string;
  giveawayTitle: string;
  giveawayState: GiveawayState;
  award: Omit<RiderGiveawayAwardSummary, "awardId">;
  deliveryDetailsSubmitted: boolean;
  claimCredentialIssued: boolean;
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
  status:
    | "pending_verification"
    | "claimable"
    | "verified"
    | "fulfilled"
    | "expired"
    | "voided";
}

/** Operator queue item scoped to one event, without rider or delivery details. */
export interface EventGiveawayOperatorQueueItem extends OperatorGiveawayClaimView {
  giveawayTitle: string;
}

/** Safe assignment candidate: display label only, never email, role, or status. */
export interface GiveawayOperatorCandidate {
  id: string;
  label: string;
}

/**
 * Editable organizer/admin configuration. It deliberately omits mechanics
 * checksums, reviewer identities, audit records, draw seeds, and entrant data.
 */
export interface OrganizerGiveawayWorkspace {
  id: string;
  eventId: string;
  title: string;
  kind: GiveawayKind;
  state: GiveawayState;
  complianceStatus: GiveawayComplianceStatus;
  entryMode: GiveawayEntryMode;
  maxEntriesPerRider: number;
  mechanics: string;
  terms: string;
  sponsorDisclosure?: string;
  timeZone: string;
  winnerLimits: GiveawayWinnerLimitsInput;
  publicVisibility: GiveawayPublicVisibility;
  presenceVerificationRequired: boolean;
  entryOpensAt?: string;
  entryClosesAt?: string;
  drawAt?: string;
  claimDeadlineAt?: string;
  eligibilityGroups: GiveawayEligibilityGroupInput[];
  prizePools: GiveawayPrizePoolInput[];
}

/** Safe organizer/admin code inventory; raw codes and token hashes never leave creation. */
export type GiveawayCampaignCodeStatus = "active" | "expired" | "exhausted" | "revoked";

export interface GiveawayCampaignCodeSummary {
  id: string;
  maxUses: number;
  usedUses: number;
  expiresAt: string;
  createdAt: string;
  status: GiveawayCampaignCodeStatus;
}

/** A raw code is returned exactly once from code creation and is never persisted in a DTO. */
export interface IssuedGiveawayCampaignCode {
  id: string;
  code: string;
  maxUses: number;
  expiresAt: string;
}

export interface CreateGiveawayCampaignCodeInput {
  maxUses: number;
  expiresAt?: string;
}

/** Event-scoped choice for an authorized organizer/admin manual-entry control. */
export interface GiveawayManualEntryCandidate {
  riderId: string;
  label: string;
}

export interface GrantManualGiveawayEntryInput {
  giveawayId: string;
  riderId: string;
  reason: string;
}

export interface RevokeManualGiveawayEntryInput {
  giveawayId: string;
  riderId: string;
  reason: string;
}

/** A winner must make an explicit, revocable choice before any alias is public. */
export type GiveawayWinnerPublicationInput =
  | {
      published: true;
      alias: string;
    }
  | {
      published: false;
      alias?: never;
    };

/** Returned exactly once to the authenticated winner; never persist or place this in a URL. */
export interface IssuedGiveawayClaimToken {
  awardId: string;
  token: string;
  qrPayload: string;
  version: number;
}

export type GiveawayClaimScannerMethod = "camera" | "upload" | "manual";

export interface VerifyGiveawayClaimInput {
  payload: string;
  method: GiveawayClaimScannerMethod;
  idempotencyKey: string;
  /** Required only where the prize pool requires an in-person attestation. */
  presenceObserved?: boolean;
}

export interface FulfillGiveawayAwardInput {
  awardId: string;
  idempotencyKey: string;
  /** Optional bounded non-secret operator reference, never a rider delivery address. */
  reference?: string;
}

export interface GiveawayDeliveryDetailsInput {
  consent: true;
  consentVersion: string;
  details: Record<string, unknown>;
}

/** Private, authorized fulfiller/admin response. Never include in global or rider DTOs. */
export interface PrivateGiveawayDeliveryDetails {
  awardId: string;
  consentVersion: string;
  retentionExpiresAt: string;
  details: Record<string, unknown>;
}

/** Nonsecret in-app notification categories. Claim secrets never belong here. */
export type GiveawayNotificationKind =
  | "giveaway_entry"
  | "giveaway_winner"
  | "giveaway_claim_verified"
  | "giveaway_claim_expired"
  | "giveaway_fulfilled";

/** A recipient-scoped notification. It is deliberately absent from DemoState. */
export interface GiveawayNotification {
  id: string;
  kind: GiveawayNotificationKind;
  title: string;
  body: string;
  href?: string;
  createdAt: string;
  readAt?: string;
}

/** Identity-free organizer report for one campaign. */
export interface OrganizerGiveawayReport {
  giveawayId: string;
  eventId: string;
  title: string;
  state: GiveawayState;
  complianceStatus: GiveawayComplianceStatus;
  entries: Record<"eligible" | "locked" | "disqualified" | "withdrawn", number>;
  awards: Record<
    | "pending_verification"
    | "claimable"
    | "verified"
    | "fulfilled"
    | "declined"
    | "disqualified"
    | "expired"
    | "voided",
    number
  >;
  prizePools: Array<{
    id: string;
    title: string;
    awardMode: GiveawayAwardMode;
    fulfilmentMode: GiveawayFulfilmentMode;
    availableItemCount?: number;
    reservedItemCount?: number;
    fulfilledItemCount?: number;
  }>;
}

/** Sanitized admin audit chain. Internal payloads and source facts are omitted. */
export interface AdminGiveawayAuditEvent {
  id: string;
  sequence: number;
  action: string;
  targetType: string;
  targetId?: string;
  actorUserId?: string;
  previousHash?: string;
  hash: string;
  createdAt: string;
}

export interface AdminGiveawayAudit {
  giveawayId: string;
  events: AdminGiveawayAuditEvent[];
}

export interface GiveawayLifecycleAdvanceResult {
  opened: number;
  locked: number;
  drawn: number;
  expired: number;
  completed: number;
  purgedDeliveryDetails: number;
}

/** Draw verification payload. Public/rider DTOs include it only after publication. */
export interface PublicGiveawayDrawVerification {
  giveawayId: string;
  commitment: string;
  snapshotDigest: string;
  snapshotCount: number;
  algorithmVersion: string;
  drawDigest: string;
  seed?: string;
}
