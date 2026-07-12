import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaTambikeBackend } from "./prisma-backend";
import { getRuntimeDatabaseUrl } from "./database-url";
import type {
  CreateGiveawayInput,
  GiveawayComplianceStatus,
  GiveawayEligibilityConditionInput,
  GiveawayEntryMode,
  GiveawayFulfilmentMode,
  GiveawayKind,
  GiveawayPublicVisibility,
  GiveawayState,
  PublicGiveawayCampaignSummary,
  PublicGiveawayPrizePoolSummary,
  RiderGiveawayState,
  UpdateGiveawayInput,
} from "@/features/giveaways/types";
import {
  assertGiveawayLifecycleTransition,
  parseCreateGiveawayInput,
  validateGiveawayUpdateInput,
} from "@/features/giveaways/validation";
import { demoEvents, mockUsers, venues } from "@/features/tambike-demo/data";
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
import { calculateGiveawayAuditHash, canonicalizeJson } from "./giveaways/audit";

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
      | "GIVEAWAY_COMPLIANCE_REQUIRED"
      | "INVALID_GIVEAWAY_STATE"
      | "GIVEAWAY_ENTRY_MODE_LOCKED",
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
  | "PASS_CREATED"
  | "CHECK_IN_CREATED"
  | "CHECK_IN_CONFIRMED"
  | "CHECK_IN_SETTINGS_UPDATED"
  | "SELF_CHECK_IN_REQUESTED"
  | "VENUE_APPROVED"
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
  | "GIVEAWAY_ENTRY_RECONCILED";

type BackendUser = UserProfile & {
  passwordHash: string;
};

type SessionRecord = {
  token: string;
  userId: string;
  createdAt: Date;
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
  qualifiedSourceFingerprint: string;
  opaquePublicReference: string;
  createdAt: string;
  updatedAt: string;
};

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

type GiveawaySnapshotMarker = {
  id: string;
  candidateCount: number;
  lockedAt: string;
};

type FutureGiveawayRecord = {
  id: string;
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
  campaignCodes: FutureGiveawayRecord[];
  entriesByRider: Map<string, GiveawayEntryRecord>;
  entryEvents: GiveawayEntryEventRecord[];
  prizePools: GiveawayPrizePoolRecord[];
  snapshot?: GiveawaySnapshotMarker;
  draws: FutureGiveawayRecord[];
  awards: FutureGiveawayRecord[];
  operators: FutureGiveawayRecord[];
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
  campaignCodesById: Map<string, FutureGiveawayRecord>;
  snapshotsById: Map<string, GiveawaySnapshotMarker>;
  drawsById: Map<string, FutureGiveawayRecord>;
  awardsById: Map<string, FutureGiveawayRecord>;
  operatorsById: Map<string, FutureGiveawayRecord>;
  auditEventsById: Map<string, GiveawayAuditEventRecord>;
};

type GiveawayCampaignView = {
  id: string;
  eventId: string;
  title: string;
  state: GiveawayState;
  complianceStatus: GiveawayComplianceStatus;
  mechanicsVersion: number;
};

type GiveawayConditionEvaluation = {
  satisfied: boolean;
  sourceFact: Record<string, unknown>;
};

type QualifiedAutomaticGiveawayGroup = {
  group: GiveawayEligibilityGroupRecord;
  sourceFacts: Record<string, unknown>[];
};

type BackendSeed = {
  users: BackendUser[];
  events: Event[];
  rsvps: Array<RSVP & { userId: string }>;
  passes: Array<Pass & { userId: string }>;
  giveaways: GiveawayAggregate[];
  perkRedemptions: PerkRedemptionRecord[];
};

