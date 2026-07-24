import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaTambikeBackend } from "./prisma-backend";
import { getRuntimeDatabaseUrl } from "./database-url";
import type {
  AdminGiveawayAudit,
  CreateGiveawayCampaignCodeInput,
  CreateGiveawayInput,
  EventGiveawayOperatorQueueItem,
  GiveawayCampaignCodeStatus,
  GiveawayCampaignCodeSummary,
  FulfillGiveawayAwardInput,
  GiveawayCampaignListItem,
  GiveawayClaimScannerMethod,
  GiveawayComplianceStatus,
  GiveawayDeliveryDetailsInput,
  GiveawayEligibilityConditionInput,
  GiveawayEntryMode,
  GiveawayFulfilmentMode,
  GiveawayKind,
  GiveawayLifecycleAdvanceResult,
  GiveawayManualEntryCandidate,
  GiveawayManualAwardReplacementOptions,
  GiveawayManualSelectionCandidate,
  GiveawayNotification,
  GiveawayNotificationKind,
  GiveawayOperatorCandidate,
  GiveawayPrizePoolInput,
  GiveawayPublicVisibility,
  GiveawayState,
  GiveawayWinnerPublicationInput,
  IssuedGiveawayClaimToken,
  IssuedGiveawayCampaignCode,
  GrantManualGiveawayEntryInput,
  OrganizerGiveawayWorkspace,
  OrganizerGiveawayOperations,
  OrganizerGiveawayPresentation,
  OrganizerGiveawayReport,
  OperatorGiveawayClaimView,
  PrivateGiveawayDeliveryDetails,
  PublicEventGiveaway,
  PublicGiveawayCampaignSummary,
  PublicGiveawayDrawVerification,
  PublicGiveawayPrizePoolSummary,
  PublicGiveawayResult,
  RiderEventGiveawayState,
  RiderGiveawayClaimContext,
  RiderGiveawayState,
  ReplaceManualGiveawayAwardInput,
  SelectManualGiveawayAwardInput,
  UpdateGiveawayInput,
  VerifyGiveawayClaimInput,
} from "@/features/giveaways/types";
import {
  assertGiveawayLifecycleTransition,
  parseCreateGiveawayInput,
  validateGiveawayUpdateInput,
} from "@/features/giveaways/validation";
import { demoEvents, seedUsers } from "@/features/tambike-demo/data";
import { normalizeEventLocation } from "@/features/tambike-demo/event-location";
import {
  filterEventsByQuery,
  getEventCtaState,
  type EventQueryInput,
} from "@/features/tambike-demo/event-state";
import type {
  AccountRole,
  AttendanceType,
  CheckInConfiguration,
  CheckInMode,
  CheckInState,
  CheckInStatus,
  CreateEventInput,
  Event,
  EventType,
  OrganizerQrMode,
  Pass,
  ProfileInput,
  RSVP,
  ScanMethod,
  SelfCheckInContext,
  SelfCheckInQr,
  SelfCheckInResult,
  SignupInput,
  UserProfile,
} from "@/features/tambike-demo/types";
import type {
  MemberProfileEditorView,
  MemberProfileView,
  MotorcycleShowcase,
  EventAttendeeRosterPage,
  EventAttendeeSummary,
  ProfileVisibility,
  RosterIdentity,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "@/features/member-profiles/types";
import {
  classifyRosterEntry,
  compareRosterRsvpIds,
  decodeRosterCursor,
  encodeRosterCursor,
  normalizeRosterPageLimit,
} from "./member-profiles/roster-domain";
import { calculateGiveawayAuditHash, canonicalizeJson } from "./giveaways/audit";
import {
  buildPublicDrawVerification,
  createDrawSeedCommitment,
  decryptDrawSeed,
  encryptDrawSeed,
  generateDrawSeed,
  rankFrozenWeightedEntries,
  type EncryptedDrawSeed,
} from "./giveaways/draw-engine";
import {
  deriveGiveawayPresentationLabelPreview,
  deriveGiveawayPresentationLabels,
  isGiveawayLivePresentationOptedIn,
  type GiveawayPresentationLabelKindValue,
} from "./giveaways/presentation-labels";
import {
  buildOrganizerGiveawayPresentation,
  GiveawayPresentationIntegrityError,
} from "./giveaways/presentation";
import {
  createGiveawayClaimToken,
  decryptGiveawayDeliveryPayload,
  encryptGiveawayDeliveryPayload,
  hashGiveawayClaimToken,
  parseGiveawayClaimQrPayload,
  toGiveawayClaimQrPayload,
} from "./giveaways/claim-engine";
import {
  assertGiveawayEligibilityTimingIntegrity,
  compareGiveawayEntriesByPoolPriority,
  earliestGiveawayEligibilityTimestamp,
  latestGiveawayEligibilityTimestamp,
  reconcileGiveawayEligibilityTimings,
  resolveGiveawayPoolEligibilityPriority,
  type GiveawayEligibilityGroupTiming,
} from "./giveaways/eligibility-timing";
import { buildGiveawayCsv } from "./giveaways/export";
import {
  assertSafeGiveawayNotification,
  createGiveawayNotificationDraft,
  type GiveawayNotificationDraft,
} from "./giveaways/notifications";
import {
  canViewMemberProfile,
  parseMotorcycleInput,
  parseProfileInput,
  profileSlugBase,
  toMemberProfileEditorView,
  toMemberProfileView,
} from "./member-profiles/profile-domain";
import {
  createMemberMediaLifecycleService,
  MemberMediaLifecycleError,
  type AuthorizedMemberMediaDescriptor,
  type FinalizeMemberMediaInput,
  type FinalizedMemberMediaRecord,
  type MemberMediaLifecycleOptions,
  type MemberMediaPersistence,
} from "./member-media/service";
import { MemberMediaError } from "./member-media/types";

export class BackendError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "WRONG_EVENT"
      | "ALREADY_CHECKED_IN"
      | "CANCELLED_PASS"
      | "SELF_CHECK_IN_DISABLED"
      | "CHECK_IN_NOT_OPEN"
      | "QR_EXPIRED"
      | "UPLOAD_NOT_FOUND"
      | "UPLOAD_EXPIRED"
      | "UPLOAD_OWNERSHIP_MISMATCH"
      | "PHOTO_LIMIT"
      | "MEDIA_UNAVAILABLE"
      | "INVALID_IMAGE"
      | "GIVEAWAY_COMPLIANCE_REQUIRED"
      | "INVALID_GIVEAWAY_STATE"
      | "GIVEAWAY_ENTRY_MODE_LOCKED"
      | "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED"
      | "GIVEAWAY_ENTRY_NOT_OPEN"
      | "GIVEAWAY_ENTRY_MODE_INVALID"
      | "GIVEAWAY_ENTRY_NOT_ELIGIBLE"
      | "GIVEAWAY_ALREADY_ENTERED"
      | "GIVEAWAY_CODE_INVALID"
      | "GIVEAWAY_CODE_UNAVAILABLE"
      | "GIVEAWAY_PERK_UNAVAILABLE"
      | "GIVEAWAY_DRAW_CONFIGURATION_ERROR"
      | "GIVEAWAY_IDEMPOTENCY_CONFLICT"
      | "GIVEAWAY_AWARD_INVALID"
      | "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
    message = code,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export type RegistrationInput = {
  status: "interested" | "going";
  attendanceType: AttendanceType;
  clubName?: string;
};

export type SignupWithPasswordInput = SignupInput & {
  password: string;
};

export type AuditAction =
  | "USER_CREATED"
  | "SESSION_CREATED"
  | "PROFILE_UPDATED"
  | "EVENT_DRAFT_CREATED"
  | "RSVP_UPDATED"
  | "ROSTER_SETTINGS_UPDATED"
  | "PASS_CREATED"
  | "CHECK_IN_CREATED"
  | "CHECK_IN_CONFIRMED"
  | "CHECK_IN_SETTINGS_UPDATED"
  | "SELF_CHECK_IN_REQUESTED"
  | "ADMIN_PUBLISHED"
  | "ATTENDEE_EXPORT_CREATED"
  | "LEAD_EXPORT_CREATED"
  | "GIVEAWAY_CREATED"
  | "GIVEAWAY_UPDATED"
  | "GIVEAWAY_SUBMITTED_FOR_REVIEW"
  | "GIVEAWAY_COMPLIANCE_REVIEWED"
  | "GIVEAWAY_OPENED"
  | "GIVEAWAY_PAUSED"
  | "GIVEAWAY_LOCKED"
  | "GIVEAWAY_CANCELLED"
  | "GIVEAWAY_SUSPENDED"
  | "GIVEAWAY_ENTRY_RECONCILED"
  | "GIVEAWAY_ENTRY_OPTED_IN"
  | "GIVEAWAY_LIVE_PRESENTATION_OPTED_IN"
  | "GIVEAWAY_LIVE_PRESENTATION_REVOKED"
  | "GIVEAWAY_CAMPAIGN_CODE_CREATED"
  | "GIVEAWAY_CAMPAIGN_CODE_CLAIMED"
  | "GIVEAWAY_MANUAL_ENTRY_GRANTED"
  | "GIVEAWAY_MANUAL_ENTRY_REVOKED"
  | "GIVEAWAY_PERK_REDEEMED"
  | "GIVEAWAY_DRAW_COMPLETED"
  | "GIVEAWAY_DRAW_PUBLISHED"
  | "GIVEAWAY_WINNER_PUBLICATION_OPTED_IN"
  | "GIVEAWAY_WINNER_PUBLICATION_REVOKED"
  | "GIVEAWAY_AWARD_DECLINED"
  | "GIVEAWAY_AWARD_REDRAWN"
  | "GIVEAWAY_MANUAL_AWARD_SELECTED"
  | "GIVEAWAY_MANUAL_AWARD_REPLACED"
  | "GIVEAWAY_AWARD_VOIDED"
  | "GIVEAWAY_AWARD_DISQUALIFIED"
  | "GIVEAWAY_CLAIM_TOKEN_ISSUED"
  | "GIVEAWAY_CLAIM_VERIFIED"
  | "GIVEAWAY_AWARD_FULFILLED"
  | "GIVEAWAY_CLAIM_EXPIRED"
  | "GIVEAWAY_AWARD_RECOVERED"
  | "GIVEAWAY_AWARD_SETTLED"
  | "GIVEAWAY_DIRECT_RECOVERY_LINKED"
  | "GIVEAWAY_OPERATOR_GRANTED"
  | "GIVEAWAY_OPERATOR_REVOKED"
  | "GIVEAWAY_DELIVERY_SUBMITTED"
  | "GIVEAWAY_DELIVERY_READ"
  | "GIVEAWAY_DELIVERY_WITHDRAWN"
  | "GIVEAWAY_DELIVERY_PURGED"
  | "GIVEAWAY_COMPLETED"
  | "GIVEAWAY_SCHEDULED"
  | "GIVEAWAY_CRON_ADVANCED"
  | "GIVEAWAY_EXPORT_CREATED";

type BackendUser = UserProfile & {
  passwordHash: string;
  profileSlug?: string;
  profileBio?: string;
  profileVisibility?: ProfileVisibility;
  defaultRosterIdentity?: RosterIdentity;
  profilePhotoMediaId?: string;
  profilePhotoStorageKey?: string;
  profilePhotoMimeType?: string;
  profilePhotoWidth?: number;
  profilePhotoHeight?: number;
  profilePhotoFinalizedAt?: Date;
};

type BackendMotorcycle = {
  id: string;
  userId: string;
  make: string;
  model: string;
  year?: number;
  displacementCc?: number;
  nickname?: string;
  description?: string;
  photos: Array<{
    id: string;
    mediaId: string;
    storageKey: string;
    mimeType: string;
    position: number;
    width: number;
    height: number;
    finalizedAt: Date;
  }>;
};

type BackendMemberMediaCleanupIntent = {
  id: string;
  userId: string;
  storageKey: string;
  cleanupAfter: Date;
  claimToken?: string;
  claimExpiresAt?: Date;
  attemptCount: number;
  lastAttemptAt?: Date;
  createdAt: Date;
};

type SessionRecord = {
  token: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
};

type CheckInRecord = {
  id: string;
  eventId: string;
  passId: string;
  userId: string;
  scannedBy?: string;
  timestamp: string;
  confirmedAt?: string;
  status: CheckInStatus;
  method: ScanMethod;
  confirmationMethod?: ScanMethod;
};

type CheckInSettings = {
  eventId: string;
  mode: CheckInMode;
  state: CheckInState;
  qrMode: OrganizerQrMode;
  fixedQrAcknowledged: boolean;
};

type SelfCheckInSession = {
  eventId: string;
  expiresAt: number;
  revokedAt?: number;
};

type AuditRecord = {
  id: string;
  action: AuditAction;
  actorUserId?: string;
  targetId?: string;
  metadata?: Record<string, boolean>;
  createdAt: Date;
};

type PerkRedemptionRecord = {
  id: string;
  perkId: string;
  userId: string;
  status: "available" | "redeemed" | "cancelled";
  redeemedBy?: string;
  redeemedAt?: string;
};

type GiveawayMechanicsVersionRecord = {
  id: string;
  version: number;
  mechanics: string;
  terms: string;
  sponsorDisclosure?: string;
  checksum: string;
  createdByUserId: string;
  createdAt: string;
  reviewedByUserId?: string;
  reviewDecision?: GiveawayComplianceStatus;
  reviewReason?: string;
  reviewedAt?: string;
};

type GiveawayEligibilityConditionRecord = {
  id: string;
  condition: GiveawayEligibilityConditionInput;
};

type GiveawayEligibilityGroupRecord = {
  id: string;
  position: number;
  label: string;
  entryWeight: number;
  enabled: boolean;
  conditions: GiveawayEligibilityConditionRecord[];
};

type GiveawayPrizeItemRecord = {
  id: string;
  position: number;
  title: string;
  description?: string;
  status: "available" | "reserved" | "fulfilled" | "voided";
};

type GiveawayPrizePoolRecord = {
  id: string;
  position: number;
  title: string;
  awardMode: "random_draw" | "first_come" | "guaranteed" | "manual_selection";
  fulfilmentMode: GiveawayFulfilmentMode;
  inventoryKind: "finite" | "unlimited";
  inventoryLimit?: number;
  perRiderLimit?: number;
  presenceVerificationRequired: boolean;
  eligibilityGroupIds: string[];
  items: GiveawayPrizeItemRecord[];
};

type GiveawayEntryRecord = {
  id: string;
  riderId: string;
  status: "eligible" | "locked" | "disqualified" | "withdrawn";
  currentWeight: number;
  /** Retained through withdrawal; active timing rows are cleared instead. */
  eligibilityCycleAt: string;
  qualifiedSourceFingerprint: string;
  qualifiedGroupIds: string[];
  qualifiedEligibilityGroupTimings: GiveawayEligibilityGroupTiming[];
  entryPath: "automatic" | "opt_in" | "campaign_code" | "manual";
  mechanicsAcknowledgement?: {
    version: number;
    checksum: string;
    acknowledgedAt: string;
  };
  campaignCodeId?: string;
  manualGrantActive?: boolean;
  opaquePublicReference: string;
  livePresentationOptedInAt?: string;
  livePresentationRevokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ImmediateGiveawayCandidate = Pick<
  GiveawayEntryRecord,
  | "id"
  | "riderId"
  | "eligibilityCycleAt"
  | "qualifiedGroupIds"
  | "qualifiedEligibilityGroupTimings"
>;

type GiveawayEntryEventRecord = {
  id: string;
  entryId: string;
  type:
    | "automatic_qualified"
    | "opted_in"
    | "campaign_code_claimed"
    | "manual_grant"
    | "manual_revoke"
    | "source_revalidated";
  sourceKey: string;
  sourceSnapshot?: Record<string, unknown>;
  weightDelta: number;
  actorUserId?: string;
  idempotencyKey: string;
  createdAt: string;
};

type GiveawayAuditEventRecord = {
  id: string;
  sequence: number;
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  canonicalPayload: string;
  payload: Record<string, unknown>;
  previousHash?: string;
  hash: string;
  createdAt: string;
};

type GiveawayCampaignCodeRecord = {
  id: string;
  tokenHash: string;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  createdByUserId: string;
  createdAt: string;
  revokedAt?: string;
  claimedRiderIds: Set<string>;
};

type GiveawaySnapshotEntryRecord = Readonly<{
  id: string;
  entryId: string;
  riderId: string;
  opaquePublicReference: string;
  frozenWeight: number;
  eligibilityCycleAt: string;
  qualifiedSourceFingerprint: string;
  qualifiedGroupIds: readonly string[];
  qualifiedEligibilityGroupTimings: readonly GiveawayEligibilityGroupTiming[];
  rankSourceDigest: string;
  presentationLabel?: string;
  presentationLabelKind?: GiveawayPresentationLabelKindValue;
}>;

type GiveawaySnapshotRecord = {
  id: string;
  mechanicsVersionId: string;
  mechanicsVersion: number;
  configDigest: string;
  snapshotDigest: string;
  candidateCount: number;
  seedCommitment: string;
  encryptedSeed: EncryptedDrawSeed;
  encryptionKeyVersion: string;
  algorithmVersion: "hmac-sha256-v1";
  lockedByUserId: string;
  lockedAt: string;
  seedRevealedAt?: string;
  entries: readonly GiveawaySnapshotEntryRecord[];
};

type GiveawayDrawRecord = {
  id: string;
  snapshotId: string;
  sequence: number;
  type: "initial" | "redraw";
  status: "completed" | "published";
  idempotencyKey: string;
  algorithmVersion: "hmac-sha256-v1" | "manual-selection-v1";
  inputDigest: string;
  resultDigest: string;
  initiatedByUserId: string;
  reasonDigest?: string;
  completedAt: string;
  publishedAt?: string;
  awardIds: string[];
};

type GiveawayDrawActionInput = {
  action: "initial_random_draw" | "manual_selection" | "redraw" | "manual_replacement";
  reasonDigest: string | null;
  prizePoolId?: string;
  riderId?: string;
  snapshotEntryId?: string;
  predecessorAwardId?: string;
  claimDeadlineAt?: string;
};

type GiveawayAwardRecord = {
  id: string;
  entryId: string;
  drawId?: string;
  prizePoolId: string;
  prizeItemId?: string;
  snapshotEntryId?: string;
  winnerUserId: string;
  status:
    | "pending_verification"
    | "claimable"
    | "verified"
    | "fulfilled"
    | "declined"
    | "disqualified"
    | "expired"
    | "voided"
    | "superseded";
  isCurrent: boolean;
  rank?: number;
  directAllocationKey?: string;
  /** Frozen pool-specific priority used for an entry-time award. */
  allocationEligibilityAt?: string;
  opaqueClaimReference: string;
  claimTokenHash?: string;
  claimTokenIssuedAt?: string;
  claimTokenVersion: number;
  claimDeadlineAt?: string;
  reasonDigest?: string;
  /** One-way terminal resolution for a historical direct-award recovery source. */
  recoveryClosedAt?: string;
  recoveryClosedReasonDigest?: string;
  /** Immutable successor link. At most one award can consume a source slot. */
  recoverySourceAwardId?: string;
  predecessorAwardId?: string;
  /** Rider-controlled public alias and its consent timeline; never defaulted from entry data. */
  publicWinnerAlias?: string;
  winnerAliasOptedInAt?: string;
  winnerAliasRevokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ElapsedDirectGiveawayRecoveryReservation = {
  reservedTotalAwardSlots: number;
  protectedPrizeItemIdsByPool: ReadonlyMap<string, ReadonlySet<string>>;
};

type GiveawayClaimVerificationRecord = {
  id: string;
  awardId: string;
  method: GiveawayClaimScannerMethod;
  result: "verified";
  operatorActorUserId: string;
  idempotencyKey: string;
  requestDigest: string;
  presenceObserved: boolean;
  createdAt: string;
};

type GiveawayFulfillmentRecord = {
  id: string;
  awardId: string;
  type: GiveawayFulfilmentMode;
  status: "fulfilled";
  operatorActorUserId: string;
  idempotencyKey: string;
  requestDigest: string;
  reference?: string;
  fulfilledAt: string;
  createdAt: string;
};

type GiveawayDeliveryDetailRecord = {
  id: string;
  awardId: string;
  submittedByUserId: string;
  consentVersion: string;
  payloadVersion: string;
  aadVersion: string;
  encryptionKeyVersion: string;
  encryptedPayload?: string;
  encryptedIv?: string;
  encryptedAuthTag?: string;
  winnerConsentedAt: string;
  retentionExpiresAt: string;
  purgedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type GiveawayOperatorRecord = {
  id: string;
  giveawayId: string;
  userId: string;
  grantedByUserId: string;
  grantedAt: string;
  revokedByUserId?: string;
  revokedAt?: string;
  revocationReasonDigest?: string;
  createdAt: string;
  updatedAt: string;
};

type GiveawayNotificationRecord = GiveawayNotification & {
  userId: string;
  dedupeKey: string;
};

type GiveawayAggregate = {
  id: string;
  eventId: string;
  creatorUserId: string;
  organizerAttestedById?: string;
  complianceReviewerId?: string;
  suspendedByUserId?: string;
  title: string;
  kind: GiveawayKind;
  state: GiveawayState;
  complianceStatus: GiveawayComplianceStatus;
  entryMode: GiveawayEntryMode;
  maxEntriesPerRider: number;
  publicVisibility: GiveawayPublicVisibility;
  timeZone: string;
  entryOpensAt?: string;
  entryClosesAt?: string;
  drawAt?: string;
  claimDeadlineAt?: string;
  maxWinsPerRider: number;
  maxWinsTotal: number;
  organizerAttestedAt?: string;
  complianceReviewedAt?: string;
  complianceReviewReason?: string;
  suspendedAt?: string;
  suspensionReason?: string;
  presenceVerificationRequired: boolean;
  createdAt: string;
  updatedAt: string;
  mechanicsVersions: GiveawayMechanicsVersionRecord[];
  eligibilityGroups: GiveawayEligibilityGroupRecord[];
  campaignCodes: GiveawayCampaignCodeRecord[];
  entriesByRider: Map<string, GiveawayEntryRecord>;
  entryEvents: GiveawayEntryEventRecord[];
  prizePools: GiveawayPrizePoolRecord[];
  snapshot?: GiveawaySnapshotRecord;
  draws: GiveawayDrawRecord[];
  awards: GiveawayAwardRecord[];
  claimVerifications: GiveawayClaimVerificationRecord[];
  fulfillments: GiveawayFulfillmentRecord[];
  deliveryDetails: GiveawayDeliveryDetailRecord[];
  operators: GiveawayOperatorRecord[];
  auditEvents: GiveawayAuditEventRecord[];
};

type GiveawayStore = {
  campaignsById: Map<string, GiveawayAggregate>;
  giveawayIdsByEventId: Map<string, Set<string>>;
  mechanicsVersionsById: Map<string, GiveawayMechanicsVersionRecord>;
  eligibilityGroupsById: Map<string, GiveawayEligibilityGroupRecord>;
  entriesById: Map<string, GiveawayEntryRecord>;
  entryEventsById: Map<string, GiveawayEntryEventRecord>;
  prizePoolsById: Map<string, GiveawayPrizePoolRecord>;
  prizeItemsById: Map<string, GiveawayPrizeItemRecord>;
  campaignCodesById: Map<string, GiveawayCampaignCodeRecord>;
  snapshotsById: Map<string, GiveawaySnapshotRecord>;
  drawsById: Map<string, GiveawayDrawRecord>;
  awardsById: Map<string, GiveawayAwardRecord>;
  claimVerificationsById: Map<string, GiveawayClaimVerificationRecord>;
  fulfillmentsById: Map<string, GiveawayFulfillmentRecord>;
  deliveryDetailsByAwardId: Map<string, GiveawayDeliveryDetailRecord>;
  operatorsById: Map<string, GiveawayOperatorRecord>;
  auditEventsById: Map<string, GiveawayAuditEventRecord>;
};

type GiveawayCampaignView = GiveawayCampaignListItem;

type GiveawayConditionEvaluation = {
  satisfied: boolean;
  eligibleAt?: string;
  sourceFact: Record<string, unknown>;
};

type QualifiedAutomaticGiveawayGroup = {
  group: GiveawayEligibilityGroupRecord;
  sourceFacts: Record<string, unknown>[];
  derivedEligibleAt: string;
};

type BackendSeed = {
  users: BackendUser[];
  events: Event[];
  rsvps: Array<RSVP & { userId: string; goingAt?: string; id?: string }>;
  passes: Array<Pass & { userId: string }>;
  giveaways: GiveawayAggregate[];
  perkRedemptions: PerkRedemptionRecord[];
};

export type TambikeTestFixture = {
  users?: Array<UserProfile & { password: string }>;
  rsvps?: Array<RSVP & { userId: string; goingAt?: string; id?: string }>;
  passes?: Array<Pass & { userId: string }>;
};

export type TambikeTestSeedOptions = {
  fixture?: TambikeTestFixture;
  perkQuantities?: Record<string, number>;
  /** Deterministic test seam for counterfactual draw comparisons. */
  generateGiveawayDrawSeed?: () => Uint8Array;
  /** Deterministic test seam for IDs that participate in frozen draw state. */
  generateGiveawayUuid?: () => string;
  memberMedia?: MemberMediaLifecycleOptions;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cloneEvent(event: Event): Event {
  return {
    ...event,
    tags: [...event.tags],
    riskFlags: [...event.riskFlags],
    rules: [...event.rules],
    perks: event.perks.map((perk) => ({ ...perk })),
    rideOut: event.rideOut ? { ...event.rideOut } : undefined,
  };
}

function cloneUser(user: BackendUser): UserProfile {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    verificationStatus: user.verificationStatus,
    area: user.area,
    bikeModel: user.bikeModel,
    clubName: user.clubName,
    joinedAt: user.joinedAt,
    organizerProfileId: user.organizerProfileId,
  };
}

function makeSessionToken() {
  return randomBytes(32).toString("base64url");
}

function makePassToken() {
  return `tbk_${randomBytes(32).toString("base64url")}`;
}

function validateSignupPassword(password: string) {
  if (password.trim().length < 8) {
    throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  }
}

function validateCheckInConfiguration(input: CheckInConfiguration) {
  if (
    !["staff_only", "self_review", "self_instant"].includes(input.mode) ||
    !["closed", "open", "paused"].includes(input.state) ||
    !["rotating", "fixed"].includes(input.qrMode) ||
    (input.qrMode === "fixed" && input.fixedQrAcknowledged !== true)
  ) {
    throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  }
}

function normalizeStaffScanMethod(method: ScanMethod): "staff_camera" | "staff_upload" | "staff_manual" {
  switch (method) {
    case "staff_camera":
    case "staff_upload":
    case "staff_manual":
      return method;
    case "qr":
      return "staff_camera";
    case "manual":
      return "staff_manual";
    default:
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  }
}

function passIdForEvent(eventId: string, userId: string) {
  return `pass-${eventId}-${userId}`;
}

function defaultRulesForEvent(type: EventType) {
  const baseRules = ["Helmet required", "No racing", "No stunts", "No revving"];
  if (type === "Track Day" || type === "Race") {
    return [...baseRules, "Follow marshal instructions"];
  }

  return [...baseRules, "Respect event staff"];
}

async function createSeed(options: TambikeTestSeedOptions = {}): Promise<BackendSeed> {
  const passwordHash = await bcrypt.hash("password123", 10);
  const adminPasswordHash = await bcrypt.hash("secret_123", 10);
  const fixtureUsers = await Promise.all(
    (options.fixture?.users ?? []).map(async ({ password, ...user }) => ({
      ...user,
      passwordHash: await bcrypt.hash(password, 10),
    })),
  );
  const users: BackendUser[] = [
    ...seedUsers.map<BackendUser>((user) => ({
      ...user,
      passwordHash: user.role === "admin" ? adminPasswordHash : passwordHash,
    })),
    ...fixtureUsers,
  ];

  const events = demoEvents.map(cloneEvent);
  for (const event of events) {
    for (const perk of event.perks) {
      const quantity = options.perkQuantities?.[perk.id];
      if (quantity !== undefined) {
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error("INVALID_TEST_PERK_QUANTITY");
        }
        perk.quantity = quantity;
      }
    }
  }

  return {
    users,
    events,
    rsvps: (options.fixture?.rsvps ?? []).map((rsvp) => ({
      ...rsvp,
      rosterIdentity: rsvp.rosterIdentity ?? "ANONYMOUS",
    })),
    passes: (options.fixture?.passes ?? []).map((pass) => ({ ...pass })),
    giveaways: [],
    perkRedemptions: [],
  };
}

export class TambikeBackend {
  private readonly users = new Map<string, BackendUser>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events = new Map<string, Event>();
  private readonly rsvps = new Map<string, RSVP & { userId: string; goingAt?: string; id?: string }>();
  private readonly rosterSettings = new Map<string, boolean>();
  private readonly passes = new Map<string, Pass & { userId: string }>();
  private readonly motorcycles = new Map<string, BackendMotorcycle>();
  private readonly memberMediaCleanupIntents = new Map<string, BackendMemberMediaCleanupIntent>();
  private readonly checkIns = new Map<string, CheckInRecord>();
  private readonly checkInSettings = new Map<string, CheckInSettings>();
  private readonly selfCheckInSessions = new Map<string, SelfCheckInSession>();
  private readonly perkRedemptions = new Map<string, PerkRedemptionRecord>();
  /** Recipient-scoped notifications are never included in DemoState/getSnapshot(). */
  private readonly giveawayNotifications = new Map<string, GiveawayNotificationRecord>();
  private readonly giveawayNotificationIdsByUserDedupeKey = new Map<string, string>();
  /**
   * Giveaway data is intentionally absent from getSnapshot()/DemoState. Only
   * privacy-scoped giveaway methods may read this aggregate.
   */
  private readonly giveaways: GiveawayStore = {
    campaignsById: new Map(),
    giveawayIdsByEventId: new Map(),
    mechanicsVersionsById: new Map(),
    eligibilityGroupsById: new Map(),
    entriesById: new Map(),
    entryEventsById: new Map(),
    prizePoolsById: new Map(),
    prizeItemsById: new Map(),
    campaignCodesById: new Map(),
    snapshotsById: new Map(),
    drawsById: new Map(),
    awardsById: new Map(),
    claimVerificationsById: new Map(),
    fulfillmentsById: new Map(),
    deliveryDetailsByAwardId: new Map(),
    operatorsById: new Map(),
    auditEventsById: new Map(),
  };
  private readonly audits: AuditRecord[] = [];
  private readonly memberMedia;

  private readonly generateGiveawayDrawSeed: () => Uint8Array;
  private readonly generateGiveawayUuid: () => string;

  private constructor(seed: BackendSeed, options: TambikeTestSeedOptions) {
    this.generateGiveawayDrawSeed = options.generateGiveawayDrawSeed ?? generateDrawSeed;
    this.generateGiveawayUuid = options.generateGiveawayUuid ?? randomUUID;
    this.memberMedia = createMemberMediaLifecycleService(options.memberMedia);
    for (const user of seed.users) {
      this.users.set(user.id, { ...user });
    }

    for (const event of seed.events) {
      this.events.set(event.id, cloneEvent(event));
    }

    for (const rsvp of seed.rsvps) {
      this.rsvps.set(`${rsvp.eventId}:${rsvp.userId}`, { ...rsvp });
    }

    for (const pass of seed.passes) {
      this.passes.set(pass.id, { ...pass });
    }

    for (const redemption of seed.perkRedemptions) {
      this.perkRedemptions.set(redemption.id, { ...redemption });
    }

    for (const giveaway of seed.giveaways) {
      this.hydrateGiveawayAggregate(giveaway);
    }
  }

  static async create(options: TambikeTestSeedOptions = {}) {
    return new TambikeBackend(await createSeed(options), options);
  }

  getSnapshot(sessionToken?: string) {
    const currentUser = sessionToken ? this.getUserForSessionToken(sessionToken) : null;
    const currentPasses = currentUser
      ? Array.from(this.passes.values())
          .filter((pass) => pass.userId === currentUser.id)
          .map((pass) => ({
            id: pass.id,
            eventId: pass.eventId,
            qrToken: pass.qrToken,
            status: pass.status,
            generatedAt: pass.generatedAt,
          }))
      : [];

    const events = this.listEvents();

    return {
      currentUser: currentUser ? cloneUser(currentUser) : null,
      users:
        currentUser?.role === "admin" && currentUser.verificationStatus !== "SUSPENDED"
          ? this.listPublicUsers()
          : [],
      events,
      passes: currentPasses,
      checkInSettings: events.map((event) => ({ ...this.getCheckInSettings(event.id) })),
      passCreated: currentPasses.length > 0,
    };
  }

  async signUpRider(input: SignupWithPasswordInput) {
    const email = input.email.trim().toLowerCase();
    validateSignupPassword(input.password);
    const passwordHash = await bcrypt.hash(input.password, 10);
    if (!email || this.findUserByEmail(email)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const user: BackendUser = {
      id: `user-${slugify(email || input.displayName)}`,
      displayName: input.displayName.trim(),
      email,
      role: "rider",
      verificationStatus: "UNVERIFIED",
      area: input.area.trim(),
      bikeModel: input.bikeModel?.trim() || undefined,
      clubName: input.clubName?.trim() || undefined,
      joinedAt: "July 4, 2026",
      passwordHash,
    };

    this.users.set(user.id, user);
    this.audit("USER_CREATED", user.id, user.id);
    const session = this.createSessionForUser(user.id);

    return {
      user: cloneUser(user),
      sessionToken: session.token,
    };
  }

  async loginWithPassword(email: string, password: string) {
    const user = this.findUserByEmail(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }

    const session = this.createSessionForUser(user.id);
    return {
      user: cloneUser(user),
      sessionToken: session.token,
    };
  }

  async getCurrentUser(sessionToken?: string | null) {
    if (!sessionToken) {
      return null;
    }

    const user = this.getUserForSessionToken(sessionToken);
    return user ? cloneUser(user) : null;
  }

  async updateProfile(sessionToken: string, input: ProfileInput) {
    const user = this.requireUser(sessionToken);
    const updated: BackendUser = {
      ...user,
      displayName: input.displayName.trim(),
      area: input.area.trim(),
      bikeModel: input.bikeModel?.trim() || undefined,
      clubName: input.clubName?.trim() || undefined,
    };

    this.users.set(updated.id, updated);
    this.audit("PROFILE_UPDATED", user.id, user.id);
    return cloneUser(updated);
  }

  async getMemberProfile(
    sessionToken: string | undefined,
    slug: string,
  ): Promise<MemberProfileView> {
    const profile = Array.from(this.users.values()).find(
      (candidate) => candidate.profileSlug === slug,
    );
    if (!profile?.profileSlug) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    const sessionUser = sessionToken ? this.getUserForSessionToken(sessionToken) : null;
    const viewer =
      sessionUser && sessionUser.verificationStatus !== "SUSPENDED"
        ? { role: sessionUser.role, ownsProfile: sessionUser.id === profile.id }
        : null;
    const visibility = profile.profileVisibility ?? "PRIVATE";
    if (!canViewMemberProfile(viewer, visibility)) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return this.toMemberProfileView(profile);
  }

  async getMemberProfileEditor(sessionToken: string): Promise<MemberProfileEditorView> {
    const user = this.requireUser(sessionToken);
    return toMemberProfileEditorView(
      {
        ...this.toInternalMemberProfile(user),
        slug: user.profileSlug ?? null,
      },
      user.defaultRosterIdentity ?? "ANONYMOUS",
    );
  }

  async updateMemberProfile(
    sessionToken: string,
    input: UpdateMemberProfileInput,
  ): Promise<MemberProfileEditorView> {
    const user = this.requireUser(sessionToken);
    let parsed: UpdateMemberProfileInput;
    try {
      parsed = parseProfileInput(input);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const profileSlug = user.profileSlug ?? this.allocateProfileSlug(parsed.displayName);
    const updated: BackendUser = {
      ...user,
      displayName: parsed.displayName,
      area: parsed.area,
      profileSlug,
      profileBio: parsed.bio,
      profileVisibility: parsed.visibility,
      defaultRosterIdentity: parsed.defaultRosterIdentity,
    };
    this.users.set(updated.id, updated);
    this.audit("PROFILE_UPDATED", user.id, user.id);
    return this.getMemberProfileEditor(sessionToken);
  }

  async upsertMotorcycle(
    sessionToken: string,
    input: UpsertMotorcycleInput,
  ): Promise<MotorcycleShowcase> {
    const user = this.requireUser(sessionToken);
    let parsed: UpsertMotorcycleInput;
    try {
      parsed = parseMotorcycleInput(input);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const existing = this.motorcycles.get(user.id);
    const motorcycle: BackendMotorcycle = {
      id: existing?.id ?? `motorcycle-${randomUUID()}`,
      userId: user.id,
      make: parsed.make,
      model: parsed.model,
      year: parsed.year,
      displacementCc: parsed.displacementCc,
      nickname: parsed.nickname,
      description: parsed.description,
      photos: existing?.photos ?? [],
    };
    this.motorcycles.set(user.id, motorcycle);
    return this.toMemberProfileView(user).motorcycle!;
  }

  async createMemberMediaUpload(sessionToken: string, mimeType: string) {
    const user = this.requireUser(sessionToken);
    try {
      return await this.memberMedia.createUpload(user.id, mimeType);
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async finalizeMemberMedia(sessionToken: string, input: FinalizeMemberMediaInput) {
    const user = this.requireUser(sessionToken);
    try {
      return await this.memberMedia.finalize(
        user.id,
        input,
        this.memberMediaPersistence(),
      );
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async deleteMemberMedia(sessionToken: string, mediaId: string) {
    const user = this.requireUser(sessionToken);
    try {
      await this.memberMedia.delete(user.id, mediaId, this.memberMediaPersistence());
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async drainMemberMediaCleanup(now: Date = new Date()) {
    return this.memberMedia.drainPendingCleanup(this.memberMediaPersistence(), { now });
  }

  async reorderMotorcyclePhotos(sessionToken: string, mediaIds: string[]) {
    const user = this.requireUser(sessionToken);
    try {
      await this.memberMedia.reorder(user.id, mediaIds, this.memberMediaPersistence());
      return this.getMemberProfileEditor(sessionToken);
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async getMemberMedia(sessionToken: string | undefined, mediaId: string) {
    const descriptor = this.resolveMemberMediaDescriptor(sessionToken, mediaId);
    try {
      return await this.memberMedia.read(descriptor);
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async createEventDraft(sessionToken: string, input: CreateEventInput) {
    const user = this.requireUser(sessionToken);
    if (
      user.role !== "organizer" ||
      user.verificationStatus !== "APPROVED" ||
      !user.organizerProfileId
    ) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const title = input.title.trim();
    const date = input.date.trim();
    const time = input.time.trim();
    const perkPreview = input.perkPreview.trim();
    const expectedRiders = Number(input.expectedRiders);
    const location = normalizeEventLocation(input);
    if (
      !title ||
      !date ||
      !time ||
      !perkPreview ||
      !Number.isInteger(expectedRiders) ||
      expectedRiders <= 0 ||
      !location
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const baseId = slugify(title);
    const eventId = this.events.has(baseId) ? `${baseId}-${this.events.size + 1}` : baseId;
    const event: Event = {
      id: eventId,
      title,
      type: input.type,
      status: "PENDING_ADMIN_REVIEW",
      organizerId: user.organizerProfileId,
      ...location,
      poster: "/demo/poster-tambike-cafe-classico.jpg",
      date,
      time,
      shortDescription: `${title} is awaiting admin review.`,
      whatHappens: "Organizer-created event submitted directly for admin review and publication.",
      going: 0,
      interested: 0,
      expectedRiders,
      perkPreview,
      tags: [input.type, "Admin review"],
      riskFlags: this.riskFlagsFor(input.type, expectedRiders),
      rules: defaultRulesForEvent(input.type),
      perks: [
        {
          id: `perk-${eventId}`,
          type: "Check-in perk",
          description: perkPreview,
        },
      ],
    };

    this.events.set(event.id, event);
    this.checkInSettings.set(event.id, {
      eventId: event.id,
      mode: "staff_only",
      state: "closed",
      qrMode: "rotating",
      fixedQrAcknowledged: false,
    });
    this.audit("EVENT_DRAFT_CREATED", user.id, event.id);
    return cloneEvent(event);
  }

  async createGiveaway(sessionToken: string, eventId: string, input: CreateGiveawayInput) {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireGiveawayConfigurator(user, event);
    const parsed = this.parseCreateGiveaway(input);
    if (parsed.eventId !== event.id) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const giveaway = this.buildGiveawayAggregate(user.id, event.id, parsed);
    this.hydrateGiveawayAggregate(giveaway);
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_CREATED", "giveaway", giveaway.id, {
      state: giveaway.state,
      complianceStatus: giveaway.complianceStatus,
      mechanicsVersion: 1,
    });

    return this.toGiveawayCampaignView(giveaway);
  }

  async updateGiveaway(sessionToken: string, input: UpdateGiveawayInput) {
    const user = this.requireUser(sessionToken);
    const parsed = this.parseUpdateGiveaway(input);
    const giveaway = this.requireGiveaway(parsed.id);
    const event = this.requireEvent(giveaway.eventId);
    this.requireGiveawayConfigurator(user, event);
    if (["locked", "drawing", "claims_open", "completed", "cancelled", "suspended"].includes(giveaway.state)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (giveaway.state === "open") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }

    const patch = parsed as Record<string, unknown>;
    const currentMechanics = this.currentGiveawayMechanics(giveaway);
    const hasEntrantHistory = giveaway.entriesByRider.size > 0 || giveaway.entryEvents.length > 0;
    if (
      Object.hasOwn(patch, "entryMode") &&
      patch.entryMode !== giveaway.entryMode &&
      hasEntrantHistory
    ) {
      throw new BackendError("GIVEAWAY_ENTRY_MODE_LOCKED", "GIVEAWAY_ENTRY_MODE_LOCKED");
    }
    const hasConfigurationPatch =
      Object.hasOwn(patch, "eligibilityGroups") && Object.hasOwn(patch, "prizePools");
    const nextWinnerLimits = Object.hasOwn(patch, "winnerLimits")
      ? (patch.winnerLimits as CreateGiveawayInput["winnerLimits"])
      : undefined;
    const changesEntrantFacingConfiguration =
      (Object.hasOwn(patch, "mechanics") && patch.mechanics !== currentMechanics.mechanics) ||
      (Object.hasOwn(patch, "terms") && patch.terms !== currentMechanics.terms) ||
      (Object.hasOwn(patch, "sponsorDisclosure") &&
        patch.sponsorDisclosure !== currentMechanics.sponsorDisclosure) ||
      (Object.hasOwn(patch, "kind") && patch.kind !== giveaway.kind) ||
      (Object.hasOwn(patch, "maxEntriesPerRider") &&
        patch.maxEntriesPerRider !== giveaway.maxEntriesPerRider) ||
      (Object.hasOwn(patch, "presenceVerificationRequired") &&
        Boolean(patch.presenceVerificationRequired) !== giveaway.presenceVerificationRequired) ||
      hasConfigurationPatch ||
      (nextWinnerLimits !== undefined &&
        (giveaway.maxWinsPerRider !== nextWinnerLimits.perRider ||
          giveaway.maxWinsTotal !== nextWinnerLimits.total));
    if (hasEntrantHistory && changesEntrantFacingConfiguration) {
      throw new BackendError(
        "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED",
        "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED",
      );
    }
    const hasAwardHistory = giveaway.awards.length > 0;
    if (
      hasAwardHistory &&
      (hasConfigurationPatch ||
        (nextWinnerLimits !== undefined &&
          (giveaway.maxWinsPerRider !== nextWinnerLimits.perRider ||
            giveaway.maxWinsTotal !== nextWinnerLimits.total)))
    ) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    let nextMechanics = currentMechanics.mechanics;
    let nextTerms = currentMechanics.terms;
    let nextSponsorDisclosure = currentMechanics.sponsorDisclosure;
    let changed = false;
    if (Object.hasOwn(patch, "title") && patch.title !== giveaway.title) {
      giveaway.title = patch.title as string;
      changed = true;
    }
    if (Object.hasOwn(patch, "timeZone") && patch.timeZone !== giveaway.timeZone) {
      giveaway.timeZone = patch.timeZone as string;
      changed = true;
    }
    if (Object.hasOwn(patch, "mechanics") && patch.mechanics !== currentMechanics.mechanics) {
      nextMechanics = patch.mechanics as string;
      changed = true;
    }
    if (Object.hasOwn(patch, "terms") && patch.terms !== currentMechanics.terms) {
      nextTerms = patch.terms as string;
      changed = true;
    }
    if (
      Object.hasOwn(patch, "sponsorDisclosure") &&
      patch.sponsorDisclosure !== currentMechanics.sponsorDisclosure
    ) {
      nextSponsorDisclosure = patch.sponsorDisclosure as string;
      changed = true;
    }

    if (Object.hasOwn(patch, "kind") && patch.kind !== giveaway.kind) {
      giveaway.kind = patch.kind as GiveawayKind;
      changed = true;
    }
    if (Object.hasOwn(patch, "entryMode") && patch.entryMode !== giveaway.entryMode) {
      giveaway.entryMode = patch.entryMode as GiveawayEntryMode;
      changed = true;
    }
    if (Object.hasOwn(patch, "maxEntriesPerRider")) {
      const next = patch.maxEntriesPerRider as number;
      if (next !== giveaway.maxEntriesPerRider) {
        giveaway.maxEntriesPerRider = next;
        changed = true;
      }
    }
    if (
      Object.hasOwn(patch, "publicVisibility") &&
      patch.publicVisibility !== giveaway.publicVisibility
    ) {
      giveaway.publicVisibility = patch.publicVisibility as GiveawayPublicVisibility;
      changed = true;
    }
    if (Object.hasOwn(patch, "presenceVerificationRequired")) {
      const next = Boolean(patch.presenceVerificationRequired);
      if (next !== giveaway.presenceVerificationRequired) {
        giveaway.presenceVerificationRequired = next;
        changed = true;
      }
    }
    if (Object.hasOwn(patch, "winnerLimits")) {
      const limits = patch.winnerLimits as CreateGiveawayInput["winnerLimits"];
      if (
        giveaway.maxWinsPerRider !== limits.perRider ||
        giveaway.maxWinsTotal !== limits.total
      ) {
        giveaway.maxWinsPerRider = limits.perRider;
        giveaway.maxWinsTotal = limits.total;
        changed = true;
      }
    }
    if (hasConfigurationPatch) {
      this.replaceGiveawayConfiguration(
        giveaway,
        patch.eligibilityGroups as CreateGiveawayInput["eligibilityGroups"],
        patch.prizePools as CreateGiveawayInput["prizePools"],
      );
      changed = true;
    }
    if (Object.hasOwn(patch, "entryOpensAt")) {
      const entryOpensAt = patch.entryOpensAt as string;
      const entryClosesAt = patch.entryClosesAt as string;
      const drawAt = patch.drawAt as string | null;
      const claimDeadlineAt = patch.claimDeadlineAt as string | null;
      if (
        giveaway.entryOpensAt !== entryOpensAt ||
        giveaway.entryClosesAt !== entryClosesAt ||
        giveaway.drawAt !== (drawAt ?? undefined) ||
        giveaway.claimDeadlineAt !== (claimDeadlineAt ?? undefined)
      ) {
        giveaway.entryOpensAt = entryOpensAt;
        giveaway.entryClosesAt = entryClosesAt;
        giveaway.drawAt = drawAt ?? undefined;
        giveaway.claimDeadlineAt = claimDeadlineAt ?? undefined;
        changed = true;
      }
    }

    if (!changed) return this.toGiveawayCampaignView(giveaway);

    const mechanicsChanged =
      nextMechanics !== currentMechanics.mechanics ||
      nextTerms !== currentMechanics.terms ||
      nextSponsorDisclosure !== currentMechanics.sponsorDisclosure;

    giveaway.updatedAt = new Date().toISOString();
    giveaway.complianceStatus = "draft";
    giveaway.complianceReviewerId = undefined;
    giveaway.complianceReviewedAt = undefined;
    giveaway.complianceReviewReason = undefined;
    if (mechanicsChanged) {
      this.createGiveawayMechanicsVersion(giveaway, user.id, {
        mechanics: nextMechanics,
        terms: nextTerms,
        sponsorDisclosure: nextSponsorDisclosure,
      });
    }
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_UPDATED", "giveaway", giveaway.id, {
      mechanicsVersion: giveaway.mechanicsVersions.at(-1)?.version ?? 1,
      complianceStatus: giveaway.complianceStatus,
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async listOrganizerGiveaways(sessionToken: string, eventId: string) {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireGiveawayConfigurator(user, event);
    return Array.from(this.giveaways.giveawayIdsByEventId.get(event.id) ?? [])
      .map((id) => this.requireGiveaway(id))
      .map((giveaway) => this.toGiveawayCampaignView(giveaway));
  }

  /** Configuration-only workspace read for the event owner or an administrator. */
  async getOrganizerGiveawayWorkspace(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OrganizerGiveawayWorkspace> {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    return this.toOrganizerGiveawayWorkspace(giveaway);
  }

  /**
   * Server-owned operational state for an organizer/admin workspace. It is
   * deliberately separate from the aggregate report so a page reload cannot
   * lose which actions are valid, while entrants and sensitive award data stay
   * outside the DTO.
   */
  async getOrganizerGiveawayOperations(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OrganizerGiveawayOperations> {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    const recoverableAwards: OrganizerGiveawayOperations["recoverableAwards"] = [];
    // Recovery actions must never accidentally inherit an elapsed campaign
    // deadline. Keep this decision server-owned so the workspace does not
    // infer it from a terminal award status (void/disqualify can happen after
    // the campaign deadline, too).
    const claimDeadlineRequired = !this.hasUsableGiveawayReplacementDeadline(giveaway);
    for (const award of giveaway.awards) {
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      if (!pool) continue;
      const terminalStatus = award.status;
      if (!["declined", "voided", "disqualified", "expired"].includes(terminalStatus)) {
        continue;
      }
      if (!this.isDirectGiveawayAward(award) && award.isCurrent && award.drawId && award.snapshotEntryId) {
        const draw = this.giveaways.drawsById.get(award.drawId);
        if (
          draw?.algorithmVersion === "hmac-sha256-v1" &&
          pool.awardMode === "random_draw" &&
          ["drawing", "claims_open"].includes(giveaway.state)
        ) {
          recoverableAwards.push({
            awardId: award.id,
            label: `Random redraw for ${pool.title}`,
            status: terminalStatus as OrganizerGiveawayOperations["recoverableAwards"][number]["status"],
            recoveryKind: "random_redraw",
            claimDeadlineRequired,
          });
          continue;
        }
        if (
          draw?.algorithmVersion === "manual-selection-v1" &&
          pool.awardMode === "manual_selection" &&
          giveaway.state === "claims_open" &&
          award.prizeItemId &&
          !giveaway.awards.some((candidate) => candidate.predecessorAwardId === award.id)
        ) {
          recoverableAwards.push({
            awardId: award.id,
            label: `Manual replacement for ${pool.title}`,
            status: terminalStatus as OrganizerGiveawayOperations["recoverableAwards"][number]["status"],
            recoveryKind: "manual_replacement",
            claimDeadlineRequired,
          });
          continue;
        }
      }
      if (
        this.isDirectGiveawayAward(award) &&
        giveaway.state === "claims_open" &&
        !award.isCurrent &&
        !award.recoveryClosedAt &&
        ["expired", "voided", "disqualified", "declined"].includes(terminalStatus) &&
        this.isGiveawayClaimDeadlineElapsed(award) &&
        ["first_come", "guaranteed"].includes(pool.awardMode)
      ) {
        recoverableAwards.push({
          awardId: award.id,
          label: `Direct re-offer for ${pool.title}`,
          status: terminalStatus as OrganizerGiveawayOperations["recoverableAwards"][number]["status"],
          recoveryKind: "direct_reoffer",
          // Direct re-offer has always taken an award-specific fresh deadline,
          // regardless of the campaign-level deadline.
          claimDeadlineRequired: true,
        });
      }
    }
    const publishableDraw = giveaway.draws
      .filter((draw) => draw.status === "completed")
      .sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id))[0];
    const presentationDraws = giveaway.draws.filter(
      (draw) =>
        draw.type === "initial" &&
        draw.algorithmVersion === "hmac-sha256-v1" &&
        ["completed", "published"].includes(draw.status),
    );
    if (presentationDraws.length > 1) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    return {
      giveawayId: giveaway.id,
      canCancel: giveaway.awards.length === 0 && ["draft", "scheduled", "open", "paused"].includes(giveaway.state),
      canRunInitialRandomDraw:
        ["locked", "drawing"].includes(giveaway.state) &&
        giveaway.prizePools.some((pool) => pool.awardMode === "random_draw") &&
        !giveaway.draws.some(
          (draw) => draw.type === "initial" && draw.algorithmVersion === "hmac-sha256-v1",
        ),
      presentationDrawId: presentationDraws[0]?.id ?? null,
      publishableDrawId: publishableDraw?.id ?? null,
      recoverableAwards: recoverableAwards.sort(
        (left, right) => left.label.localeCompare(right.label) || left.awardId.localeCompare(right.awardId),
      ),
    };
  }

  async getOrganizerGiveawayPresentation(
    sessionToken: string,
    giveawayId: string,
    drawId: string,
  ): Promise<OrganizerGiveawayPresentation> {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    const draw = giveaway.draws.find((candidate) => candidate.id === drawId);
    if (!draw) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const snapshot = giveaway.snapshot;
    if (!snapshot) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const campaigns = [...this.giveaways.campaignsById.values()];
    const requireCurrentOwner = (
      owners: GiveawayAggregate[],
      code: "INVALID_GIVEAWAY_STATE" | "GIVEAWAY_AWARD_INVALID",
    ) => {
      if (owners.length !== 1 || owners[0] !== giveaway) {
        throw new BackendError(code, code);
      }
      return owners[0];
    };
    if (this.giveaways.drawsById.get(draw.id) !== draw) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (this.giveaways.snapshotsById.get(snapshot.id) !== snapshot) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    requireCurrentOwner(
      campaigns.filter((candidate) => candidate.draws.includes(draw)),
      "INVALID_GIVEAWAY_STATE",
    );
    const snapshotOwner = requireCurrentOwner(
      campaigns.filter((candidate) => candidate.snapshot === snapshot),
      "INVALID_GIVEAWAY_STATE",
    );
    const presentationEntries = snapshot.entries.map((snapshotEntry) => {
      const entry = this.giveaways.entriesById.get(snapshotEntry.entryId);
      if (!entry || entry.riderId !== snapshotEntry.riderId) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const entryOwner = requireCurrentOwner(
        campaigns.filter(
          (candidate) => candidate.entriesByRider.get(entry.riderId) === entry,
        ),
        "GIVEAWAY_AWARD_INVALID",
      );
      return { ...snapshotEntry, giveawayId: entryOwner.id };
    });
    const drawAwardIds = new Set(draw.awardIds);
    if (drawAwardIds.size !== draw.awardIds.length) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const presentationAwards = draw.awardIds.map((awardId) => {
      const award = giveaway.awards.find((candidate) => candidate.id === awardId);
      if (
        !award ||
        award.drawId !== draw.id ||
        this.giveaways.awardsById.get(award.id) !== award
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const awardOwner = requireCurrentOwner(
        campaigns.filter((candidate) => candidate.awards.includes(award)),
        "GIVEAWAY_AWARD_INVALID",
      );
      return { ...award, giveawayId: awardOwner.id };
    });
    const storedAwardsForDraw = [
      ...new Set([
        ...this.giveaways.awardsById.values(),
        ...campaigns.flatMap((candidate) => candidate.awards),
      ]),
    ].filter((award) => award.drawId === draw.id);
    for (const award of storedAwardsForDraw) {
      requireCurrentOwner(
        campaigns.filter((candidate) => candidate.awards.includes(award)),
        "GIVEAWAY_AWARD_INVALID",
      );
      if (
        !drawAwardIds.has(award.id) ||
        this.giveaways.awardsById.get(award.id) !== award ||
        giveaway.awards.find((candidate) => candidate.id === award.id) !== award
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
    }
    if (storedAwardsForDraw.length !== drawAwardIds.size) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }

    try {
      return buildOrganizerGiveawayPresentation({
        giveawayId: giveaway.id,
        eventId: giveaway.eventId,
        giveawayTitle: giveaway.title,
        draw,
        snapshot: {
          ...snapshot,
          giveawayId: snapshotOwner.id,
          entries: presentationEntries,
        },
        prizePools: giveaway.prizePools,
        awards: presentationAwards,
      });
    } catch (error) {
      if (error instanceof GiveawayPresentationIntegrityError) {
        throw new BackendError(error.code, error.code);
      }
      throw error;
    }
  }

  /**
   * Authorized configuration inventory only. The raw campaign code and its
   * stored hash remain creation/audit-only secrets.
   */
  async listGiveawayCampaignCodes(
    sessionToken: string,
    giveawayId: string,
  ): Promise<GiveawayCampaignCodeSummary[]> {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    if (giveaway.entryMode !== "claim_code") {
      throw new BackendError("GIVEAWAY_ENTRY_MODE_INVALID", "GIVEAWAY_ENTRY_MODE_INVALID");
    }
    const now = Date.now();

    return [...giveaway.campaignCodes]
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .map((code) => {
        const status: GiveawayCampaignCodeStatus = code.revokedAt
          ? "revoked"
          : new Date(code.expiresAt).getTime() <= now
            ? "expired"
            : code.useCount >= code.maxUses
              ? "exhausted"
              : "active";
        return {
          id: code.id,
          maxUses: code.maxUses,
          usedUses: code.useCount,
          expiresAt: code.expiresAt,
          createdAt: code.createdAt,
          status,
        };
      });
  }

  /**
   * An actionable manual-entry picker. It stays event-scoped and returns no
   * rider contact details, source facts, or existing entry state.
   */
  async listGiveawayManualEntryCandidates(
    sessionToken: string,
    giveawayId: string,
  ): Promise<GiveawayManualEntryCandidate[]> {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    if (giveaway.state !== "open" || giveaway.entryMode !== "manual_only") return [];

    const actionAt = new Date().toISOString();
    const candidatesByRiderId = new Map<string, GiveawayManualEntryCandidate>();
    for (const riderId of this.riderIdsWithEventActivity(giveaway.eventId)) {
      const rider = this.users.get(riderId);
      if (!rider || rider.role !== "rider" || rider.verificationStatus === "SUSPENDED") continue;
      const qualification = this.evaluateGiveawayEntryQualification(giveaway, rider.id, {
        manual: true,
        actionAt,
      });
      if (qualification.weight <= 0) continue;
      candidatesByRiderId.set(rider.id, {
        riderId: rider.id,
        label: rider.displayName.trim() || "Unnamed rider",
      });
    }
    for (const entry of giveaway.entriesByRider.values()) {
      if (
        entry.entryPath !== "manual" ||
        entry.status !== "eligible" ||
        !entry.manualGrantActive
      ) {
        continue;
      }
      const rider = this.users.get(entry.riderId);
      if (!rider) continue;
      candidatesByRiderId.set(rider.id, {
        riderId: rider.id,
        label: rider.displayName.trim() || "Unnamed rider",
      });
    }
    return [...candidatesByRiderId.values()].sort(
      (left, right) => left.label.localeCompare(right.label) || left.riderId.localeCompare(right.riderId),
    );
  }

  /**
   * Manual award selection is limited to the immutable locked snapshot. This
   * intentionally returns only an opaque entry reference; it never reads or
   * returns current rider activity, profile, contact, or source-fact data.
   */
  async listGiveawayManualSelectionCandidates(
    sessionToken: string,
    giveawayId: string,
    prizePoolId: string,
  ): Promise<GiveawayManualSelectionCandidate[]> {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    const snapshot = giveaway.snapshot;
    if (!snapshot || !["locked", "drawing"].includes(giveaway.state)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const pool = giveaway.prizePools.find((candidate) => candidate.id === prizePoolId);
    if (!pool || pool.awardMode !== "manual_selection") {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    if (!pool.items.some((item) => item.status === "available")) return [];

    return [...snapshot.entries]
      .filter((entry) => this.isSnapshotEntryEligibleForPool(entry, pool))
      .filter((entry) => this.canCreateGiveawayAward(giveaway, pool, entry.riderId))
      .sort((left, right) => left.opaquePublicReference.localeCompare(right.opaquePublicReference))
      .map((entry) => ({
        snapshotEntryId: entry.id,
        label: `Locked entry ${entry.opaquePublicReference}`,
      }));
  }

  /**
   * A terminal manual award is replaced from its original frozen snapshot; it
   * is never rerolled. This safe, owner/admin-only read intentionally exposes
   * opaque entry references instead of rider identity, entry provenance, or
   * claim data.
   */
  async listManualGiveawayReplacementCandidates(
    sessionToken: string,
    sourceAwardId: string,
  ): Promise<GiveawayManualAwardReplacementOptions> {
    const organizer = this.requireUser(sessionToken);
    const sourceAward = this.giveaways.awardsById.get(
      this.requireOpaqueGiveawayLedgerText(sourceAwardId),
    );
    if (!sourceAward) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const giveaway = this.requireGiveawayByAward(sourceAward);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    if (giveaway.state !== "claims_open" || !sourceAward.isCurrent) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const { snapshot, pool } = this.requireManualGiveawayReplacementSource(giveaway, sourceAward);
    const candidates = this.manualGiveawayReplacementCandidates(
      giveaway,
      snapshot,
      pool,
      sourceAward.id,
    );
    return {
      sourceAwardId: sourceAward.id,
      label: `Manual replacement for ${pool.title}`,
      status: sourceAward.status as GiveawayManualAwardReplacementOptions["status"],
      claimDeadlineRequired: !this.hasUsableGiveawayReplacementDeadline(giveaway),
      candidates,
    };
  }

  /** Minimal cross-event administrator campaign list; entrant records stay private. */
  async listAdminGiveaways(sessionToken: string): Promise<GiveawayCampaignListItem[]> {
    this.requireRole(sessionToken, "admin");
    return Array.from(this.giveaways.campaignsById.values())
      .sort(
        (left, right) =>
          left.eventId.localeCompare(right.eventId) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .map((giveaway) => this.toGiveawayCampaignView(giveaway));
  }

  async getOrganizerGiveawayReport(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OrganizerGiveawayReport> {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));

    const entries: OrganizerGiveawayReport["entries"] = {
      eligible: 0,
      locked: 0,
      disqualified: 0,
      withdrawn: 0,
    };
    for (const entry of giveaway.entriesByRider.values()) {
      entries[entry.status] += 1;
    }
    const awards: OrganizerGiveawayReport["awards"] = {
      pending_verification: 0,
      claimable: 0,
      verified: 0,
      fulfilled: 0,
      declined: 0,
      disqualified: 0,
      expired: 0,
      voided: 0,
    };
    for (const award of giveaway.awards) {
      if (award.status !== "superseded") awards[award.status] += 1;
    }

    return {
      giveawayId: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      state: giveaway.state,
      complianceStatus: giveaway.complianceStatus,
      entries,
      awards,
      prizePools: giveaway.prizePools.map((pool) => ({
        id: pool.id,
        title: pool.title,
        awardMode: pool.awardMode,
        fulfilmentMode: pool.fulfilmentMode,
        ...(pool.inventoryKind === "finite"
          ? {
              availableItemCount: pool.items.filter((item) => item.status === "available").length,
              reservedItemCount: pool.items.filter((item) => item.status === "reserved").length,
              fulfilledItemCount: pool.items.filter((item) => item.status === "fulfilled").length,
            }
          : {}),
      })),
    };
  }

  async getAdminGiveawayAudit(sessionToken: string, giveawayId: string): Promise<AdminGiveawayAudit> {
    this.requireRole(sessionToken, "admin");
    const giveaway = this.requireGiveaway(giveawayId);
    return {
      giveawayId: giveaway.id,
      events: giveaway.auditEvents.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        action: event.action,
        targetType: event.targetType,
        ...(event.targetId ? { targetId: event.targetId } : {}),
        ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
        ...(event.previousHash ? { previousHash: event.previousHash } : {}),
        hash: event.hash,
        createdAt: event.createdAt,
      })),
    };
  }

  async listGiveawayNotifications(sessionToken: string): Promise<GiveawayNotification[]> {
    const user = this.requireUser(sessionToken);
    return Array.from(this.giveawayNotifications.values())
      .filter((notification) => notification.userId === user.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .map((notification) => ({
        id: notification.id,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        ...(notification.href ? { href: notification.href } : {}),
        createdAt: notification.createdAt,
        ...(notification.readAt ? { readAt: notification.readAt } : {}),
      }));
  }

  async exportGiveawayCsv(sessionToken: string, giveawayId: string) {
    const administrator = this.requireRole(sessionToken, "admin");
    const giveaway = this.requireGiveaway(giveawayId);
    const event = this.requireEvent(giveaway.eventId);
    const awardByEntryId = new Map<string, GiveawayAwardRecord[]>();
    for (const award of giveaway.awards) {
      const records = awardByEntryId.get(award.entryId) ?? [];
      records.push(award);
      awardByEntryId.set(award.entryId, records);
    }
    const rows: Array<Record<string, unknown>> = [];
    for (const entry of giveaway.entriesByRider.values()) {
      const awards = awardByEntryId.get(entry.id) ?? [undefined];
      for (const award of awards) {
        const pool = award ? giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId) : undefined;
        const item = award && pool?.items.find((candidate) => candidate.id === award.prizeItemId);
        const rider = this.users.get(entry.riderId);
        rows.push({
          giveaway_id: giveaway.id,
          event_id: event.id,
          giveaway_title: giveaway.title,
          entry_reference: entry.opaquePublicReference,
          entry_status: entry.status,
          entry_path: entry.entryPath,
          award_id: award?.id ?? "",
          award_status: award?.status ?? "",
          prize_pool: pool?.title ?? "",
          prize_item: item?.title ?? "",
          winner_user_id: award?.winnerUserId ?? "",
          winner_email: award ? rider?.email ?? "" : "",
          entry_created_at: entry.createdAt,
          award_created_at: award?.createdAt ?? "",
        });
      }
    }
    const csv = buildGiveawayCsv(
      [
        "giveaway_id",
        "event_id",
        "giveaway_title",
        "entry_reference",
        "entry_status",
        "entry_path",
        "award_id",
        "award_status",
        "prize_pool",
        "prize_item",
        "winner_user_id",
        "winner_email",
        "entry_created_at",
        "award_created_at",
      ],
      rows,
    );
    this.auditGiveaway(giveaway, administrator.id, "GIVEAWAY_EXPORT_CREATED", "giveaway", giveaway.id, {
      rowCount: rows.length,
      format: "csv",
    });
    return csv;
  }

  async getPublicGiveaway(giveawayId: string, sessionToken?: string): Promise<PublicGiveawayCampaignSummary> {
    const giveaway = this.requireGiveaway(giveawayId);
    const event = this.requireEvent(giveaway.eventId);
    if (
      !["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status) ||
      !this.isPublicEventGiveaway(giveaway) ||
      giveaway.publicVisibility === "hidden"
    ) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    if (giveaway.publicVisibility === "registered_riders") {
      const rider = this.requireUser(sessionToken ?? "");
      if (!this.canViewPublicEventGiveaway(giveaway, rider.id)) {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
    }

    if (giveaway.publicVisibility === "eligible_riders") {
      const rider = this.requireUser(sessionToken ?? "");
      if (!this.canViewPublicEventGiveaway(giveaway, rider.id)) {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
    }

    return this.toPublicGiveaway(giveaway);
  }

  /**
   * Public event-page campaign list. Restricted campaign visibility quietly
   * filters nonmembers instead of leaking the campaign's existence.
   */
  async listPublicGiveawaysForEvent(
    eventId: string,
    sessionToken?: string,
  ): Promise<PublicEventGiveaway[]> {
    const event = this.requireEvent(eventId);
    if (!["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status)) return [];
    const viewer = sessionToken ? this.getUserForSessionToken(sessionToken) : null;
    const viewerId = viewer?.verificationStatus === "SUSPENDED" ? undefined : viewer?.id;
    return Array.from(this.giveaways.giveawayIdsByEventId.get(eventId) ?? [])
      .map((id) => this.requireGiveaway(id))
      .filter((giveaway) => this.canViewPublicEventGiveaway(giveaway, viewerId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((giveaway) => ({
        giveaway: this.toPublicGiveaway(giveaway),
        results: this.toPublicGiveawayResults(giveaway),
        drawVerifications: this.toPublicGiveawayDrawVerifications(giveaway),
      }));
  }

  async getRiderGiveawayState(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState> {
    const rider = this.requireUser(sessionToken);
    if (rider.role !== "rider") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }
    const giveaway = this.requireGiveaway(giveawayId);
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async setGiveawayLivePresentationPreference(
    sessionToken: string,
    giveawayId: string,
    optedIn: boolean,
  ): Promise<RiderGiveawayState> {
    const rider = this.requireGiveawayRider(sessionToken);
    if (typeof optedIn !== "boolean") throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    const giveaway = this.requireGiveaway(giveawayId);
    if (giveaway.state !== "open") {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_OPEN", "GIVEAWAY_ENTRY_NOT_OPEN");
    }
    const entry = giveaway.entriesByRider.get(rider.id);
    if (!entry || entry.status !== "eligible") {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    }
    if (!optedIn && !isGiveawayLivePresentationOptedIn({
      optedInAt: entry.livePresentationOptedInAt,
      revokedAt: entry.livePresentationRevokedAt,
    })) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const now = new Date().toISOString();
    if (optedIn) {
      entry.livePresentationOptedInAt = now;
      entry.livePresentationRevokedAt = undefined;
    } else {
      entry.livePresentationRevokedAt = now;
    }
    entry.updatedAt = now;
    this.auditGiveaway(
      giveaway,
      rider.id,
      optedIn
        ? "GIVEAWAY_LIVE_PRESENTATION_OPTED_IN"
        : "GIVEAWAY_LIVE_PRESENTATION_REVOKED",
      "entry",
      entry.id,
      { optedIn },
    );
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  /** Rider-only event list; hidden campaigns appear only when the rider has their own state. */
  async listRiderGiveawayStatesForEvent(
    sessionToken: string,
    eventId: string,
  ): Promise<RiderEventGiveawayState[]> {
    const rider = this.requireGiveawayRider(sessionToken);
    this.requireEvent(eventId);
    const states: RiderEventGiveawayState[] = [];
    for (const giveawayId of this.giveaways.giveawayIdsByEventId.get(eventId) ?? []) {
      const giveaway = this.requireGiveaway(giveawayId);
      const riderState = this.toRiderGiveawayState(giveaway, rider.id);
      if (
        !this.canViewPublicEventGiveaway(giveaway, rider.id) &&
        riderState.status === "not_eligible"
      ) {
        continue;
      }
      states.push({
        giveawayId: giveaway.id,
        giveawayTitle: giveaway.title,
        giveawayState: giveaway.state,
        entryMode: giveaway.entryMode,
        riderState,
      });
    }
    return states.sort(
      (left, right) =>
        left.giveawayTitle.localeCompare(right.giveawayTitle) ||
        left.giveawayId.localeCompare(right.giveawayId),
    );
  }

  /** A winner's own, nonsecret claim-page context. */
  async getRiderGiveawayClaimContext(
    sessionToken: string,
    awardId: string,
  ): Promise<RiderGiveawayClaimContext> {
    const rider = this.requireGiveawayRider(sessionToken);
    const award = this.giveaways.awardsById.get(awardId);
    if (!award || !award.isCurrent || award.winnerUserId !== rider.id || award.status === "superseded") {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(award);
    const pool = this.requireGiveawayPrizePool(giveaway, award.prizePoolId);
    const deliveryDetail = this.giveaways.deliveryDetailsByAwardId.get(award.id);
    return {
      awardId: award.id,
      giveawayId: giveaway.id,
      giveawayTitle: giveaway.title,
      giveawayState: giveaway.state,
      award: {
        prizePoolTitle: pool.title,
        status: award.status as RiderGiveawayClaimContext["award"]["status"],
        ...(award.claimDeadlineAt ? { claimDeadlineAt: award.claimDeadlineAt } : {}),
        fulfilmentMode: pool.fulfilmentMode,
      },
      deliveryDetailsSubmitted: Boolean(deliveryDetail && !deliveryDetail.purgedAt),
      claimCredentialIssued: Boolean(award.claimTokenHash),
    };
  }

  /**
   * A winner can voluntarily publish a short alias after a draw is public, or
   * revoke that consent at any time. The award itself is never reassigned or
   * removed when this preference changes.
   */
  async setGiveawayWinnerPublication(
    sessionToken: string,
    awardId: string,
    input: GiveawayWinnerPublicationInput,
  ): Promise<RiderGiveawayState> {
    const rider = this.requireGiveawayRider(sessionToken);
    const preference = this.parseGiveawayWinnerPublicationInput(input);
    const award = this.giveaways.awardsById.get(awardId);
    if (!award || award.winnerUserId !== rider.id || !award.isCurrent) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(award);
    const entry = this.giveaways.entriesById.get(award.entryId);
    if (
      !entry ||
      !award.drawId ||
      !award.snapshotEntryId ||
      !giveaway.snapshot?.seedRevealedAt ||
      !["pending_verification", "claimable", "verified", "fulfilled"].includes(award.status)
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }

    const now = new Date().toISOString();
    if (preference.published) {
      if (this.isOpaqueGiveawayWinnerAlias(preference.alias, entry.opaquePublicReference)) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
      award.publicWinnerAlias = preference.alias;
      award.winnerAliasOptedInAt = now;
      award.winnerAliasRevokedAt = undefined;
    } else {
      if (!award.publicWinnerAlias || !award.winnerAliasOptedInAt) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      award.winnerAliasRevokedAt = now;
    }
    award.updatedAt = now;
    this.auditGiveaway(
      giveaway,
      rider.id,
      preference.published
        ? "GIVEAWAY_WINNER_PUBLICATION_OPTED_IN"
        : "GIVEAWAY_WINNER_PUBLICATION_REVOKED",
      "award",
      award.id,
      { awardId: award.id, public: preference.published },
    );
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async optInToGiveaway(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState> {
    const rider = this.requireGiveawayRider(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayEntryMode(giveaway, "opt_in");
    const mechanics = this.currentGiveawayMechanics(giveaway);
    const entry = this.createGiveawayEntryFromPath(giveaway, rider.id, {
      path: "opt_in",
      eventType: "opted_in",
      actorUserId: rider.id,
      mechanicsAcknowledgement: {
        version: mechanics.version,
        checksum: mechanics.checksum,
        acknowledgedAt: new Date().toISOString(),
      },
    });
    this.auditGiveaway(giveaway, rider.id, "GIVEAWAY_ENTRY_OPTED_IN", "entry", entry.id, {
      entryId: entry.id,
      mechanicsVersion: mechanics.version,
      mechanicsChecksum: mechanics.checksum,
    });
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async createGiveawayCampaignCode(
    sessionToken: string,
    giveawayId: string,
    input: CreateGiveawayCampaignCodeInput,
  ): Promise<IssuedGiveawayCampaignCode> {
    const organizer = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    if (giveaway.entryMode !== "claim_code") {
      throw new BackendError("GIVEAWAY_ENTRY_MODE_INVALID", "GIVEAWAY_ENTRY_MODE_INVALID");
    }
    if (!["draft", "scheduled", "open", "paused"].includes(giveaway.state)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const parsed = this.parseGiveawayCampaignCodeInput(input);
    const code = `gwy_${randomBytes(24).toString("base64url")}`;
    const now = new Date().toISOString();
    const record: GiveawayCampaignCodeRecord = {
      id: `giveaway-code-${randomUUID()}`,
      tokenHash: this.hashGiveawayCampaignCode(code),
      maxUses: parsed.maxUses,
      useCount: 0,
      expiresAt: parsed.expiresAt,
      createdByUserId: organizer.id,
      createdAt: now,
      claimedRiderIds: new Set(),
    };
    giveaway.campaignCodes.push(record);
    this.giveaways.campaignCodesById.set(record.id, record);
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_CAMPAIGN_CODE_CREATED", "campaign_code", record.id, {
      maxUses: record.maxUses,
      expiresAt: record.expiresAt,
      tokenHash: record.tokenHash,
    });
    return { id: record.id, code, maxUses: record.maxUses, expiresAt: record.expiresAt };
  }

  async claimGiveawayCampaignCode(
    sessionToken: string,
    giveawayId: string,
    rawCode: unknown,
  ): Promise<RiderGiveawayState> {
    const rider = this.requireGiveawayRider(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayEntryMode(giveaway, "claim_code");
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const code = giveaway.campaignCodes.find(
      (candidate) => candidate.tokenHash === this.hashGiveawayCampaignCode(rawCode.trim()),
    );
    if (!code) throw new BackendError("GIVEAWAY_CODE_INVALID", "GIVEAWAY_CODE_INVALID");
    if (
      code.revokedAt ||
      code.useCount >= code.maxUses ||
      code.claimedRiderIds.has(rider.id) ||
      new Date(code.expiresAt).getTime() < Date.now()
    ) {
      throw new BackendError("GIVEAWAY_CODE_UNAVAILABLE", "GIVEAWAY_CODE_UNAVAILABLE");
    }
    const entry = this.createGiveawayEntryFromPath(giveaway, rider.id, {
      path: "campaign_code",
      eventType: "campaign_code_claimed",
      actorUserId: rider.id,
      campaignCodeId: code.id,
    });
    code.useCount += 1;
    code.claimedRiderIds.add(rider.id);
    this.auditGiveaway(giveaway, rider.id, "GIVEAWAY_CAMPAIGN_CODE_CLAIMED", "entry", entry.id, {
      entryId: entry.id,
      campaignCodeId: code.id,
      useCount: code.useCount,
    });
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async grantManualGiveawayEntry(
    sessionToken: string,
    input: GrantManualGiveawayEntryInput,
  ): Promise<RiderGiveawayState> {
    const parsed = this.parseManualGiveawayEntryInput(input);
    const organizer = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(parsed.giveawayId);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    this.requireGiveawayEntryMode(giveaway, "manual_only");
    const rider = this.users.get(parsed.riderId);
    if (!rider || rider.role !== "rider") throw new BackendError("NOT_FOUND", "NOT_FOUND");
    if (rider.verificationStatus === "SUSPENDED") {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    }
    const entry = this.createGiveawayEntryFromPath(giveaway, rider.id, {
      path: "manual",
      eventType: "manual_grant",
      actorUserId: organizer.id,
      manualGrantActive: true,
      reasonDigest: this.hashGiveawayReason(parsed.reason),
    });
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_MANUAL_ENTRY_GRANTED", "entry", entry.id, {
      entryId: entry.id,
      reasonDigest: this.hashGiveawayReason(parsed.reason),
    });
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async revokeManualGiveawayEntry(
    sessionToken: string,
    giveawayId: string,
    riderId: string,
    reason: unknown,
  ): Promise<RiderGiveawayState> {
    const organizer = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    this.requireGiveawayEntryMode(giveaway, "manual_only");
    const normalizedReason = this.requireGiveawayReason(reason);
    const entry = giveaway.entriesByRider.get(riderId);
    if (
      !entry ||
      entry.entryPath !== "manual" ||
      entry.status !== "eligible" ||
      !entry.manualGrantActive
    ) {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    }
    const now = new Date().toISOString();
    this.voidDirectEntryAwards(giveaway, entry, organizer.id, "manual_revoke");
    entry.manualGrantActive = false;
    entry.status = "withdrawn";
    entry.qualifiedGroupIds = [];
    entry.qualifiedEligibilityGroupTimings = [];
    entry.updatedAt = now;
    this.recordGiveawayEntryEvent(giveaway, entry, {
      type: "manual_revoke",
      sourceKey: `manual-revoke:${giveaway.id}:${entry.id}:${giveaway.entryEvents.length + 1}`,
      actorUserId: organizer.id,
      idempotencyKey: `manual-revoke:${giveaway.id}:${entry.id}:${randomUUID()}`,
      weightDelta: -entry.currentWeight,
      sourceSnapshot: {
        reasonDigest: this.hashGiveawayReason(normalizedReason),
        qualifiedGroupIds: [],
        qualifiedEligibilityGroupTimings: [],
        eligibilityCycleAt: entry.eligibilityCycleAt,
      },
    });
    this.reallocateImmediateGiveawayAwards(giveaway);
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_MANUAL_ENTRY_REVOKED", "entry", entry.id, {
      entryId: entry.id,
      reasonDigest: this.hashGiveawayReason(normalizedReason),
    });
    return this.toRiderGiveawayState(giveaway, riderId);
  }

  async redeemGiveawayPerk(
    sessionToken: string,
    perkId: string,
  ): Promise<{ perkId: string; status: "redeemed" }> {
    const rider = this.requireGiveawayRider(sessionToken);
    const event = Array.from(this.events.values()).find((candidate) =>
      candidate.perks.some((perk) => perk.id === perkId),
    );
    if (!event) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const perk = event.perks.find((candidate) => candidate.id === perkId);
    if (!perk) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const activePass = this.findPassForEventRider(event.id, rider.id);
    if (!activePass || activePass.status === "cancelled") {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    }
    const existing = Array.from(this.perkRedemptions.values()).find(
      (redemption) => redemption.perkId === perkId && redemption.userId === rider.id && redemption.status === "redeemed",
    );
    if (!existing) {
      const redeemedCount = Array.from(this.perkRedemptions.values()).filter(
        (redemption) => redemption.perkId === perkId && redemption.status === "redeemed",
      ).length;
      if (perk.quantity !== undefined && redeemedCount >= perk.quantity) {
        throw new BackendError("GIVEAWAY_PERK_UNAVAILABLE", "GIVEAWAY_PERK_UNAVAILABLE");
      }
      const redemption: PerkRedemptionRecord = {
        id: `perk-redemption-${randomUUID()}`,
        perkId,
        userId: rider.id,
        status: "redeemed",
        redeemedBy: rider.id,
        redeemedAt: new Date().toISOString(),
      };
      this.perkRedemptions.set(redemption.id, redemption);
      this.audit("GIVEAWAY_PERK_REDEEMED", rider.id, perkId);
      this.reconcileAutomaticEligibilityForEvent(event.id, rider.id);
    }
    return { perkId, status: "redeemed" };
  }

  async runGiveawayDraw(
    sessionToken: string,
    input: unknown,
  ) {
    const parsed = this.parseGiveawayDrawInput(input);
    const organizer = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(parsed.giveawayId);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    return this.runGiveawayDrawAsActor(organizer, giveaway, parsed);
  }

  private runGiveawayDrawAsActor(
    organizer: BackendUser,
    giveaway: GiveawayAggregate,
    parsed: { giveawayId: string; idempotencyKey: string; reason?: string },
    options: { initiatedVia?: "cron" } = {},
  ) {
    const snapshot = giveaway.snapshot;
    if (!snapshot) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const actionInput: GiveawayDrawActionInput = {
      action: "initial_random_draw",
      reasonDigest: parsed.reason ? this.hashGiveawayReason(parsed.reason) : null,
    };
    const inputDigest = this.calculateDrawInputDigest(
      giveaway,
      snapshot,
      "hmac-sha256-v1",
      actionInput,
    );
    const replay = giveaway.draws.find((draw) => draw.idempotencyKey === parsed.idempotencyKey);
    if (replay) {
      this.assertGiveawayDrawReplayInput(replay, inputDigest);
      return this.toGiveawayDrawResult(giveaway, replay);
    }
    if (!["locked", "drawing"].includes(giveaway.state)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (
      giveaway.draws.some(
        (draw) => draw.type === "initial" && draw.algorithmVersion === "hmac-sha256-v1",
      )
    ) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const seed = this.decryptGiveawayDrawSeed(snapshot);
    const now = new Date().toISOString();
    const draw: GiveawayDrawRecord = {
      id: `giveaway-draw-${this.generateGiveawayUuid()}`,
      snapshotId: snapshot.id,
      sequence: giveaway.draws.length + 1,
      type: "initial",
      status: "completed",
      idempotencyKey: parsed.idempotencyKey,
      algorithmVersion: "hmac-sha256-v1",
      inputDigest,
      resultDigest: "",
      initiatedByUserId: organizer.id,
      reasonDigest: actionInput.reasonDigest ?? undefined,
      completedAt: now,
      awardIds: [],
    };
    const rankedUnits = rankFrozenWeightedEntries({
      giveawayId: giveaway.id,
      seed,
      entries: snapshot.entries.map((entry) => ({ id: entry.id, weight: entry.frozenWeight })),
    });
    const snapshotEntryById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
    for (const pool of giveaway.prizePools
      .filter((candidate) => candidate.awardMode === "random_draw")
      .sort((left, right) => left.position - right.position)) {
      const selectedUnitKeys = new Set<string>();
      for (const item of pool.items
        .filter((candidate) => candidate.status === "available")
        .sort((left, right) => left.position - right.position)) {
        const candidate = rankedUnits.find((unit) => {
          const unitKey = `${unit.entryId}:${unit.unitOrdinal}`;
          if (selectedUnitKeys.has(unitKey)) return false;
          const snapshotEntry = snapshotEntryById.get(unit.entryId);
          return Boolean(
            snapshotEntry &&
              this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) &&
              this.canCreateGiveawayAward(giveaway, pool, snapshotEntry.riderId),
          );
        });
        if (!candidate) continue;
        selectedUnitKeys.add(`${candidate.entryId}:${candidate.unitOrdinal}`);
        const snapshotEntry = snapshotEntryById.get(candidate.entryId);
        if (!snapshotEntry) continue;
        const entry = this.giveaways.entriesById.get(snapshotEntry.entryId);
        if (!entry) continue;
        const rank = rankedUnits.indexOf(candidate) + 1;
        const award = this.createGiveawayAward(giveaway, {
          entry,
          prizePool: pool,
          prizeItem: item,
          draw,
          snapshotEntry,
          rank,
        });
        draw.awardIds.push(award.id);
      }
    }
    draw.resultDigest = this.calculateGiveawayDrawResultDigest(giveaway, draw);
    giveaway.draws.push(draw);
    this.giveaways.drawsById.set(draw.id, draw);
    if (giveaway.state === "locked") this.transitionGiveaway(giveaway, "drawing");
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_DRAW_COMPLETED", "draw", draw.id, {
      drawId: draw.id,
      sequence: draw.sequence,
      resultDigest: draw.resultDigest,
      awardCount: draw.awardIds.length,
      ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
    });
    return this.toGiveawayDrawResult(giveaway, draw);
  }

  async publishGiveawayDraw(sessionToken: string, giveawayId: string, drawId: string) {
    const organizer = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    const draw = giveaway.draws.find((candidate) => candidate.id === drawId);
    if (!draw) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    if (giveaway.state === "suspended") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const snapshot = giveaway.snapshot;
    if (!snapshot || draw.snapshotId !== snapshot.id) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (draw.status === "published") {
      const seed = this.decryptGiveawayDrawSeed(snapshot);
      return this.buildGiveawayDrawVerification(giveaway, draw, seed, true);
    }
    if (draw.status !== "completed") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (giveaway.state !== "drawing") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (
      !snapshot.seedRevealedAt &&
      this.hasAwardableManualSelectionCandidates(giveaway, snapshot)
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const seed = this.decryptGiveawayDrawSeed(snapshot);
    if (!snapshot.seedRevealedAt) snapshot.seedRevealedAt = new Date().toISOString();
    for (const campaignDraw of giveaway.draws) {
      if (campaignDraw.snapshotId === snapshot.id && campaignDraw.status === "completed") {
        campaignDraw.status = "published";
        campaignDraw.publishedAt = snapshot.seedRevealedAt;
      }
    }
    this.transitionGiveaway(giveaway, "claims_open");
    for (const award of giveaway.awards) {
      if (!award.drawId) continue;
      this.notifyGiveaway(giveaway, award.winnerUserId, "giveaway_winner", { awardId: award.id });
    }
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_DRAW_PUBLISHED", "draw", draw.id, {
      drawId: draw.id,
      resultDigest: draw.resultDigest,
    });
    return this.buildGiveawayDrawVerification(giveaway, draw, seed, true);
  }

  /**
   * Issues a raw claim secret exactly once to its winning rider. A retry without
   * rotation deliberately does not manufacture a second unknown secret.
   */
  async issueGiveawayClaimToken(
    sessionToken: string,
    awardId: string,
    input: { rotate?: boolean } = {},
  ): Promise<IssuedGiveawayClaimToken> {
    const rider = this.requireGiveawayRider(sessionToken);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== "rotate") ||
      (input.rotate !== undefined && typeof input.rotate !== "boolean")
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const award = this.giveaways.awardsById.get(awardId);
    if (!award || award.winnerUserId !== rider.id) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayClaimGate(giveaway, award, ["pending_verification", "claimable"]);
    if (award.claimTokenHash && !input.rotate) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }

    const token = createGiveawayClaimToken();
    const now = new Date().toISOString();
    award.claimTokenHash = hashGiveawayClaimToken(token);
    award.claimTokenIssuedAt = now;
    award.claimTokenVersion += 1;
    award.updatedAt = now;
    this.auditGiveaway(giveaway, rider.id, "GIVEAWAY_CLAIM_TOKEN_ISSUED", "award", award.id, {
      awardId: award.id,
      claimTokenVersion: award.claimTokenVersion,
      rotated: Boolean(input.rotate),
    });
    return {
      awardId: award.id,
      token,
      qrPayload: toGiveawayClaimQrPayload(token),
      version: award.claimTokenVersion,
    };
  }

  /** Resolves a claim for an authorized operator without mutating audit or award state. */
  async resolveGiveawayClaim(
    sessionToken: string,
    payload: string,
  ): Promise<OperatorGiveawayClaimView> {
    const operator = this.requireUser(sessionToken);
    const award = this.requireGiveawayAwardForClaimPayload(payload);
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayOperator(operator, this.requireEvent(giveaway.eventId), giveaway);
    this.requireGiveawayClaimGate(giveaway, award, ["pending_verification", "claimable", "verified"]);
    return this.toOperatorGiveawayClaimView(giveaway, award);
  }

  async verifyGiveawayClaim(
    sessionToken: string,
    input: VerifyGiveawayClaimInput,
  ): Promise<OperatorGiveawayClaimView> {
    const operator = this.requireUser(sessionToken);
    const parsed = this.parseGiveawayClaimVerificationInput(input);
    const award = this.requireGiveawayAwardForClaimPayload(parsed.payload);
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayOperator(operator, this.requireEvent(giveaway.eventId), giveaway);
    const requestDigest = createHash("sha256")
      .update(canonicalizeJson({ method: parsed.method, presenceObserved: parsed.presenceObserved }))
      .digest("hex");
    const replay = giveaway.claimVerifications.find(
      (verification) =>
        verification.awardId === award.id && verification.idempotencyKey === parsed.idempotencyKey,
    );
    if (replay) {
      if (replay.requestDigest !== requestDigest) {
        throw new BackendError("GIVEAWAY_IDEMPOTENCY_CONFLICT", "GIVEAWAY_IDEMPOTENCY_CONFLICT");
      }
      return this.toOperatorGiveawayClaimView(giveaway, award);
    }

    this.requireGiveawayClaimGate(giveaway, award, ["pending_verification", "claimable"]);
    const pool = this.requireGiveawayPrizePool(giveaway, award.prizePoolId);
    if ((giveaway.presenceVerificationRequired || pool.presenceVerificationRequired) && !parsed.presenceObserved) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const now = new Date().toISOString();
    const verification: GiveawayClaimVerificationRecord = {
      id: `giveaway-claim-verification-${randomUUID()}`,
      awardId: award.id,
      method: parsed.method,
      result: "verified",
      operatorActorUserId: operator.id,
      idempotencyKey: parsed.idempotencyKey,
      requestDigest,
      presenceObserved: parsed.presenceObserved,
      createdAt: now,
    };
    giveaway.claimVerifications.push(verification);
    this.giveaways.claimVerificationsById.set(verification.id, verification);
    award.status = "verified";
    award.updatedAt = now;
    this.auditGiveaway(giveaway, operator.id, "GIVEAWAY_CLAIM_VERIFIED", "award", award.id, {
      awardId: award.id,
      verificationId: verification.id,
      method: verification.method,
      presenceObserved: verification.presenceObserved,
    });
    this.notifyGiveaway(giveaway, award.winnerUserId, "giveaway_claim_verified", { awardId: award.id });
    return this.toOperatorGiveawayClaimView(giveaway, award);
  }

  async fulfillGiveawayAward(
    sessionToken: string,
    input: FulfillGiveawayAwardInput,
  ): Promise<OperatorGiveawayClaimView> {
    const operator = this.requireUser(sessionToken);
    const parsed = this.parseGiveawayFulfillmentInput(input);
    const award = this.giveaways.awardsById.get(parsed.awardId);
    if (!award) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayOperator(operator, this.requireEvent(giveaway.eventId), giveaway);
    const requestDigest = createHash("sha256")
      .update(canonicalizeJson({ reference: parsed.reference ?? null }))
      .digest("hex");
    const replay = giveaway.fulfillments.find(
      (fulfillment) =>
        fulfillment.awardId === award.id && fulfillment.idempotencyKey === parsed.idempotencyKey,
    );
    if (replay) {
      if (replay.requestDigest !== requestDigest) {
        throw new BackendError("GIVEAWAY_IDEMPOTENCY_CONFLICT", "GIVEAWAY_IDEMPOTENCY_CONFLICT");
      }
      return this.toOperatorGiveawayClaimView(giveaway, award);
    }

    this.requireGiveawayClaimGate(giveaway, award, ["verified"], { enforceDeadline: false });
    const pool = this.requireGiveawayPrizePool(giveaway, award.prizePoolId);
    if (pool.fulfilmentMode === "delivery") {
      const detail = this.giveaways.deliveryDetailsByAwardId.get(award.id);
      const retentionExpiresAt = detail ? new Date(detail.retentionExpiresAt).getTime() : Number.NaN;
      if (
        !detail ||
        detail.purgedAt ||
        !detail.encryptedPayload ||
        !Number.isFinite(retentionExpiresAt) ||
        retentionExpiresAt <= Date.now()
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
    }
    const now = new Date().toISOString();
    const fulfillment: GiveawayFulfillmentRecord = {
      id: `giveaway-fulfillment-${randomUUID()}`,
      awardId: award.id,
      type: pool.fulfilmentMode,
      status: "fulfilled",
      operatorActorUserId: operator.id,
      idempotencyKey: parsed.idempotencyKey,
      requestDigest,
      reference: parsed.reference,
      fulfilledAt: now,
      createdAt: now,
    };
    giveaway.fulfillments.push(fulfillment);
    this.giveaways.fulfillmentsById.set(fulfillment.id, fulfillment);
    award.status = "fulfilled";
    award.updatedAt = now;
    if (award.prizeItemId) {
      const item = pool.items.find((candidate) => candidate.id === award.prizeItemId);
      if (!item || item.status !== "reserved") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      item.status = "fulfilled";
    }
    this.auditGiveaway(giveaway, operator.id, "GIVEAWAY_AWARD_FULFILLED", "award", award.id, {
      awardId: award.id,
      fulfillmentId: fulfillment.id,
      fulfillmentType: fulfillment.type,
    });
    this.notifyGiveaway(giveaway, award.winnerUserId, "giveaway_fulfilled", { awardId: award.id });
    return this.toOperatorGiveawayClaimView(giveaway, award);
  }

  async grantGiveawayOperator(
    sessionToken: string,
    giveawayId: string,
    userId: string,
  ): Promise<{ id: string }> {
    const actor = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(actor, this.requireEvent(giveaway.eventId));
    if (!this.users.has(userId)) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    if (giveaway.operators.some((assignment) => assignment.userId === userId && !assignment.revokedAt)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const now = new Date().toISOString();
    const assignment: GiveawayOperatorRecord = {
      id: `giveaway-operator-${randomUUID()}`,
      giveawayId: giveaway.id,
      userId,
      grantedByUserId: actor.id,
      grantedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    giveaway.operators.push(assignment);
    this.giveaways.operatorsById.set(assignment.id, assignment);
    this.auditGiveaway(giveaway, actor.id, "GIVEAWAY_OPERATOR_GRANTED", "operator", assignment.id, {
      operatorAssignmentId: assignment.id,
    });
    return { id: assignment.id };
  }

  async revokeGiveawayOperator(
    sessionToken: string,
    assignmentId: string,
    reason: unknown,
  ): Promise<{ id: string }> {
    const actor = this.requireUser(sessionToken);
    const assignment = this.giveaways.operatorsById.get(assignmentId);
    if (!assignment || assignment.revokedAt) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const giveaway = this.requireGiveaway(assignment.giveawayId);
    this.requireGiveawayConfigurator(actor, this.requireEvent(giveaway.eventId));
    const now = new Date().toISOString();
    assignment.revokedAt = now;
    assignment.revokedByUserId = actor.id;
    assignment.revocationReasonDigest = this.hashGiveawayReason(this.requireGiveawayReason(reason));
    assignment.updatedAt = now;
    this.auditGiveaway(giveaway, actor.id, "GIVEAWAY_OPERATOR_REVOKED", "operator", assignment.id, {
      operatorAssignmentId: assignment.id,
      reasonDigest: assignment.revocationReasonDigest,
    });
    return { id: assignment.id };
  }

  async listGiveawayOperatorClaims(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OperatorGiveawayClaimView[]> {
    const operator = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayOperator(operator, this.requireEvent(giveaway.eventId), giveaway);
    if (giveaway.state === "suspended") throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    return giveaway.awards
      .filter(
        (award) =>
          award.isCurrent &&
          ((["pending_verification", "claimable"].includes(award.status) &&
            !this.isGiveawayClaimDeadlineElapsed(award)) ||
            award.status === "verified"),
      )
      .map((award) => this.toOperatorGiveawayClaimView(giveaway, award));
  }

  /** Event-scoped queue for the owning organizer, admins, and explicit assignments. */
  async listEventGiveawayOperatorClaims(
    sessionToken: string,
    eventId: string,
  ): Promise<EventGiveawayOperatorQueueItem[]> {
    const operator = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    const queue: EventGiveawayOperatorQueueItem[] = [];
    for (const giveawayId of this.giveaways.giveawayIdsByEventId.get(event.id) ?? []) {
      const giveaway = this.requireGiveaway(giveawayId);
      try {
        this.requireGiveawayOperator(operator, event, giveaway);
      } catch (error) {
        if (error instanceof BackendError && error.code === "FORBIDDEN") continue;
        throw error;
      }
      if (giveaway.state === "suspended") continue;
      for (const award of giveaway.awards) {
        if (
          !award.isCurrent ||
          !(
            (["pending_verification", "claimable"].includes(award.status) &&
              !this.isGiveawayClaimDeadlineElapsed(award)) ||
            award.status === "verified"
          )
        ) {
          continue;
        }
        queue.push({
          ...this.toOperatorGiveawayClaimView(giveaway, award),
          giveawayTitle: giveaway.title,
        });
      }
    }
    return queue.sort(
      (left, right) =>
        left.giveawayTitle.localeCompare(right.giveawayTitle) ||
        (left.claimDeadlineAt ?? "").localeCompare(right.claimDeadlineAt ?? "") ||
        left.awardId.localeCompare(right.awardId),
    );
  }

  /** Safe assignment choices for an authorized event owner or administrator. */
  async listGiveawayOperatorCandidates(
    sessionToken: string,
    eventId: string,
  ): Promise<GiveawayOperatorCandidate[]> {
    const actor = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireGiveawayConfigurator(actor, event);
    return Array.from(this.users.values())
      .filter((user) => user.verificationStatus !== "SUSPENDED" && user.role !== "admin")
      .map((user) => ({ id: user.id, label: user.displayName.trim() || "Unnamed operator" }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  }

  async submitGiveawayDeliveryDetails(
    sessionToken: string,
    awardId: string,
    input: GiveawayDeliveryDetailsInput,
  ): Promise<void> {
    const rider = this.requireGiveawayRider(sessionToken);
    const parsed = this.parseGiveawayDeliveryDetailsInput(input);
    const award = this.giveaways.awardsById.get(awardId);
    if (!award || award.winnerUserId !== rider.id) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayClaimGate(giveaway, award, ["verified"], { enforceDeadline: false });
    const pool = this.requireGiveawayPrizePool(giveaway, award.prizePoolId);
    if (pool.fulfilmentMode !== "delivery" || this.giveaways.deliveryDetailsByAwardId.has(award.id)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const key = this.requireGiveawayDeliveryEncryptionKey();
    const payloadVersion = "delivery-v1";
    const aadVersion = "aad-v1";
    const encryptionKeyVersion = "delivery-key-v1";
    let encrypted: ReturnType<typeof encryptGiveawayDeliveryPayload>;
    try {
      encrypted = encryptGiveawayDeliveryPayload(
        parsed.details,
        { awardId: award.id, payloadVersion, aadVersion, encryptionKeyVersion },
        key,
      );
    } catch {
      throw new BackendError(
        "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
        "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
      );
    }
    const now = new Date();
    const record: GiveawayDeliveryDetailRecord = {
      id: `giveaway-delivery-${randomUUID()}`,
      awardId: award.id,
      submittedByUserId: rider.id,
      consentVersion: parsed.consentVersion,
      payloadVersion,
      aadVersion,
      encryptionKeyVersion,
      encryptedPayload: encrypted.ciphertext,
      encryptedIv: encrypted.iv,
      encryptedAuthTag: encrypted.authTag,
      winnerConsentedAt: now.toISOString(),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    giveaway.deliveryDetails.push(record);
    this.giveaways.deliveryDetailsByAwardId.set(record.awardId, record);
    this.auditGiveaway(giveaway, rider.id, "GIVEAWAY_DELIVERY_SUBMITTED", "delivery_detail", record.id, {
      awardId: award.id,
      consentVersion: record.consentVersion,
      retentionExpiresAt: record.retentionExpiresAt,
    });
  }

  async readGiveawayDeliveryDetails(
    sessionToken: string,
    awardId: string,
  ): Promise<PrivateGiveawayDeliveryDetails> {
    const operator = this.requireUser(sessionToken);
    const award = this.giveaways.awardsById.get(awardId);
    if (!award || !award.isCurrent || !["verified", "fulfilled"].includes(award.status)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayOperator(operator, this.requireEvent(giveaway.eventId), giveaway);
    if (giveaway.state === "suspended") throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    const detail = this.giveaways.deliveryDetailsByAwardId.get(award.id);
    if (
      !detail ||
      detail.purgedAt ||
      !detail.encryptedPayload ||
      !detail.encryptedIv ||
      !detail.encryptedAuthTag ||
      new Date(detail.retentionExpiresAt).getTime() <= Date.now()
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    let details: Record<string, unknown>;
    try {
      details = decryptGiveawayDeliveryPayload(
        {
          algorithm: "aes-256-gcm",
          ciphertext: detail.encryptedPayload,
          iv: detail.encryptedIv,
          authTag: detail.encryptedAuthTag,
        },
        {
          awardId: award.id,
          payloadVersion: detail.payloadVersion,
          aadVersion: detail.aadVersion,
          encryptionKeyVersion: detail.encryptionKeyVersion,
        },
        this.requireGiveawayDeliveryEncryptionKey(),
      );
    } catch {
      throw new BackendError(
        "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
        "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
      );
    }
    this.auditGiveaway(giveaway, operator.id, "GIVEAWAY_DELIVERY_READ", "delivery_detail", detail.id, {
      awardId: award.id,
      deliveryDetailId: detail.id,
    });
    return {
      awardId: award.id,
      consentVersion: detail.consentVersion,
      retentionExpiresAt: detail.retentionExpiresAt,
      details,
    };
  }

  async withdrawGiveawayDeliveryDetails(sessionToken: string, awardId: string): Promise<void> {
    const rider = this.requireGiveawayRider(sessionToken);
    const award = this.giveaways.awardsById.get(awardId);
    if (!award || award.winnerUserId !== rider.id) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(award);
    const detail = this.giveaways.deliveryDetailsByAwardId.get(award.id);
    if (!detail || detail.purgedAt) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    this.purgeGiveawayDeliveryDetail(giveaway, detail, rider.id, "withdrawn");
  }

  async purgeExpiredGiveawayDeliveryDetails(sessionToken: string): Promise<{ purgedCount: number }> {
    const administrator = this.requireRole(sessionToken, "admin");
    let purgedCount = 0;
    for (const giveaway of this.giveaways.campaignsById.values()) {
      for (const detail of giveaway.deliveryDetails) {
        if (!detail.purgedAt && new Date(detail.retentionExpiresAt).getTime() <= Date.now()) {
          this.purgeGiveawayDeliveryDetail(giveaway, detail, administrator.id, "retention_expired");
          purgedCount += 1;
        }
      }
    }
    return { purgedCount };
  }

  /**
   * Retention is a privileged system obligation, not a campaign-owner action.
   * It must keep purging due encrypted payloads even if an organizer is
   * suspended, deleted, or otherwise ineligible to advance lifecycle state.
   */
  private purgeExpiredGiveawayDeliveryDetailsAsSystem(now: Date) {
    let purgedCount = 0;
    for (const giveaway of this.giveaways.campaignsById.values()) {
      for (const detail of giveaway.deliveryDetails) {
        if (!detail.purgedAt && new Date(detail.retentionExpiresAt).getTime() <= now.getTime()) {
          this.purgeGiveawayDeliveryDetail(giveaway, detail, undefined, "retention_expired", {
            initiatedVia: "cron",
          });
          purgedCount += 1;
        }
      }
    }
    return purgedCount;
  }

  async expireGiveawayClaims(sessionToken: string, giveawayId: string): Promise<{ expiredCount: number }> {
    const administrator = this.requireRole(sessionToken, "admin");
    const giveaway = this.requireGiveaway(giveawayId);
    return this.expireGiveawayClaimsAsActor(giveaway, administrator.id);
  }

  private expireGiveawayClaimsAsActor(
    giveaway: GiveawayAggregate,
    actorUserId: string,
    options: { now?: Date; initiatedVia?: "cron" } = {},
  ): { expiredCount: number } {
    if (giveaway.state !== "claims_open") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const now = options.now ?? new Date();
    let expiredCount = 0;
    for (const award of giveaway.awards) {
      if (
        award.isCurrent &&
        ["pending_verification", "claimable"].includes(award.status) &&
        this.isGiveawayClaimDeadlineElapsed(award, now)
      ) {
        const reasonDigest = this.hashGiveawayReason("claim_deadline_elapsed");
        if (this.isDirectGiveawayAward(award)) {
          // Expiry is never an implicit reallocation. Release a finite direct
          // item so an authorized operator can explicitly recover or settle it.
          this.finalizeDirectGiveawayAward(giveaway, award, "expired", reasonDigest);
        } else {
          // A drawn award remains the current predecessor until an authorized
          // redraw or settlement explicitly disposes of it.
          award.status = "expired";
          award.reasonDigest = reasonDigest;
          award.updatedAt = new Date().toISOString();
        }
        const detail = this.giveaways.deliveryDetailsByAwardId.get(award.id);
        if (detail && !detail.purgedAt) {
          this.purgeGiveawayDeliveryDetail(giveaway, detail, actorUserId, "award_expired");
        }
        this.auditGiveaway(giveaway, actorUserId, "GIVEAWAY_CLAIM_EXPIRED", "award", award.id, {
          awardId: award.id,
          ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
        });
        this.notifyGiveaway(giveaway, award.winnerUserId, "giveaway_claim_expired", { awardId: award.id });
        expiredCount += 1;
      }
    }
    return { expiredCount };
  }

  /** Completion requires every recovery/redraw path to be settled first. */
  async completeGiveawayClaims(
    sessionToken: string,
    giveawayId: string,
  ): Promise<{ completed: true }> {
    const actor = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(actor, this.requireEvent(giveaway.eventId));
    if (giveaway.state !== "claims_open") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (
      giveaway.awards.some(
        (award) =>
          award.isCurrent &&
          ["pending_verification", "claimable", "verified", "expired", "declined", "disqualified", "voided"].includes(
            award.status,
          ),
      )
    ) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (this.hasUnresolvedTerminalDirectGiveawayAward(giveaway)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    this.transitionGiveaway(giveaway, "completed");
    this.auditGiveaway(giveaway, actor.id, "GIVEAWAY_COMPLETED", "giveaway", giveaway.id, {
      giveawayId: giveaway.id,
      completion: "explicit_claim_settlement",
    });
    return { completed: true };
  }

  /**
   * Explicitly closes a terminal draw award when the owner/admin elects not to
   * redraw it. This is separate from expiry so expiry itself never disposes of
   * a recoverable award or auto-closes the campaign.
   */
  async settleGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: unknown,
  ): Promise<{ id: string }> {
    const actor = this.requireUser(sessionToken);
    const award = this.giveaways.awardsById.get(awardId);
    if (!award) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayConfigurator(actor, this.requireEvent(giveaway.eventId));
    const closableDirectRecoverySource =
      this.isDirectGiveawayAward(award) &&
      !award.isCurrent &&
      !award.recoveryClosedAt &&
      ["declined", "disqualified", "expired", "voided"].includes(award.status);
    if (
      giveaway.state !== "claims_open" ||
      (!closableDirectRecoverySource &&
        (!award.isCurrent || !["declined", "disqualified", "expired", "voided"].includes(award.status)))
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const reasonDigest = this.hashGiveawayReason(this.requireGiveawayRecoveryClosureReason(reason));
    if (closableDirectRecoverySource) {
      this.closeGiveawayDirectRecoverySource(award, reasonDigest);
    } else {
      award.isCurrent = false;
      award.reasonDigest = reasonDigest;
      award.updatedAt = new Date().toISOString();
      if (this.isDirectGiveawayAward(award)) {
        this.closeGiveawayDirectRecoverySource(award, reasonDigest);
      }
    }
    if (award.prizeItemId) {
      const pool = this.requireGiveawayPrizePool(giveaway, award.prizePoolId);
      const item = pool.items.find((candidate) => candidate.id === award.prizeItemId);
      if (item?.status === "reserved") item.status = "available";
    }
    const delivery = this.giveaways.deliveryDetailsByAwardId.get(award.id);
    if (delivery && !delivery.purgedAt) {
      this.purgeGiveawayDeliveryDetail(giveaway, delivery, actor.id, "award_expired");
    }
    this.auditGiveaway(giveaway, actor.id, "GIVEAWAY_AWARD_SETTLED", "award", award.id, {
      awardId: award.id,
      status: award.status,
      reasonDigest,
      recoveryClosed: this.isDirectGiveawayAward(award),
    });
    return { id: award.id };
  }

  /**
   * A finite direct award has no draw chain. After expiry its item is released,
   * and only this explicit owner/admin operation may re-offer it from the
   * frozen candidate set with a new award-specific future deadline.
   */
  async recoverExpiredDirectGiveawayAward(
    sessionToken: string,
    input: unknown,
  ): Promise<{ awardId: string | null }> {
    const actor = this.requireUser(sessionToken);
    const parsed = this.parseExpiredDirectGiveawayRecoveryInput(input);
    const sourceAward = this.giveaways.awardsById.get(parsed.awardId);
    if (!sourceAward || !this.isDirectGiveawayAward(sourceAward)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(sourceAward);
    this.requireGiveawayConfigurator(actor, this.requireEvent(giveaway.eventId));
    if (
      giveaway.state !== "claims_open" ||
      sourceAward.isCurrent ||
      sourceAward.recoveryClosedAt ||
      !["expired", "voided", "disqualified", "declined"].includes(sourceAward.status) ||
      !this.isGiveawayClaimDeadlineElapsed(sourceAward)
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const pool = this.requireGiveawayPrizePool(giveaway, sourceAward.prizePoolId);
    if (pool.awardMode !== "first_come" && pool.awardMode !== "guaranteed") {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const deadline = new Date(parsed.claimDeadlineAt);
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const reasonDigest = this.hashGiveawayReason(parsed.reason);
    const replacement = this.recoverFrozenImmediateGiveawayAwardSlot(
      giveaway,
      sourceAward,
      pool,
      deadline.toISOString(),
    );
    if (replacement) {
      this.linkGiveawayDirectRecoverySource(giveaway, sourceAward, replacement, reasonDigest, "explicit");
    }
    this.auditGiveaway(giveaway, actor.id, "GIVEAWAY_AWARD_RECOVERED", "award", sourceAward.id, {
      awardId: sourceAward.id,
      replacementAwardId: replacement?.id ?? null,
      reasonDigest,
      claimDeadlineAt: deadline.toISOString(),
    });
    return { awardId: replacement?.id ?? null };
  }

  async declineGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: unknown,
  ): Promise<RiderGiveawayState> {
    const rider = this.requireGiveawayRider(sessionToken);
    const award = this.giveaways.awardsById.get(awardId);
    if (!award || award.winnerUserId !== rider.id || !award.isCurrent) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    if (!["pending_verification", "claimable", "verified"].includes(award.status)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const normalizedReason = this.requireGiveawayReason(reason);
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayRiderDeclineGate(award);
    const reasonDigest = this.hashGiveawayReason(normalizedReason);
    const directAward = this.isDirectGiveawayAward(award);
    if (directAward) {
      this.finalizeDirectGiveawayAward(giveaway, award, "declined", reasonDigest);
    } else {
      award.status = "declined";
      award.reasonDigest = reasonDigest;
      award.updatedAt = new Date().toISOString();
    }
    this.auditGiveaway(giveaway, rider.id, "GIVEAWAY_AWARD_DECLINED", "award", award.id, {
      awardId: award.id,
      reasonDigest: award.reasonDigest,
      directAward,
    });
    if (directAward) this.reallocateFinalizedDirectGiveawayAward(giveaway, award);
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async voidGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: unknown,
  ): Promise<RiderGiveawayState> {
    return this.resolveGiveawayAwardByAdministrator(sessionToken, awardId, reason, "voided");
  }

  async disqualifyGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: unknown,
  ): Promise<RiderGiveawayState> {
    return this.resolveGiveawayAwardByAdministrator(sessionToken, awardId, reason, "disqualified");
  }

  async redrawGiveawayAward(sessionToken: string, input: unknown) {
    const parsed = this.parseGiveawayRedrawInput(input);
    const organizer = this.requireUser(sessionToken);
    const award = this.giveaways.awardsById.get(parsed.awardId);
    if (!award) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const giveaway = this.requireGiveawayByAward(award);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    const snapshot = giveaway.snapshot;
    if (!snapshot) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const actionInput: GiveawayDrawActionInput = {
      action: "redraw",
      reasonDigest: this.hashGiveawayReason(parsed.reason),
      predecessorAwardId: parsed.awardId,
      claimDeadlineAt: parsed.claimDeadlineAt,
    };
    const inputDigest = this.calculateDrawInputDigest(
      giveaway,
      snapshot,
      "hmac-sha256-v1",
      actionInput,
    );
    const replay = giveaway.draws.find((draw) => draw.idempotencyKey === parsed.idempotencyKey);
    if (replay) {
      this.assertGiveawayDrawReplayInput(replay, inputDigest);
      return this.toGiveawayDrawResult(giveaway, replay);
    }
    if (giveaway.state === "suspended" || !["drawing", "claims_open"].includes(giveaway.state)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const replacementDeadline = this.resolveGiveawayReplacementClaimDeadline(
      giveaway,
      parsed.claimDeadlineAt,
    );
    // Immediate allocations never participate in a deterministic draw chain.
    // They are terminal historical records and are reconciled directly.
    if (this.isDirectGiveawayAward(award)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    if (
      !award.isCurrent ||
      !["declined", "disqualified", "expired", "voided"].includes(award.status) ||
      !award.drawId ||
      !award.snapshotEntryId ||
      !award.prizeItemId
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const originalDraw = this.giveaways.drawsById.get(award.drawId);
    const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
    const prizeItem = pool?.items.find((candidate) => candidate.id === award.prizeItemId);
    if (
      !originalDraw ||
      originalDraw.algorithmVersion !== "hmac-sha256-v1" ||
      !snapshot ||
      originalDraw.snapshotId !== snapshot.id ||
      !pool ||
      pool.awardMode !== "random_draw" ||
      !prizeItem
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const seed = this.decryptGiveawayDrawSeed(snapshot);
    const rankedUnits = rankFrozenWeightedEntries({
      giveawayId: giveaway.id,
      seed,
      entries: snapshot.entries.map((entry) => ({ id: entry.id, weight: entry.frozenWeight })),
    });
    const snapshotEntryById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
    const consumedWeightedUnitKeys = new Set<string>();
    for (const historicalAward of giveaway.awards) {
      const historicalDraw = historicalAward.drawId
        ? this.giveaways.drawsById.get(historicalAward.drawId)
        : undefined;
      if (
        historicalAward.prizePoolId !== pool.id ||
        historicalDraw?.algorithmVersion !== "hmac-sha256-v1" ||
        historicalDraw.snapshotId !== snapshot.id
      ) {
        continue;
      }
      if (!historicalAward.snapshotEntryId || !historicalAward.rank) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const consumedUnit = rankedUnits[historicalAward.rank - 1];
      if (!consumedUnit || consumedUnit.entryId !== historicalAward.snapshotEntryId) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      consumedWeightedUnitKeys.add(`${consumedUnit.entryId}:${consumedUnit.unitOrdinal}`);
    }
    const nextUnit = rankedUnits.find((unit) => {
      const snapshotEntry = snapshotEntryById.get(unit.entryId);
      return Boolean(
        snapshotEntry &&
          !consumedWeightedUnitKeys.has(`${unit.entryId}:${unit.unitOrdinal}`) &&
          this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) &&
          this.canCreateGiveawayAward(giveaway, pool, snapshotEntry.riderId, award.id),
      );
    });
    if (!nextUnit) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    const nextSnapshotEntry = snapshotEntryById.get(nextUnit.entryId);
    if (!nextSnapshotEntry) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    const nextEntry = this.giveaways.entriesById.get(nextSnapshotEntry.entryId);
    if (!nextEntry) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    const now = new Date().toISOString();
    const draw: GiveawayDrawRecord = {
      id: `giveaway-draw-${this.generateGiveawayUuid()}`,
      snapshotId: snapshot.id,
      sequence: giveaway.draws.length + 1,
      type: "redraw",
      status: snapshot.seedRevealedAt ? "published" : "completed",
      idempotencyKey: parsed.idempotencyKey,
      algorithmVersion: "hmac-sha256-v1",
      inputDigest,
      resultDigest: "",
      initiatedByUserId: organizer.id,
      reasonDigest: actionInput.reasonDigest ?? undefined,
      completedAt: now,
      publishedAt: snapshot.seedRevealedAt,
      awardIds: [],
    };
    award.isCurrent = false;
    award.status = "superseded";
    award.updatedAt = now;
    const replacement = this.createGiveawayAward(giveaway, {
      entry: nextEntry,
      prizePool: pool,
      prizeItem,
      draw,
      snapshotEntry: nextSnapshotEntry,
      rank: rankedUnits.indexOf(nextUnit) + 1,
      predecessorAwardId: award.id,
      claimDeadlineAt: replacementDeadline,
    });
    draw.awardIds.push(replacement.id);
    draw.resultDigest = this.calculateGiveawayDrawResultDigest(giveaway, draw);
    giveaway.draws.push(draw);
    this.giveaways.drawsById.set(draw.id, draw);
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_AWARD_REDRAWN", "award", replacement.id, {
      awardId: replacement.id,
      predecessorAwardId: award.id,
      drawId: draw.id,
      reasonDigest: draw.reasonDigest,
      claimDeadlineAt: replacementDeadline ?? null,
    });
    if (snapshot.seedRevealedAt) {
      this.notifyGiveaway(giveaway, replacement.winnerUserId, "giveaway_winner", {
        awardId: replacement.id,
      });
    }
    return this.toGiveawayDrawResult(giveaway, draw);
  }

  async selectManualGiveawayAward(sessionToken: string, input: unknown) {
    const parsed = this.parseManualGiveawayAwardInput(input);
    const organizer = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(parsed.giveawayId);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    const snapshot = giveaway.snapshot;
    if (!snapshot || !["locked", "drawing"].includes(giveaway.state)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const pool = giveaway.prizePools.find((candidate) => candidate.id === parsed.prizePoolId);
    if (!pool || pool.awardMode !== "manual_selection") {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const snapshotEntry = snapshot.entries.find((candidate) => candidate.id === parsed.snapshotEntryId);
    if (!snapshotEntry) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const actionInput: GiveawayDrawActionInput = {
      action: "manual_selection",
      reasonDigest: this.hashGiveawayReason(parsed.reason),
      prizePoolId: parsed.prizePoolId,
      // Keep draw replay commitments stable while accepting only the opaque
      // snapshot reference from the organizer surface.
      riderId: snapshotEntry.riderId,
      snapshotEntryId: snapshotEntry.id,
    };
    const inputDigest = this.calculateDrawInputDigest(
      giveaway,
      snapshot,
      "manual-selection-v1",
      actionInput,
    );
    const replay = giveaway.draws.find((draw) => draw.idempotencyKey === parsed.idempotencyKey);
    if (replay) {
      this.assertGiveawayDrawReplayInput(replay, inputDigest);
      return this.toGiveawayDrawResult(giveaway, replay);
    }
    const prizeItem = pool?.items
      .filter((candidate) => candidate.status === "available")
      .sort((left, right) => left.position - right.position)[0];
    const entry = this.giveaways.entriesById.get(snapshotEntry.entryId);
    if (
      !prizeItem ||
      !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
      !this.canCreateGiveawayAward(giveaway, pool, snapshotEntry.riderId) ||
      !entry ||
      entry.riderId !== snapshotEntry.riderId ||
      entry.status !== "locked"
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const now = new Date().toISOString();
    const draw: GiveawayDrawRecord = {
      id: `giveaway-draw-${this.generateGiveawayUuid()}`,
      snapshotId: snapshot.id,
      sequence: giveaway.draws.length + 1,
      type: "initial",
      status: "completed",
      idempotencyKey: parsed.idempotencyKey,
      algorithmVersion: "manual-selection-v1",
      inputDigest,
      resultDigest: "",
      initiatedByUserId: organizer.id,
      reasonDigest: actionInput.reasonDigest ?? undefined,
      completedAt: now,
      awardIds: [],
    };
    const award = this.createGiveawayAward(giveaway, {
      entry,
      prizePool: pool,
      prizeItem,
      draw,
      snapshotEntry,
      rank: 1,
    });
    draw.awardIds.push(award.id);
    draw.resultDigest = this.calculateGiveawayDrawResultDigest(giveaway, draw);
    giveaway.draws.push(draw);
    this.giveaways.drawsById.set(draw.id, draw);
    if (giveaway.state === "locked") this.transitionGiveaway(giveaway, "drawing");
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_MANUAL_AWARD_SELECTED", "award", award.id, {
      awardId: award.id,
      drawId: draw.id,
      reasonDigest: draw.reasonDigest,
    });
    return this.toGiveawayDrawResult(giveaway, draw);
  }

  /**
   * Replaces one terminal, published manual-selection award. This is
   * deliberately distinct from an HMAC redraw: the organizer selects another
   * opaque candidate from the already-frozen snapshot, the original terminal
   * award remains historically truthful, and no seed is generated or rerolled.
   */
  async replaceManualGiveawayAward(sessionToken: string, input: unknown) {
    const parsed = this.parseManualGiveawayReplacementInput(input);
    const organizer = this.requireUser(sessionToken);
    const sourceAward = this.giveaways.awardsById.get(parsed.sourceAwardId);
    if (!sourceAward) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const giveaway = this.requireGiveawayByAward(sourceAward);
    this.requireGiveawayConfigurator(organizer, this.requireEvent(giveaway.eventId));
    // Build the immutable replay digest before consulting mutable allocation
    // state. A later fulfilment changes the prize item from reserved to
    // fulfilled, but must not invalidate an already successful idempotent
    // replacement request.
    const replayLineage = this.requireManualGiveawayReplacementSource(
      giveaway,
      sourceAward,
      { requireReservedPrizeItem: false },
    );
    const { snapshot, pool } = replayLineage;
    const snapshotEntry = snapshot.entries.find(
      (candidate) => candidate.id === parsed.snapshotEntryId,
    );
    if (!snapshotEntry) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const actionInput: GiveawayDrawActionInput = {
      action: "manual_replacement",
      reasonDigest: this.hashGiveawayReason(parsed.reason),
      prizePoolId: pool.id,
      riderId: snapshotEntry.riderId,
      snapshotEntryId: snapshotEntry.id,
      predecessorAwardId: sourceAward.id,
      claimDeadlineAt: parsed.claimDeadlineAt,
    };
    const inputDigest = this.calculateDrawInputDigest(
      giveaway,
      snapshot,
      "manual-selection-v1",
      actionInput,
    );
    const replay = giveaway.draws.find((draw) => draw.idempotencyKey === parsed.idempotencyKey);
    if (replay) {
      this.assertGiveawayDrawReplayInput(replay, inputDigest);
      return this.toGiveawayDrawResult(giveaway, replay);
    }
    const { originalDraw, prizeItem } = this.requireManualGiveawayReplacementSource(
      giveaway,
      sourceAward,
    );
    if (giveaway.state !== "claims_open" || !sourceAward.isCurrent) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    if (giveaway.awards.some((award) => award.predecessorAwardId === sourceAward.id)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const entry = this.giveaways.entriesById.get(snapshotEntry.entryId);
    if (
      !entry ||
      entry.status !== "locked" ||
      entry.riderId !== snapshotEntry.riderId ||
      !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
      !this.canCreateGiveawayAward(giveaway, pool, snapshotEntry.riderId, sourceAward.id)
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const replacementDeadline = this.resolveGiveawayReplacementClaimDeadline(
      giveaway,
      parsed.claimDeadlineAt,
    );
    const now = new Date().toISOString();
    const draw: GiveawayDrawRecord = {
      id: `giveaway-draw-${this.generateGiveawayUuid()}`,
      snapshotId: snapshot.id,
      sequence: giveaway.draws.length + 1,
      type: "redraw",
      status: "published",
      idempotencyKey: parsed.idempotencyKey,
      algorithmVersion: "manual-selection-v1",
      inputDigest,
      resultDigest: "",
      initiatedByUserId: organizer.id,
      reasonDigest: actionInput.reasonDigest ?? undefined,
      completedAt: now,
      publishedAt: snapshot.seedRevealedAt,
      awardIds: [],
    };
    // Keep the factual terminal outcome and its reason digest intact. Only the
    // current allocation pointer changes to make the reserved item available
    // to its successor under the partial current-item constraint.
    sourceAward.isCurrent = false;
    sourceAward.updatedAt = now;
    const replacement = this.createGiveawayAward(giveaway, {
      entry,
      prizePool: pool,
      prizeItem,
      draw,
      snapshotEntry,
      rank: 1,
      predecessorAwardId: sourceAward.id,
      claimDeadlineAt: replacementDeadline,
    });
    draw.awardIds.push(replacement.id);
    draw.resultDigest = this.calculateGiveawayDrawResultDigest(giveaway, draw);
    giveaway.draws.push(draw);
    this.giveaways.drawsById.set(draw.id, draw);
    this.auditGiveaway(giveaway, organizer.id, "GIVEAWAY_MANUAL_AWARD_REPLACED", "award", replacement.id, {
      awardId: replacement.id,
      predecessorAwardId: sourceAward.id,
      drawId: draw.id,
      originalDrawId: originalDraw.id,
      reasonDigest: draw.reasonDigest,
      claimDeadlineAt: replacementDeadline ?? null,
    });
    this.notifyGiveaway(giveaway, replacement.winnerUserId, "giveaway_winner", {
      awardId: replacement.id,
    });
    return this.toGiveawayDrawResult(giveaway, draw);
  }

  async submitGiveawayForReview(sessionToken: string, giveawayId: string) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    if (
      !["draft", "scheduled", "paused"].includes(giveaway.state) ||
      !["draft", "changes_requested", "rejected"].includes(giveaway.complianceStatus)
    ) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    giveaway.complianceStatus = "pending_review";
    giveaway.updatedAt = new Date().toISOString();
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_SUBMITTED_FOR_REVIEW", "giveaway", giveaway.id, {
      mechanicsVersion: giveaway.mechanicsVersions.at(-1)?.version ?? 1,
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async reviewGiveawayCompliance(
    sessionToken: string,
    giveawayId: string,
    input: unknown,
  ) {
    const reviewer = this.requireRole(sessionToken, "admin");
    const giveaway = this.requireGiveaway(giveawayId);
    const review = this.parseGiveawayComplianceReview(input);
    if (giveaway.complianceStatus !== "pending_review") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }

    const now = new Date().toISOString();
    giveaway.complianceStatus = review.decision;
    giveaway.complianceReviewerId = reviewer.id;
    giveaway.complianceReviewedAt = now;
    giveaway.complianceReviewReason = review.reason;
    const mechanicsVersion = giveaway.mechanicsVersions.at(-1);
    if (mechanicsVersion) {
      mechanicsVersion.reviewedByUserId = reviewer.id;
      mechanicsVersion.reviewDecision = review.decision;
      mechanicsVersion.reviewReason = giveaway.complianceReviewReason;
      mechanicsVersion.reviewedAt = now;
    }
    giveaway.updatedAt = now;
    const reviewAuditPayload: Record<string, unknown> = {
      decision: review.decision,
      mechanicsVersion: mechanicsVersion?.version ?? 1,
    };
    if (giveaway.complianceReviewReason) {
      reviewAuditPayload.reasonDigest = this.hashGiveawayReason(giveaway.complianceReviewReason);
    }
    this.auditGiveaway(
      giveaway,
      reviewer.id,
      "GIVEAWAY_COMPLIANCE_REVIEWED",
      "giveaway",
      giveaway.id,
      reviewAuditPayload,
    );
    return this.toGiveawayCampaignView(giveaway);
  }

  /**
   * Scheduling is an explicit owner/admin decision. Cron only advances this
   * already-approved state; it never promotes a draft based on timestamps.
   */
  async scheduleGiveaway(sessionToken: string, giveawayId: string) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    const entryOpensAt = giveaway.entryOpensAt ? new Date(giveaway.entryOpensAt) : null;
    if (
      giveaway.state !== "draft" ||
      giveaway.complianceStatus !== "approved" ||
      !entryOpensAt ||
      !Number.isFinite(entryOpensAt.getTime()) ||
      entryOpensAt.getTime() <= Date.now()
    ) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    this.transitionGiveaway(giveaway, "scheduled");
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_SCHEDULED", "giveaway", giveaway.id, {
      entryOpensAt: giveaway.entryOpensAt,
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  /**
   * Trusted scheduler entry point. It accepts a server-supplied clock only and
   * advances one-way lifecycle states; it never restores paused campaigns or
   * creates a redraw. Draw provenance remains the real configured actor plus
   * an immutable initiatedVia: cron audit fact.
   */
  async advanceScheduledGiveawayLifecycle(now: Date): Promise<GiveawayLifecycleAdvanceResult> {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const result: GiveawayLifecycleAdvanceResult = {
      opened: 0,
      locked: 0,
      drawn: 0,
      expired: 0,
      completed: 0,
      purgedDeliveryDetails: 0,
    };
    // This runs before any lifecycle actor lookup so encrypted payload
    // retention cannot be held hostage by a suspended or deleted creator.
    result.purgedDeliveryDetails = this.purgeExpiredGiveawayDeliveryDetailsAsSystem(now);
    const giveaways = Array.from(this.giveaways.campaignsById.values()).sort((left, right) =>
      left.id.localeCompare(right.id),
    );

    for (const giveaway of giveaways) {
      const event = this.events.get(giveaway.eventId);
      const actor = event ? this.getGiveawayCronActor(giveaway, event) : null;

      if (actor && giveaway.state === "scheduled" && this.isGiveawayScheduleDue(giveaway.entryOpensAt, now)) {
        try {
          this.openGiveawayAsActor(actor, giveaway, event!, { initiatedVia: "cron" });
          result.opened += 1;
        } catch (error) {
          if (!(error instanceof BackendError)) throw error;
        }
      }

      if (actor && giveaway.state === "open" && this.isGiveawayScheduleDue(giveaway.entryClosesAt, now)) {
        try {
          this.lockGiveawayAsActor(actor, giveaway, { initiatedVia: "cron" });
          result.locked += 1;
        } catch (error) {
          if (!(error instanceof BackendError)) throw error;
        }
      }

      if (actor && giveaway.state === "locked" && this.isGiveawayScheduleDue(giveaway.drawAt, now)) {
        try {
          this.runGiveawayDrawAsActor(
            actor,
            giveaway,
            {
              giveawayId: giveaway.id,
              idempotencyKey: `cron-initial-draw:${giveaway.id}:${giveaway.drawAt}`,
              reason: "scheduled_initial_draw",
            },
            { initiatedVia: "cron" },
          );
          result.drawn += 1;
        } catch (error) {
          if (!(error instanceof BackendError)) throw error;
        }
      }

      if (giveaway.state === "claims_open" && actor) {
        result.expired += this.expireGiveawayClaimsAsActor(giveaway, actor.id, {
          now,
          initiatedVia: "cron",
        }).expiredCount;
        if (
          !giveaway.awards.some((award) => award.isCurrent && award.status !== "fulfilled") &&
          !this.hasUnresolvedTerminalDirectGiveawayAward(giveaway)
        ) {
          this.transitionGiveaway(giveaway, "completed");
          this.auditGiveaway(giveaway, actor.id, "GIVEAWAY_COMPLETED", "giveaway", giveaway.id, {
            giveawayId: giveaway.id,
            completion: "cron_eligible_settlement",
            initiatedVia: "cron",
          });
          result.completed += 1;
        }
      }
    }
    return result;
  }

  async openGiveaway(sessionToken: string, giveawayId: string) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    const event = this.requireEvent(giveaway.eventId);
    this.requireGiveawayConfigurator(user, event);
    return this.openGiveawayAsActor(user, giveaway, event);
  }

  private openGiveawayAsActor(
    user: BackendUser,
    giveaway: GiveawayAggregate,
    event: Event,
    options: { initiatedVia?: "cron" } = {},
  ) {
    if (giveaway.complianceStatus !== "approved") {
      throw new BackendError("GIVEAWAY_COMPLIANCE_REQUIRED", "GIVEAWAY_COMPLIANCE_REQUIRED");
    }
    if (!["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    this.transitionGiveaway(giveaway, "open");
    if (giveaway.entryMode === "automatic") {
      this.reconcileAutomaticEligibilityForEvent(event.id, undefined, { reallocate: false });
    }
    this.reallocateImmediateGiveawayAwards(giveaway);
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_OPENED", "giveaway", giveaway.id, {
      state: giveaway.state,
      ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async pauseGiveaway(sessionToken: string, giveawayId: string) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    if (!["scheduled", "open"].includes(giveaway.state)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    this.transitionGiveaway(giveaway, "paused");
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_PAUSED", "giveaway", giveaway.id, {
      state: giveaway.state,
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async lockGiveaway(sessionToken: string, giveawayId: string) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    return this.lockGiveawayAsActor(user, giveaway);
  }

  private lockGiveawayAsActor(
    user: BackendUser,
    giveaway: GiveawayAggregate,
    options: { initiatedVia?: "cron" } = {},
  ) {
    if (giveaway.snapshot) {
      return this.toGiveawayLockResult(giveaway);
    }
    if (giveaway.state !== "open" || giveaway.complianceStatus !== "approved") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const { seed, encryptedSeed, commitment } = this.createEncryptedGiveawayDrawSeed();
    const eventRiderIds = new Set([
      ...this.riderIdsWithEventActivity(giveaway.eventId),
      ...giveaway.entriesByRider.keys(),
    ]);
    for (const riderId of eventRiderIds) {
      if (giveaway.entryMode === "automatic") {
        this.reconcileAutomaticEntry(giveaway, riderId);
      } else {
        this.reconcileEntryForLock(giveaway, riderId);
      }
    }
    this.reallocateImmediateGiveawayAwards(giveaway);

    const mechanics = this.currentGiveawayMechanics(giveaway);
    const lockedAt = new Date().toISOString();
    const entries = Array.from(giveaway.entriesByRider.values())
      .filter((entry) => entry.status === "eligible")
      .sort((left, right) => left.opaquePublicReference.localeCompare(right.opaquePublicReference));
    const presentationLabels = new Map(
      deriveGiveawayPresentationLabels(
        entries.map((entry) => ({
          entryId: entry.id,
          opaquePublicReference: entry.opaquePublicReference,
          displayName: this.users.get(entry.riderId)?.displayName ?? "",
          optedIn: isGiveawayLivePresentationOptedIn({
            optedInAt: entry.livePresentationOptedInAt,
            revokedAt: entry.livePresentationRevokedAt,
          }),
        })),
      ).map((label) => [label.entryId, label]),
    );
    const configDigest = this.calculateGiveawayConfigDigest(giveaway, mechanics.id);
    const snapshotEntries: readonly GiveawaySnapshotEntryRecord[] = Object.freeze(
      entries.map((entry) => {
        const presentation = presentationLabels.get(entry.id);
        if (!presentation) throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
        return Object.freeze({
          id: `giveaway-snapshot-entry-${this.generateGiveawayUuid()}`,
          entryId: entry.id,
          riderId: entry.riderId,
          opaquePublicReference: entry.opaquePublicReference,
          frozenWeight: entry.currentWeight,
          eligibilityCycleAt: entry.eligibilityCycleAt,
          qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
          qualifiedGroupIds: Object.freeze([...entry.qualifiedGroupIds]),
          qualifiedEligibilityGroupTimings: Object.freeze(
            entry.qualifiedEligibilityGroupTimings.map((timing) => Object.freeze({ ...timing })),
          ),
          rankSourceDigest: createHash("sha256")
            .update(
              canonicalizeJson({
                entryId: entry.id,
                opaquePublicReference: entry.opaquePublicReference,
                eligibilityCycleAt: entry.eligibilityCycleAt,
                qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
                qualifiedGroupIds: entry.qualifiedGroupIds,
                qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
                weight: entry.currentWeight,
              }),
            )
            .digest("hex"),
          presentationLabel: presentation.presentationLabel,
          presentationLabelKind: presentation.presentationLabelKind,
        });
      }),
    );
    const snapshotDigest = createHash("sha256")
      .update(
        canonicalizeJson({
          giveawayId: giveaway.id,
          mechanicsVersionId: mechanics.id,
          configDigest,
          entries: snapshotEntries.map((entry) => ({
            entryId: entry.entryId,
            opaquePublicReference: entry.opaquePublicReference,
            frozenWeight: entry.frozenWeight,
            eligibilityCycleAt: entry.eligibilityCycleAt,
            qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
            qualifiedGroupIds: entry.qualifiedGroupIds,
            qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
            rankSourceDigest: entry.rankSourceDigest,
          })),
        }),
      )
      .digest("hex");
    const snapshot: GiveawaySnapshotRecord = {
      id: `giveaway-snapshot-${this.generateGiveawayUuid()}`,
      mechanicsVersionId: mechanics.id,
      mechanicsVersion: mechanics.version,
      configDigest,
      snapshotDigest,
      candidateCount: snapshotEntries.length,
      seedCommitment: commitment,
      encryptedSeed,
      encryptionKeyVersion: "env-v1",
      algorithmVersion: "hmac-sha256-v1",
      lockedByUserId: user.id,
      lockedAt,
      entries: snapshotEntries,
    };
    for (const entry of entries) {
      entry.status = "locked";
      entry.updatedAt = lockedAt;
    }
    this.transitionGiveaway(giveaway, "locked");
    giveaway.snapshot = snapshot;
    this.giveaways.snapshotsById.set(snapshot.id, snapshot);
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_LOCKED", "giveaway", giveaway.id, {
      candidateCount: snapshot.candidateCount,
      snapshotId: snapshot.id,
      snapshotDigest,
      commitment,
      seedByteLength: seed.byteLength,
      ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
    });
    return this.toGiveawayLockResult(giveaway);
  }

  async cancelGiveaway(sessionToken: string, giveawayId: string, reason: unknown) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    const normalizedReason = this.requireGiveawayReason(reason);
    if (giveaway.awards.length > 0) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    this.transitionGiveaway(giveaway, "cancelled");
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_CANCELLED", "giveaway", giveaway.id, {
      state: giveaway.state,
      reasonDigest: this.hashGiveawayReason(normalizedReason),
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async suspendGiveaway(sessionToken: string, giveawayId: string, reason: unknown) {
    const admin = this.requireRole(sessionToken, "admin");
    const giveaway = this.requireGiveaway(giveawayId);
    const normalizedReason = this.requireGiveawayReason(reason);
    this.transitionGiveaway(giveaway, "suspended");
    const now = new Date().toISOString();
    giveaway.suspendedByUserId = admin.id;
    giveaway.suspendedAt = now;
    giveaway.suspensionReason = normalizedReason;
    giveaway.updatedAt = now;
    this.auditGiveaway(giveaway, admin.id, "GIVEAWAY_SUSPENDED", "giveaway", giveaway.id, {
      state: giveaway.state,
      reasonDigest: this.hashGiveawayReason(normalizedReason),
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async registerForEvent(sessionToken: string, eventId: string, input: RegistrationInput) {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    const cta = getEventCtaState(event);
    if (!cta.canRegister && !cta.canShowInterest) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const rsvpKey = `${event.id}:${user.id}`;
    const previousRsvp = this.rsvps.get(rsvpKey);
    const now = new Date().toISOString();
    const rsvp: RSVP & { userId: string; goingAt?: string; id: string } = {
      id: previousRsvp?.id ?? `rsvp-${randomUUID()}`,
      eventId: event.id,
      userId: user.id,
      status: input.status,
      attendanceType: input.attendanceType,
      clubName: input.clubName?.trim() || user.clubName,
      rosterIdentity:
        previousRsvp?.rosterIdentity ??
        user.defaultRosterIdentity ??
        "ANONYMOUS",
      ...(input.status === "going"
        ? {
            goingAt:
              previousRsvp?.status === "going" && previousRsvp.goingAt
                ? previousRsvp.goingAt
                : now,
          }
        : {}),
    };

    this.rsvps.set(rsvpKey, rsvp);
    if (input.status === "interested") {
      event.interested += 1;
      this.audit("RSVP_UPDATED", user.id, event.id);
      this.reconcileAutomaticEligibilityForEvent(event.id, user.id);
      return { rsvp, pass: null };
    }

    event.going += 1;
    const pass =
      this.findPassForEventRider(event.id, user.id) ??
      ({
        id: passIdForEvent(event.id, user.id),
        eventId: event.id,
        userId: user.id,
        qrToken: makePassToken(),
        status: "active",
        generatedAt: now,
      } satisfies Pass & { userId: string });

    this.passes.set(pass.id, pass);
    this.audit("RSVP_UPDATED", user.id, event.id);
    this.audit("PASS_CREATED", user.id, pass.id);
    this.reconcileAutomaticEligibilityForEvent(event.id, user.id);
    return { rsvp, pass: { ...pass } };
  }

  async configureEventRoster(
    sessionToken: string,
    eventId: string,
    input: { enabled: boolean },
  ): Promise<EventAttendeeSummary> {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireRosterConfigurator(user, event);
    if (typeof input?.enabled !== "boolean") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const previousEnabled = this.rosterSettings.get(event.id) ?? false;
    this.rosterSettings.set(event.id, input.enabled);
    this.audit("ROSTER_SETTINGS_UPDATED", user.id, event.id, {
      previousEnabled,
      nextEnabled: input.enabled,
    });
    return this.buildMemoryRosterSummary(event, input.enabled);
  }

  async listEventAttendees(
    sessionToken: string | undefined,
    eventId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<EventAttendeeRosterPage> {
    const event = this.requireEvent(eventId);
    const enabled = this.rosterSettings.get(event.id) ?? false;
    if (enabled) {
      if (!sessionToken) throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
      this.requireUser(sessionToken);
    }
    const limit = normalizeRosterPageLimit(options.limit);
    const cursor = options.cursor ? decodeRosterCursor(options.cursor) : undefined;

    const summary = this.buildMemoryRosterSummary(event, enabled);
    if (!enabled) {
      return { summary, attendees: [], pageSize: limit };
    }

    const visible = Array.from(this.rsvps.values())
      .filter((rsvp) => rsvp.eventId === event.id && rsvp.status === "going" && rsvp.goingAt)
      .map((rsvp) => ({ rsvp, user: this.users.get(rsvp.userId) }))
      .filter(
        (entry): entry is typeof entry & { user: BackendUser } =>
          Boolean(entry.user) &&
          classifyRosterEntry({
            enabled,
            rosterIdentity: entry.user.defaultRosterIdentity ?? "ANONYMOUS",
            profileSlug: entry.user?.profileSlug,
            profileVisibility: entry.user?.profileVisibility ?? "PRIVATE",
          }) === "VISIBLE",
      )
      .sort(
        (left, right) =>
          left.rsvp.goingAt!.localeCompare(right.rsvp.goingAt!) ||
          compareRosterRsvpIds(
            left.rsvp.id ?? `${left.rsvp.eventId}:${left.rsvp.userId}`,
            right.rsvp.id ?? `${right.rsvp.eventId}:${right.rsvp.userId}`,
          ),
      );
    const afterCursor = cursor
      ? visible.filter(({ rsvp }) => {
          const id = rsvp.id ?? `${rsvp.eventId}:${rsvp.userId}`;
          return rsvp.goingAt! > cursor.goingAt ||
            (rsvp.goingAt === cursor.goingAt && compareRosterRsvpIds(id, cursor.rsvpId) > 0);
        })
      : visible;
    const pageEntries = afterCursor.slice(0, limit + 1);
    const hasNextPage = pageEntries.length > limit;
    const selected = pageEntries.slice(0, limit);
    const attendees = selected.map(({ user }) => {
      const profile = this.toMemberProfileView(user);
      return {
        slug: profile.slug,
        displayName: profile.displayName,
        area: profile.area,
        profilePhotoUrl: profile.profilePhotoUrl,
        motorcycle: profile.motorcycle,
      };
    });
    const last = selected.at(-1)?.rsvp;
    return {
      summary,
      attendees,
      nextCursor:
        hasNextPage && last?.goingAt
          ? encodeRosterCursor({
              goingAt: last.goingAt,
              rsvpId: last.id ?? `${last.eventId}:${last.userId}`,
            })
          : undefined,
      pageSize: limit,
    };
  }

  async getEventAttendeeSummary(eventId: string): Promise<EventAttendeeSummary> {
    const event = this.requireEvent(eventId);
    return this.buildMemoryRosterSummary(event, this.rosterSettings.get(event.id) ?? false);
  }

  async updateEventRosterIdentity(
    sessionToken: string,
    eventId: string,
    input: { rosterIdentity: RosterIdentity },
  ) {
    const user = this.requireUser(sessionToken);
    this.requireEvent(eventId);
    if (input?.rosterIdentity !== "VISIBLE" && input?.rosterIdentity !== "ANONYMOUS") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const key = `${eventId}:${user.id}`;
    const rsvp = this.rsvps.get(key);
    if (!rsvp) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const updated = { ...rsvp, rosterIdentity: input.rosterIdentity };
    this.rsvps.set(key, updated);
    this.audit("RSVP_UPDATED", user.id, eventId);
    return { rosterIdentity: updated.rosterIdentity };
  }

  async getEventRosterIdentity(sessionToken: string, eventId: string) {
    const user = this.requireUser(sessionToken);
    this.requireEvent(eventId);
    const rsvp = this.rsvps.get(`${eventId}:${user.id}`);
    if (!rsvp) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return { rosterIdentity: rsvp.rosterIdentity ?? "ANONYMOUS" } satisfies {
      rosterIdentity: RosterIdentity;
    };
  }

  async configureCheckIn(
    sessionToken: string,
    eventId: string,
    input: CheckInConfiguration,
  ) {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    validateCheckInConfiguration(input);
    const previousSettings = this.getCheckInSettings(event.id);

    const settings: CheckInSettings = {
      eventId: event.id,
      mode: input.mode,
      state: input.state,
      qrMode: input.qrMode,
      fixedQrAcknowledged: input.qrMode === "fixed",
    };
    this.checkInSettings.set(event.id, settings);

    if (
      input.mode === "staff_only" ||
      input.state !== "open" ||
      previousSettings.qrMode !== input.qrMode
    ) {
      const now = Date.now();
      for (const session of this.selfCheckInSessions.values()) {
        if (session.eventId === event.id && !session.revokedAt) {
          session.revokedAt = now;
        }
      }
    }

    this.audit("CHECK_IN_SETTINGS_UPDATED", user.id, event.id);
    return { ...settings };
  }

  async issueSelfCheckInQr(sessionToken: string, eventId: string): Promise<SelfCheckInQr> {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    const settings = this.getCheckInSettings(event.id);

    this.requireSelfCheckInEnabled(settings);
    if (!this.isSelfCheckInEvent(event)) {
      throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
    }
    if (settings.qrMode === "fixed") {
      return { token: `fixed:${event.id}`, qrMode: "fixed" };
    }

    const token = `tbk_checkin_${randomBytes(24).toString("base64url")}`;
    const expiresAt = Date.now() + 90_000;
    this.selfCheckInSessions.set(token, { eventId: event.id, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString(), qrMode: "rotating" };
  }

  async getSelfCheckInContext(qrToken: string): Promise<SelfCheckInContext> {
    const resolved = this.resolveSelfCheckInQr(qrToken);
    const event = resolved.event;
    const settings = this.getCheckInSettings(event.id);
    if (settings.mode === "staff_only") {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
    return {
      event: cloneEvent(event),
      mode: settings.mode,
      state: settings.state,
      qrMode: settings.qrMode,
      available:
        resolved.valid &&
        settings.qrMode === resolved.qrMode &&
        settings.state === "open" &&
        this.isSelfCheckInEvent(event),
    };
  }

  async selfCheckIn(sessionToken: string, qrToken: string): Promise<SelfCheckInResult> {
    const rider = this.requireUser(sessionToken);
    if (rider.role !== "rider") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }
    const resolved = this.resolveSelfCheckInQr(qrToken);
    const event = resolved.event;
    const settings = this.getCheckInSettings(event.id);

    this.requireSelfCheckInEnabled(settings);
    if (settings.qrMode !== resolved.qrMode) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }
    if (!resolved.valid) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }
    if (!this.isSelfCheckInEvent(event)) {
      throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
    }

    const pass = Array.from(this.passes.values()).find(
      (candidate) => candidate.eventId === event.id && candidate.userId === rider.id,
    );
    if (!pass) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    if (pass.status === "cancelled") {
      throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
    }

    const existing = this.findCheckIn(event.id, pass.id);
    if (existing?.status === "pending") {
      return { status: "pending", pass: { ...pass } };
    }
    if (existing?.status === "confirmed" || pass.status === "checked_in") {
      throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
    }

    const timestamp = new Date().toISOString();
    const status: CheckInStatus = settings.mode === "self_review" ? "pending" : "confirmed";
    const checkIn: CheckInRecord = {
      id: `checkin-${randomUUID()}`,
      eventId: event.id,
      passId: pass.id,
      userId: rider.id,
      timestamp,
      confirmedAt: status === "confirmed" ? timestamp : undefined,
      status,
      method: "rider_qr",
    };
    this.checkIns.set(checkIn.id, checkIn);
    this.audit("SELF_CHECK_IN_REQUESTED", rider.id, checkIn.id);

    if (status === "confirmed") {
      pass.status = "checked_in";
      this.audit("CHECK_IN_CREATED", rider.id, checkIn.id);
      this.reconcileAutomaticEligibilityForEvent(event.id, rider.id);
    }

    return { status, pass: { ...pass } };
  }

  async scanPass(
    sessionToken: string,
    eventId: string,
    qrToken: string,
    method: ScanMethod,
  ) {
    const scanner = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireCheckInStaff(scanner, event);
    const staffMethod = normalizeStaffScanMethod(method);
    const pass = Array.from(this.passes.values()).find(
      (candidate) => candidate.qrToken === qrToken,
    );
    if (!pass) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    if (pass.eventId !== event.id) {
      throw new BackendError("WRONG_EVENT", "WRONG_EVENT");
    }
    if (pass.status === "cancelled") {
      throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
    }
    const existing = this.findCheckIn(event.id, pass.id);
    if (existing?.status === "pending") {
      const confirmedAt = new Date().toISOString();
      existing.status = "confirmed";
      existing.scannedBy = scanner.id;
      existing.confirmedAt = confirmedAt;
      existing.confirmationMethod = staffMethod;
      pass.status = "checked_in";
      this.audit("CHECK_IN_CONFIRMED", scanner.id, existing.id);
      this.reconcileAutomaticEligibilityForEvent(event.id, pass.userId);
      return { ...pass };
    }
    if (existing?.status === "confirmed" || pass.status === "checked_in") {
      throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
    }

    const timestamp = new Date().toISOString();
    const checkIn: CheckInRecord = {
      id: `checkin-${randomUUID()}`,
      eventId: event.id,
      passId: pass.id,
      userId: pass.userId,
      scannedBy: scanner.id,
      timestamp,
      confirmedAt: timestamp,
      status: "confirmed",
      method: staffMethod,
    };

    pass.status = "checked_in";
    this.checkIns.set(checkIn.id, checkIn);
    this.audit("CHECK_IN_CREATED", scanner.id, checkIn.id);
    this.reconcileAutomaticEligibilityForEvent(event.id, pass.userId);
    return { ...pass };
  }

  async approvePublish(sessionToken: string, eventId: string) {
    const user = this.requireRole(sessionToken, "admin");
    const event = this.requireEvent(eventId);
    if (event.status !== "PENDING_ADMIN_REVIEW") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    event.status = "PUBLISHED";
    this.audit("ADMIN_PUBLISHED", user.id, event.id);
    return cloneEvent(event);
  }

  async exportAttendeesCsv(sessionToken: string, eventId: string) {
    const user = this.requireRole(sessionToken, "admin");
    const event = this.requireEvent(eventId);
    const rows = ["event_id,user_email,rsvp_status,pass_status,checked_in_at"];
    const eventRsvps = Array.from(this.rsvps.values()).filter((rsvp) => rsvp.eventId === event.id);

    for (const rsvp of eventRsvps) {
      const attendee = this.users.get(rsvp.userId);
      const pass = Array.from(this.passes.values()).find(
        (candidate) => candidate.eventId === event.id && candidate.userId === rsvp.userId,
      );
      const checkIn = pass
        ? Array.from(this.checkIns.values()).find(
            (candidate) => candidate.passId === pass.id && candidate.status === "confirmed",
          )
        : null;
      rows.push(
        [
          event.id,
          attendee?.email ?? "",
          rsvp.status,
          pass?.status ?? "",
          checkIn?.confirmedAt ?? checkIn?.timestamp ?? "",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (eventRsvps.length === 0) {
      rows.push([event.id, "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    this.audit("ATTENDEE_EXPORT_CREATED", user.id, event.id);
    return rows.join("\n");
  }

  async exportLeadsCsv(sessionToken: string) {
    const user = this.requireRole(sessionToken, "admin");
    const rows = ["event_id,lead_name,email,interest,status"];
    const leadEvents = Array.from(this.events.values()).filter(
      (event) => event.type === "Test Ride" || event.tags.includes("Lead collection"),
    );

    for (const event of leadEvents) {
      rows.push(
        [
          event.id,
          "Seeded Tambike Lead",
          "lead@example.com",
          event.perkPreview,
          "captured",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (leadEvents.length === 0) {
      rows.push(["", "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    this.audit("LEAD_EXPORT_CREATED", user.id, "lead-export");
    return rows.join("\n");
  }

  async auditCount(action: AuditAction) {
    return this.audits.filter((audit) => audit.action === action).length;
  }

  listPublicUsers() {
    return Array.from(this.users.values()).map(cloneUser);
  }

  listEvents(query?: EventQueryInput) {
    return filterEventsByQuery(
      Array.from(this.events.values()).map((event) => this.withAttendanceCounts(event)),
      query,
    );
  }

  private allocateProfileSlug(displayName: string) {
    const base = profileSlugBase(displayName);
    const existing = new Set(
      Array.from(this.users.values())
        .map((user) => user.profileSlug)
        .filter((slug): slug is string => Boolean(slug)),
    );
    if (!existing.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!existing.has(candidate)) return candidate;
    }
  }

  private toInternalMemberProfile(user: BackendUser) {
    return {
      userId: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      verificationStatus: user.verificationStatus,
      profilePhotoStorageKey: user.profilePhotoStorageKey,
      slug: user.profileSlug ?? "",
      displayName: user.displayName,
      area: user.area,
      role: user.role,
      bio: user.profileBio,
      visibility: user.profileVisibility ?? ("PRIVATE" as const),
      joinedAt: user.joinedAt,
      profilePhotoMediaId: user.profilePhotoMediaId,
      motorcycle: this.motorcycles.get(user.id),
      hostedEventCount:
        user.role === "organizer" && user.organizerProfileId
          ? Array.from(this.events.values()).filter(
              (event) => event.organizerId === user.organizerProfileId,
            ).length
          : undefined,
    };
  }

  private toMemberProfileView(user: BackendUser) {
    return toMemberProfileView(this.toInternalMemberProfile(user));
  }

  private parseCreateGiveaway(input: unknown): CreateGiveawayInput {
    try {
      return parseCreateGiveawayInput(input);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
  }

  private parseUpdateGiveaway(input: unknown): UpdateGiveawayInput {
    try {
      return validateGiveawayUpdateInput(input);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
  }

  private parseGiveawayComplianceReview(input: unknown): {
    decision: "approved" | "changes_requested" | "rejected";
    reason?: string;
  } {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      !Object.hasOwn(record, "decision") ||
      !["approved", "changes_requested", "rejected"].includes(record.decision as string) ||
      Object.keys(record).some((key) => key !== "decision" && key !== "reason")
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    if (!Object.hasOwn(record, "reason")) {
      return { decision: record.decision as "approved" | "changes_requested" | "rejected" };
    }
    const reason = this.requireGiveawayReason(record.reason);
    return {
      decision: record.decision as "approved" | "changes_requested" | "rejected",
      reason,
    };
  }

  private requireGiveawayReason(reason: unknown) {
    if (typeof reason !== "string" || !reason.trim()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return reason.trim();
  }

  private requireGiveawayRecoveryClosureReason(reason: unknown) {
    const normalized = this.requireGiveawayReason(reason);
    if (normalized.length > 500) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return normalized;
  }

  private requireGiveawayRider(sessionToken: string) {
    const rider = this.requireUser(sessionToken);
    if (rider.role !== "rider") throw new BackendError("FORBIDDEN", "FORBIDDEN");
    return rider;
  }

  private requireGiveawayAwardForClaimPayload(payload: string) {
    let token: string;
    try {
      token = parseGiveawayClaimQrPayload(payload);
    } catch {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const tokenHash = hashGiveawayClaimToken(token);
    const award = Array.from(this.giveaways.awardsById.values()).find(
      (candidate) => candidate.claimTokenHash === tokenHash,
    );
    if (!award) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    return award;
  }

  private requireGiveawayClaimGate(
    giveaway: GiveawayAggregate,
    award: GiveawayAwardRecord,
    acceptedStatuses: readonly GiveawayAwardRecord["status"][],
    options: { enforceDeadline?: boolean } = {},
  ) {
    if (
      giveaway.state !== "claims_open" ||
      !award.isCurrent ||
      !acceptedStatuses.includes(award.status) ||
      ((options.enforceDeadline ?? true) && this.isGiveawayClaimDeadlineElapsed(award))
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
  }

  /** A rider may decline a verified claim after its cutoff, but never a late unclaimed award. */
  private requireGiveawayRiderDeclineGate(award: GiveawayAwardRecord) {
    if (
      !award.isCurrent ||
      !["pending_verification", "claimable", "verified"].includes(award.status) ||
      (award.status !== "verified" && this.isGiveawayClaimDeadlineElapsed(award))
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
  }

  private isGiveawayClaimDeadlineElapsed(
    award: Pick<GiveawayAwardRecord, "claimDeadlineAt">,
    now: Date = new Date(),
  ) {
    if (!award.claimDeadlineAt) return false;
    const deadline = new Date(award.claimDeadlineAt).getTime();
    return !Number.isFinite(deadline) || deadline <= now.getTime();
  }

  /** A new winner may never inherit an elapsed campaign deadline. */
  private resolveGiveawayReplacementClaimDeadline(
    giveaway: GiveawayAggregate,
    requestedDeadlineAt?: string,
  ) {
    if (requestedDeadlineAt) {
      return this.resolveExplicitGiveawayClaimDeadline(requestedDeadlineAt);
    }
    if (!this.hasUsableGiveawayReplacementDeadline(giveaway)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return giveaway.claimDeadlineAt;
  }

  private resolveExplicitGiveawayClaimDeadline(value: string) {
    const deadline = new Date(value);
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return deadline.toISOString();
  }

  private hasUsableGiveawayReplacementDeadline(giveaway: Pick<GiveawayAggregate, "claimDeadlineAt">) {
    if (!giveaway.claimDeadlineAt) return true;
    const deadline = new Date(giveaway.claimDeadlineAt).getTime();
    return Number.isFinite(deadline) && deadline > Date.now();
  }

  /** Giveaway operations intentionally do not reuse attendance-staff authorization. */
  private requireGiveawayOperator(
    user: BackendUser,
    event: Event,
    giveaway: GiveawayAggregate,
  ) {
    if (user.role === "admin") return;
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      user.organizerProfileId === event.organizerId
    ) {
      return;
    }
    if (giveaway.operators.some((assignment) => assignment.userId === user.id && !assignment.revokedAt)) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private requireGiveawayPrizePool(giveaway: GiveawayAggregate, prizePoolId: string) {
    const pool = giveaway.prizePools.find((candidate) => candidate.id === prizePoolId);
    if (!pool) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    return pool;
  }

  private toOperatorGiveawayClaimView(
    giveaway: GiveawayAggregate,
    award: GiveawayAwardRecord,
  ): OperatorGiveawayClaimView {
    if (
      ![
        "pending_verification",
        "claimable",
        "verified",
        "fulfilled",
        "expired",
        "voided",
      ].includes(award.status)
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const pool = this.requireGiveawayPrizePool(giveaway, award.prizePoolId);
    return {
      awardId: award.id,
      giveawayId: giveaway.id,
      claimReference: award.opaqueClaimReference,
      prizePoolTitle: pool.title,
      fulfilmentMode: pool.fulfilmentMode,
      presenceVerificationRequired:
        giveaway.presenceVerificationRequired || pool.presenceVerificationRequired,
      claimDeadlineAt: award.claimDeadlineAt,
      status: award.status as OperatorGiveawayClaimView["status"],
    };
  }

  private parseGiveawayClaimVerificationInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !["payload", "method", "idempotencyKey", "presenceObserved"].includes(key),
      ) ||
      typeof record.payload !== "string" ||
      !["camera", "upload", "manual"].includes(record.method as string) ||
      typeof record.idempotencyKey !== "string" ||
      (record.presenceObserved !== undefined && typeof record.presenceObserved !== "boolean")
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      payload: record.payload,
      method: record.method as GiveawayClaimScannerMethod,
      idempotencyKey: this.requireOpaqueGiveawayLedgerText(record.idempotencyKey),
      presenceObserved: record.presenceObserved === true,
    };
  }

  private parseGiveawayFulfillmentInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => !["awardId", "idempotencyKey", "reference"].includes(key)) ||
      typeof record.awardId !== "string" ||
      !record.awardId.trim() ||
      typeof record.idempotencyKey !== "string" ||
      (record.reference !== undefined &&
        (typeof record.reference !== "string" ||
          !this.isOpaqueGiveawayFulfillmentReference(record.reference.trim())))
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      awardId: record.awardId.trim(),
      idempotencyKey: this.requireOpaqueGiveawayLedgerText(record.idempotencyKey),
      reference: typeof record.reference === "string" ? record.reference.trim() : undefined,
    };
  }

  private parseExpiredDirectGiveawayRecoveryInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => !["awardId", "claimDeadlineAt", "reason"].includes(key)) ||
      typeof record.awardId !== "string" ||
      !record.awardId.trim() ||
      typeof record.claimDeadlineAt !== "string" ||
      !record.claimDeadlineAt.trim()
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      awardId: record.awardId.trim(),
      claimDeadlineAt: this.resolveExplicitGiveawayClaimDeadline(record.claimDeadlineAt),
      reason: this.requireGiveawayReason(record.reason),
    };
  }

  private parseGiveawayDeliveryDetailsInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => !["consent", "consentVersion", "details"].includes(key)) ||
      record.consent !== true ||
      typeof record.consentVersion !== "string" ||
      !this.isPlainGiveawayDeliveryRecord(record.details)
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    let canonicalDetails: string;
    try {
      canonicalDetails = canonicalizeJson(record.details);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    // Canonical JSON includes every nested object key and value, so this also prevents
    // a raw claim token or QR payload from being retained inside encrypted delivery data.
    if (canonicalDetails.length > 16_384 || this.hasGiveawayClaimSecretText(canonicalDetails)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      consentVersion: this.requireOpaqueGiveawayLedgerText(record.consentVersion),
      details: record.details as Record<string, unknown>,
    };
  }

  /**
   * This is deliberately an opaque tracking-style identifier, not free text:
   * names, addresses, phone numbers, URLs, and whitespace are not accepted.
   */
  private isOpaqueGiveawayFulfillmentReference(reference: string) {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(reference) && !this.hasGiveawayClaimSecretText(reference);
  }

  /** Prevent a scanned claim secret from leaking into append-only ledgers or audit payloads. */
  private requireOpaqueGiveawayLedgerText(value: unknown) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      !this.isOpaqueGiveawayFulfillmentReference(value.trim())
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return value.trim();
  }

  private hasGiveawayClaimSecretText(value: string) {
    return /tbk_gc1_[A-Za-z0-9_-]{43}|TAMBIKE:GIVEAWAY-CLAIM:v1:/i.test(value);
  }

  private isPlainGiveawayDeliveryRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(
      value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
    );
  }

  private requireGiveawayDeliveryEncryptionKey() {
    const key = process.env.GIVEAWAY_DELIVERY_ENCRYPTION_KEY;
    if (!key) {
      throw new BackendError(
        "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
        "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
      );
    }
    return key;
  }

  private purgeGiveawayDeliveryDetail(
    giveaway: GiveawayAggregate,
    detail: GiveawayDeliveryDetailRecord,
    actorUserId: string | undefined,
    reason: "withdrawn" | "retention_expired" | "award_expired",
    options: { initiatedVia?: "cron" } = {},
  ) {
    if (detail.purgedAt) return;
    const now = new Date().toISOString();
    detail.encryptedPayload = undefined;
    detail.encryptedIv = undefined;
    detail.encryptedAuthTag = undefined;
    detail.purgedAt = now;
    detail.updatedAt = now;
    this.auditGiveaway(
      giveaway,
      actorUserId,
      reason === "withdrawn" ? "GIVEAWAY_DELIVERY_WITHDRAWN" : "GIVEAWAY_DELIVERY_PURGED",
      "delivery_detail",
      detail.id,
      {
        awardId: detail.awardId,
        deliveryDetailId: detail.id,
        reason,
        ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
      },
    );
  }

  private requireGiveawayEntryMode(
    giveaway: GiveawayAggregate,
    entryMode: GiveawayEntryMode,
  ) {
    if (giveaway.state !== "open") {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_OPEN", "GIVEAWAY_ENTRY_NOT_OPEN");
    }
    if (giveaway.entryMode !== entryMode) {
      throw new BackendError("GIVEAWAY_ENTRY_MODE_INVALID", "GIVEAWAY_ENTRY_MODE_INVALID");
    }
  }

  private parseGiveawayCampaignCodeInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (!Number.isInteger(record.maxUses) || (record.maxUses as number) <= 0) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const expiresAt =
      record.expiresAt === undefined
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : record.expiresAt;
    if (typeof expiresAt !== "string") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return { maxUses: record.maxUses as number, expiresAt };
  }

  private parseManualGiveawayEntryInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      typeof record.giveawayId !== "string" ||
      !record.giveawayId.trim() ||
      typeof record.riderId !== "string" ||
      !record.riderId.trim()
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const reason = this.requireGiveawayReason(record.reason);
    return {
      giveawayId: record.giveawayId.trim(),
      riderId: record.riderId.trim(),
      reason,
    };
  }

  private parseGiveawayWinnerPublicationInput(input: unknown): GiveawayWinnerPublicationInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => key !== "published" && key !== "alias") ||
      !Object.hasOwn(record, "published") ||
      typeof record.published !== "boolean"
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    if (!record.published) {
      if (Object.hasOwn(record, "alias")) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
      return { published: false };
    }
    if (!Object.hasOwn(record, "alias") || typeof record.alias !== "string") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const alias = record.alias.trim();
    if (!/^[A-Za-z][A-Za-z0-9 ._-]{1,39}$/.test(alias)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return { published: true, alias };
  }

  private isOpaqueGiveawayWinnerAlias(alias: string, entryReference: string) {
    return (
      alias === entryReference ||
      /^(?:entry|claim)_[A-Za-z0-9_-]+$/i.test(alias)
    );
  }

  private parseGiveawayDrawInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      typeof record.giveawayId !== "string" ||
      !record.giveawayId.trim() ||
      typeof record.idempotencyKey !== "string" ||
      !record.idempotencyKey.trim()
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    if (record.reason !== undefined && (typeof record.reason !== "string" || !record.reason.trim())) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      giveawayId: record.giveawayId.trim(),
      idempotencyKey: this.requireOpaqueGiveawayLedgerText(record.idempotencyKey),
      reason: typeof record.reason === "string" ? record.reason.trim() : undefined,
    };
  }

  private parseGiveawayRedrawInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !["awardId", "idempotencyKey", "reason", "claimDeadlineAt"].includes(key),
      ) ||
      typeof record.awardId !== "string" ||
      !record.awardId.trim() ||
      typeof record.idempotencyKey !== "string" ||
      record.claimDeadlineAt !== undefined &&
        (typeof record.claimDeadlineAt !== "string" || !record.claimDeadlineAt.trim())
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const claimDeadlineAt =
      typeof record.claimDeadlineAt === "string"
        ? this.resolveExplicitGiveawayClaimDeadline(record.claimDeadlineAt)
        : undefined;
    return {
      awardId: record.awardId.trim(),
      idempotencyKey: this.requireOpaqueGiveawayLedgerText(record.idempotencyKey),
      reason: this.requireGiveawayReason(record.reason),
      claimDeadlineAt,
    };
  }

  private parseManualGiveawayAwardInput(input: unknown): SelectManualGiveawayAwardInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !["giveawayId", "prizePoolId", "snapshotEntryId", "reason", "idempotencyKey"].includes(key),
      )
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    for (const field of ["giveawayId", "prizePoolId", "snapshotEntryId", "idempotencyKey"] as const) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
    }
    return {
      giveawayId: (record.giveawayId as string).trim(),
      prizePoolId: (record.prizePoolId as string).trim(),
      snapshotEntryId: this.requireOpaqueGiveawayLedgerText(record.snapshotEntryId),
      idempotencyKey: this.requireOpaqueGiveawayLedgerText(record.idempotencyKey),
      reason: this.requireGiveawayReason(record.reason),
    };
  }

  private parseManualGiveawayReplacementInput(
    input: unknown,
  ): ReplaceManualGiveawayAwardInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) =>
          ![
            "sourceAwardId",
            "snapshotEntryId",
            "reason",
            "idempotencyKey",
            "claimDeadlineAt",
          ].includes(key),
      ) ||
      typeof record.sourceAwardId !== "string" ||
      !record.sourceAwardId.trim() ||
      typeof record.snapshotEntryId !== "string" ||
      !record.snapshotEntryId.trim() ||
      typeof record.idempotencyKey !== "string" ||
      !record.idempotencyKey.trim() ||
      (record.claimDeadlineAt !== undefined &&
        (typeof record.claimDeadlineAt !== "string" || !record.claimDeadlineAt.trim()))
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      sourceAwardId: this.requireOpaqueGiveawayLedgerText(record.sourceAwardId),
      snapshotEntryId: this.requireOpaqueGiveawayLedgerText(record.snapshotEntryId),
      reason: this.requireGiveawayReason(record.reason),
      idempotencyKey: this.requireOpaqueGiveawayLedgerText(record.idempotencyKey),
      claimDeadlineAt:
        typeof record.claimDeadlineAt === "string"
          ? this.resolveExplicitGiveawayClaimDeadline(record.claimDeadlineAt)
          : undefined,
    };
  }

  private hashGiveawayCampaignCode(code: string) {
    return createHash("sha256").update(code).digest("hex");
  }

  private createEncryptedGiveawayDrawSeed() {
    const encryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new BackendError(
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
      );
    }
    try {
      const seed = this.generateGiveawayDrawSeed();
      return {
        seed,
        encryptedSeed: encryptDrawSeed(seed, encryptionKey),
        commitment: createDrawSeedCommitment(seed),
      };
    } catch {
      throw new BackendError(
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
      );
    }
  }

  private decryptGiveawayDrawSeed(snapshot: GiveawaySnapshotRecord) {
    const encryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new BackendError(
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
      );
    }
    try {
      return decryptDrawSeed(snapshot.encryptedSeed, encryptionKey);
    } catch {
      throw new BackendError(
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
      );
    }
  }

  private toGiveawayLockResult(giveaway: GiveawayAggregate) {
    const snapshot = giveaway.snapshot;
    if (!snapshot) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return {
      ...this.toGiveawayCampaignView(giveaway),
      snapshot: {
        id: snapshot.id,
        candidateCount: snapshot.candidateCount,
        snapshotDigest: snapshot.snapshotDigest,
        commitment: snapshot.seedCommitment,
        algorithmVersion: snapshot.algorithmVersion,
      },
    };
  }

  private toRiderGiveawayState(giveaway: GiveawayAggregate, riderId: string): RiderGiveawayState {
    const entry = giveaway.entriesByRider.get(riderId);
    if (!entry || entry.status === "withdrawn") {
      return { giveawayId: giveaway.id, status: "not_eligible", entryCount: 0 };
    }
    if (entry.status === "disqualified") {
      return { giveawayId: giveaway.id, status: "disqualified", entryCount: 0 };
    }
    const livePresentation = this.toRiderGiveawayLivePresentation(giveaway, entry);
    const proof = this.toRiderGiveawayDrawProof(giveaway, entry);
    const award = giveaway.awards
      .filter(
        (candidate) =>
          candidate.winnerUserId === riderId &&
          [
            "pending_verification",
            "claimable",
            "verified",
            "fulfilled",
            "declined",
            "disqualified",
            "expired",
            "voided",
          ].includes(candidate.status),
      )
      .sort(
        (left, right) =>
          Number(right.isCurrent) - Number(left.isCurrent) || right.createdAt.localeCompare(left.createdAt),
      )[0];
    if (!award) {
      return {
        giveawayId: giveaway.id,
        status: "entered",
        entryCount: entry.currentWeight,
        livePresentation,
        ...(proof ? { proof } : {}),
      };
    }
    const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
    if (!pool) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return {
      giveawayId: giveaway.id,
      status: award.status as RiderGiveawayState["status"],
      entryCount: entry.currentWeight,
      livePresentation,
      award: {
        awardId: award.id,
        prizePoolTitle: pool.title,
        status: award.status as NonNullable<RiderGiveawayState["award"]>["status"],
        claimDeadlineAt: award.claimDeadlineAt,
        fulfilmentMode: pool.fulfilmentMode,
        winnerPublication: {
          isPublic: this.isGiveawayWinnerAliasPublic(award),
          ...(award.publicWinnerAlias ? { alias: award.publicWinnerAlias } : {}),
        },
      },
      ...(proof ? { proof } : {}),
    };
  }

  private toRiderGiveawayLivePresentation(
    giveaway: GiveawayAggregate,
    entry: GiveawayEntryRecord,
  ): NonNullable<RiderGiveawayState["livePresentation"]> {
    const optedIn = isGiveawayLivePresentationOptedIn({
      optedInAt: entry.livePresentationOptedInAt,
      revokedAt: entry.livePresentationRevokedAt,
    });
    const frozenLabel = giveaway.snapshot?.entries.find(
      (candidate) => candidate.entryId === entry.id,
    )?.presentationLabel;
    const preview = deriveGiveawayPresentationLabelPreview({
      opaquePublicReference: entry.opaquePublicReference,
      displayName: this.users.get(entry.riderId)?.displayName ?? "",
      optedIn,
    });
    return {
      optedIn,
      canUpdate: giveaway.state === "open" && entry.status === "eligible",
      labelPreview: frozenLabel ?? preview.presentationLabel,
    };
  }

  private toRiderGiveawayDrawProof(
    giveaway: GiveawayAggregate,
    entry: GiveawayEntryRecord,
  ) {
    const snapshotEntry = giveaway.snapshot?.entries.find(
      (candidate) => candidate.entryId === entry.id,
    );
    const drawVerifications = this.toPublicGiveawayDrawVerifications(giveaway);
    if (!snapshotEntry || drawVerifications.length === 0) return undefined;
    return {
      entryReference: snapshotEntry.opaquePublicReference,
      drawVerifications,
    };
  }

  private calculateGiveawayConfigDigest(giveaway: GiveawayAggregate, mechanicsVersionId: string) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          giveawayId: giveaway.id,
          mechanicsVersionId,
          entryMode: giveaway.entryMode,
          maxEntriesPerRider: giveaway.maxEntriesPerRider,
          maxWinsPerRider: giveaway.maxWinsPerRider,
          maxWinsTotal: giveaway.maxWinsTotal,
          eligibilityGroups: giveaway.eligibilityGroups.map((group) => ({
            id: group.id,
            position: group.position,
            entryWeight: group.entryWeight,
            enabled: group.enabled,
            conditions: group.conditions.map((condition) => condition.condition),
          })),
          prizePools: giveaway.prizePools.map((pool) => ({
            id: pool.id,
            position: pool.position,
            awardMode: pool.awardMode,
            inventoryKind: pool.inventoryKind,
            inventoryLimit: pool.inventoryLimit ?? null,
            perRiderLimit: pool.perRiderLimit ?? 1,
            eligibilityGroupIds: pool.eligibilityGroupIds,
            itemIds: pool.items.map((item) => item.id),
          })),
        }),
      )
      .digest("hex");
  }

  private calculateDrawInputDigest(
    giveaway: GiveawayAggregate,
    snapshot: GiveawaySnapshotRecord,
    algorithmVersion: GiveawayDrawRecord["algorithmVersion"],
    actionInput: GiveawayDrawActionInput,
  ) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          giveawayId: giveaway.id,
          snapshotDigest: snapshot.snapshotDigest,
          algorithmVersion,
          action: actionInput.action,
          reasonDigest: actionInput.reasonDigest,
          prizePoolId: actionInput.prizePoolId ?? null,
          riderId: actionInput.riderId ?? null,
          snapshotEntryId: actionInput.snapshotEntryId ?? null,
          predecessorAwardId: actionInput.predecessorAwardId ?? null,
          claimDeadlineAt: actionInput.claimDeadlineAt ?? null,
          prizePools: giveaway.prizePools.map((pool) => ({
            id: pool.id,
            awardMode: pool.awardMode,
            itemIds: pool.items.map((item) => item.id),
          })),
        }),
      )
      .digest("hex");
  }

  private assertGiveawayDrawReplayInput(
    draw: Pick<GiveawayDrawRecord, "inputDigest">,
    expectedInputDigest: string,
  ) {
    if (draw.inputDigest !== expectedInputDigest) {
      throw new BackendError("GIVEAWAY_IDEMPOTENCY_CONFLICT", "GIVEAWAY_IDEMPOTENCY_CONFLICT");
    }
  }

  private calculateGiveawayDrawResultDigest(giveaway: GiveawayAggregate, draw: GiveawayDrawRecord) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          giveawayId: giveaway.id,
          drawId: draw.id,
          snapshotId: draw.snapshotId,
          algorithmVersion: draw.algorithmVersion,
          awards: draw.awardIds.map((awardId) => {
            const award = this.giveaways.awardsById.get(awardId);
            if (!award) throw new BackendError("NOT_FOUND", "NOT_FOUND");
            return {
              prizePoolId: award.prizePoolId,
              prizeItemId: award.prizeItemId ?? null,
              snapshotEntryId: award.snapshotEntryId ?? null,
              rank: award.rank ?? null,
              predecessorAwardId: award.predecessorAwardId ?? null,
            };
          }),
        }),
      )
      .digest("hex");
  }

  private buildGiveawayDrawVerification(
    giveaway: GiveawayAggregate,
    draw: GiveawayDrawRecord,
    seed: Uint8Array,
    published: boolean,
  ) {
    const snapshot = giveaway.snapshot;
    if (!snapshot) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return buildPublicDrawVerification({
      giveawayId: giveaway.id,
      published,
      seed: published ? seed : undefined,
      commitment: snapshot.seedCommitment,
      snapshotDigest: snapshot.snapshotDigest,
      snapshotCount: snapshot.candidateCount,
      algorithmVersion: draw.algorithmVersion,
      drawDigest: draw.resultDigest,
    });
  }

  private toGiveawayDrawResult(giveaway: GiveawayAggregate, draw: GiveawayDrawRecord) {
    const snapshot = giveaway.snapshot;
    if (!snapshot) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const published = Boolean(snapshot.seedRevealedAt);
    const seed = published ? this.decryptGiveawayDrawSeed(snapshot) : undefined;
    return {
      drawId: draw.id,
      verification: this.buildGiveawayDrawVerification(giveaway, draw, seed ?? new Uint8Array(), published),
    };
  }

  private requireGiveawayByAward(award: GiveawayAwardRecord) {
    const giveaway = Array.from(this.giveaways.campaignsById.values()).find((candidate) =>
      candidate.awards.some((candidateAward) => candidateAward.id === award.id),
    );
    if (!giveaway) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return giveaway;
  }

  private resolveGiveawayAwardByAdministrator(
    sessionToken: string,
    awardId: string,
    reason: unknown,
    status: "voided" | "disqualified",
  ): RiderGiveawayState {
    const administrator = this.requireRole(sessionToken, "admin");
    const normalizedReason = this.requireGiveawayReason(reason);
    const award = this.giveaways.awardsById.get(awardId);
    const directAward = award ? this.isDirectGiveawayAward(award) : false;
    if (
      !award ||
      !award.isCurrent ||
      (!directAward && !(award.drawId && award.snapshotEntryId)) ||
      !["pending_verification", "claimable", "verified"].includes(award.status)
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = this.requireGiveawayByAward(award);
    const reasonDigest = this.hashGiveawayReason(normalizedReason);
    if (directAward) {
      this.finalizeDirectGiveawayAward(giveaway, award, status, reasonDigest);
    } else {
      award.status = status;
      award.reasonDigest = reasonDigest;
      award.updatedAt = new Date().toISOString();
    }
    this.auditGiveaway(
      giveaway,
      administrator.id,
      status === "voided" ? "GIVEAWAY_AWARD_VOIDED" : "GIVEAWAY_AWARD_DISQUALIFIED",
      "award",
      award.id,
      {
        awardId: award.id,
        drawId: award.drawId ?? null,
        status,
        reasonDigest,
        directAward,
      },
    );
    if (directAward) this.reallocateFinalizedDirectGiveawayAward(giveaway, award);
    return this.toRiderGiveawayState(giveaway, award.winnerUserId);
  }

  private createGiveawayEntryFromPath(
    giveaway: GiveawayAggregate,
    riderId: string,
    input: {
      path: Exclude<GiveawayEntryRecord["entryPath"], "automatic">;
      eventType: Extract<GiveawayEntryEventRecord["type"], "opted_in" | "campaign_code_claimed" | "manual_grant">;
      actorUserId: string;
      mechanicsAcknowledgement?: GiveawayEntryRecord["mechanicsAcknowledgement"];
      campaignCodeId?: string;
      manualGrantActive?: boolean;
      reasonDigest?: string;
    },
  ) {
    const existing = giveaway.entriesByRider.get(riderId);
    if (existing && existing.status !== "withdrawn") {
      throw new BackendError("GIVEAWAY_ALREADY_ENTERED", "GIVEAWAY_ALREADY_ENTERED");
    }
    const now = new Date().toISOString();
    const qualification = this.evaluateGiveawayEntryQualification(giveaway, riderId, {
      campaignCode: input.path === "campaign_code",
      manual: input.path === "manual",
      actionAt: now,
    });
    if (qualification.weight <= 0) {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    }
    const timing = reconcileGiveawayEligibilityTimings({
      previousTimings: existing?.qualifiedEligibilityGroupTimings ?? [],
      qualifiedGroups: qualification.qualifiedGroups.map(({ group, derivedEligibleAt }) => ({
        groupId: group.id,
        position: group.position,
        derivedEligibleAt,
      })),
      actionAt: now,
    });
    if (!timing.eligibilityCycleAt) throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    assertGiveawayEligibilityTimingIntegrity(
      qualification.qualifiedGroups.map(({ group }) => group.id),
      timing.qualifiedEligibilityGroupTimings,
    );
    const entry =
      existing ??
      ({
        id: `giveaway-entry-${this.generateGiveawayUuid()}`,
        riderId,
        status: "eligible",
        currentWeight: qualification.weight,
        eligibilityCycleAt: timing.eligibilityCycleAt,
        qualifiedSourceFingerprint: qualification.sourceFingerprint,
        qualifiedGroupIds: qualification.qualifiedGroups.map(({ group }) => group.id),
        qualifiedEligibilityGroupTimings: timing.qualifiedEligibilityGroupTimings,
        entryPath: input.path,
        opaquePublicReference: `entry_${randomBytes(16).toString("base64url")}`,
        createdAt: now,
        updatedAt: now,
      } satisfies GiveawayEntryRecord);
    entry.status = "eligible";
    entry.currentWeight = qualification.weight;
    entry.eligibilityCycleAt = timing.eligibilityCycleAt;
    entry.qualifiedSourceFingerprint = qualification.sourceFingerprint;
    entry.qualifiedGroupIds = qualification.qualifiedGroups.map(({ group }) => group.id);
    entry.qualifiedEligibilityGroupTimings = timing.qualifiedEligibilityGroupTimings;
    entry.entryPath = input.path;
    entry.mechanicsAcknowledgement = input.mechanicsAcknowledgement;
    entry.campaignCodeId = input.campaignCodeId;
    entry.manualGrantActive = input.manualGrantActive;
    entry.updatedAt = now;
    giveaway.entriesByRider.set(riderId, entry);
    this.giveaways.entriesById.set(entry.id, entry);
    this.recordGiveawayEntryEvent(giveaway, entry, {
      type: input.eventType,
      sourceKey: `${input.path}:${giveaway.id}:${entry.id}:${giveaway.entryEvents.length + 1}`,
      actorUserId: input.actorUserId,
      idempotencyKey: `${input.path}:${giveaway.id}:${entry.id}:${randomUUID()}`,
      weightDelta: qualification.weight,
      sourceSnapshot: {
        qualifiedGroupIds: qualification.qualifiedGroups.map(({ group }) => group.id),
        qualifiedEligibilityGroupTimings: timing.qualifiedEligibilityGroupTimings,
        eligibilityCycleAt: timing.eligibilityCycleAt,
        sourceFingerprint: qualification.sourceFingerprint,
        ...(input.mechanicsAcknowledgement
          ? {
              mechanicsVersion: input.mechanicsAcknowledgement.version,
              mechanicsChecksum: input.mechanicsAcknowledgement.checksum,
            }
          : {}),
        ...(input.campaignCodeId ? { campaignCodeId: input.campaignCodeId } : {}),
        ...(input.reasonDigest ? { reasonDigest: input.reasonDigest } : {}),
      },
    });
    this.notifyGiveaway(giveaway, riderId, "giveaway_entry");
    this.reallocateImmediateGiveawayAwards(giveaway);
    return entry;
  }

  private evaluateGiveawayEntryQualification(
    giveaway: GiveawayAggregate,
    riderId: string,
    context: { campaignCode?: boolean; manual?: boolean; actionAt?: string } = {},
  ) {
    const qualifiedGroups = giveaway.eligibilityGroups.flatMap<QualifiedAutomaticGiveawayGroup>(
      (group) => {
        if (!group.enabled) return [];
        const evaluations = group.conditions.map((condition) =>
          this.evaluateGiveawayCondition(giveaway.eventId, riderId, condition.condition, context),
        );
        if (!evaluations.every((evaluation) => evaluation.satisfied)) return [];
        const derivedEligibleAt = latestGiveawayEligibilityTimestamp(
          evaluations.map((evaluation) => evaluation.eligibleAt),
        );
        if (!derivedEligibleAt) return [];
        return [
          {
            group,
            sourceFacts: evaluations.map((evaluation) => evaluation.sourceFact),
            derivedEligibleAt,
          },
        ];
      },
    );
    const calculatedWeight = qualifiedGroups.reduce(
      (total, qualifiedGroup) => total + qualifiedGroup.group.entryWeight,
      0,
    );
    return {
      qualifiedGroups,
      weight: Math.min(calculatedWeight, giveaway.maxEntriesPerRider),
      sourceFingerprint: this.calculateQualifiedSourceFingerprint(qualifiedGroups),
    };
  }

  private recordGiveawayEntryEvent(
    giveaway: GiveawayAggregate,
    entry: GiveawayEntryRecord,
    input: {
      type: GiveawayEntryEventRecord["type"];
      sourceKey: string;
      sourceSnapshot?: Record<string, unknown>;
      weightDelta: number;
      actorUserId?: string;
      idempotencyKey: string;
    },
  ) {
    const record: GiveawayEntryEventRecord = Object.freeze({
      id: `giveaway-entry-event-${randomUUID()}`,
      entryId: entry.id,
      type: input.type,
      sourceKey: input.sourceKey,
      sourceSnapshot: input.sourceSnapshot ? Object.freeze({ ...input.sourceSnapshot }) : undefined,
      weightDelta: input.weightDelta,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    });
    giveaway.entryEvents.push(record);
    this.giveaways.entryEventsById.set(record.id, record);
  }

  private reconcileEntryForLock(giveaway: GiveawayAggregate, riderId: string) {
    const entry = giveaway.entriesByRider.get(riderId);
    if (!entry) return;
    if (entry.entryPath === "manual" && !entry.manualGrantActive) return;
    const qualification = this.evaluateGiveawayEntryQualification(giveaway, riderId, {
      campaignCode: entry.entryPath === "campaign_code",
      manual: entry.entryPath === "manual" && entry.manualGrantActive,
      actionAt: entry.createdAt,
    });
    const now = new Date().toISOString();
    if (qualification.weight <= 0) {
      if (entry.status === "eligible") {
        this.voidDirectEntryAwards(giveaway, entry, undefined, "lock_revalidation");
        entry.status = "withdrawn";
        entry.qualifiedGroupIds = [];
        entry.qualifiedEligibilityGroupTimings = [];
        entry.updatedAt = now;
        this.recordGiveawayEntryEvent(giveaway, entry, {
          type: "source_revalidated",
          sourceKey: `lock-revalidation:${giveaway.id}:${entry.id}:${giveaway.entryEvents.length + 1}`,
          weightDelta: -entry.currentWeight,
          sourceSnapshot: {
            qualifiedGroupIds: [],
            qualifiedEligibilityGroupTimings: [],
            eligibilityCycleAt: entry.eligibilityCycleAt,
            sourceFingerprint: qualification.sourceFingerprint,
          },
          idempotencyKey: `lock-revalidation:${giveaway.id}:${entry.id}:${randomUUID()}`,
        });
      }
      return;
    }
    const timing = reconcileGiveawayEligibilityTimings({
      previousTimings: entry.qualifiedEligibilityGroupTimings,
      qualifiedGroups: qualification.qualifiedGroups.map(({ group, derivedEligibleAt }) => ({
        groupId: group.id,
        position: group.position,
        derivedEligibleAt,
      })),
      actionAt: entry.entryPath === "automatic" ? undefined : entry.createdAt,
    });
    if (!timing.eligibilityCycleAt) throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    const nextGroupIds = qualification.qualifiedGroups.map(({ group }) => group.id);
    assertGiveawayEligibilityTimingIntegrity(nextGroupIds, timing.qualifiedEligibilityGroupTimings);
    if (entry.status === "withdrawn" && entry.entryPath !== "manual") entry.status = "eligible";
    if (entry.status === "eligible") {
      const weightDelta = qualification.weight - entry.currentWeight;
      const changed =
        weightDelta !== 0 ||
        entry.qualifiedSourceFingerprint !== qualification.sourceFingerprint ||
        !this.haveSameGiveawayGroupIds(entry.qualifiedGroupIds, nextGroupIds) ||
        entry.eligibilityCycleAt !== timing.eligibilityCycleAt ||
        !this.haveSameGiveawayEligibilityTimings(
          entry.qualifiedEligibilityGroupTimings,
          timing.qualifiedEligibilityGroupTimings,
        );
      entry.currentWeight = qualification.weight;
      entry.eligibilityCycleAt = timing.eligibilityCycleAt;
      entry.qualifiedSourceFingerprint = qualification.sourceFingerprint;
      entry.qualifiedGroupIds = nextGroupIds;
      entry.qualifiedEligibilityGroupTimings = timing.qualifiedEligibilityGroupTimings;
      entry.updatedAt = now;
      this.voidIneligibleDirectEntryAwards(giveaway, entry, undefined, "lock_pool_revalidation");
      if (changed) {
        this.recordGiveawayEntryEvent(giveaway, entry, {
          type: "source_revalidated",
          sourceKey: `lock-revalidation:${giveaway.id}:${entry.id}:${giveaway.entryEvents.length + 1}`,
          weightDelta,
          sourceSnapshot: {
            qualifiedGroupIds: entry.qualifiedGroupIds,
            qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
            eligibilityCycleAt: entry.eligibilityCycleAt,
            sourceFingerprint: entry.qualifiedSourceFingerprint,
          },
          idempotencyKey: `lock-revalidation:${giveaway.id}:${entry.id}:${randomUUID()}`,
        });
      }
    }
  }

  private haveSameGiveawayGroupIds(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
  }

  private haveSameGiveawayEligibilityTimings(
    left: readonly GiveawayEligibilityGroupTiming[],
    right: readonly GiveawayEligibilityGroupTiming[],
  ) {
    return (
      left.length === right.length &&
      left.every(
        (timing, index) =>
          timing.groupId === right[index]?.groupId && timing.eligibleAt === right[index]?.eligibleAt,
      )
    );
  }

  /**
   * The memory backend has no database trigger, so it must enforce the same
   * post-lock provenance boundary before it changes a direct award. A frozen
   * replacement may use the locked row only as proof that the original entry
   * still exists for the same rider; every qualification fact comes from the
   * snapshot.
   */
  private frozenImmediateGiveawayCandidates(giveaway: GiveawayAggregate) {
    const snapshot = giveaway.snapshot;
    if (!snapshot) throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    return snapshot.entries.map<ImmediateGiveawayCandidate>((snapshotEntry) => {
      const entry = this.giveaways.entriesById.get(snapshotEntry.entryId);
      if (
        !entry ||
        entry.status !== "locked" ||
        entry.riderId !== snapshotEntry.riderId ||
        entry.currentWeight !== snapshotEntry.frozenWeight ||
        entry.eligibilityCycleAt !== snapshotEntry.eligibilityCycleAt ||
        entry.qualifiedSourceFingerprint !== snapshotEntry.qualifiedSourceFingerprint ||
        !this.haveSameGiveawayGroupIds(entry.qualifiedGroupIds, snapshotEntry.qualifiedGroupIds) ||
        !this.haveSameGiveawayEligibilityTimings(
          entry.qualifiedEligibilityGroupTimings,
          snapshotEntry.qualifiedEligibilityGroupTimings,
        )
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      return {
        id: snapshotEntry.entryId,
        riderId: snapshotEntry.riderId,
        eligibilityCycleAt: snapshotEntry.eligibilityCycleAt,
        qualifiedGroupIds: [...snapshotEntry.qualifiedGroupIds],
        qualifiedEligibilityGroupTimings: snapshotEntry.qualifiedEligibilityGroupTimings.map((timing) => ({
          ...timing,
        })),
      };
    });
  }

  private isEntryEligibleForPool(entry: ImmediateGiveawayCandidate, pool: GiveawayPrizePoolRecord) {
    return (
      pool.eligibilityGroupIds.length === 0 ||
      pool.eligibilityGroupIds.some((groupId) => entry.qualifiedGroupIds.includes(groupId))
    );
  }

  private isSnapshotEntryEligibleForPool(
    entry: GiveawaySnapshotEntryRecord,
    pool: GiveawayPrizePoolRecord,
  ) {
    return (
      pool.eligibilityGroupIds.length === 0 ||
      pool.eligibilityGroupIds.some((groupId) => entry.qualifiedGroupIds.includes(groupId))
    );
  }

  /**
   * The first publication permanently reveals the draw seed and moves the
   * campaign into claims. Do not strand a manual prize when the frozen
   * snapshot still contains someone who can receive it. Pools with no
   * remaining eligible capacity are intentionally allowed to publish.
   */
  private hasAwardableManualSelectionCandidates(
    giveaway: GiveawayAggregate,
    snapshot: GiveawaySnapshotRecord,
  ) {
    return giveaway.prizePools.some((pool) => {
      if (
        pool.awardMode !== "manual_selection" ||
        !pool.items.some((item) => item.status === "available")
      ) {
        return false;
      }
      return snapshot.entries.some((snapshotEntry) => {
        const entry = this.giveaways.entriesById.get(snapshotEntry.entryId);
        return Boolean(
          entry &&
            entry.status === "locked" &&
            entry.riderId === snapshotEntry.riderId &&
            this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) &&
            this.canCreateGiveawayAward(giveaway, pool, snapshotEntry.riderId),
        );
      });
    });
  }

  /**
   * Resolves the immutable lineage that a post-publication manual replacement
   * is allowed to use. The caller decides whether the source must still be
   * current so idempotent replay can be resolved after a successful request
   * has made that source historical.
   */
  private requireManualGiveawayReplacementSource(
    giveaway: GiveawayAggregate,
    sourceAward: GiveawayAwardRecord,
    options: { requireReservedPrizeItem?: boolean } = {},
  ) {
    const requireReservedPrizeItem = options.requireReservedPrizeItem ?? true;
    const snapshot = giveaway.snapshot;
    const originalDraw = sourceAward.drawId
      ? this.giveaways.drawsById.get(sourceAward.drawId)
      : undefined;
    const pool = giveaway.prizePools.find((candidate) => candidate.id === sourceAward.prizePoolId);
    const prizeItem = sourceAward.prizeItemId
      ? pool?.items.find((candidate) => candidate.id === sourceAward.prizeItemId)
      : undefined;
    if (
      !snapshot ||
      !snapshot.seedRevealedAt ||
      !["declined", "voided", "disqualified", "expired"].includes(sourceAward.status) ||
      this.isDirectGiveawayAward(sourceAward) ||
      !sourceAward.drawId ||
      !sourceAward.snapshotEntryId ||
      !sourceAward.prizeItemId ||
      !originalDraw ||
      originalDraw.status !== "published" ||
      originalDraw.snapshotId !== snapshot.id ||
      originalDraw.algorithmVersion !== "manual-selection-v1" ||
      !pool ||
      pool.awardMode !== "manual_selection" ||
      !prizeItem ||
      (requireReservedPrizeItem && prizeItem.status !== "reserved")
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    return { snapshot, originalDraw, pool, prizeItem };
  }

  private manualGiveawayReplacementCandidates(
    giveaway: GiveawayAggregate,
    snapshot: GiveawaySnapshotRecord,
    pool: GiveawayPrizePoolRecord,
    predecessorAwardId: string,
  ): GiveawayManualSelectionCandidate[] {
    return snapshot.entries
      .filter((entry) => this.isSnapshotEntryEligibleForPool(entry, pool))
      .filter((entry) => {
        const frozenEntry = this.giveaways.entriesById.get(entry.entryId);
        return Boolean(
          frozenEntry &&
            frozenEntry.status === "locked" &&
            frozenEntry.riderId === entry.riderId &&
            this.canCreateGiveawayAward(giveaway, pool, entry.riderId, predecessorAwardId),
        );
      })
      .sort((left, right) => left.opaquePublicReference.localeCompare(right.opaquePublicReference))
      .map((entry) => ({
        snapshotEntryId: entry.id,
        label: `Locked entry ${entry.opaquePublicReference}`,
      }));
  }

  private canCreateGiveawayAward(
    giveaway: GiveawayAggregate,
    pool: GiveawayPrizePoolRecord,
    riderId: string,
    predecessorAwardIdForTotal?: string,
    reservedTotalAwardSlots: number = 0,
  ) {
    const currentAwards = giveaway.awards.filter((award) => award.isCurrent);
    const currentAwardsForTotal = predecessorAwardIdForTotal
      ? currentAwards.filter((award) => award.id !== predecessorAwardIdForTotal)
      : currentAwards;
    if (currentAwardsForTotal.length + reservedTotalAwardSlots >= giveaway.maxWinsTotal) return false;
    // A redraw frees one campaign-wide slot, but a predecessor still consumes
    // its rider/pool cap. That preserves a one-win limit while allowing later
    // weighted units only where the configured rider cap leaves room.
    if (currentAwards.filter((award) => award.winnerUserId === riderId).length >= giveaway.maxWinsPerRider) {
      return false;
    }
    const poolLimit = pool.perRiderLimit ?? 1;
    return (
      currentAwards.filter(
        (award) => award.winnerUserId === riderId && award.prizePoolId === pool.id,
      ).length < poolLimit
    );
  }

  /**
   * Reconciles every immediate pool in one deterministic pass. Opening first
   * materializes all automatic candidates and then calls this method, so a
   * lexical identifier or reconciliation loop cannot decide a first-come win.
   */
  private reallocateImmediateGiveawayAwards(giveaway: GiveawayAggregate) {
    this.resolvePendingDirectGiveawayRecoverySources(giveaway);
    const elapsedRecoveryReservation = this.getElapsedDirectGiveawayRecoveryReservation(giveaway);
    const candidates = Array.from(giveaway.entriesByRider.values()).filter(
      (entry) => entry.status === "eligible",
    );
    for (const pool of [...giveaway.prizePools].sort((left, right) => left.position - right.position)) {
      if (pool.awardMode !== "guaranteed" && pool.awardMode !== "first_come") continue;
      const orderedCandidates = candidates
        .filter((entry) => this.isEntryEligibleForPool(entry, pool))
        .sort((left, right) =>
          compareGiveawayEntriesByPoolPriority(left, right, pool.eligibilityGroupIds),
        );
      for (const entry of orderedCandidates) {
        this.allocateImmediateGiveawayAwardForPool(giveaway, entry, pool, undefined, elapsedRecoveryReservation);
      }
    }
  }

  /**
   * A generic open-campaign allocation must not silently consume capacity that
   * belongs to an unresolved terminal direct award. Resolve each historical
   * source first so any successor carries its one-to-one recovery link.
   */
  private resolvePendingDirectGiveawayRecoverySources(giveaway: GiveawayAggregate) {
    if (giveaway.state !== "open") return;
    const poolPositionById = new Map(giveaway.prizePools.map((pool) => [pool.id, pool.position]));
    const sources = giveaway.awards
      .filter(
        (award) =>
          this.isDirectGiveawayAward(award) &&
          !award.isCurrent &&
          !award.recoveryClosedAt &&
          !this.isGiveawayClaimDeadlineElapsed(award) &&
          ["declined", "voided", "disqualified", "expired"].includes(award.status),
      )
      .sort(
        (left, right) =>
          (poolPositionById.get(left.prizePoolId) ?? Number.MAX_SAFE_INTEGER) -
            (poolPositionById.get(right.prizePoolId) ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    for (const source of sources) {
      this.reallocateFinalizedDirectGiveawayAward(giveaway, source);
    }
  }

  /**
   * An elapsed source may only be recovered explicitly with a fresh deadline
   * or settled. Until then it still owns one campaign-wide award slot and, for
   * finite pools, its exact released prize item.
   */
  private getElapsedDirectGiveawayRecoveryReservation(
    giveaway: GiveawayAggregate,
    excludedSourceAwardId?: string,
  ): ElapsedDirectGiveawayRecoveryReservation {
    const protectedPrizeItemIdsByPool = new Map<string, Set<string>>();
    let reservedTotalAwardSlots = 0;
    for (const award of giveaway.awards) {
      if (
        award.id === excludedSourceAwardId ||
        !this.isDirectGiveawayAward(award) ||
        award.isCurrent ||
        award.recoveryClosedAt ||
        !this.isGiveawayClaimDeadlineElapsed(award) ||
        !["declined", "voided", "disqualified", "expired"].includes(award.status)
      ) {
        continue;
      }
      reservedTotalAwardSlots += 1;
      if (award.prizeItemId) {
        const protectedPrizeItemIds = protectedPrizeItemIdsByPool.get(award.prizePoolId) ?? new Set<string>();
        protectedPrizeItemIds.add(award.prizeItemId);
        protectedPrizeItemIdsByPool.set(award.prizePoolId, protectedPrizeItemIds);
      }
    }
    return { reservedTotalAwardSlots, protectedPrizeItemIdsByPool };
  }

  /**
   * Once a campaign is locked, direct pool replacement must use the frozen
   * entry ordering and group facts rather than current RSVP/check-in data.
   */
  private reallocateFrozenImmediateGiveawayAwards(
    giveaway: GiveawayAggregate,
    options: { prizePoolId?: string; claimDeadlineAt?: string } = {},
  ) {
    const elapsedRecoveryReservation = this.getElapsedDirectGiveawayRecoveryReservation(giveaway);
    const candidates = this.frozenImmediateGiveawayCandidates(giveaway);
    for (const pool of [...giveaway.prizePools].sort((left, right) => left.position - right.position)) {
      if (options.prizePoolId && pool.id !== options.prizePoolId) continue;
      if (pool.awardMode !== "guaranteed" && pool.awardMode !== "first_come") continue;
      const orderedCandidates = candidates
        .filter((entry) => this.isEntryEligibleForPool(entry, pool))
        .sort((left, right) =>
          compareGiveawayEntriesByPoolPriority(left, right, pool.eligibilityGroupIds),
        );
      for (const entry of orderedCandidates) {
        this.allocateImmediateGiveawayAwardForPool(
          giveaway,
          entry,
          pool,
          options.claimDeadlineAt,
          elapsedRecoveryReservation,
        );
      }
    }
  }

  /**
   * A recovery action is scoped to one historical direct award. It may fill
   * only that released finite item (or one unlimited guaranteed slot), never
   * sweep every free item in the pool merely because the campaign has capacity.
   */
  private recoverFrozenImmediateGiveawayAwardSlot(
    giveaway: GiveawayAggregate,
    sourceAward: GiveawayAwardRecord,
    pool: GiveawayPrizePoolRecord,
    claimDeadlineAt?: string,
    recoverySourceAwardId: string = sourceAward.id,
  ): GiveawayAwardRecord | null {
    const targetPrizeItem = pool.awardMode === "first_come"
      ? pool.items.find((item) => item.id === sourceAward.prizeItemId)
      : undefined;
    if (pool.awardMode === "first_come" && (!targetPrizeItem || targetPrizeItem.status !== "available")) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const elapsedRecoveryReservation = this.getElapsedDirectGiveawayRecoveryReservation(
      giveaway,
      sourceAward.id,
    );
    const candidates = this.frozenImmediateGiveawayCandidates(giveaway)
      .filter((entry) => this.isEntryEligibleForPool(entry, pool))
      .sort((left, right) =>
        compareGiveawayEntriesByPoolPriority(left, right, pool.eligibilityGroupIds),
      );

    for (const entry of candidates) {
      const allocationEligibilityAt = resolveGiveawayPoolEligibilityPriority({
        eligibilityCycleAt: entry.eligibilityCycleAt,
        qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
        permittedGroupIds: pool.eligibilityGroupIds,
      });
      if (!allocationEligibilityAt) continue;
      const directAllocationKey = `direct:${entry.id}:${pool.id}:${allocationEligibilityAt}`;
      const hasHistoricAllocation = giveaway.awards.some(
        (award) => award.directAllocationKey === directAllocationKey,
      );
      const hasCurrentPoolAward = giveaway.awards.some(
        (award) =>
          award.entryId === entry.id &&
          award.prizePoolId === pool.id &&
          !award.drawId &&
          award.isCurrent,
      );
      if (
        hasHistoricAllocation ||
        hasCurrentPoolAward ||
        !this.canCreateGiveawayAward(
          giveaway,
          pool,
          entry.riderId,
          undefined,
          elapsedRecoveryReservation.reservedTotalAwardSlots,
        )
      ) {
        continue;
      }
      return this.createGiveawayAward(giveaway, {
        entry,
        prizePool: pool,
        ...(targetPrizeItem ? { prizeItem: targetPrizeItem } : {}),
        directAllocationKey,
        allocationEligibilityAt,
        claimDeadlineAt,
        recoverySourceAwardId,
      });
    }
    return null;
  }

  private reallocateFinalizedDirectGiveawayAward(
    giveaway: GiveawayAggregate,
    sourceAward: GiveawayAwardRecord,
  ) {
    if (sourceAward.recoveryClosedAt || this.isGiveawayClaimDeadlineElapsed(sourceAward)) return;
    const pool = this.requireGiveawayPrizePool(giveaway, sourceAward.prizePoolId);
    if (pool.awardMode !== "first_come" && pool.awardMode !== "guaranteed") return;
    let replacement: GiveawayAwardRecord | null = null;
    if (giveaway.state === "open") {
      replacement = this.reallocateImmediateDirectGiveawayAwardSlot(giveaway, sourceAward, pool);
    } else if (
      ["locked", "drawing", "claims_open"].includes(giveaway.state) &&
      this.hasUsableGiveawayReplacementDeadline(giveaway)
    ) {
      replacement = this.recoverFrozenImmediateGiveawayAwardSlot(
        giveaway,
        sourceAward,
        pool,
        giveaway.claimDeadlineAt,
      );
    }
    if (replacement) {
      this.linkGiveawayDirectRecoverySource(
        giveaway,
        sourceAward,
        replacement,
        this.hashGiveawayReason("automatic_direct_reallocation"),
        "automatic",
      );
    }
  }

  /** Replaces only the released direct slot while an event is still open. */
  private reallocateImmediateDirectGiveawayAwardSlot(
    giveaway: GiveawayAggregate,
    sourceAward: GiveawayAwardRecord,
    pool: GiveawayPrizePoolRecord,
  ): GiveawayAwardRecord | null {
    const targetPrizeItem = pool.awardMode === "first_come"
      ? pool.items.find((item) => item.id === sourceAward.prizeItemId)
      : undefined;
    if (pool.awardMode === "first_come" && (!targetPrizeItem || targetPrizeItem.status !== "available")) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const elapsedRecoveryReservation = this.getElapsedDirectGiveawayRecoveryReservation(
      giveaway,
      sourceAward.id,
    );
    const candidates = Array.from(giveaway.entriesByRider.values())
      .filter((entry) => entry.status === "eligible" && this.isEntryEligibleForPool(entry, pool))
      .sort((left, right) =>
        compareGiveawayEntriesByPoolPriority(left, right, pool.eligibilityGroupIds),
      );
    for (const entry of candidates) {
      const allocationEligibilityAt = resolveGiveawayPoolEligibilityPriority({
        eligibilityCycleAt: entry.eligibilityCycleAt,
        qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
        permittedGroupIds: pool.eligibilityGroupIds,
      });
      if (!allocationEligibilityAt) continue;
      const directAllocationKey = `direct:${entry.id}:${pool.id}:${allocationEligibilityAt}`;
      if (
        giveaway.awards.some((award) => award.directAllocationKey === directAllocationKey) ||
        giveaway.awards.some(
          (award) =>
            award.entryId === entry.id &&
            award.prizePoolId === pool.id &&
            !award.drawId &&
            award.isCurrent,
        ) ||
        !this.canCreateGiveawayAward(
          giveaway,
          pool,
          entry.riderId,
          undefined,
          elapsedRecoveryReservation.reservedTotalAwardSlots,
        )
      ) {
        continue;
      }
      return this.createGiveawayAward(giveaway, {
        entry,
        prizePool: pool,
        ...(targetPrizeItem ? { prizeItem: targetPrizeItem } : {}),
        directAllocationKey,
        allocationEligibilityAt,
        recoverySourceAwardId: sourceAward.id,
      });
    }
    return null;
  }

  private allocateImmediateGiveawayAwardForPool(
    giveaway: GiveawayAggregate,
    entry: ImmediateGiveawayCandidate,
    pool: GiveawayPrizePoolRecord,
    claimDeadlineAt?: string,
    elapsedRecoveryReservation: ElapsedDirectGiveawayRecoveryReservation = {
      reservedTotalAwardSlots: 0,
      protectedPrizeItemIdsByPool: new Map(),
    },
  ) {
    if (!this.isEntryEligibleForPool(entry, pool)) return false;
    if (
      giveaway.awards.some(
        (award) =>
          award.entryId === entry.id &&
          award.prizePoolId === pool.id &&
          !award.drawId &&
          award.isCurrent,
      )
    ) {
      return true;
    }
    const allocationEligibilityAt = resolveGiveawayPoolEligibilityPriority({
      eligibilityCycleAt: entry.eligibilityCycleAt,
      qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
      permittedGroupIds: pool.eligibilityGroupIds,
    });
    if (!allocationEligibilityAt) return false;
    const directAllocationKey = `direct:${entry.id}:${pool.id}:${allocationEligibilityAt}`;
    const historicAward = giveaway.awards.find(
      (award) => award.directAllocationKey === directAllocationKey,
    );
    if (historicAward) return historicAward.isCurrent;
    if (
      !this.canCreateGiveawayAward(
        giveaway,
        pool,
        entry.riderId,
        undefined,
        elapsedRecoveryReservation.reservedTotalAwardSlots,
      )
    ) {
      return false;
    }
    if (pool.awardMode === "guaranteed") {
      this.createGiveawayAward(giveaway, {
        entry,
        prizePool: pool,
        directAllocationKey,
        allocationEligibilityAt,
        claimDeadlineAt,
      });
      return true;
    }
    const prizeItem = pool.items
      .filter(
        (item) =>
          item.status === "available" &&
          !elapsedRecoveryReservation.protectedPrizeItemIdsByPool.get(pool.id)?.has(item.id),
      )
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0];
    if (!prizeItem) return false;
    this.createGiveawayAward(giveaway, {
      entry,
      prizePool: pool,
      prizeItem,
      directAllocationKey,
      allocationEligibilityAt,
      claimDeadlineAt,
    });
    return true;
  }

  private voidDirectEntryAwards(
    giveaway: GiveawayAggregate,
    entry: GiveawayEntryRecord,
    actorUserId: string | undefined,
    reason: string,
    shouldVoid: (award: GiveawayAwardRecord) => boolean = () => true,
  ) {
    const affectedPoolIds = new Set<string>();
    for (const award of giveaway.awards.filter(
      (candidate) =>
        candidate.entryId === entry.id &&
        !candidate.drawId &&
        candidate.isCurrent &&
        ["pending_verification", "claimable", "verified"].includes(candidate.status),
    )) {
      if (!shouldVoid(award)) continue;
      affectedPoolIds.add(award.prizePoolId);
      award.isCurrent = false;
      award.status = "voided";
      const reasonDigest = this.hashGiveawayReason(reason);
      award.reasonDigest = reasonDigest;
      award.updatedAt = new Date().toISOString();
      if (award.prizeItemId) {
        const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
        const item = pool?.items.find((candidate) => candidate.id === award.prizeItemId);
        if (item?.status === "reserved") item.status = "available";
      }
      this.closeGiveawayDirectRecoverySource(award, reasonDigest);
      this.auditGiveaway(giveaway, actorUserId, "GIVEAWAY_AWARD_VOIDED", "award", award.id, {
        awardId: award.id,
        entryId: entry.id,
        prizePoolId: award.prizePoolId,
        reasonDigest,
        recoveryClosed: true,
      });
    }
    return affectedPoolIds;
  }

  private isDirectGiveawayAward(award: GiveawayAwardRecord) {
    return !award.drawId && !award.snapshotEntryId;
  }

  /** A recovery source can close once, either by a linked replacement or a human settlement. */
  private closeGiveawayDirectRecoverySource(award: GiveawayAwardRecord, reasonDigest: string) {
    if (!this.isDirectGiveawayAward(award) || award.recoveryClosedAt) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const now = new Date().toISOString();
    award.recoveryClosedAt = now;
    award.recoveryClosedReasonDigest = reasonDigest;
    award.updatedAt = now;
  }

  /**
   * A direct source may produce at most one successor. Keep the immutable
   * child-to-source link and source closure together so retries cannot later
   * consume an unlimited guaranteed slot a second time.
   */
  private linkGiveawayDirectRecoverySource(
    giveaway: GiveawayAggregate,
    sourceAward: GiveawayAwardRecord,
    replacement: GiveawayAwardRecord,
    reasonDigest: string,
    initiatedVia: "automatic" | "explicit",
  ) {
    if (
      !this.isDirectGiveawayAward(sourceAward) ||
      !this.isDirectGiveawayAward(replacement) ||
      sourceAward.recoveryClosedAt ||
      replacement.recoverySourceAwardId !== sourceAward.id ||
      sourceAward.prizePoolId !== replacement.prizePoolId ||
      giveaway.awards.some(
        (award) => award.id !== replacement.id && award.recoverySourceAwardId === sourceAward.id,
      )
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    this.closeGiveawayDirectRecoverySource(sourceAward, reasonDigest);
    if (initiatedVia === "automatic") {
      this.auditGiveaway(giveaway, undefined, "GIVEAWAY_DIRECT_RECOVERY_LINKED", "award", sourceAward.id, {
        awardId: sourceAward.id,
        replacementAwardId: replacement.id,
        reasonDigest,
        initiatedVia,
      });
    }
  }

  /**
   * A finalized direct award is historical (`isCurrent: false`), so a simple
   * unresolved-current query would otherwise complete the campaign and remove
   * the organizer's future authorized recovery path. Whether it is eligible
   * to re-offer now is a separate deadline gate in the recovery action.
   */
  private hasUnresolvedTerminalDirectGiveawayAward(giveaway: GiveawayAggregate) {
    return giveaway.awards.some((award) => {
      if (
        !this.isDirectGiveawayAward(award) ||
        award.isCurrent ||
        award.recoveryClosedAt ||
        !["declined", "voided", "disqualified", "expired"].includes(award.status)
      ) {
        return false;
      }
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      return pool?.awardMode === "first_come" || pool?.awardMode === "guaranteed";
    });
  }

  /**
   * Direct awards are terminal at decline/void/disqualification/expiry. Their immutable
   * allocation proof remains on the historical row, so the same entry cannot
   * receive the same immediate allocation again during reconciliation.
   */
  private finalizeDirectGiveawayAward(
    giveaway: GiveawayAggregate,
    award: GiveawayAwardRecord,
    status: Extract<
      GiveawayAwardRecord["status"],
      "declined" | "voided" | "disqualified" | "expired"
    >,
    reasonDigest: string,
  ) {
    if (!this.isDirectGiveawayAward(award)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    // Validate before mutating so a tampered in-memory locked entry cannot
    // leave a partially finalized award when frozen reallocation is refused.
    if (["locked", "drawing", "claims_open"].includes(giveaway.state)) {
      this.frozenImmediateGiveawayCandidates(giveaway);
    }
    award.isCurrent = false;
    award.status = status;
    award.reasonDigest = reasonDigest;
    award.updatedAt = new Date().toISOString();
    if (award.prizeItemId) {
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      const item = pool?.items.find((candidate) => candidate.id === award.prizeItemId);
      if (item?.status === "reserved") item.status = "available";
    }
  }

  private voidIneligibleDirectEntryAwards(
    giveaway: GiveawayAggregate,
    entry: GiveawayEntryRecord,
    actorUserId: string | undefined,
    reason: string,
  ) {
    return this.voidDirectEntryAwards(giveaway, entry, actorUserId, reason, (award) => {
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      return !pool || !this.isEntryEligibleForPool(entry, pool);
    });
  }

  private createGiveawayAward(
    giveaway: GiveawayAggregate,
    input: {
      entry: Pick<GiveawayEntryRecord, "id" | "riderId">;
      prizePool: GiveawayPrizePoolRecord;
      prizeItem?: GiveawayPrizeItemRecord;
      draw?: GiveawayDrawRecord;
      snapshotEntry?: GiveawaySnapshotEntryRecord;
      rank?: number;
      directAllocationKey?: string;
      allocationEligibilityAt?: string;
      recoverySourceAwardId?: string;
      predecessorAwardId?: string;
      claimDeadlineAt?: string;
    },
  ) {
    if (input.prizePool.awardMode === "guaranteed" && input.prizeItem) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    if (input.prizePool.awardMode !== "guaranteed" && !input.prizeItem) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    if (Boolean(input.draw) !== Boolean(input.snapshotEntry) || Boolean(input.draw) !== Boolean(input.rank)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    if (input.draw) {
      if (input.directAllocationKey || input.allocationEligibilityAt) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
    } else if (!input.directAllocationKey || !input.allocationEligibilityAt) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    if (
      input.directAllocationKey &&
      giveaway.awards.some((award) => award.directAllocationKey === input.directAllocationKey)
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    if (input.recoverySourceAwardId) {
      const source = this.giveaways.awardsById.get(input.recoverySourceAwardId);
      if (
        !source ||
        !this.isDirectGiveawayAward(source) ||
        !giveaway.awards.includes(source) ||
        source.prizePoolId !== input.prizePool.id ||
        source.isCurrent ||
        source.recoveryClosedAt ||
        giveaway.awards.some((award) => award.recoverySourceAwardId === input.recoverySourceAwardId)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
    }
    if (input.predecessorAwardId) {
      const predecessor = this.giveaways.awardsById.get(input.predecessorAwardId);
      if (
        !predecessor ||
        !giveaway.awards.includes(predecessor) ||
        predecessor.isCurrent ||
        predecessor.prizePoolId !== input.prizePool.id ||
        predecessor.prizeItemId !== input.prizeItem?.id ||
        giveaway.awards.some((award) => award.predecessorAwardId === predecessor.id)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
    }
    if (input.prizeItem) {
      const conflictingCurrentAward = giveaway.awards.find(
        (award) => award.isCurrent && award.prizeItemId === input.prizeItem?.id,
      );
      if (conflictingCurrentAward) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      input.prizeItem.status = "reserved";
    }
    const now = new Date().toISOString();
    const award: GiveawayAwardRecord = {
      id: `giveaway-award-${this.generateGiveawayUuid()}`,
      entryId: input.entry.id,
      drawId: input.draw?.id,
      prizePoolId: input.prizePool.id,
      prizeItemId: input.prizeItem?.id,
      snapshotEntryId: input.snapshotEntry?.id,
      winnerUserId: input.entry.riderId,
      status:
        giveaway.presenceVerificationRequired || input.prizePool.presenceVerificationRequired
          ? "pending_verification"
          : "claimable",
      isCurrent: true,
      rank: input.rank,
      directAllocationKey: input.directAllocationKey,
      allocationEligibilityAt: input.allocationEligibilityAt,
      opaqueClaimReference: `claim_${randomBytes(16).toString("base64url")}`,
      claimTokenVersion: 0,
      // The award persists the campaign deadline at allocation time. This is
      // the single authoritative deadline for claim gates; later schedule edits
      // cannot silently extend or shorten an already-issued award.
      claimDeadlineAt: input.claimDeadlineAt ?? giveaway.claimDeadlineAt,
      recoverySourceAwardId: input.recoverySourceAwardId,
      predecessorAwardId: input.predecessorAwardId,
      createdAt: now,
      updatedAt: now,
    };
    giveaway.awards.push(award);
    this.giveaways.awardsById.set(award.id, award);
    if (!input.draw) {
      this.notifyGiveaway(giveaway, award.winnerUserId, "giveaway_winner", { awardId: award.id });
    }
    return award;
  }

  private hydrateGiveawayAggregate(giveaway: GiveawayAggregate) {
    this.giveaways.campaignsById.set(giveaway.id, giveaway);
    const eventGiveawayIds = this.giveaways.giveawayIdsByEventId.get(giveaway.eventId) ?? new Set<string>();
    eventGiveawayIds.add(giveaway.id);
    this.giveaways.giveawayIdsByEventId.set(giveaway.eventId, eventGiveawayIds);
    for (const mechanicsVersion of giveaway.mechanicsVersions) {
      this.giveaways.mechanicsVersionsById.set(mechanicsVersion.id, mechanicsVersion);
    }
    for (const group of giveaway.eligibilityGroups) {
      this.giveaways.eligibilityGroupsById.set(group.id, group);
    }
    for (const entry of giveaway.entriesByRider.values()) {
      this.giveaways.entriesById.set(entry.id, entry);
    }
    for (const entryEvent of giveaway.entryEvents) {
      this.giveaways.entryEventsById.set(entryEvent.id, entryEvent);
    }
    for (const pool of giveaway.prizePools) {
      this.giveaways.prizePoolsById.set(pool.id, pool);
      for (const item of pool.items) this.giveaways.prizeItemsById.set(item.id, item);
    }
    for (const code of giveaway.campaignCodes) this.giveaways.campaignCodesById.set(code.id, code);
    if (giveaway.snapshot) this.giveaways.snapshotsById.set(giveaway.snapshot.id, giveaway.snapshot);
    for (const draw of giveaway.draws) this.giveaways.drawsById.set(draw.id, draw);
    for (const award of giveaway.awards) this.giveaways.awardsById.set(award.id, award);
    for (const verification of giveaway.claimVerifications) {
      this.giveaways.claimVerificationsById.set(verification.id, verification);
    }
    for (const fulfillment of giveaway.fulfillments) {
      this.giveaways.fulfillmentsById.set(fulfillment.id, fulfillment);
    }
    for (const deliveryDetail of giveaway.deliveryDetails) {
      this.giveaways.deliveryDetailsByAwardId.set(deliveryDetail.awardId, deliveryDetail);
    }
    for (const operator of giveaway.operators) this.giveaways.operatorsById.set(operator.id, operator);
    for (const auditEvent of giveaway.auditEvents) {
      this.giveaways.auditEventsById.set(auditEvent.id, auditEvent);
    }
  }

  private buildGiveawayAggregate(
    creatorUserId: string,
    eventId: string,
    input: CreateGiveawayInput,
  ): GiveawayAggregate {
    const now = new Date().toISOString();
    const giveaway: GiveawayAggregate = {
      id: `giveaway-${this.generateGiveawayUuid()}`,
      eventId,
      creatorUserId,
      organizerAttestedById: creatorUserId,
      title: input.title,
      kind: input.kind,
      state: "draft",
      complianceStatus: "draft",
      entryMode: input.entryMode,
      maxEntriesPerRider: input.maxEntriesPerRider,
      publicVisibility: input.publicVisibility ?? "hidden",
      timeZone: input.timeZone,
      entryOpensAt: input.entryOpensAt,
      entryClosesAt: input.entryClosesAt,
      drawAt: input.drawAt ?? undefined,
      claimDeadlineAt: input.claimDeadlineAt ?? undefined,
      maxWinsPerRider: input.winnerLimits.perRider,
      maxWinsTotal: input.winnerLimits.total,
      organizerAttestedAt: now,
      presenceVerificationRequired: input.presenceVerificationRequired ?? false,
      createdAt: now,
      updatedAt: now,
      mechanicsVersions: [],
      eligibilityGroups: [],
      campaignCodes: [],
      entriesByRider: new Map(),
      entryEvents: [],
      prizePools: [],
      draws: [],
      awards: [],
      claimVerifications: [],
      fulfillments: [],
      deliveryDetails: [],
      operators: [],
      auditEvents: [],
    };

    this.replaceGiveawayConfiguration(giveaway, input.eligibilityGroups, input.prizePools);
    this.createGiveawayMechanicsVersion(giveaway, creatorUserId, {
      mechanics: input.mechanics,
      terms: input.terms,
      sponsorDisclosure: input.sponsorDisclosure,
    });
    return giveaway;
  }

  /** Replaces only pre-lock eligibility/prize configuration after mapping request-local IDs. */
  private replaceGiveawayConfiguration(
    giveaway: GiveawayAggregate,
    groups: CreateGiveawayInput["eligibilityGroups"],
    prizePools: CreateGiveawayInput["prizePools"],
  ) {
    for (const group of giveaway.eligibilityGroups) {
      this.giveaways.eligibilityGroupsById.delete(group.id);
    }
    for (const pool of giveaway.prizePools) {
      this.giveaways.prizePoolsById.delete(pool.id);
      for (const item of pool.items) this.giveaways.prizeItemsById.delete(item.id);
    }

    const groupIdByRequestId = new Map<string, string>();
    const persistedGroups = groups.map<GiveawayEligibilityGroupRecord>((group, position) => {
      const id = `giveaway-eligibility-group-${this.generateGiveawayUuid()}`;
      groupIdByRequestId.set(group.id, id);
      const persisted: GiveawayEligibilityGroupRecord = {
        id,
        position,
        label: group.label,
        entryWeight: group.weight,
        enabled: true,
        conditions: group.conditions.map((condition) => ({
          id: `giveaway-eligibility-condition-${this.generateGiveawayUuid()}`,
          condition: { ...condition },
        })),
      };
      this.giveaways.eligibilityGroupsById.set(id, persisted);
      return persisted;
    });

    const persistedPools = prizePools.map<GiveawayPrizePoolRecord>((pool, position) => {
      const id = `giveaway-prize-pool-${this.generateGiveawayUuid()}`;
      const items = pool.items.map<GiveawayPrizeItemRecord>((item, itemPosition) => {
        const persisted: GiveawayPrizeItemRecord = {
          id: `giveaway-prize-item-${this.generateGiveawayUuid()}`,
          position: itemPosition,
          title: item.title,
          description: item.description,
          status: "available",
        };
        this.giveaways.prizeItemsById.set(persisted.id, persisted);
        return persisted;
      });
      const persisted: GiveawayPrizePoolRecord = {
        id,
        position,
        title: pool.title,
        awardMode: pool.awardMode,
        fulfilmentMode: pool.fulfilmentMode,
        inventoryKind: pool.inventory.kind,
        inventoryLimit: pool.inventory.kind === "finite" ? pool.inventory.quantity : undefined,
        perRiderLimit: pool.perRiderLimit,
        presenceVerificationRequired:
          pool.presenceVerificationRequired ?? giveaway.presenceVerificationRequired,
        eligibilityGroupIds: (pool.eligibilityGroupIds ?? []).map((requestId) => {
          const persistedId = groupIdByRequestId.get(requestId);
          if (!persistedId) throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
          return persistedId;
        }),
        items,
      };
      this.giveaways.prizePoolsById.set(id, persisted);
      return persisted;
    });

    giveaway.eligibilityGroups = persistedGroups;
    giveaway.prizePools = persistedPools;
  }

  private createGiveawayMechanicsVersion(
    giveaway: GiveawayAggregate,
    creatorUserId: string,
    input?: {
      mechanics: string;
      terms: string;
      sponsorDisclosure?: string;
    },
  ) {
    const current = giveaway.mechanicsVersions.at(-1);
    const mechanics = input?.mechanics ?? current?.mechanics;
    const terms = input?.terms ?? current?.terms;
    if (!mechanics || !terms) throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    const sponsorDisclosure = input?.sponsorDisclosure ?? current?.sponsorDisclosure;
    const record: GiveawayMechanicsVersionRecord = {
      id: `giveaway-mechanics-${this.generateGiveawayUuid()}`,
      version: (current?.version ?? 0) + 1,
      mechanics,
      terms,
      sponsorDisclosure,
      checksum: createHash("sha256")
        .update(canonicalizeJson({ mechanics, terms, sponsorDisclosure: sponsorDisclosure ?? null }))
        .digest("hex"),
      createdByUserId: creatorUserId,
      createdAt: new Date().toISOString(),
    };
    giveaway.mechanicsVersions.push(record);
    this.giveaways.mechanicsVersionsById.set(record.id, record);
    return record;
  }

  private currentGiveawayMechanics(giveaway: GiveawayAggregate) {
    const mechanics = giveaway.mechanicsVersions.at(-1);
    if (!mechanics) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return mechanics;
  }

  private toGiveawayCampaignView(giveaway: GiveawayAggregate): GiveawayCampaignView {
    return {
      id: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      state: giveaway.state,
      complianceStatus: giveaway.complianceStatus,
      mechanicsVersion: this.currentGiveawayMechanics(giveaway).version,
    };
  }

  private toPublicGiveaway(giveaway: GiveawayAggregate): PublicGiveawayCampaignSummary {
    const mechanics = this.currentGiveawayMechanics(giveaway);
    const prizePools = giveaway.prizePools.map<PublicGiveawayPrizePoolSummary>((pool) => ({
      id: pool.id,
      title: pool.title,
      awardMode: pool.awardMode,
      fulfilmentMode: pool.fulfilmentMode,
      inventoryKind: pool.inventoryKind,
      itemQuantity: pool.inventoryKind === "finite" ? pool.items.length : undefined,
      items: pool.items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
      })),
      presenceVerificationRequired:
        giveaway.presenceVerificationRequired || pool.presenceVerificationRequired,
    }));
    return {
      id: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      kind: giveaway.kind,
      state: giveaway.state,
      complianceStatus: giveaway.complianceStatus,
      entryMode: giveaway.entryMode,
      mechanics: mechanics.mechanics,
      terms: mechanics.terms,
      timeZone: giveaway.timeZone,
      publicVisibility: giveaway.publicVisibility,
      sponsorDisclosure: mechanics.sponsorDisclosure,
      entryOpensAt: giveaway.entryOpensAt,
      entryClosesAt: giveaway.entryClosesAt,
      drawAt: giveaway.drawAt,
      claimDeadlineAt: giveaway.claimDeadlineAt,
      prizePools,
    };
  }

  private canViewPublicEventGiveaway(giveaway: GiveawayAggregate, viewerId?: string) {
    if (!this.isPublicEventGiveaway(giveaway)) return false;
    if (giveaway.publicVisibility === "hidden") return false;
    if (giveaway.publicVisibility === "event_page") return true;
    if (!viewerId) return false;
    if (giveaway.publicVisibility === "registered_riders") {
      return this.rsvps.get(`${giveaway.eventId}:${viewerId}`)?.status === "going";
    }
    const entry = giveaway.entriesByRider.get(viewerId);
    return Boolean(entry && entry.status !== "withdrawn");
  }

  private isPublicEventGiveaway(giveaway: GiveawayAggregate) {
    return (
      giveaway.complianceStatus === "approved" &&
      !["draft", "cancelled", "suspended"].includes(giveaway.state)
    );
  }

  /** Published draw receipts contain the fairness commitment, never entrants or encrypted seed material. */
  private toPublicGiveawayDrawVerifications(
    giveaway: GiveawayAggregate,
  ): PublicGiveawayDrawVerification[] {
    const snapshot = giveaway.snapshot;
    if (!snapshot?.seedRevealedAt || !process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY) return [];
    const publishedDraws = giveaway.draws
      .filter((draw) => draw.status === "published")
      .slice()
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
    if (publishedDraws.length === 0) return [];
    const seed = this.decryptGiveawayDrawSeed(snapshot);
    return publishedDraws.map((draw) => this.buildGiveawayDrawVerification(giveaway, draw, seed, true));
  }

  private isGiveawayWinnerAliasPublic(
    award: Pick<
      GiveawayAwardRecord,
      "publicWinnerAlias" | "winnerAliasOptedInAt" | "winnerAliasRevokedAt"
    >,
  ) {
    if (!award.publicWinnerAlias || !award.winnerAliasOptedInAt) return false;
    return !award.winnerAliasRevokedAt;
  }

  private toPublicGiveawayResults(giveaway: GiveawayAggregate): PublicGiveawayResult[] {
    if (
      !giveaway.snapshot?.seedRevealedAt ||
      !["claims_open", "completed"].includes(giveaway.state)
    ) {
      return [];
    }
    return giveaway.awards
      .filter(
        (award) =>
          award.isCurrent &&
          ["pending_verification", "claimable", "verified", "fulfilled"].includes(award.status),
      )
      .filter((award) => Boolean(award.drawId && award.snapshotEntryId && this.isGiveawayWinnerAliasPublic(award)))
      .map((award) => ({
        award,
        pool: giveaway.prizePools.find((pool) => pool.id === award.prizePoolId),
      }))
      .filter(
        (
          value,
        ): value is {
          award: GiveawayAwardRecord;
          pool: GiveawayPrizePoolRecord;
        } => Boolean(value.pool),
      )
      .sort(
        (left, right) =>
          left.pool.position - right.pool.position ||
          (left.award.publicWinnerAlias ?? "").localeCompare(right.award.publicWinnerAlias ?? "") ||
          left.award.id.localeCompare(right.award.id),
      )
      .map(({ pool, award }) => ({
        prizePoolTitle: pool.title,
        winnerAlias: award.publicWinnerAlias!,
      }));
  }

  private toOrganizerGiveawayWorkspace(giveaway: GiveawayAggregate): OrganizerGiveawayWorkspace {
    const mechanics = this.currentGiveawayMechanics(giveaway);
    return {
      id: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      kind: giveaway.kind,
      state: giveaway.state,
      complianceStatus: giveaway.complianceStatus,
      entryMode: giveaway.entryMode,
      maxEntriesPerRider: giveaway.maxEntriesPerRider,
      mechanics: mechanics.mechanics,
      terms: mechanics.terms,
      sponsorDisclosure: mechanics.sponsorDisclosure,
      timeZone: giveaway.timeZone,
      winnerLimits: { perRider: giveaway.maxWinsPerRider, total: giveaway.maxWinsTotal },
      publicVisibility: giveaway.publicVisibility,
      presenceVerificationRequired: giveaway.presenceVerificationRequired,
      entryOpensAt: giveaway.entryOpensAt,
      entryClosesAt: giveaway.entryClosesAt,
      drawAt: giveaway.drawAt,
      claimDeadlineAt: giveaway.claimDeadlineAt,
      eligibilityGroups: giveaway.eligibilityGroups
        .slice()
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map((group) => ({
          id: group.id,
          label: group.label,
          weight: group.entryWeight,
          conditions: group.conditions.map(({ condition }) => ({ ...condition })),
        })),
      prizePools: giveaway.prizePools
        .slice()
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map((pool) => this.toOrganizerGiveawayPrizePool(pool)),
    };
  }

  private toOrganizerGiveawayPrizePool(pool: GiveawayPrizePoolRecord): GiveawayPrizePoolInput {
    const base = {
      id: pool.id,
      title: pool.title,
      fulfilmentMode: pool.fulfilmentMode,
      eligibilityGroupIds: pool.eligibilityGroupIds.length ? [...pool.eligibilityGroupIds] : undefined,
      perRiderLimit: pool.perRiderLimit ?? 1,
      presenceVerificationRequired: pool.presenceVerificationRequired,
    };
    if (pool.inventoryKind === "unlimited") {
      return { ...base, awardMode: "guaranteed", inventory: { kind: "unlimited" }, items: [] };
    }
    return {
      ...base,
      awardMode: pool.awardMode as Exclude<GiveawayPrizePoolInput["awardMode"], "guaranteed">,
      inventory: { kind: "finite", quantity: pool.inventoryLimit ?? pool.items.length },
      items: pool.items
        .slice()
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map((item) => ({ id: item.id, title: item.title, description: item.description })),
    } as GiveawayPrizePoolInput;
  }

  private requireGiveaway(giveawayId: string) {
    const giveaway = this.giveaways.campaignsById.get(giveawayId);
    if (!giveaway) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return giveaway;
  }

  private requireGiveawayConfigurator(user: BackendUser, event: Event) {
    this.requireCheckInConfigurator(user, event);
  }

  /** Fail closed if the original configured organizer/admin is no longer valid. */
  private getGiveawayCronActor(giveaway: GiveawayAggregate, event: Event) {
    const actor = this.users.get(giveaway.creatorUserId);
    // Cron has no session, but it must still honor the active-user guard that
    // every session-backed request receives. In particular, an admin-shaped
    // suspended creator must never become trusted lifecycle provenance.
    if (!actor || actor.verificationStatus === "SUSPENDED") return null;
    try {
      this.requireGiveawayConfigurator(actor, event);
      return actor;
    } catch {
      return null;
    }
  }

  private isGiveawayScheduleDue(value: string | undefined, now: Date) {
    if (!value) return false;
    const dueAt = new Date(value).getTime();
    return Number.isFinite(dueAt) && dueAt <= now.getTime();
  }

  private transitionGiveaway(giveaway: GiveawayAggregate, next: GiveawayState) {
    try {
      assertGiveawayLifecycleTransition(giveaway.state, next, giveaway.complianceStatus);
    } catch {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    giveaway.state = next;
    giveaway.updatedAt = new Date().toISOString();
  }

  private hashGiveawayReason(reason: string) {
    return createHash("sha256").update(reason.trim()).digest("hex");
  }

  private auditGiveaway(
    giveaway: GiveawayAggregate,
    actorUserId: string | undefined,
    action: AuditAction,
    targetType: string,
    targetId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const previousHash = giveaway.auditEvents.at(-1)?.hash;
    const now = new Date().toISOString();
    const frozenPayload = Object.freeze({ ...payload }) as Record<string, unknown>;
    const record: GiveawayAuditEventRecord = Object.freeze({
      id: `giveaway-audit-${randomUUID()}`,
      sequence: giveaway.auditEvents.length + 1,
      actorUserId,
      action,
      targetType,
      targetId,
      canonicalPayload: canonicalizeJson(frozenPayload),
      payload: frozenPayload,
      previousHash,
      hash: calculateGiveawayAuditHash(previousHash, frozenPayload),
      createdAt: now,
    });
    giveaway.auditEvents.push(record);
    this.giveaways.auditEventsById.set(record.id, record);
    this.audit(action, actorUserId, targetId);
  }

  private notifyGiveaway(
    giveaway: GiveawayAggregate,
    userId: string,
    kind: GiveawayNotificationKind,
    options: { awardId?: string } = {},
  ) {
    const draft = createGiveawayNotificationDraft(kind, {
      userId,
      giveawayId: giveaway.id,
      giveawayTitle: giveaway.title,
      awardId: options.awardId,
    });
    this.recordGiveawayNotification(draft);
  }

  private recordGiveawayNotification(draft: GiveawayNotificationDraft) {
    assertSafeGiveawayNotification(draft);
    const lookupKey = `${draft.userId}:${draft.dedupeKey}`;
    const existingId = this.giveawayNotificationIdsByUserDedupeKey.get(lookupKey);
    if (existingId) {
      const existing = this.giveawayNotifications.get(existingId);
      if (!existing) throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      return existing;
    }
    const record: GiveawayNotificationRecord = {
      id: `giveaway-notification-${randomUUID()}`,
      userId: draft.userId,
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      ...(draft.href ? { href: draft.href } : {}),
      dedupeKey: draft.dedupeKey,
      createdAt: new Date().toISOString(),
    };
    this.giveawayNotifications.set(record.id, record);
    this.giveawayNotificationIdsByUserDedupeKey.set(lookupKey, record.id);
    return record;
  }

  /**
   * Runs only after RSVP/pass/check-in state has been committed. It deliberately
   * ignores paused and locked campaigns so a frozen candidate set cannot change.
   */
  private reconcileAutomaticEligibilityForEvent(
    eventId: string,
    riderId?: string,
    options: { reallocate?: boolean } = {},
  ) {
    const giveawayIds = this.giveaways.giveawayIdsByEventId.get(eventId);
    if (!giveawayIds) return;

    const riderIds = riderId ? [riderId] : this.riderIdsWithEventActivity(eventId);
    for (const giveawayId of giveawayIds) {
      const giveaway = this.requireGiveaway(giveawayId);
      if (giveaway.state !== "open" || giveaway.entryMode !== "automatic") continue;
      let changed = false;
      for (const candidateRiderId of riderIds) {
        changed = this.reconcileAutomaticEntry(giveaway, candidateRiderId) || changed;
      }
      if (changed && options.reallocate !== false) this.reallocateImmediateGiveawayAwards(giveaway);
    }
  }

  private riderIdsWithEventActivity(eventId: string) {
    const riderIds = new Set<string>();
    for (const rsvp of this.rsvps.values()) {
      if (rsvp.eventId === eventId) riderIds.add(rsvp.userId);
    }
    for (const pass of this.passes.values()) {
      if (pass.eventId === eventId) riderIds.add(pass.userId);
    }
    for (const checkIn of this.checkIns.values()) {
      if (checkIn.eventId === eventId) riderIds.add(checkIn.userId);
    }
    return [...riderIds];
  }

  private reconcileAutomaticEntry(giveaway: GiveawayAggregate, riderId: string) {
    const qualification = this.evaluateGiveawayEntryQualification(giveaway, riderId);
    const { qualifiedGroups, weight: nextWeight, sourceFingerprint } = qualification;
    const existing = giveaway.entriesByRider.get(riderId);

    if (nextWeight <= 0) {
      if (existing?.status === "eligible") {
        this.voidDirectEntryAwards(giveaway, existing, undefined, "automatic_withdrawal");
        existing.status = "withdrawn";
        existing.qualifiedSourceFingerprint = sourceFingerprint;
        existing.qualifiedGroupIds = [];
        existing.qualifiedEligibilityGroupTimings = [];
        existing.updatedAt = new Date().toISOString();
        this.recordAutomaticEntryEvent(
          giveaway,
          existing,
          "source_revalidated",
          -existing.currentWeight,
          qualifiedGroups,
          sourceFingerprint,
        );
        return true;
      }
      return false;
    }

    const timing = reconcileGiveawayEligibilityTimings({
      previousTimings: existing?.qualifiedEligibilityGroupTimings ?? [],
      qualifiedGroups: qualifiedGroups.map(({ group, derivedEligibleAt }) => ({
        groupId: group.id,
        position: group.position,
        derivedEligibleAt,
      })),
    });
    if (!timing.eligibilityCycleAt) return false;
    const nextQualifiedGroupIds = qualifiedGroups.map(({ group }) => group.id);
    assertGiveawayEligibilityTimingIntegrity(nextQualifiedGroupIds, timing.qualifiedEligibilityGroupTimings);

    if (!existing) {
      const now = new Date().toISOString();
      const entry: GiveawayEntryRecord = {
        id: `giveaway-entry-${this.generateGiveawayUuid()}`,
        riderId,
        status: "eligible",
        currentWeight: nextWeight,
        eligibilityCycleAt: timing.eligibilityCycleAt,
        qualifiedSourceFingerprint: sourceFingerprint,
        qualifiedGroupIds: nextQualifiedGroupIds,
        qualifiedEligibilityGroupTimings: timing.qualifiedEligibilityGroupTimings,
        entryPath: "automatic",
        opaquePublicReference: `entry_${randomBytes(16).toString("base64url")}`,
        createdAt: now,
        updatedAt: now,
      };
      giveaway.entriesByRider.set(riderId, entry);
      this.giveaways.entriesById.set(entry.id, entry);
      this.recordAutomaticEntryEvent(
        giveaway,
        entry,
        "automatic_qualified",
        nextWeight,
        qualifiedGroups,
        sourceFingerprint,
      );
      return true;
    }

    if (existing.status === "withdrawn") {
      existing.status = "eligible";
      existing.currentWeight = nextWeight;
      existing.eligibilityCycleAt = timing.eligibilityCycleAt;
      existing.qualifiedSourceFingerprint = sourceFingerprint;
      existing.qualifiedGroupIds = nextQualifiedGroupIds;
      existing.qualifiedEligibilityGroupTimings = timing.qualifiedEligibilityGroupTimings;
      existing.updatedAt = new Date().toISOString();
      this.recordAutomaticEntryEvent(
        giveaway,
        existing,
        "source_revalidated",
        nextWeight,
        qualifiedGroups,
        sourceFingerprint,
      );
      return true;
    }

    if (existing.status === "eligible") {
      const changed =
        existing.currentWeight !== nextWeight ||
        existing.qualifiedSourceFingerprint !== sourceFingerprint ||
        !this.haveSameGiveawayGroupIds(existing.qualifiedGroupIds, nextQualifiedGroupIds) ||
        existing.eligibilityCycleAt !== timing.eligibilityCycleAt ||
        !this.haveSameGiveawayEligibilityTimings(
          existing.qualifiedEligibilityGroupTimings,
          timing.qualifiedEligibilityGroupTimings,
        );
      const weightDelta = nextWeight - existing.currentWeight;
      if (changed) {
        existing.currentWeight = nextWeight;
        existing.eligibilityCycleAt = timing.eligibilityCycleAt;
        existing.qualifiedSourceFingerprint = sourceFingerprint;
        existing.qualifiedGroupIds = nextQualifiedGroupIds;
        existing.qualifiedEligibilityGroupTimings = timing.qualifiedEligibilityGroupTimings;
        existing.updatedAt = new Date().toISOString();
      }
      const affectedPoolIds = this.voidIneligibleDirectEntryAwards(
        giveaway,
        existing,
        undefined,
        "automatic_pool_revalidation",
      );
      if (changed) {
        this.recordAutomaticEntryEvent(
          giveaway,
          existing,
          "source_revalidated",
          weightDelta,
          qualifiedGroups,
          sourceFingerprint,
        );
      }
      return changed || affectedPoolIds.size > 0;
    }
    return false;
  }

  private calculateQualifiedSourceFingerprint(
    qualifiedGroups: QualifiedAutomaticGiveawayGroup[],
  ) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          qualifiedGroups: qualifiedGroups.map(({ group, sourceFacts }) => ({
            groupId: group.id,
            sourceFacts,
          })),
        }),
      )
      .digest("hex");
  }

  private recordAutomaticEntryEvent(
    giveaway: GiveawayAggregate,
    entry: GiveawayEntryRecord,
    type: GiveawayEntryEventRecord["type"],
    weightDelta: number,
    qualifiedGroups: QualifiedAutomaticGiveawayGroup[],
    sourceFingerprint: string,
  ) {
    const sourceFacts = Object.freeze(
      qualifiedGroups.map(({ group, sourceFacts: groupSourceFacts }) =>
        Object.freeze({
          groupId: group.id,
          conditions: Object.freeze(groupSourceFacts.map((sourceFact) => Object.freeze({ ...sourceFact }))),
        }),
      ),
    );
    const sourceSnapshot = Object.freeze({
      qualifiedGroupIds: Object.freeze(qualifiedGroups.map(({ group }) => group.id)),
      qualifiedEligibilityGroupTimings: Object.freeze(
        qualifiedGroups.map(({ group, derivedEligibleAt }) =>
          Object.freeze({ groupId: group.id, eligibleAt: derivedEligibleAt }),
        ),
      ),
      eligibilityCycleAt: entry.eligibilityCycleAt,
      sourceFingerprint,
      sourceFacts,
      effectiveWeight: qualifiedGroups.length === 0 ? 0 : entry.currentWeight,
    }) as Record<string, unknown>;
    const record: GiveawayEntryEventRecord = Object.freeze({
      id: `giveaway-entry-event-${randomUUID()}`,
      entryId: entry.id,
      type,
      sourceKey: `automatic:${giveaway.id}:${entry.id}:${giveaway.entryEvents.length + 1}`,
      sourceSnapshot,
      weightDelta,
      idempotencyKey: `automatic:${giveaway.id}:${entry.id}:${randomUUID()}`,
      createdAt: new Date().toISOString(),
    });
    giveaway.entryEvents.push(record);
    this.giveaways.entryEventsById.set(record.id, record);
    this.auditGiveaway(giveaway, undefined, "GIVEAWAY_ENTRY_RECONCILED", "entry", entry.id, {
      entryId: entry.id,
      type,
      weightDelta,
      sourceFingerprint,
    });
    if (entry.status === "eligible") {
      this.notifyGiveaway(giveaway, entry.riderId, "giveaway_entry");
    }
  }

  private evaluateGiveawayCondition(
    eventId: string,
    riderId: string,
    condition: GiveawayEligibilityConditionInput,
    context: { campaignCode?: boolean; manual?: boolean; actionAt?: string } = {},
  ): GiveawayConditionEvaluation {
    switch (condition.source) {
      case "active_rsvp_pass": {
        const rsvp = this.rsvps.get(`${eventId}:${riderId}`);
        const pass = this.findPassForEventRider(eventId, riderId);
        const satisfied = rsvp?.status === "going" && Boolean(pass && pass.status !== "cancelled");
        const eligibleAt = satisfied
          ? latestGiveawayEligibilityTimestamp([rsvp?.goingAt, pass?.generatedAt])
          : null;
        return {
          satisfied,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            rsvpStatus: rsvp?.status ?? null,
            attendanceType: rsvp?.attendanceType ?? null,
            rsvpGoingAt: rsvp?.goingAt ?? null,
            passId: pass?.id ?? null,
            passStatus: pass?.status ?? null,
            passGeneratedAt: pass?.generatedAt ?? null,
            eligibleAt,
          },
        };
      }
      case "confirmed_check_in": {
        const pass = this.findPassForEventRider(eventId, riderId);
        const confirmedCheckIns = pass
          ? this.confirmedCheckInsForPass(eventId, riderId, pass.id)
          : [];
        const eligibleAt = earliestGiveawayEligibilityTimestamp(
          confirmedCheckIns.map((checkIn) => checkIn.confirmedAt ?? checkIn.timestamp),
        );
        return {
          satisfied: confirmedCheckIns.length > 0,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            confirmedCheckIns: confirmedCheckIns.map((checkIn) => ({
              id: checkIn.id,
              method: checkIn.method,
              confirmationMethod: checkIn.confirmationMethod ?? null,
              confirmedAt: checkIn.confirmedAt ?? null,
              timestamp: checkIn.timestamp,
            })),
            eligibleAt,
          },
        };
      }
      case "staff_confirmed_check_in": {
        const pass = this.findPassForEventRider(eventId, riderId);
        const staffConfirmedCheckIns = pass
          ? this.confirmedCheckInsForPass(eventId, riderId, pass.id).filter(
              (checkIn) =>
                this.isStaffConfirmationMethod(checkIn.method) ||
                (checkIn.method === "rider_qr" &&
                  checkIn.confirmationMethod !== undefined &&
                  this.isStaffConfirmationMethod(checkIn.confirmationMethod)),
            )
          : [];
        const eligibleAt = earliestGiveawayEligibilityTimestamp(
          staffConfirmedCheckIns.map((checkIn) => checkIn.confirmedAt ?? checkIn.timestamp),
        );
        return {
          satisfied: staffConfirmedCheckIns.length > 0,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            staffConfirmedCheckIns: staffConfirmedCheckIns.map((checkIn) => ({
              id: checkIn.id,
              method: checkIn.method,
              confirmationMethod: checkIn.confirmationMethod ?? null,
              confirmedAt: checkIn.confirmedAt ?? null,
              timestamp: checkIn.timestamp,
            })),
            eligibleAt,
          },
        };
      }
      case "perk_redemption": {
        const event = this.requireEvent(eventId);
        const redemptions = event.perks.some((perk) => perk.id === condition.perkId)
          ? Array.from(this.perkRedemptions.values())
              .filter(
                (redemption) =>
                  redemption.perkId === condition.perkId &&
                  redemption.userId === riderId &&
                  redemption.status === "redeemed" &&
                  Boolean(redemption.redeemedAt),
              )
              .sort(
                (left, right) =>
                  (left.redeemedAt ?? "").localeCompare(right.redeemedAt ?? "") ||
                  left.id.localeCompare(right.id),
              )
          : [];
        const eligibleAt = earliestGiveawayEligibilityTimestamp(
          redemptions.map((redemption) => redemption.redeemedAt),
        );
        return {
          satisfied: redemptions.length > 0,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            perkId: condition.perkId,
            redemptions: redemptions.map((redemption) => ({
              id: redemption.id,
              redeemedAt: redemption.redeemedAt,
            })),
            eligibleAt,
          },
        };
      }
      case "campaign_code":
        return {
          satisfied: Boolean(context.campaignCode),
          eligibleAt: context.campaignCode ? context.actionAt : undefined,
          sourceFact: {
            source: condition.source,
            satisfiedBy: context.campaignCode ? "claim" : null,
            eligibleAt: context.campaignCode ? context.actionAt ?? null : null,
          },
        };
      case "manual":
        return {
          satisfied: Boolean(context.manual),
          eligibleAt: context.manual ? context.actionAt : undefined,
          sourceFact: {
            source: condition.source,
            eligibleAt: context.manual ? context.actionAt ?? null : null,
          },
        };
    }
  }

  private confirmedCheckInsForPass(eventId: string, riderId: string, passId: string) {
    return Array.from(this.checkIns.values())
      .filter(
        (checkIn) =>
          checkIn.eventId === eventId &&
          checkIn.passId === passId &&
          checkIn.userId === riderId &&
          checkIn.status === "confirmed",
      )
      .sort(
        (left, right) =>
          (left.confirmedAt ?? left.timestamp).localeCompare(right.confirmedAt ?? right.timestamp) ||
          left.id.localeCompare(right.id),
      );
  }

  private findPassForEventRider(eventId: string, riderId: string) {
    return Array.from(this.passes.values()).find(
      (pass) => pass.eventId === eventId && pass.userId === riderId,
    );
  }

  private isStaffConfirmationMethod(method: ScanMethod) {
    return ["staff_camera", "staff_upload", "staff_manual", "qr", "manual"].includes(method);
  }

  private withAttendanceCounts(event: Event): Event {
    const arrivals = Array.from(this.checkIns.values()).filter(
      (checkIn) => checkIn.eventId === event.id,
    );
    return {
      ...cloneEvent(event),
      confirmedCheckIns: arrivals.filter((checkIn) => checkIn.status === "confirmed").length,
      pendingCheckIns: arrivals.filter((checkIn) => checkIn.status === "pending").length,
    };
  }

  private createSessionForUser(userId: string): SessionRecord {
    const session: SessionRecord = {
      token: makeSessionToken(),
      userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    };
    this.sessions.set(session.token, session);
    this.audit("SESSION_CREATED", userId, userId);
    return session;
  }

  private getUserForSessionToken(sessionToken: string) {
    const session = this.sessions.get(sessionToken);
    return session && session.expiresAt >= new Date()
      ? this.users.get(session.userId) ?? null
      : null;
  }

  private requireUser(sessionToken: string) {
    const user = this.getUserForSessionToken(sessionToken);
    if (!user) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }
    if (user.verificationStatus === "SUSPENDED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private requireRole(sessionToken: string, role: AccountRole) {
    const user = this.requireUser(sessionToken);
    if (user.role !== role) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private requireEvent(eventId: string) {
    const event = this.events.get(eventId);
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private getCheckInSettings(eventId: string): CheckInSettings {
    return this.checkInSettings.get(eventId) ?? {
      eventId,
      mode: "staff_only",
      state: "closed",
      qrMode: "rotating",
      fixedQrAcknowledged: false,
    };
  }

  private resolveSelfCheckInQr(qrToken: string) {
    if (qrToken.startsWith("fixed:")) {
      return {
        event: this.requireEvent(qrToken.slice("fixed:".length)),
        qrMode: "fixed" as const,
        valid: true,
      };
    }

    const session = this.selfCheckInSessions.get(qrToken);
    if (!session) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }
    return {
      event: this.requireEvent(session.eventId),
      qrMode: "rotating" as const,
      valid: !session.revokedAt && session.expiresAt >= Date.now(),
    };
  }

  private requireSelfCheckInEnabled(settings: CheckInSettings) {
    if (settings.mode === "staff_only") {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
    if (settings.state !== "open") {
      throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
    }
    if (settings.qrMode === "fixed" && !settings.fixedQrAcknowledged) {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
  }

  private isSelfCheckInEvent(event: Event) {
    return event.status === "PUBLISHED" || event.status === "ONGOING";
  }

  private requireCheckInConfigurator(user: BackendUser, event: Event) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      user.organizerProfileId === event.organizerId
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private requireRosterConfigurator(user: BackendUser, event: Event) {
    if (user.role === "admin") return;
    if (user.role === "organizer" && user.organizerProfileId === event.organizerId) return;
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private requireCheckInStaff(user: BackendUser, event: Event) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      user.organizerProfileId === event.organizerId
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private findCheckIn(eventId: string, passId: string) {
    return Array.from(this.checkIns.values()).find(
      (checkIn) => checkIn.eventId === eventId && checkIn.passId === passId,
    );
  }

  private requireUserById(userId: string) {
    const user = this.users.get(userId);
    if (!user) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return user;
  }

  private findUserByEmail(email: string) {
    return Array.from(this.users.values()).find((user) => user.email === email) ?? null;
  }

  private buildMemoryRosterSummary(event: Event, enabled: boolean): EventAttendeeSummary {
    const going = Array.from(this.rsvps.values()).filter(
      (rsvp) => rsvp.eventId === event.id && rsvp.status === "going",
    );
    const visibleCount = enabled
      ? going.filter((rsvp) => {
          const user = this.users.get(rsvp.userId);
          return Boolean(rsvp.goingAt) && Boolean(user) && classifyRosterEntry({
            enabled,
            rosterIdentity: user.defaultRosterIdentity ?? "ANONYMOUS",
            profileSlug: user?.profileSlug,
            profileVisibility: user?.profileVisibility ?? "PRIVATE",
          }) === "VISIBLE";
        }).length
      : 0;
    return {
      eventId: event.id,
      eventTitle: event.title,
      rosterEnabled: enabled,
      goingCount: going.length,
      visibleCount,
      anonymousCount: going.length - visibleCount,
    };
  }

  private memberMediaPersistence(): MemberMediaPersistence {
    return {
      registerCleanup: async (userId, storageKey, cleanupAfter) => {
        this.queueMemberMediaCleanup(userId, storageKey, cleanupAfter);
      },
      activateCleanup: async (storageKey, cleanupAfter) => {
        const intent = this.memberMediaCleanupIntents.get(storageKey);
        if (!intent) throw new Error("MEMBER_MEDIA_CLEANUP_INTENT_MISSING");
        intent.cleanupAfter = cleanupAfter;
      },
      saveFinalized: async (userId, record, tempKey, cleanupAfter) =>
        this.saveFinalizedMemberMedia(userId, record, tempKey, cleanupAfter),
      remove: async (userId, mediaId, cleanupAfter) =>
        this.removeMemberMediaRecord(userId, mediaId, cleanupAfter),
      reorder: async (userId, mediaIds) => this.reorderMemberMediaRecords(userId, mediaIds),
      claimCleanup: async (input) => this.claimMemberMediaCleanup(input),
      completeCleanup: async (id, claimToken) => {
        const intent = Array.from(this.memberMediaCleanupIntents.values()).find(
          (candidate) => candidate.id === id && candidate.claimToken === claimToken,
        );
        if (intent) this.memberMediaCleanupIntents.delete(intent.storageKey);
      },
      failCleanup: async (id, claimToken, attemptedAt, retryAt) => {
        const intent = Array.from(this.memberMediaCleanupIntents.values()).find(
          (candidate) => candidate.id === id && candidate.claimToken === claimToken,
        );
        if (!intent) return;
        intent.attemptCount += 1;
        intent.lastAttemptAt = attemptedAt;
        intent.cleanupAfter = retryAt;
        intent.claimToken = undefined;
        intent.claimExpiresAt = undefined;
      },
    };
  }

  private queueMemberMediaCleanup(userId: string, storageKey: string, cleanupAfter: Date) {
    const existing = this.memberMediaCleanupIntents.get(storageKey);
    if (existing) {
      if (cleanupAfter < existing.cleanupAfter) existing.cleanupAfter = cleanupAfter;
      return;
    }
    this.memberMediaCleanupIntents.set(storageKey, {
      id: `member-media-cleanup-${randomUUID()}`,
      userId,
      storageKey,
      cleanupAfter,
      attemptCount: 0,
      createdAt: new Date(),
    });
  }

  private claimMemberMediaCleanup(input: {
    limit: number;
    now: Date;
    claimExpiresAt: Date;
  }) {
    return Array.from(this.memberMediaCleanupIntents.values())
      .filter((intent) =>
        intent.cleanupAfter <= input.now &&
        (!intent.claimExpiresAt || intent.claimExpiresAt <= input.now)
      )
      .sort((left, right) =>
        left.cleanupAfter.getTime() - right.cleanupAfter.getTime() ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id)
      )
      .slice(0, input.limit)
      .map((intent) => {
        intent.claimToken = randomUUID();
        intent.claimExpiresAt = input.claimExpiresAt;
        return {
          id: intent.id,
          storageKey: intent.storageKey,
          claimToken: intent.claimToken,
          attemptCount: intent.attemptCount,
        };
      });
  }

  private saveFinalizedMemberMedia(
    userId: string,
    record: FinalizedMemberMediaRecord,
    tempKey: string,
    cleanupAfter: Date,
  ) {
    const user = this.users.get(userId);
    if (!user) throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    if (!this.memberMediaCleanupIntents.has(record.storageKey)) {
      throw new Error("MEMBER_MEDIA_CLEANUP_INTENT_MISSING");
    }

    if (record.purpose === "avatar") {
      const replacedStorageKeys = user.profilePhotoStorageKey
        ? [user.profilePhotoStorageKey]
        : [];
      Object.assign(user, {
        profilePhotoMediaId: record.mediaId,
        profilePhotoStorageKey: record.storageKey,
        profilePhotoMimeType: record.mimeType,
        profilePhotoWidth: record.width,
        profilePhotoHeight: record.height,
        profilePhotoFinalizedAt: record.finalizedAt,
      });
      this.queueMemberMediaCleanup(userId, tempKey, cleanupAfter);
      for (const storageKey of replacedStorageKeys) {
        this.queueMemberMediaCleanup(userId, storageKey, cleanupAfter);
      }
      this.memberMediaCleanupIntents.delete(record.storageKey);
      return Promise.resolve({ mediaId: record.mediaId });
    }

    const motorcycle = this.motorcycles.get(userId);
    if (!motorcycle) throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    const requestedPosition = record.motorcyclePhotoPosition;
    if (
      requestedPosition !== undefined &&
      (!Number.isInteger(requestedPosition) || requestedPosition < 0 || requestedPosition > 4)
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const position = requestedPosition ?? [0, 1, 2, 3, 4].find(
      (candidate) => !motorcycle.photos.some((photo) => photo.position === candidate),
    );
    if (position === undefined) throw new BackendError("PHOTO_LIMIT", "PHOTO_LIMIT");
    const existing = motorcycle.photos.find((photo) => photo.position === position);
    if (!existing && position !== motorcycle.photos.length) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const nextPhoto: BackendMotorcycle["photos"][number] = {
      id: existing?.id ?? `motorcycle-photo-${randomUUID()}`,
      mediaId: record.mediaId,
      storageKey: record.storageKey,
      mimeType: record.mimeType,
      position,
      width: record.width,
      height: record.height,
      finalizedAt: record.finalizedAt,
    };
    motorcycle.photos = [
      ...motorcycle.photos.filter((photo) => photo.position !== position),
      nextPhoto,
    ].sort((left, right) => left.position - right.position);
    this.queueMemberMediaCleanup(userId, tempKey, cleanupAfter);
    if (existing) this.queueMemberMediaCleanup(userId, existing.storageKey, cleanupAfter);
    this.memberMediaCleanupIntents.delete(record.storageKey);
    return Promise.resolve({ mediaId: record.mediaId });
  }

  private removeMemberMediaRecord(userId: string, mediaId: string, cleanupAfter: Date) {
    const user = this.users.get(userId);
    if (!user) throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    if (user.profilePhotoMediaId === mediaId && user.profilePhotoStorageKey) {
      const storageKey = user.profilePhotoStorageKey;
      user.profilePhotoMediaId = undefined;
      user.profilePhotoStorageKey = undefined;
      user.profilePhotoMimeType = undefined;
      user.profilePhotoWidth = undefined;
      user.profilePhotoHeight = undefined;
      user.profilePhotoFinalizedAt = undefined;
      this.queueMemberMediaCleanup(userId, storageKey, cleanupAfter);
      return Promise.resolve();
    }

    const motorcycle = this.motorcycles.get(userId);
    const index = motorcycle?.photos.findIndex((photo) => photo.mediaId === mediaId) ?? -1;
    if (!motorcycle || index < 0) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    const [removed] = motorcycle.photos.splice(index, 1);
    motorcycle.photos
      .sort((left, right) => left.position - right.position)
      .forEach((photo, position) => { photo.position = position; });
    this.queueMemberMediaCleanup(userId, removed.storageKey, cleanupAfter);
    return Promise.resolve();
  }

  private reorderMemberMediaRecords(userId: string, mediaIds: string[]) {
    const motorcycle = this.motorcycles.get(userId);
    if (
      !motorcycle ||
      mediaIds.length !== motorcycle.photos.length ||
      new Set(mediaIds).size !== mediaIds.length ||
      mediaIds.some((mediaId) => !motorcycle.photos.some((photo) => photo.mediaId === mediaId))
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const photosByMediaId = new Map(motorcycle.photos.map((photo) => [photo.mediaId, photo]));
    motorcycle.photos = mediaIds.map((mediaId, position) => ({
      ...photosByMediaId.get(mediaId)!,
      position,
    }));
    return Promise.resolve();
  }

  private resolveMemberMediaDescriptor(
    sessionToken: string | undefined,
    mediaId: string,
  ): AuthorizedMemberMediaDescriptor {
    let owner = Array.from(this.users.values()).find(
      (candidate) => candidate.profilePhotoMediaId === mediaId,
    );
    let storageKey = owner?.profilePhotoStorageKey;
    let mimeType = owner?.profilePhotoMimeType;
    if (!owner) {
      for (const motorcycle of this.motorcycles.values()) {
        const photo = motorcycle.photos.find((candidate) => candidate.mediaId === mediaId);
        if (photo) {
          owner = this.users.get(motorcycle.userId);
          storageKey = photo.storageKey;
          mimeType = photo.mimeType;
          break;
        }
      }
    }
    if (!owner || !storageKey || mimeType !== "image/webp") {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    const sessionUser = sessionToken ? this.getUserForSessionToken(sessionToken) : null;
    const validSessionUser = sessionUser?.verificationStatus === "SUSPENDED" ? null : sessionUser;
    const ownsProfile = validSessionUser?.id === owner.id;
    const viewer = validSessionUser
      ? { role: validSessionUser.role, ownsProfile }
      : null;
    if ((!owner.profileSlug && !ownsProfile) ||
        !canViewMemberProfile(viewer, owner.profileVisibility ?? "PRIVATE")) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    return { storageKey, mimeType };
  }

  private toMemberMediaBackendError(error: unknown): unknown {
    if (error instanceof BackendError) return error;
    if (error instanceof MemberMediaError) {
      return new BackendError("INVALID_IMAGE", "INVALID_IMAGE");
    }
    if (error instanceof MemberMediaLifecycleError) {
      const code = error.code;
      return new BackendError(code, code);
    }
    return error;
  }

  private audit(
    action: AuditAction,
    actorUserId?: string,
    targetId?: string,
    metadata?: Record<string, boolean>,
  ) {
    this.audits.push({
      id: `audit-${randomUUID()}`,
      action,
      actorUserId,
      targetId,
      metadata,
      createdAt: new Date(),
    });
  }

  private riskFlagsFor(type: EventType, expectedRiders: number) {
    const flags: string[] = [];
    if (["Charity Ride", "Test Ride", "Track Day", "Race"].includes(type)) {
      flags.push(`${type} requires admin review`);
    }
    if (expectedRiders >= 50) {
      flags.push("Expected riders need review");
    }

    return flags.length > 0 ? flags : ["Standard admin review"];
  }
}

type RuntimeBackend = TambikeBackend | PrismaTambikeBackend;

type RuntimeBackendState = {
  backend: Promise<RuntimeBackend> | null;
};

const runtimeBackendState = (() => {
  const state = globalThis as typeof globalThis & {
    __tambikeRuntimeBackend?: RuntimeBackendState;
  };

  state.__tambikeRuntimeBackend ??= { backend: null };
  return state.__tambikeRuntimeBackend;
})();

async function createRuntimeBackend(): Promise<RuntimeBackend> {
  const databaseUrl = getRuntimeDatabaseUrl();
  if (databaseUrl) {
    const { PrismaTambikeBackend } = await import("./prisma-backend");
    return PrismaTambikeBackend.create(databaseUrl);
  }

  return TambikeBackend.create();
}

export function getTambikeBackend() {
  runtimeBackendState.backend ??= createRuntimeBackend();
  return runtimeBackendState.backend;
}

export async function resetTambikeBackendForTests(options: TambikeTestSeedOptions = {}) {
  runtimeBackendState.backend = TambikeBackend.create(options);
  return runtimeBackendState.backend;
}