const demoScannerPass = {
  eventId: "arai-hjc-charity-ride",
  userId: "user-demo-scan-rider",
  passId: "pass-arai-hjc-charity-ride-user-demo-scan-rider",
  qrToken: "tbk_yKZKcLiDPmQ91TgS-eqvp4hLRR2PBumJtKt6e2HMA0s",
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

function cloneUser(user: UserProfile): UserProfile {
  return { ...user };
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

  return [...baseRules, "Respect venue staff"];
}

async function createSeed(): Promise<BackendSeed> {
  const passwordHash = await bcrypt.hash("password123", 10);
  const adminPasswordHash = await bcrypt.hash("secret_123", 10);
  const users: BackendUser[] = [
    ...mockUsers.map<BackendUser>((user) => ({
      ...user,
      passwordHash: user.role === "admin" ? adminPasswordHash : passwordHash,
    })),
    {
      id: demoScannerPass.userId,
      displayName: "Seeded Scan Rider",
      email: "scan-rider@seed.tambike.local",
      role: "rider",
      verificationStatus: "UNVERIFIED",
      area: "Antipolo",
      joinedAt: "July 9, 2026",
      passwordHash,
    },
  ];

  return {
    users,
    events: demoEvents.map(cloneEvent),
    rsvps: [
      {
        eventId: demoScannerPass.eventId,
        userId: demoScannerPass.userId,
        status: "going",
        attendanceType: "direct",
        clubName: "Weekend Tambike Crew",
      },
    ],
    passes: [
      {
        id: demoScannerPass.passId,
        eventId: demoScannerPass.eventId,
        userId: demoScannerPass.userId,
        qrToken: demoScannerPass.qrToken,
        status: "active",
        generatedAt: "2026-07-09T00:00:00.000Z",
      },
    ],
    giveaways: [],
    perkRedemptions: [],
  };
}

export class TambikeBackend {
  private readonly users = new Map<string, BackendUser>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events = new Map<string, Event>();
  private readonly rsvps = new Map<string, RSVP & { userId: string }>();
  private readonly passes = new Map<string, Pass & { userId: string }>();
  private readonly checkIns = new Map<string, CheckInRecord>();
  private readonly checkInSettings = new Map<string, CheckInSettings>();
  private readonly selfCheckInSessions = new Map<string, SelfCheckInSession>();
  private readonly perkRedemptions = new Map<string, PerkRedemptionRecord>();
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
    operatorsById: new Map(),
    auditEventsById: new Map(),
  };
  private readonly audits: AuditRecord[] = [];

  private constructor(seed: BackendSeed) {
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

  static async create() {
    return new TambikeBackend(await createSeed());
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
      users: this.listPublicUsers(),
      events,
      passes: currentPasses,
      checkInSettings: events.map((event) => ({ ...this.getCheckInSettings(event.id) })),
      passCreated: currentPasses.length > 0,
    };
  }

  async signUpRider(input: SignupWithPasswordInput) {
    const email = input.email.trim().toLowerCase();
    if (!email || this.findUserByEmail(email)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    validateSignupPassword(input.password);

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
      passwordHash: await bcrypt.hash(input.password, 10),
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

  async createEventDraft(sessionToken: string, input: CreateEventInput) {
    const user = this.requireUser(sessionToken);
    if (user.role !== "organizer" || user.verificationStatus !== "APPROVED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const venue = venues.find((candidate) => candidate.id === input.venueId);
    if (!venue || venue.status !== "APPROVED") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const baseId = slugify(input.title);
    const eventId = this.events.has(baseId) ? `${baseId}-${this.events.size + 1}` : baseId;
    const expectedRiders = Math.max(1, Number(input.expectedRiders) || 1);
    const event: Event = {
      id: eventId,
      title: input.title.trim(),
      type: input.type,
      status: "PENDING_VENUE_APPROVAL",
      organizerId: user.organizerProfileId ?? "arai-hjc-riders",
      venueId: venue.id,
      poster: "/demo/poster-tambike-cafe-classico.jpg",
      date: input.date.trim(),
      time: input.time.trim(),
      area: input.area.trim(),
      shortDescription: `${input.title.trim()} is awaiting venue approval.`,
      whatHappens:
        "Organizer-created draft that will move through venue approval and admin publish.",
      going: 0,
      interested: 0,
      expectedRiders,
      perkPreview: input.perkPreview.trim(),
      tags: [input.type, "Venue approval"],
      riskFlags: this.riskFlagsFor(input.type, expectedRiders),
      rules: defaultRulesForEvent(input.type),
      perks: [
        {
          id: `perk-${eventId}`,
          type: "Check-in perk",
          description: input.perkPreview.trim(),
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
    if (
      Object.hasOwn(patch, "entryMode") &&
      patch.entryMode !== giveaway.entryMode &&
      (giveaway.entriesByRider.size > 0 || giveaway.entryEvents.length > 0)
    ) {
      throw new BackendError("GIVEAWAY_ENTRY_MODE_LOCKED", "GIVEAWAY_ENTRY_MODE_LOCKED");
    }
    const currentMechanics = this.currentGiveawayMechanics(giveaway);
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
    if (Object.hasOwn(patch, "eligibilityGroups") && Object.hasOwn(patch, "prizePools")) {
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

    giveaway.updatedAt = new Date().toISOString();
    giveaway.complianceStatus = "draft";
    giveaway.complianceReviewerId = undefined;
    giveaway.complianceReviewedAt = undefined;
    giveaway.complianceReviewReason = undefined;
    this.createGiveawayMechanicsVersion(giveaway, user.id, {
      mechanics: nextMechanics,
      terms: nextTerms,
      sponsorDisclosure: nextSponsorDisclosure,
    });
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

  async getPublicGiveaway(giveawayId: string, sessionToken?: string): Promise<PublicGiveawayCampaignSummary> {
    const giveaway = this.requireGiveaway(giveawayId);
    if (giveaway.publicVisibility === "hidden") {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    if (giveaway.publicVisibility === "registered_riders") {
      const rider = this.requireUser(sessionToken ?? "");
      const rsvp = this.rsvps.get(`${giveaway.eventId}:${rider.id}`);
      if (!rsvp || rsvp.status !== "going") throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    if (giveaway.publicVisibility === "eligible_riders") {
      const rider = this.requireUser(sessionToken ?? "");
      const entry = giveaway.entriesByRider.get(rider.id);
      if (!entry || entry.status === "withdrawn") throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return this.toPublicGiveaway(giveaway);
  }

  async getRiderGiveawayState(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState> {
    const rider = this.requireUser(sessionToken);
    if (rider.role !== "rider") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }
    const giveaway = this.requireGiveaway(giveawayId);
    const entry = giveaway.entriesByRider.get(rider.id);
    if (!entry || entry.status === "withdrawn") {
      return { giveawayId: giveaway.id, status: "not_eligible", entryCount: 0 };
    }
    if (entry.status === "disqualified") {
      return { giveawayId: giveaway.id, status: "disqualified", entryCount: 0 };
    }
    return {
      giveawayId: giveaway.id,
      status: "entered",
      entryCount: entry.currentWeight,
    };
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

  async openGiveaway(sessionToken: string, giveawayId: string) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    const event = this.requireEvent(giveaway.eventId);
    this.requireGiveawayConfigurator(user, event);
    if (giveaway.complianceStatus !== "approved") {
      throw new BackendError("GIVEAWAY_COMPLIANCE_REQUIRED", "GIVEAWAY_COMPLIANCE_REQUIRED");
    }
    if (!["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status)) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    this.transitionGiveaway(giveaway, "open");
    this.reconcileAutomaticEligibilityForEvent(event.id);
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_OPENED", "giveaway", giveaway.id, {
      state: giveaway.state,
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async pauseGiveaway(sessionToken: string, giveawayId: string) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    if (giveaway.state !== "open") {
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
    if (giveaway.state !== "open" || giveaway.complianceStatus !== "approved") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    this.transitionGiveaway(giveaway, "locked");
    for (const entry of giveaway.entriesByRider.values()) {
      if (entry.status === "eligible") {
        entry.status = "locked";
        entry.updatedAt = new Date().toISOString();
      }
    }
    const snapshot: GiveawaySnapshotMarker = Object.freeze({
      id: `giveaway-snapshot-marker-${randomUUID()}`,
      candidateCount: Array.from(giveaway.entriesByRider.values()).filter(
        (entry) => entry.status === "locked",
      ).length,
      lockedAt: new Date().toISOString(),
    });
    giveaway.snapshot = snapshot;
    this.giveaways.snapshotsById.set(snapshot.id, snapshot);
    this.auditGiveaway(giveaway, user.id, "GIVEAWAY_LOCKED", "giveaway", giveaway.id, {
      candidateCount: snapshot.candidateCount,
      snapshotMarkerId: snapshot.id,
    });
    return this.toGiveawayCampaignView(giveaway);
  }

  async cancelGiveaway(sessionToken: string, giveawayId: string, reason: unknown) {
    const user = this.requireUser(sessionToken);
    const giveaway = this.requireGiveaway(giveawayId);
    this.requireGiveawayConfigurator(user, this.requireEvent(giveaway.eventId));
    const normalizedReason = this.requireGiveawayReason(reason);
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
    const rsvp: RSVP & { userId: string } = {
      eventId: event.id,
      userId: user.id,
      status: input.status,
      attendanceType: input.attendanceType,
      clubName: input.clubName?.trim() || user.clubName,
    };

    this.rsvps.set(rsvpKey, rsvp);
    if (input.status === "interested") {
      event.interested += 1;
      this.audit("RSVP_UPDATED", user.id, event.id);
      this.reconcileAutomaticEligibilityForEvent(event.id, user.id);
      return { rsvp, pass: null };
    }

    event.going += 1;
    const pass: Pass & { userId: string } = {
      id: passIdForEvent(event.id, user.id),
      eventId: event.id,
      userId: user.id,
      qrToken: makePassToken(),
      status: "active",
      generatedAt: new Date().toISOString(),
    };

    this.passes.set(pass.id, pass);
    this.audit("RSVP_UPDATED", user.id, event.id);
    this.audit("PASS_CREATED", user.id, pass.id);
    this.reconcileAutomaticEligibilityForEvent(event.id, user.id);
    return { rsvp, pass: { ...pass } };
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

  async approveVenueWithConditions(sessionToken: string, eventId: string, conditions: string) {
    const user = this.requireUser(sessionToken);
    if (!["venue", "admin"].includes(user.role)) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const event = this.requireEvent(eventId);
    event.status = "PENDING_ADMIN_REVIEW";
    this.audit("VENUE_APPROVED", user.id, event.id);
    return { event: cloneEvent(event), conditions: conditions.trim() };
  }

  async approvePublish(sessionToken: string, eventId: string) {
    const user = this.requireRole(sessionToken, "admin");
    const event = this.requireEvent(eventId);
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
    return Array.from(this.users.values())
      .filter((user) => !user.email.endsWith("@seed.tambike.local"))
      .map(cloneUser);
  }

  listEvents(query?: EventQueryInput) {
    return filterEventsByQuery(
      Array.from(this.events.values()).map((event) => this.withAttendanceCounts(event)),
      query,
    );
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
      id: `giveaway-${randomUUID()}`,
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
      const id = `giveaway-eligibility-group-${randomUUID()}`;
      groupIdByRequestId.set(group.id, id);
      const persisted: GiveawayEligibilityGroupRecord = {
        id,
        position,
        label: group.label,
        entryWeight: group.weight,
        enabled: true,
        conditions: group.conditions.map((condition) => ({
          id: `giveaway-eligibility-condition-${randomUUID()}`,
          condition: { ...condition },
        })),
      };
      this.giveaways.eligibilityGroupsById.set(id, persisted);
      return persisted;
    });

    const persistedPools = prizePools.map<GiveawayPrizePoolRecord>((pool, position) => {
      const id = `giveaway-prize-pool-${randomUUID()}`;
      const items = pool.items.map<GiveawayPrizeItemRecord>((item, itemPosition) => {
        const persisted: GiveawayPrizeItemRecord = {
          id: `giveaway-prize-item-${randomUUID()}`,
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
      id: `giveaway-mechanics-${randomUUID()}`,
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
      presenceVerificationRequired: pool.presenceVerificationRequired,
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

  private requireGiveaway(giveawayId: string) {
    const giveaway = this.giveaways.campaignsById.get(giveawayId);
    if (!giveaway) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return giveaway;
  }

  private requireGiveawayConfigurator(user: BackendUser, event: Event) {
    this.requireCheckInConfigurator(user, event);
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

  /**
   * Runs only after RSVP/pass/check-in state has been committed. It deliberately
   * ignores paused and locked campaigns so a frozen candidate set cannot change.
   */
  private reconcileAutomaticEligibilityForEvent(eventId: string, riderId?: string) {
    const giveawayIds = this.giveaways.giveawayIdsByEventId.get(eventId);
    if (!giveawayIds) return;

    const riderIds = riderId ? [riderId] : this.riderIdsWithEventActivity(eventId);
    for (const giveawayId of giveawayIds) {
      const giveaway = this.requireGiveaway(giveawayId);
      if (giveaway.state !== "open" || giveaway.entryMode !== "automatic") continue;
      for (const candidateRiderId of riderIds) {
        this.reconcileAutomaticEntry(giveaway, candidateRiderId);
      }
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
    const qualifiedGroups = giveaway.eligibilityGroups.flatMap<QualifiedAutomaticGiveawayGroup>(
      (group) => {
        if (!group.enabled) return [];
        const evaluations = group.conditions.map((condition) =>
          this.evaluateGiveawayCondition(giveaway.eventId, riderId, condition.condition),
        );
        if (!evaluations.every((evaluation) => evaluation.satisfied)) return [];
        return [{ group, sourceFacts: evaluations.map((evaluation) => evaluation.sourceFact) }];
      },
    );
    const calculatedWeight = qualifiedGroups.reduce(
      (total, qualifiedGroup) => total + qualifiedGroup.group.entryWeight,
      0,
    );
    const nextWeight = Math.min(calculatedWeight, giveaway.maxEntriesPerRider);
    const sourceFingerprint = this.calculateQualifiedSourceFingerprint(qualifiedGroups);
    const existing = giveaway.entriesByRider.get(riderId);

    if (nextWeight <= 0) {
      if (existing?.status === "eligible") {
        existing.status = "withdrawn";
        existing.qualifiedSourceFingerprint = sourceFingerprint;
        existing.updatedAt = new Date().toISOString();
        this.recordAutomaticEntryEvent(
          giveaway,
          existing,
          "source_revalidated",
          -existing.currentWeight,
          qualifiedGroups,
          sourceFingerprint,
        );
      }
      return;
    }

    if (!existing) {
      const now = new Date().toISOString();
      const entry: GiveawayEntryRecord = {
        id: `giveaway-entry-${randomUUID()}`,
        riderId,
        status: "eligible",
        currentWeight: nextWeight,
        qualifiedSourceFingerprint: sourceFingerprint,
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
      return;
    }

    if (existing.status === "withdrawn") {
      existing.status = "eligible";
      existing.currentWeight = nextWeight;
      existing.qualifiedSourceFingerprint = sourceFingerprint;
      existing.updatedAt = new Date().toISOString();
      this.recordAutomaticEntryEvent(
        giveaway,
        existing,
        "source_revalidated",
        nextWeight,
        qualifiedGroups,
        sourceFingerprint,
      );
      return;
    }

    if (
      existing.status === "eligible" &&
      (existing.currentWeight !== nextWeight ||
        existing.qualifiedSourceFingerprint !== sourceFingerprint)
    ) {
      const weightDelta = nextWeight - existing.currentWeight;
      existing.currentWeight = nextWeight;
      existing.qualifiedSourceFingerprint = sourceFingerprint;
      existing.updatedAt = new Date().toISOString();
      this.recordAutomaticEntryEvent(
        giveaway,
        existing,
        "source_revalidated",
        weightDelta,
        qualifiedGroups,
        sourceFingerprint,
      );
    }
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
  }

  private evaluateGiveawayCondition(
    eventId: string,
    riderId: string,
    condition: GiveawayEligibilityConditionInput,
  ): GiveawayConditionEvaluation {
    switch (condition.source) {
      case "active_rsvp_pass": {
        const rsvp = this.rsvps.get(`${eventId}:${riderId}`);
        const pass = this.findPassForEventRider(eventId, riderId);
        return {
          satisfied: rsvp?.status === "going" && Boolean(pass && pass.status !== "cancelled"),
          sourceFact: {
            source: condition.source,
            rsvpStatus: rsvp?.status ?? null,
            attendanceType: rsvp?.attendanceType ?? null,
            passId: pass?.id ?? null,
            passStatus: pass?.status ?? null,
          },
        };
      }
      case "confirmed_check_in": {
        const pass = this.findPassForEventRider(eventId, riderId);
        const confirmedCheckIns = pass
          ? this.confirmedCheckInsForPass(eventId, riderId, pass.id)
          : [];
        return {
          satisfied: confirmedCheckIns.length > 0,
          sourceFact: {
            source: condition.source,
            confirmedCheckIns: confirmedCheckIns.map((checkIn) => ({
              id: checkIn.id,
              method: checkIn.method,
              confirmationMethod: checkIn.confirmationMethod ?? null,
            })),
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
        return {
          satisfied: staffConfirmedCheckIns.length > 0,
          sourceFact: {
            source: condition.source,
            staffConfirmedCheckIns: staffConfirmedCheckIns.map((checkIn) => ({
              id: checkIn.id,
              method: checkIn.method,
              confirmationMethod: checkIn.confirmationMethod ?? null,
            })),
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
                  redemption.status === "redeemed",
              )
              .sort((left, right) => left.id.localeCompare(right.id))
          : [];
        return {
          satisfied: redemptions.length > 0,
          sourceFact: {
            source: condition.source,
            perkId: condition.perkId,
            redemptionIds: redemptions.map((redemption) => redemption.id),
          },
        };
      }
      case "campaign_code":
      case "manual":
        return {
          satisfied: false,
          sourceFact: { source: condition.source },
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
      .sort((left, right) => left.id.localeCompare(right.id));
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
    };
    this.sessions.set(session.token, session);
    this.audit("SESSION_CREATED", userId, userId);
    return session;
  }

  private getUserForSessionToken(sessionToken: string) {
    const session = this.sessions.get(sessionToken);
    return session ? this.users.get(session.userId) ?? null : null;
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
    if (
      user.role === "venue" &&
      user.verificationStatus === "APPROVED" &&
      user.venueId === event.venueId
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

  private findUserByEmail(email: string) {
    return Array.from(this.users.values()).find((user) => user.email === email) ?? null;
  }

  private audit(action: AuditAction, actorUserId?: string, targetId?: string) {
    this.audits.push({
      id: `audit-${randomUUID()}`,
      action,
      actorUserId,
      targetId,
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

    return flags.length > 0 ? flags : ["Standard venue approval"];
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

export async function resetTambikeBackendForTests() {
  runtimeBackendState.backend = TambikeBackend.create();
  return runtimeBackendState.backend;
}
