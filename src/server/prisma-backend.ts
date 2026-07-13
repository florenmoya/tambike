import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type {
  CreateGiveawayInput,
  GiveawayEligibilityConditionInput,
  GiveawayFulfilmentMode,
  GiveawayPublicVisibility,
  GiveawayState,
  PublicGiveawayCampaignSummary,
  PublicGiveawayDrawVerification,
  PublicGiveawayPrizePoolSummary,
  RiderGiveawayState,
  UpdateGiveawayInput,
} from "@/features/giveaways/types";
import {
  assertGiveawayLifecycleTransition,
  parseCreateGiveawayInput,
  validateGiveawayUpdateInput,
} from "@/features/giveaways/validation";
import { venues } from "@/features/tambike-demo/data";
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
  CreateEventInput,
  Event,
  EventType,
  OrganizerQrMode,
  Pass,
  Perk,
  ProfileInput,
  RSVP,
  ScanMethod,
  SelfCheckInContext,
  SelfCheckInQr,
  SelfCheckInResult,
  SignupInput,
  UserProfile,
} from "@/features/tambike-demo/types";
import {
  BackendError,
  type AuditAction,
  type RegistrationInput,
} from "./backend";
import { calculateGiveawayAuditHash, canonicalizeJson } from "./giveaways/audit";
import {
  buildPublicDrawVerification,
  createDrawSeedCommitment,
  decryptDrawSeed,
  encryptDrawSeed,
  generateDrawSeed,
  rankFrozenWeightedEntries,
} from "./giveaways/draw-engine";
import {
  assertGiveawayEligibilityTimingIntegrity,
  calculateGiveawayEntryWeightDelta,
  compareGiveawayEntriesByPoolPriority,
  earliestGiveawayEligibilityTimestamp,
  latestGiveawayEligibilityTimestamp,
  reconcileGiveawayEligibilityTimings,
  resolveGiveawayPoolEligibilityPriority,
  type GiveawayEligibilityGroupTiming,
} from "./giveaways/eligibility-timing";

type SignupWithPasswordInput = SignupInput & {
  password: string;
};

type PrismaEventRecord = {
  id: string;
  title: string;
  type: string;
  status: string;
  organizerId: string;
  venueId: string | null;
  poster: string;
  dateLabel: string;
  timeLabel: string;
  area: string;
  description: string;
  whatHappens: string;
  expectedRiders: number;
  perkPreview: string;
  tags: string[];
  riskFlags: string[];
  rideOutMeetup: string | null;
  rideOutCallTime: string | null;
  rideOutDeparture: string | null;
  rideOutDestination: string | null;
  rideOutNotes: string | null;
  safetyRules: string[];
  perks: Array<Omit<Perk, "quantity"> & { quantity: number | null }>;
  _count?: {
    passes: number;
    rsvps: number;
  };
};

type PrismaUserRecord = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  verificationStatus: string;
  area: string;
  bikeModel: string | null;
  clubName: string | null;
  createdAt: Date;
  organizerProfile?: { id: string } | null;
  ownedVenues?: Array<{ id: string }>;
};

type CheckInSettingsValue = CheckInConfiguration & {
  eventId: string;
  fixedQrAcknowledged: boolean;
};

const giveawayConfigurationInclude = {
  event: {
    include: {
      organizer: { select: { userId: true } },
      perks: true,
      _count: { select: { passes: true, rsvps: true } },
    },
  },
  mechanicsVersions: { orderBy: { version: "desc" } },
  eligibilityGroups: {
    orderBy: { position: "asc" },
    include: { conditions: { orderBy: { id: "asc" } } },
  },
  prizePools: {
    orderBy: { position: "asc" },
    include: {
      prizeItems: { orderBy: { position: "asc" } },
      eligibilityGroups: { include: { eligibilityGroup: true } },
    },
  },
} satisfies Prisma.EventGiveawayInclude;

type GiveawayConfiguration = Prisma.EventGiveawayGetPayload<{
  include: typeof giveawayConfigurationInclude;
}>;

const giveawaySnapshotInclude = {
  entries: { orderBy: { opaquePublicReference: "asc" } },
} satisfies Prisma.GiveawaySnapshotInclude;

type GiveawaySnapshotWithEntries = Prisma.GiveawaySnapshotGetPayload<{
  include: typeof giveawaySnapshotInclude;
}>;

type GiveawayDrawRecord = Prisma.GiveawayDrawGetPayload<Record<string, never>>;

type GiveawayAwardRecord = Prisma.GiveawayAwardGetPayload<Record<string, never>>;

type GiveawayDrawActionInput = {
  action: "initial_random_draw" | "manual_selection" | "redraw";
  reasonDigest: string | null;
  prizePoolId?: string;
  riderId?: string;
  predecessorAwardId?: string;
};

type GiveawayDrawResult = {
  drawId: string;
  verification: PublicGiveawayDrawVerification;
};

type GiveawayQualification = {
  qualifiedGroupIds: string[];
  qualifiedGroups: Array<{
    id: string;
    position: number;
    weight: number;
    facts: Record<string, unknown>[];
    derivedEligibleAt: string;
  }>;
  weight: number;
  sourceFingerprint: string;
  sourceFacts: Array<Record<string, unknown>>;
};

type GiveawayCampaignView = {
  id: string;
  eventId: string;
  title: string;
  state: GiveawayState;
  complianceStatus: "draft" | "pending_review" | "approved" | "changes_requested" | "rejected";
  mechanicsVersion: number;
};

type GiveawayEntryWrite = {
  entry: {
    id: string;
    giveawayId: string;
    riderId: string;
    status: string;
    entryPath: string;
    currentWeight: number;
    eligibilityCycleAt: Date;
    qualifiedSourceFingerprint: string;
    qualifiedEligibilityGroupIds: Prisma.JsonValue;
    qualifiedEligibilityGroupTimings: Prisma.JsonValue;
    manualGrantActive: boolean;
    opaquePublicReference: string;
    createdAt: Date;
    updatedAt: Date;
  };
  entryEventId: string;
};

type DirectGiveawayAllocationCandidate = Pick<
  GiveawayEntryWrite["entry"],
  | "id"
  | "riderId"
  | "eligibilityCycleAt"
  | "qualifiedEligibilityGroupIds"
  | "qualifiedEligibilityGroupTimings"
>;

type DirectGiveawayAwardFinalizationLock = {
  award: GiveawayAwardRecord;
  lockedEntries?: GiveawayEntryWrite["entry"][];
};

const eventTypeToDb: Record<EventType, string> = {
  Tambike: "TAMBIKE",
  "Bike Night": "BIKE_NIGHT",
  "Coffee Ride": "COFFEE_RIDE",
  "Club EB": "CLUB_EB",
  "Brand Event": "BRAND_EVENT",
  "Test Ride": "TEST_RIDE",
  "Charity Ride": "CHARITY_RIDE",
  "Track Day": "TRACK_DAY",
  "Endurance Ride": "ENDURANCE_RIDE",
  "Moto Expo": "MOTO_EXPO",
  Race: "RACE",
};

const dbEventTypeToUi = Object.fromEntries(
  Object.entries(eventTypeToDb).map(([uiValue, dbValue]) => [dbValue, uiValue]),
) as Record<string, EventType>;

const attendanceTypeToDb: Record<AttendanceType, string> = {
  direct: "direct",
  "ride-out": "ride_out",
  club: "club",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("base64url");
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

function formatJoinedAt(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function defaultRulesForEvent(type: EventType) {
  const baseRules = ["Helmet required", "No racing", "No stunts", "No revving"];
  if (type === "Track Day" || type === "Race") {
    return [...baseRules, "Follow marshal instructions"];
  }

  return [...baseRules, "Respect venue staff"];
}

export class PrismaTambikeBackend {
  private constructor(private readonly prisma: PrismaClient) {}

  static create(databaseUrl: string) {
    const adapter = new PrismaPg(databaseUrl);
    return new PrismaTambikeBackend(new PrismaClient({ adapter }));
  }

  async disconnect() {
    await this.prisma.$disconnect();
  }

  async getSnapshot(sessionToken?: string) {
    const currentUser = sessionToken ? await this.getUserForSessionToken(sessionToken) : null;
    const [users, events, currentPasses, persistedSettings] = await Promise.all([
      this.listPublicUsers(),
      this.listEvents(),
      currentUser ? this.listPassesForUser(currentUser.id) : Promise.resolve([]),
      this.prisma.eventCheckInSettings.findMany(),
    ]);
    const settingsByEventId = new Map(
      persistedSettings.map((settings) => [settings.eventId, this.toCheckInSettings(settings)]),
    );

    return {
      currentUser: currentUser ? this.toUserProfile(currentUser) : null,
      users,
      events,
      passes: currentPasses,
      checkInSettings: events.map(
        (event) =>
          settingsByEventId.get(event.id) ?? {
            eventId: event.id,
            mode: "staff_only" as const,
            state: "closed" as const,
            qrMode: "rotating" as const,
            fixedQrAcknowledged: false,
          },
      ),
      passCreated: currentPasses.length > 0,
    };
  }

  async signUpRider(input: SignupWithPasswordInput) {
    const email = input.email.trim().toLowerCase();
    if (!email || (await this.findUserByEmail(email))) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    validateSignupPassword(input.password);

    const user = await this.prisma.user.create({
      data: {
        id: `user-${slugify(email || input.displayName)}`,
        displayName: input.displayName.trim(),
        email,
        passwordHash: await bcrypt.hash(input.password, 10),
        role: "rider",
        verificationStatus: "UNVERIFIED",
        area: input.area.trim(),
        bikeModel: input.bikeModel?.trim() || null,
        clubName: input.clubName?.trim() || null,
      },
      include: { organizerProfile: true, ownedVenues: true },
    });
    await this.audit("USER_CREATED", user.id, "User", user.id);
    const sessionToken = await this.createSessionForUser(user.id);

    return {
      user: this.toUserProfile(user),
      sessionToken,
    };
  }

  async loginWithPassword(email: string, password: string) {
    const user = await this.findUserByEmail(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }

    const sessionToken = await this.createSessionForUser(user.id);
    return {
      user: this.toUserProfile(user),
      sessionToken,
    };
  }

  async getCurrentUser(sessionToken?: string | null) {
    if (!sessionToken) {
      return null;
    }

    const user = await this.getUserForSessionToken(sessionToken);
    return user ? this.toUserProfile(user) : null;
  }

  async updateProfile(sessionToken: string, input: ProfileInput) {
    const user = await this.requireUser(sessionToken);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: input.displayName.trim(),
        area: input.area.trim(),
        bikeModel: input.bikeModel?.trim() || null,
        clubName: input.clubName?.trim() || null,
      },
      include: { organizerProfile: true, ownedVenues: true },
    });
    await this.audit("PROFILE_UPDATED", user.id, "User", user.id);
    return this.toUserProfile(updated);
  }

  /**
   * Giveaway write lock order is EventGiveaway -> CampaignCode -> Entry -> Pool
   * -> Item -> Award. Event activity already holds Event before it enters this
   * path; configuration creation uses Event as its pre-lock because no campaign
   * row exists yet.
   */
  async createGiveaway(sessionToken: string, eventId: string, input: CreateGiveawayInput) {
    const user = await this.requireUser(sessionToken);
    const parsed = this.parseCreateGiveaway(input);
    if (parsed.eventId !== eventId) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    return this.prisma.$transaction(async (tx) => {
      const event = await this.lockGiveawayEvent(tx, eventId);
      this.requireGiveawayConfigurator(user, event);
      this.assertGiveawayEligibilityPerks(event, parsed.eligibilityGroups);

      const mechanicsChecksum = this.calculateMechanicsChecksum(
        parsed.mechanics,
        parsed.terms,
        parsed.sponsorDisclosure,
      );
      const giveaway = await tx.eventGiveaway.create({
        data: {
          id: `giveaway-${randomUUID()}`,
          eventId: event.id,
          creatorUserId: user.id,
          organizerAttestedById: user.id,
          title: parsed.title,
          kind: parsed.kind as never,
          status: "draft",
          complianceStatus: "draft",
          entryMode: parsed.entryMode as never,
          maxEntriesPerRider: parsed.maxEntriesPerRider,
          presenceVerificationRequired: parsed.presenceVerificationRequired ?? false,
          visibility: (parsed.publicVisibility ?? "hidden") as never,
          timeZone: parsed.timeZone,
          entryOpensAt: this.toOptionalDate(parsed.entryOpensAt),
          entryClosesAt: this.toOptionalDate(parsed.entryClosesAt),
          drawAt: this.toOptionalDate(parsed.drawAt),
          claimDeadlineAt: this.toOptionalDate(parsed.claimDeadlineAt),
          maxWinsPerRider: parsed.winnerLimits.perRider,
          maxWinsTotal: parsed.winnerLimits.total,
          organizerAttestedAt: new Date(),
          mechanicsVersions: {
            create: {
              id: `giveaway-mechanics-${randomUUID()}`,
              version: 1,
              mechanics: parsed.mechanics,
              terms: parsed.terms,
              sponsorDisclosure: parsed.sponsorDisclosure ?? null,
              checksum: mechanicsChecksum,
              createdByUserId: user.id,
            },
          },
        },
      });

      await this.replaceGiveawayConfiguration(
        tx,
        giveaway.id,
        parsed.eligibilityGroups,
        parsed.prizePools,
        parsed.presenceVerificationRequired ?? false,
      );
      const configured = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(tx, configured.id, user.id, "GIVEAWAY_CREATED", "giveaway", configured.id, {
        state: configured.status,
        complianceStatus: configured.complianceStatus,
        mechanicsVersion: this.currentGiveawayMechanics(configured).version,
      });
      return this.toGiveawayCampaignView(configured);
    });
  }

  async updateGiveaway(sessionToken: string, input: UpdateGiveawayInput) {
    const user = await this.requireUser(sessionToken);
    const parsed = this.parseUpdateGiveaway(input);
    const patch = parsed as unknown as Record<string, unknown>;
    const hasConfigurationPatch =
      Object.hasOwn(patch, "eligibilityGroups") && Object.hasOwn(patch, "prizePools");
    const configurationEvent = hasConfigurationPatch
      ? await this.prisma.eventGiveaway.findUnique({
          where: { id: parsed.id },
          select: { eventId: true },
        })
      : null;

    return this.prisma.$transaction(async (tx) => {
      if (configurationEvent) {
        await this.lockGiveawayEvent(tx, configurationEvent.eventId);
      }
      const giveaway = await this.lockGiveawayCampaign(tx, parsed.id);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if (
        ["locked", "drawing", "claims_open", "completed", "cancelled", "suspended"].includes(
          giveaway.status,
        ) ||
        giveaway.status === "open"
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }

      const entryCount = await tx.giveawayEntry.count({ where: { giveawayId: giveaway.id } });
      const entryEventCount = await tx.giveawayEntryEvent.count({
        where: { giveawayId: giveaway.id },
      });
      const hasEntrantHistory = entryCount > 0 || entryEventCount > 0;
      if (
        Object.hasOwn(patch, "entryMode") &&
        patch.entryMode !== giveaway.entryMode &&
        hasEntrantHistory
      ) {
        throw new BackendError("GIVEAWAY_ENTRY_MODE_LOCKED", "GIVEAWAY_ENTRY_MODE_LOCKED");
      }

      const hasAwardHistory =
        (await tx.giveawayAward.count({ where: { giveawayId: giveaway.id } })) > 0;
      const nextWinnerLimits = Object.hasOwn(patch, "winnerLimits")
        ? (patch.winnerLimits as CreateGiveawayInput["winnerLimits"])
        : undefined;
      if (
        hasAwardHistory &&
        (hasConfigurationPatch ||
          (nextWinnerLimits !== undefined &&
            (giveaway.maxWinsPerRider !== nextWinnerLimits.perRider ||
              giveaway.maxWinsTotal !== nextWinnerLimits.total)))
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }

      if (hasConfigurationPatch) {
        this.assertGiveawayEligibilityPerks(
          giveaway.event,
          patch.eligibilityGroups as CreateGiveawayInput["eligibilityGroups"],
        );
      }

      const currentMechanics = this.currentGiveawayMechanics(giveaway);
      const mechanics = Object.hasOwn(patch, "mechanics")
        ? (patch.mechanics as string)
        : currentMechanics.mechanics;
      const terms = Object.hasOwn(patch, "terms") ? (patch.terms as string) : currentMechanics.terms;
      const sponsorDisclosure = Object.hasOwn(patch, "sponsorDisclosure")
        ? ((patch.sponsorDisclosure as string | undefined) ?? null)
        : currentMechanics.sponsorDisclosure;
      const mechanicsChanged =
        mechanics !== currentMechanics.mechanics ||
        terms !== currentMechanics.terms ||
        sponsorDisclosure !== currentMechanics.sponsorDisclosure;
      const scheduleChanged =
        Object.hasOwn(patch, "entryOpensAt") &&
        ((giveaway.entryOpensAt?.getTime() ?? null) !==
          (this.toOptionalDate(patch.entryOpensAt as string)?.getTime() ?? null) ||
          (giveaway.entryClosesAt?.getTime() ?? null) !==
            (this.toOptionalDate(patch.entryClosesAt as string)?.getTime() ?? null) ||
          (giveaway.drawAt?.getTime() ?? null) !==
            (this.toOptionalDate(patch.drawAt as string | null)?.getTime() ?? null) ||
          (giveaway.claimDeadlineAt?.getTime() ?? null) !==
            (this.toOptionalDate(patch.claimDeadlineAt as string | null)?.getTime() ?? null));
      const coreChanged =
        (Object.hasOwn(patch, "title") && patch.title !== giveaway.title) ||
        (Object.hasOwn(patch, "kind") && patch.kind !== giveaway.kind) ||
        (Object.hasOwn(patch, "entryMode") && patch.entryMode !== giveaway.entryMode) ||
        (Object.hasOwn(patch, "maxEntriesPerRider") &&
          patch.maxEntriesPerRider !== giveaway.maxEntriesPerRider) ||
        (Object.hasOwn(patch, "publicVisibility") && patch.publicVisibility !== giveaway.visibility) ||
        (Object.hasOwn(patch, "presenceVerificationRequired") &&
          Boolean(patch.presenceVerificationRequired) !== giveaway.presenceVerificationRequired) ||
        (nextWinnerLimits !== undefined &&
          (nextWinnerLimits.perRider !== giveaway.maxWinsPerRider ||
            nextWinnerLimits.total !== giveaway.maxWinsTotal)) ||
        (Object.hasOwn(patch, "timeZone") && patch.timeZone !== giveaway.timeZone) ||
        scheduleChanged;
      const changesEntrantFacingConfiguration =
        mechanicsChanged ||
        hasConfigurationPatch ||
        (Object.hasOwn(patch, "kind") && patch.kind !== giveaway.kind) ||
        (Object.hasOwn(patch, "maxEntriesPerRider") &&
          patch.maxEntriesPerRider !== giveaway.maxEntriesPerRider) ||
        (Object.hasOwn(patch, "presenceVerificationRequired") &&
          Boolean(patch.presenceVerificationRequired) !== giveaway.presenceVerificationRequired) ||
        (nextWinnerLimits !== undefined &&
          (nextWinnerLimits.perRider !== giveaway.maxWinsPerRider ||
            nextWinnerLimits.total !== giveaway.maxWinsTotal));
      if (hasEntrantHistory && changesEntrantFacingConfiguration) {
        throw new BackendError(
          "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED",
          "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED",
        );
      }
      const changed = mechanicsChanged || hasConfigurationPatch || coreChanged;
      if (!changed) {
        return this.toGiveawayCampaignView(giveaway);
      }

      const data: Prisma.EventGiveawayUpdateInput = {
        complianceStatus: "draft",
        complianceReviewer: { disconnect: true },
        complianceReviewedAt: null,
        complianceReviewReason: null,
      };
      if (Object.hasOwn(patch, "title")) data.title = patch.title as string;
      if (Object.hasOwn(patch, "kind")) data.kind = patch.kind as never;
      if (Object.hasOwn(patch, "entryMode")) data.entryMode = patch.entryMode as never;
      if (Object.hasOwn(patch, "maxEntriesPerRider")) {
        data.maxEntriesPerRider = patch.maxEntriesPerRider as number;
      }
      if (Object.hasOwn(patch, "publicVisibility")) {
        data.visibility = patch.publicVisibility as never;
      }
      if (Object.hasOwn(patch, "presenceVerificationRequired")) {
        data.presenceVerificationRequired = Boolean(patch.presenceVerificationRequired);
      }
      if (Object.hasOwn(patch, "winnerLimits")) {
        const limits = patch.winnerLimits as CreateGiveawayInput["winnerLimits"];
        data.maxWinsPerRider = limits.perRider;
        data.maxWinsTotal = limits.total;
      }
      if (Object.hasOwn(patch, "timeZone")) data.timeZone = patch.timeZone as string;
      if (Object.hasOwn(patch, "entryOpensAt")) {
        data.entryOpensAt = this.toOptionalDate(patch.entryOpensAt as string);
        data.entryClosesAt = this.toOptionalDate(patch.entryClosesAt as string);
        data.drawAt = this.toOptionalDate(patch.drawAt as string | null);
        data.claimDeadlineAt = this.toOptionalDate(patch.claimDeadlineAt as string | null);
      }
      await tx.eventGiveaway.update({ where: { id: giveaway.id }, data });

      if (hasConfigurationPatch) {
        await this.replaceGiveawayConfiguration(
          tx,
          giveaway.id,
          patch.eligibilityGroups as CreateGiveawayInput["eligibilityGroups"],
          patch.prizePools as CreateGiveawayInput["prizePools"],
          Object.hasOwn(patch, "presenceVerificationRequired")
            ? Boolean(patch.presenceVerificationRequired)
            : giveaway.presenceVerificationRequired,
        );
      }
      if (mechanicsChanged) {
        await tx.giveawayMechanicsVersion.create({
          data: {
            id: `giveaway-mechanics-${randomUUID()}`,
            giveawayId: giveaway.id,
            version: currentMechanics.version + 1,
            mechanics,
            terms,
            sponsorDisclosure,
            checksum: this.calculateMechanicsChecksum(mechanics, terms, sponsorDisclosure),
            createdByUserId: user.id,
          },
        });
      }

      const updated = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(tx, updated.id, user.id, "GIVEAWAY_UPDATED", "giveaway", updated.id, {
        mechanicsVersion: this.currentGiveawayMechanics(updated).version,
        complianceStatus: updated.complianceStatus,
      });
      return this.toGiveawayCampaignView(updated);
    });
  }

  async listOrganizerGiveaways(sessionToken: string, eventId: string) {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireGiveawayConfigurator(user, event);
    const giveaways = await this.prisma.eventGiveaway.findMany({
      where: { eventId: event.id },
      include: giveawayConfigurationInclude,
      orderBy: { createdAt: "asc" },
    });
    return giveaways.map((giveaway) => this.toGiveawayCampaignView(giveaway));
  }

  async getPublicGiveaway(
    giveawayId: string,
    sessionToken?: string,
  ): Promise<PublicGiveawayCampaignSummary> {
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    if (giveaway.visibility === "hidden") {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    if (giveaway.visibility === "registered_riders") {
      const rider = await this.requireUser(sessionToken ?? "");
      const rsvp = await this.prisma.rSVP.findUnique({
        where: { eventId_userId: { eventId: giveaway.eventId, userId: rider.id } },
      });
      if (!rsvp || rsvp.status !== "going") {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
    }
    if (giveaway.visibility === "eligible_riders") {
      const rider = await this.requireUser(sessionToken ?? "");
      const entry = await this.prisma.giveawayEntry.findUnique({
        where: { giveawayId_riderId: { giveawayId: giveaway.id, riderId: rider.id } },
      });
      if (!entry || entry.status === "withdrawn") {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
    }
    return this.toPublicGiveaway(giveaway);
  }

  async getRiderGiveawayState(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async submitGiveawayForReview(sessionToken: string, giveawayId: string) {
    const user = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if (
        !["draft", "scheduled", "paused"].includes(giveaway.status) ||
        !["draft", "changes_requested", "rejected"].includes(giveaway.complianceStatus)
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      await tx.eventGiveaway.update({
        where: { id: giveaway.id },
        data: { complianceStatus: "pending_review" },
      });
      const updated = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(
        tx,
        updated.id,
        user.id,
        "GIVEAWAY_SUBMITTED_FOR_REVIEW",
        "giveaway",
        updated.id,
        { mechanicsVersion: this.currentGiveawayMechanics(updated).version },
      );
      return this.toGiveawayCampaignView(updated);
    });
  }

  async reviewGiveawayCompliance(sessionToken: string, giveawayId: string, input: unknown) {
    const reviewer = await this.requireRole(sessionToken, "admin");
    const review = this.parseGiveawayComplianceReview(input);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      if (giveaway.complianceStatus !== "pending_review") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const mechanics = this.currentGiveawayMechanics(giveaway);
      const now = new Date();
      await tx.eventGiveaway.update({
        where: { id: giveaway.id },
        data: {
          complianceStatus: review.decision as never,
          complianceReviewerId: reviewer.id,
          complianceReviewedAt: now,
          complianceReviewReason: review.reason ?? null,
        },
      });
      await tx.giveawayMechanicsVersion.update({
        where: { id: mechanics.id },
        data: {
          reviewedByUserId: reviewer.id,
          reviewDecision: review.decision as never,
          reviewReason: review.reason ?? null,
          reviewedAt: now,
        },
      });
      const updated = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(
        tx,
        updated.id,
        reviewer.id,
        "GIVEAWAY_COMPLIANCE_REVIEWED",
        "giveaway",
        updated.id,
        {
          decision: review.decision,
          mechanicsVersion: mechanics.version,
          ...(review.reason ? { reasonDigest: this.hashGiveawayReason(review.reason) } : {}),
        },
      );
      return this.toGiveawayCampaignView(updated);
    });
  }

  async openGiveaway(sessionToken: string, giveawayId: string) {
    const user = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if (giveaway.complianceStatus !== "approved") {
        throw new BackendError("GIVEAWAY_COMPLIANCE_REQUIRED", "GIVEAWAY_COMPLIANCE_REQUIRED");
      }
      if (!["PUBLISHED", "ONGOING", "COMPLETED"].includes(giveaway.event.status)) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      this.assertGiveawayTransition(giveaway, "open");
      await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "open" } });
      const opened = await this.lockGiveawayCampaign(tx, giveaway.id);
      if (opened.entryMode === "automatic") {
        const [activityRiderIds, entryRiderRows] = await Promise.all([
          this.riderIdsWithGiveawayActivity(tx, opened.eventId),
          tx.giveawayEntry.findMany({
            where: { giveawayId: opened.id },
            select: { riderId: true },
            orderBy: { riderId: "asc" },
          }),
        ]);
        const riderIds = [
          ...new Set([...activityRiderIds, ...entryRiderRows.map((entry) => entry.riderId)]),
        ].sort();
        await this.lockGiveawayEntries(tx, opened.id);
        for (const riderId of riderIds) {
          await this.reconcileAutomaticGiveawayEntry(tx, opened, riderId, {
            reconcileDirectAwards: false,
          });
        }
      }
      // Every entry mode can retain direct awards while paused. Reopening must
      // reconcile their released capacity, not only automatic campaigns.
      const lockedEntries = await this.lockGiveawayEntries(tx, opened.id);
      await this.revalidateDirectGiveawayAwardsForLockedEntries(tx, opened, lockedEntries);
      await this.reallocateImmediateGiveawayAwards(tx, opened);
      const updated = await this.lockGiveawayCampaign(tx, opened.id);
      await this.auditGiveaway(tx, updated.id, user.id, "GIVEAWAY_OPENED", "giveaway", updated.id, {
        state: updated.status,
      });
      return this.toGiveawayCampaignView(updated);
    });
  }

  async pauseGiveaway(sessionToken: string, giveawayId: string) {
    const user = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if (giveaway.status !== "open") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      this.assertGiveawayTransition(giveaway, "paused");
      await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "paused" } });
      const updated = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(tx, updated.id, user.id, "GIVEAWAY_PAUSED", "giveaway", updated.id, {
        state: updated.status,
      });
      return this.toGiveawayCampaignView(updated);
    });
  }

  async cancelGiveaway(sessionToken: string, giveawayId: string, reason: unknown) {
    const user = await this.requireUser(sessionToken);
    const normalizedReason = this.requireGiveawayReason(reason);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if ((await tx.giveawayAward.count({ where: { giveawayId: giveaway.id } })) > 0) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      this.assertGiveawayTransition(giveaway, "cancelled");
      await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "cancelled" } });
      const updated = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(tx, updated.id, user.id, "GIVEAWAY_CANCELLED", "giveaway", updated.id, {
        state: updated.status,
        reasonDigest: this.hashGiveawayReason(normalizedReason),
      });
      return this.toGiveawayCampaignView(updated);
    });
  }

  async suspendGiveaway(sessionToken: string, giveawayId: string, reason: unknown) {
    const admin = await this.requireRole(sessionToken, "admin");
    const normalizedReason = this.requireGiveawayReason(reason);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.assertGiveawayTransition(giveaway, "suspended");
      const now = new Date();
      await tx.eventGiveaway.update({
        where: { id: giveaway.id },
        data: {
          status: "suspended",
          suspendedByUserId: admin.id,
          suspendedAt: now,
          suspensionReason: normalizedReason,
        },
      });
      const updated = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(tx, updated.id, admin.id, "GIVEAWAY_SUSPENDED", "giveaway", updated.id, {
        state: updated.status,
        reasonDigest: this.hashGiveawayReason(normalizedReason),
      });
      return this.toGiveawayCampaignView(updated);
    });
  }

  async optInToGiveaway(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState> {
    const rider = await this.requireGiveawayRider(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayEntryMode(giveaway, "opt_in");
      const mechanics = this.currentGiveawayMechanics(giveaway);
      const existing = await this.lockGiveawayEntry(tx, giveaway.id, rider.id);
      if (existing && existing.status !== "withdrawn") {
        throw new BackendError("GIVEAWAY_ALREADY_ENTERED", "GIVEAWAY_ALREADY_ENTERED");
      }
      const actionAt = new Date();
      const qualification = await this.evaluateGiveawayEntryQualification(tx, giveaway, rider.id, {
        actionAt,
      });
      if (qualification.weight <= 0) {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
      }
      const write = await this.writeGiveawayEntry(tx, giveaway, rider.id, qualification, {
        entryPath: "opt_in",
        entryEventType: "opted_in",
        actorUserId: rider.id,
        mechanicsAcknowledgement: mechanics,
        actionAt,
      });
      await this.allocateDirectGiveawayAwards(tx, giveaway);
      await this.auditGiveaway(
        tx,
        giveaway.id,
        rider.id,
        "GIVEAWAY_ENTRY_OPTED_IN",
        "entry",
        write.entry.id,
        {
          entryId: write.entry.id,
          mechanicsVersion: mechanics.version,
          mechanicsChecksum: mechanics.checksum,
        },
      );
      return this.toRiderGiveawayState(giveaway, rider.id, tx);
    });
  }

  async createGiveawayCampaignCode(sessionToken: string, giveawayId: string, input: unknown) {
    const organizer = await this.requireUser(sessionToken);
    const parsed = this.parseGiveawayCampaignCodeInput(input);
    const code = `gwy_${randomBytes(24).toString("base64url")}`;
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      if (!["draft", "scheduled", "open", "paused"].includes(giveaway.status)) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const record = await tx.giveawayCampaignCode.create({
        data: {
          id: `giveaway-code-${randomUUID()}`,
          giveawayId: giveaway.id,
          createdByUserId: organizer.id,
          tokenHash: hashToken(code),
          maxUses: parsed.maxUses,
          expiresAt: parsed.expiresAt,
        },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        organizer.id,
        "GIVEAWAY_CAMPAIGN_CODE_CREATED",
        "campaign_code",
        record.id,
        {
          maxUses: record.maxUses,
          expiresAt: record.expiresAt.toISOString(),
          tokenHash: record.tokenHash,
        },
      );
      return {
        id: record.id,
        code,
        maxUses: record.maxUses,
        expiresAt: record.expiresAt.toISOString(),
      };
    });
  }

  async claimGiveawayCampaignCode(
    sessionToken: string,
    giveawayId: string,
    rawCode: unknown,
  ): Promise<RiderGiveawayState> {
    const rider = await this.requireGiveawayRider(sessionToken);
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const tokenHash = hashToken(rawCode.trim());
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayEntryMode(giveaway, "claim_code");
      const code = await this.lockGiveawayCampaignCode(tx, giveaway.id, tokenHash);
      if (!code) {
        throw new BackendError("GIVEAWAY_CODE_INVALID", "GIVEAWAY_CODE_INVALID");
      }
      const existingClaim = await tx.giveawayCampaignCodeClaim.findUnique({
        where: { campaignCodeId_riderId: { campaignCodeId: code.id, riderId: rider.id } },
      });
      if (existingClaim) {
        throw new BackendError("GIVEAWAY_CODE_UNAVAILABLE", "GIVEAWAY_CODE_UNAVAILABLE");
      }
      if (code.revokedAt || code.useCount >= code.maxUses || code.expiresAt < new Date()) {
        throw new BackendError("GIVEAWAY_CODE_UNAVAILABLE", "GIVEAWAY_CODE_UNAVAILABLE");
      }
      const existingEntry = await this.lockGiveawayEntry(tx, giveaway.id, rider.id);
      if (existingEntry && existingEntry.status !== "withdrawn") {
        throw new BackendError("GIVEAWAY_ALREADY_ENTERED", "GIVEAWAY_ALREADY_ENTERED");
      }
      const actionAt = new Date();
      const qualification = await this.evaluateGiveawayEntryQualification(tx, giveaway, rider.id, {
        campaignCode: true,
        actionAt,
      });
      if (qualification.weight <= 0) {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
      }
      const write = await this.writeGiveawayEntry(tx, giveaway, rider.id, qualification, {
        entryPath: "campaign_code",
        entryEventType: "campaign_code_claimed",
        actorUserId: rider.id,
        campaignCodeId: code.id,
        actionAt,
      });
      await tx.giveawayCampaignCode.update({
        where: { id: code.id },
        data: { useCount: { increment: 1 } },
      });
      await tx.giveawayCampaignCodeClaim.create({
        data: {
          id: `giveaway-code-claim-${randomUUID()}`,
          campaignCodeId: code.id,
          riderId: rider.id,
          entryId: write.entry.id,
          idempotencyKey: `campaign-code:${code.id}:${rider.id}`,
        },
      });
      await this.allocateDirectGiveawayAwards(tx, giveaway);
      await this.auditGiveaway(
        tx,
        giveaway.id,
        rider.id,
        "GIVEAWAY_CAMPAIGN_CODE_CLAIMED",
        "entry",
        write.entry.id,
        { entryId: write.entry.id, campaignCodeId: code.id, useCount: code.useCount + 1 },
      );
      return this.toRiderGiveawayState(giveaway, rider.id, tx);
    });
  }

  async grantManualGiveawayEntry(
    sessionToken: string,
    input: unknown,
  ): Promise<RiderGiveawayState> {
    const parsed = this.parseManualGiveawayEntryInput(input);
    const organizer = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, parsed.giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      this.requireGiveawayEntryMode(giveaway, "manual_only");
      const rider = await tx.user.findUnique({ where: { id: parsed.riderId } });
      if (!rider || rider.role !== "rider") {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
      const existing = await this.lockGiveawayEntry(tx, giveaway.id, rider.id);
      if (existing && existing.status !== "withdrawn") {
        throw new BackendError("GIVEAWAY_ALREADY_ENTERED", "GIVEAWAY_ALREADY_ENTERED");
      }
      const actionAt = new Date();
      const qualification = await this.evaluateGiveawayEntryQualification(tx, giveaway, rider.id, {
        manual: true,
        actionAt,
      });
      if (qualification.weight <= 0) {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
      }
      const write = await this.writeGiveawayEntry(tx, giveaway, rider.id, qualification, {
        entryPath: "manual",
        entryEventType: "manual_grant",
        actorUserId: organizer.id,
        manualGrantActive: true,
        reasonDigest: this.hashGiveawayReason(parsed.reason),
        actionAt,
      });
      await this.allocateDirectGiveawayAwards(tx, giveaway);
      await this.auditGiveaway(
        tx,
        giveaway.id,
        organizer.id,
        "GIVEAWAY_MANUAL_ENTRY_GRANTED",
        "entry",
        write.entry.id,
        { entryId: write.entry.id, reasonDigest: this.hashGiveawayReason(parsed.reason) },
      );
      return this.toRiderGiveawayState(giveaway, rider.id, tx);
    });
  }

  async revokeManualGiveawayEntry(
    sessionToken: string,
    giveawayId: string,
    riderId: string,
    reason: unknown,
  ): Promise<RiderGiveawayState> {
    const organizer = await this.requireUser(sessionToken);
    const normalizedReason = this.requireGiveawayReason(reason);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      this.requireGiveawayEntryMode(giveaway, "manual_only");
      const entry = await this.lockGiveawayEntry(tx, giveaway.id, riderId);
      if (
        !entry ||
        entry.entryPath !== "manual" ||
        entry.status !== "eligible" ||
        !entry.manualGrantActive
      ) {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
      }
      await this.voidDirectGiveawayAwards(
        tx,
        giveaway,
        entry,
        organizer.id,
        "manual_revoke",
      );
      const next = await tx.giveawayEntry.update({
        where: { id: entry.id },
        data: {
          status: "withdrawn",
          manualGrantActive: false,
          qualifiedEligibilityGroupIds: this.toJsonValue([]),
          qualifiedEligibilityGroupTimings: this.toJsonValue([]),
        },
      });
      await tx.giveawayEntryEvent.create({
        data: {
          id: `giveaway-entry-event-${randomUUID()}`,
          giveawayId: giveaway.id,
          entryId: entry.id,
          type: "manual_revoke",
          sourceKey: `manual-revoke:${giveaway.id}:${entry.id}:${randomUUID()}`,
          sourceSnapshot: this.toJsonValue({
            reasonDigest: this.hashGiveawayReason(normalizedReason),
            qualifiedGroupIds: [],
            qualifiedEligibilityGroupTimings: [],
            eligibilityCycleAt: entry.eligibilityCycleAt.toISOString(),
          }),
          weightDelta: -entry.currentWeight,
          actorUserId: organizer.id,
          idempotencyKey: `manual-revoke:${giveaway.id}:${entry.id}:${randomUUID()}`,
        },
      });
      await this.reallocateImmediateGiveawayAwards(tx, giveaway);
      await this.auditGiveaway(
        tx,
        giveaway.id,
        organizer.id,
        "GIVEAWAY_MANUAL_ENTRY_REVOKED",
        "entry",
        next.id,
        { entryId: next.id, reasonDigest: this.hashGiveawayReason(normalizedReason) },
      );
      return this.toRiderGiveawayState(giveaway, riderId, tx);
    });
  }

  async redeemGiveawayPerk(
    sessionToken: string,
    perkId: string,
  ): Promise<{ perkId: string; status: "redeemed" }> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const normalizedPerkId = perkId.trim();
    const perkLocation = normalizedPerkId
      ? await this.prisma.perk.findUnique({
          where: { id: normalizedPerkId },
          select: { eventId: true },
        })
      : null;
    if (!perkLocation) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return this.prisma.$transaction(async (tx) => {
      // Keep the Event lock first, matching registration/check-in and the
      // giveaway reconciliation order. The Perk lock then serializes finite
      // inventory redemptions before any EventGiveaway rows are acquired.
      const event = await this.lockGiveawayEvent(tx, perkLocation.eventId);
      const perk = await this.lockGiveawayPerk(tx, event.id, normalizedPerkId);
      if (!perk) {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }

      const pass = await tx.pass.findFirst({
        where: {
          eventId: event.id,
          userId: rider.id,
          status: { not: "cancelled" },
        },
        orderBy: { generatedAt: "asc" },
      });
      if (!pass) {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
      }

      const existing = await tx.perkRedemption.findFirst({
        where: { perkId: perk.id, userId: rider.id, status: "redeemed" },
        orderBy: { id: "asc" },
      });
      if (existing) {
        return { perkId: perk.id, status: "redeemed" };
      }

      if (perk.quantity !== null) {
        const redeemedCount = await tx.perkRedemption.count({
          where: { perkId: perk.id, status: "redeemed" },
        });
        if (redeemedCount >= perk.quantity) {
          throw new BackendError("GIVEAWAY_PERK_UNAVAILABLE", "GIVEAWAY_PERK_UNAVAILABLE");
        }
      }

      const redemption = await tx.perkRedemption.create({
        data: {
          id: `perk-redemption-${randomUUID()}`,
          perkId: perk.id,
          userId: rider.id,
          status: "redeemed",
          redeemedBy: rider.id,
          redeemedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "GIVEAWAY_PERK_REDEEMED",
          actorUserId: rider.id,
          targetType: "PerkRedemption",
          targetId: redemption.id,
          metadata: this.toJsonValue({ perkId: perk.id, eventId: event.id }),
        },
      });
      await this.reconcileAutomaticGiveawayEligibility(tx, event.id, rider.id);

      return { perkId: perk.id, status: "redeemed" };
    });
  }

  async lockGiveaway(sessionToken: string, giveawayId: string) {
    const organizer = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      const existingSnapshot = await tx.giveawaySnapshot.findUnique({
        where: { giveawayId: giveaway.id },
      });
      if (existingSnapshot) {
        return this.toGiveawayLockResult(giveaway, existingSnapshot);
      }
      if (giveaway.status !== "open" || giveaway.complianceStatus !== "approved") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }

      // Validate the key before reconciliation can write any source state.
      const { seed, encryptedSeed, commitment } = this.createEncryptedGiveawayDrawSeed();
      const [activityRiderIds, entryRiderRows] = await Promise.all([
        this.riderIdsWithGiveawayActivity(tx, giveaway.eventId),
        tx.giveawayEntry.findMany({
          where: { giveawayId: giveaway.id },
          select: { riderId: true },
          orderBy: { riderId: "asc" },
        }),
      ]);
      const riderIds = [...new Set([...activityRiderIds, ...entryRiderRows.map((entry) => entry.riderId)])]
        .sort();
      // Take the complete entry lock set before candidate reconciliation can
      // invalidate direct awards. That way any later pool/item work follows
      // the standalone campaign lock order.
      await this.lockGiveawayEntries(tx, giveaway.id);
      for (const riderId of riderIds) {
        if (giveaway.entryMode === "automatic") {
          await this.reconcileAutomaticGiveawayEntry(tx, giveaway, riderId, {
            reconcileDirectAwards: false,
          });
        } else {
          await this.reconcileGiveawayEntryForLock(tx, giveaway, riderId, {
            reconcileDirectAwards: false,
          });
        }
      }
      // Lock entries before allocation takes any pool or item lock. This keeps
      // standalone campaign mutations in the agreed campaign -> entry -> pool
      // -> item -> award order while the authoritative candidate set freezes.
      const lockedEntries = await this.lockGiveawayEntries(tx, giveaway.id);
      await this.revalidateDirectGiveawayAwardsForLockedEntries(tx, giveaway, lockedEntries);
      await this.reallocateImmediateGiveawayAwards(tx, giveaway);

      const eligibleEntries = lockedEntries.filter((entry) => entry.status === "eligible");
      const mechanics = this.currentGiveawayMechanics(giveaway);
      const configDigest = this.calculateGiveawayConfigDigest(giveaway, mechanics.id);
      const frozenEntries = eligibleEntries.map((entry) => {
        const qualifiedEligibilityGroupIds = this.entryQualifiedGroupIds(entry);
        const qualifiedEligibilityGroupTimings = this.entryQualifiedGroupTimings(entry);
        return {
          id: `giveaway-snapshot-entry-${randomUUID()}`,
          entryId: entry.id,
          opaquePublicReference: entry.opaquePublicReference,
          frozenWeight: entry.currentWeight,
          eligibilityCycleAt: entry.eligibilityCycleAt,
          qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
          qualifiedEligibilityGroupIds,
          qualifiedEligibilityGroupTimings,
          rankSourceDigest: this.calculateGiveawayRankSourceDigest({
            entryId: entry.id,
            opaquePublicReference: entry.opaquePublicReference,
            frozenWeight: entry.currentWeight,
            eligibilityCycleAt: entry.eligibilityCycleAt,
            qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
            qualifiedEligibilityGroupIds,
            qualifiedEligibilityGroupTimings,
          }),
        };
      });
      const snapshotDigest = this.calculateGiveawaySnapshotDigest(
        giveaway.id,
        mechanics.id,
        configDigest,
        frozenEntries,
      );
      const snapshot = await tx.giveawaySnapshot.create({
        data: {
          id: `giveaway-snapshot-${randomUUID()}`,
          giveawayId: giveaway.id,
          mechanicsVersionId: mechanics.id,
          configDigest,
          snapshotDigest,
          candidateCount: frozenEntries.length,
          seedCommitment: commitment,
          encryptedSeedCiphertext: encryptedSeed.ciphertext,
          encryptedSeedIv: encryptedSeed.iv,
          encryptedSeedAuthTag: encryptedSeed.authTag,
          encryptionKeyVersion: "env-v1",
          algorithmVersion: "hmac-sha256-v1",
          lockedByUserId: organizer.id,
          entries: {
            create: frozenEntries.map((entry) => ({
              id: entry.id,
              entryId: entry.entryId,
              opaquePublicReference: entry.opaquePublicReference,
              frozenWeight: entry.frozenWeight,
              eligibilityCycleAt: entry.eligibilityCycleAt,
              qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
              qualifiedEligibilityGroupIds: this.toJsonValue(entry.qualifiedEligibilityGroupIds),
              qualifiedEligibilityGroupTimings: this.toJsonValue(
                entry.qualifiedEligibilityGroupTimings,
              ),
              rankSourceDigest: entry.rankSourceDigest,
            })),
          },
        },
      });
      await tx.giveawayEntry.updateMany({
        where: { giveawayId: giveaway.id, status: "eligible" },
        data: { status: "locked" },
      });
      await tx.eventGiveaway.update({
        where: { id: giveaway.id },
        data: { status: "locked" },
      });
      const locked = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(tx, giveaway.id, organizer.id, "GIVEAWAY_LOCKED", "giveaway", giveaway.id, {
        candidateCount: snapshot.candidateCount,
        snapshotId: snapshot.id,
        snapshotDigest,
        commitment,
        seedByteLength: seed.byteLength,
      });
      return this.toGiveawayLockResult(locked, snapshot);
    });
  }

  async runGiveawayDraw(sessionToken: string, input: unknown): Promise<GiveawayDrawResult> {
    const parsed = this.parseGiveawayDrawInput(input);
    const organizer = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, parsed.giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const actionInput: GiveawayDrawActionInput = {
        action: "initial_random_draw",
        reasonDigest: parsed.reason ? this.hashGiveawayReason(parsed.reason) : null,
      };
      const inputDigest = this.calculateGiveawayDrawInputDigest(
        giveaway,
        snapshot,
        "hmac-sha256-v1",
        actionInput,
      );
      const replay = await tx.giveawayDraw.findUnique({
        where: {
          giveawayId_idempotencyKey: {
            giveawayId: giveaway.id,
            idempotencyKey: parsed.idempotencyKey,
          },
        },
      });
      if (replay) {
        this.assertGiveawayDrawReplayInput(replay, inputDigest);
        return this.toGiveawayDrawResult(giveaway, snapshot, replay);
      }
      if (!snapshot || !["locked", "drawing"].includes(giveaway.status)) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const existingInitialDraw = await tx.giveawayDraw.findFirst({
        where: {
          giveawayId: giveaway.id,
          type: "initial",
          algorithmVersion: "hmac-sha256-v1",
        },
        select: { id: true },
      });
      if (existingInitialDraw) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }

      const seed = this.decryptGiveawayDrawSeed(snapshot);
      const entriesById = new Map(
        (await this.lockGiveawayEntries(tx, giveaway.id)).map((entry) => [entry.id, entry]),
      );
      const draw = await tx.giveawayDraw.create({
        data: {
          id: `giveaway-draw-${randomUUID()}`,
          giveawayId: giveaway.id,
          snapshotId: snapshot.id,
          sequence: await this.nextGiveawayDrawSequence(tx, giveaway.id),
          type: "initial",
          status: "completed",
          idempotencyKey: parsed.idempotencyKey,
          algorithmVersion: "hmac-sha256-v1",
          inputDigest,
          initiatedByUserId: organizer.id,
          reasonDigest: actionInput.reasonDigest,
          completedAt: new Date(),
        },
      });
      const rankedUnits = rankFrozenWeightedEntries({
        giveawayId: giveaway.id,
        seed,
        entries: snapshot.entries.map((entry) => ({ id: entry.id, weight: entry.frozenWeight })),
      });
      const snapshotEntryById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
      const awarded = [] as Array<{
        prizePoolId: string;
        prizeItemId: string | null;
        snapshotEntryId: string | null;
        rank: number | null;
        predecessorAwardId: string | null;
      }>;
      for (const pool of giveaway.prizePools.filter((candidate) => candidate.awardMode === "random_draw")) {
        await this.lockGiveawayPrizePool(tx, pool.id);
        const selectedUnitKeys = new Set<string>();
        while (true) {
          let nextUnit:
            | ReturnType<typeof rankFrozenWeightedEntries>[number]
            | undefined;
          for (const unit of rankedUnits) {
            const unitKey = `${unit.entryId}:${unit.unitOrdinal}`;
            const snapshotEntry = snapshotEntryById.get(unit.entryId);
            const entry = snapshotEntry ? entriesById.get(snapshotEntry.entryId) : undefined;
            if (
              selectedUnitKeys.has(unitKey) ||
              !snapshotEntry ||
              !entry ||
              !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
              !(await this.canCreateDrawGiveawayAward(tx, giveaway, pool, entry.riderId))
            ) {
              continue;
            }
            nextUnit = unit;
            break;
          }
          if (!nextUnit) break;
          const prizeItemId = await this.lockNextAvailablePrizeItem(tx, pool.id);
          if (!prizeItemId) break;
          const snapshotEntry = snapshotEntryById.get(nextUnit.entryId);
          const entry = snapshotEntry ? entriesById.get(snapshotEntry.entryId) : undefined;
          if (!snapshotEntry || !entry) {
            throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
          }
          selectedUnitKeys.add(`${nextUnit.entryId}:${nextUnit.unitOrdinal}`);
          const award = await this.createDrawGiveawayAward(tx, giveaway, pool, {
            entry,
            draw,
            snapshotEntry,
            prizeItemId,
            rank: rankedUnits.indexOf(nextUnit) + 1,
            reservePrizeItem: true,
          });
          awarded.push({
            prizePoolId: award.prizePoolId,
            prizeItemId: award.prizeItemId,
            snapshotEntryId: award.snapshotEntryId,
            rank: award.rank,
            predecessorAwardId: award.predecessorAwardId,
          });
        }
      }
      const resultDigest = this.calculateGiveawayDrawResultDigest(giveaway.id, draw, awarded);
      const completedDraw = await tx.giveawayDraw.update({
        where: { id: draw.id },
        data: { resultDigest },
      });
      if (giveaway.status === "locked") {
        await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "drawing" } });
      }
      await this.auditGiveaway(tx, giveaway.id, organizer.id, "GIVEAWAY_DRAW_COMPLETED", "draw", draw.id, {
        drawId: draw.id,
        sequence: draw.sequence,
        resultDigest,
        awardCount: awarded.length,
      });
      return this.toGiveawayDrawResult(giveaway, snapshot, completedDraw);
    });
  }

  async selectManualGiveawayAward(
    sessionToken: string,
    input: unknown,
  ): Promise<GiveawayDrawResult> {
    const parsed = this.parseManualGiveawayAwardInput(input);
    const organizer = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, parsed.giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const actionInput: GiveawayDrawActionInput = {
        action: "manual_selection",
        reasonDigest: this.hashGiveawayReason(parsed.reason),
        prizePoolId: parsed.prizePoolId,
        riderId: parsed.riderId,
      };
      const inputDigest = this.calculateGiveawayDrawInputDigest(
        giveaway,
        snapshot,
        "manual-selection-v1",
        actionInput,
      );
      const replay = await tx.giveawayDraw.findUnique({
        where: {
          giveawayId_idempotencyKey: {
            giveawayId: giveaway.id,
            idempotencyKey: parsed.idempotencyKey,
          },
        },
      });
      if (replay) {
        this.assertGiveawayDrawReplayInput(replay, inputDigest);
        return this.toGiveawayDrawResult(giveaway, snapshot, replay);
      }
      if (!snapshot || !["locked", "drawing"].includes(giveaway.status)) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const pool = giveaway.prizePools.find((candidate) => candidate.id === parsed.prizePoolId);
      if (!pool || pool.awardMode !== "manual_selection") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const entriesById = new Map(
        (await this.lockGiveawayEntries(tx, giveaway.id)).map((entry) => [entry.id, entry]),
      );
      const snapshotEntry = snapshot.entries.find(
        (entry) => entriesById.get(entry.entryId)?.riderId === parsed.riderId,
      );
      const entry = snapshotEntry ? entriesById.get(snapshotEntry.entryId) : undefined;
      if (
        !snapshotEntry ||
        !entry ||
        !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
        !(await this.canCreateDrawGiveawayAward(tx, giveaway, pool, entry.riderId))
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      await this.lockGiveawayPrizePool(tx, pool.id);
      const prizeItemId = await this.lockNextAvailablePrizeItem(tx, pool.id);
      if (!prizeItemId) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const draw = await tx.giveawayDraw.create({
        data: {
          id: `giveaway-draw-${randomUUID()}`,
          giveawayId: giveaway.id,
          snapshotId: snapshot.id,
          sequence: await this.nextGiveawayDrawSequence(tx, giveaway.id),
          type: "initial",
          status: "completed",
          idempotencyKey: parsed.idempotencyKey,
          algorithmVersion: "manual-selection-v1",
          inputDigest,
          initiatedByUserId: organizer.id,
          reasonDigest: actionInput.reasonDigest,
          completedAt: new Date(),
        },
      });
      const award = await this.createDrawGiveawayAward(tx, giveaway, pool, {
        entry,
        draw,
        snapshotEntry,
        prizeItemId,
        rank: 1,
        reservePrizeItem: true,
      });
      const resultDigest = this.calculateGiveawayDrawResultDigest(giveaway.id, draw, [
        {
          prizePoolId: award.prizePoolId,
          prizeItemId: award.prizeItemId,
          snapshotEntryId: award.snapshotEntryId,
          rank: award.rank,
          predecessorAwardId: award.predecessorAwardId,
        },
      ]);
      const completedDraw = await tx.giveawayDraw.update({
        where: { id: draw.id },
        data: { resultDigest },
      });
      if (giveaway.status === "locked") {
        await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "drawing" } });
      }
      await this.auditGiveaway(
        tx,
        giveaway.id,
        organizer.id,
        "GIVEAWAY_MANUAL_AWARD_SELECTED",
        "award",
        award.id,
        {
          awardId: award.id,
          drawId: draw.id,
          reasonDigest: draw.reasonDigest,
        },
      );
      return this.toGiveawayDrawResult(giveaway, snapshot, completedDraw);
    });
  }

  async publishGiveawayDraw(
    sessionToken: string,
    giveawayId: string,
    drawId: string,
  ): Promise<PublicGiveawayDrawVerification> {
    const organizer = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      if (giveaway.status === "suspended") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const draw = await tx.giveawayDraw.findUnique({ where: { id: drawId } });
      if (!draw) throw new BackendError("NOT_FOUND", "NOT_FOUND");
      if (draw.giveawayId !== giveaway.id || draw.snapshotId !== snapshot.id) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const seed = this.decryptGiveawayDrawSeed(snapshot);
      if (draw.status === "published") {
        return this.buildGiveawayDrawVerification(giveaway, snapshot, draw, seed, true);
      }
      if (draw.status !== "completed") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      if (giveaway.status !== "drawing") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const publishedAt = snapshot.seedRevealedAt ?? new Date();
      if (!snapshot.seedRevealedAt) {
        await tx.giveawaySnapshot.update({
          where: { id: snapshot.id },
          data: { seedRevealedAt: publishedAt },
        });
      }
      await tx.giveawayDraw.updateMany({
        where: { snapshotId: snapshot.id, status: "completed" },
        data: { status: "published", publishedAt },
      });
      await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "claims_open" } });
      const publishedDraw = await tx.giveawayDraw.findUnique({ where: { id: draw.id } });
      if (!publishedDraw) throw new BackendError("NOT_FOUND", "NOT_FOUND");
      await this.auditGiveaway(tx, giveaway.id, organizer.id, "GIVEAWAY_DRAW_PUBLISHED", "draw", draw.id, {
        drawId: draw.id,
        resultDigest: publishedDraw.resultDigest,
      });
      return this.buildGiveawayDrawVerification(
        giveaway,
        snapshot,
        publishedDraw,
        seed,
        true,
      );
    });
  }

  async declineGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: unknown,
  ): Promise<RiderGiveawayState> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const normalizedReason = this.requireGiveawayReason(reason);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const directAwardLock = await this.lockDirectGiveawayAwardForFinalization(tx, giveaway, awardId);
      const directAward = directAwardLock?.award;
      const award = directAward ?? (await this.lockGiveawayAward(tx, awardId));
      if (
        !award ||
        award.giveawayId !== giveaway.id ||
        award.winnerUserId !== rider.id ||
        !award.isCurrent ||
        !["pending_verification", "claimable", "verified"].includes(award.status)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const reasonDigest = this.hashGiveawayReason(normalizedReason);
      if (directAward) {
        await this.finalizeDirectGiveawayAward(tx, award, "declined", reasonDigest);
      } else {
        await tx.giveawayAward.update({
          where: { id: award.id },
          data: { status: "declined", reasonDigest },
        });
      }
      await this.auditGiveaway(tx, giveaway.id, rider.id, "GIVEAWAY_AWARD_DECLINED", "award", award.id, {
        awardId: award.id,
        reasonDigest,
        directAward: Boolean(directAward),
      });
      if (directAward) {
        await this.reallocateFinalizedDirectGiveawayAward(
          tx,
          giveaway,
          directAwardLock?.lockedEntries,
        );
      }
      return this.toRiderGiveawayState(giveaway, rider.id, tx);
    });
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

  async redrawGiveawayAward(sessionToken: string, input: unknown): Promise<GiveawayDrawResult> {
    const parsed = this.parseGiveawayRedrawInput(input);
    const organizer = await this.requireUser(sessionToken);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: parsed.awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const actionInput: GiveawayDrawActionInput = {
        action: "redraw",
        reasonDigest: this.hashGiveawayReason(parsed.reason),
        predecessorAwardId: parsed.awardId,
      };
      const inputDigest = this.calculateGiveawayDrawInputDigest(
        giveaway,
        snapshot,
        "hmac-sha256-v1",
        actionInput,
      );
      const replay = await tx.giveawayDraw.findUnique({
        where: {
          giveawayId_idempotencyKey: {
            giveawayId: giveaway.id,
            idempotencyKey: parsed.idempotencyKey,
          },
        },
      });
      if (replay) {
        this.assertGiveawayDrawReplayInput(replay, inputDigest);
        return this.toGiveawayDrawResult(giveaway, snapshot, replay);
      }
      if (giveaway.status === "suspended" || !["drawing", "claims_open"].includes(giveaway.status)) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const award = await tx.giveawayAward.findUnique({ where: { id: parsed.awardId } });
      if (
        !award ||
        award.giveawayId !== giveaway.id
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
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
      const originalDraw = await tx.giveawayDraw.findUnique({ where: { id: award.drawId } });
      const entries = await this.lockGiveawayEntries(tx, giveaway.id);
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      if (
        !originalDraw ||
        originalDraw.algorithmVersion !== "hmac-sha256-v1" ||
        originalDraw.snapshotId !== snapshot.id ||
        !pool ||
        pool.awardMode !== "random_draw"
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
      const seed = this.decryptGiveawayDrawSeed(snapshot);
      const rankedUnits = rankFrozenWeightedEntries({
        giveawayId: giveaway.id,
        seed,
        entries: snapshot.entries.map((entry) => ({ id: entry.id, weight: entry.frozenWeight })),
      });
      const snapshotEntryById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
      const historicalAwardRows = await tx.giveawayAward.findMany({
        where: {
          giveawayId: giveaway.id,
          prizePoolId: pool.id,
          drawId: { not: null },
        },
        select: {
          snapshotEntryId: true,
          rank: true,
          draw: { select: { algorithmVersion: true, snapshotId: true } },
        },
      });
      const consumedWeightedUnitKeys = new Set<string>();
      for (const historicalAward of historicalAwardRows) {
        if (
          historicalAward.draw?.algorithmVersion !== "hmac-sha256-v1" ||
          historicalAward.draw.snapshotId !== snapshot.id
        ) {
          continue;
        }
        if (!historicalAward.snapshotEntryId || historicalAward.rank === null) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
        const consumedUnit = rankedUnits[historicalAward.rank - 1];
        if (!consumedUnit || consumedUnit.entryId !== historicalAward.snapshotEntryId) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
        consumedWeightedUnitKeys.add(`${consumedUnit.entryId}:${consumedUnit.unitOrdinal}`);
      }
      let nextUnit: ReturnType<typeof rankFrozenWeightedEntries>[number] | undefined;
      for (const unit of rankedUnits) {
        const snapshotEntry = snapshotEntryById.get(unit.entryId);
        const entry = snapshotEntry ? entriesById.get(snapshotEntry.entryId) : undefined;
        if (
          !snapshotEntry ||
          !entry ||
          consumedWeightedUnitKeys.has(`${unit.entryId}:${unit.unitOrdinal}`) ||
          !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
          !(await this.canCreateDrawGiveawayAward(tx, giveaway, pool, entry.riderId, award.id))
        ) {
          continue;
        }
        nextUnit = unit;
        break;
      }
      if (!nextUnit) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      const nextSnapshotEntry = snapshotEntryById.get(nextUnit.entryId);
      const nextEntry = nextSnapshotEntry ? entriesById.get(nextSnapshotEntry.entryId) : undefined;
      if (!nextSnapshotEntry || !nextEntry) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      await this.lockGiveawayPrizePool(tx, pool.id);
      const prizeItem = await this.lockGiveawayPrizeItem(tx, award.prizeItemId);
      if (!prizeItem || prizeItem.prizePoolId !== pool.id || prizeItem.status !== "reserved") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const currentAward = await this.lockGiveawayAward(tx, award.id);
      if (
        !currentAward ||
        !currentAward.isCurrent ||
        !["declined", "disqualified", "expired", "voided"].includes(currentAward.status)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const draw = await tx.giveawayDraw.create({
        data: {
          id: `giveaway-draw-${randomUUID()}`,
          giveawayId: giveaway.id,
          snapshotId: snapshot.id,
          sequence: await this.nextGiveawayDrawSequence(tx, giveaway.id),
          type: "redraw",
          status: snapshot.seedRevealedAt ? "published" : "completed",
          idempotencyKey: parsed.idempotencyKey,
          algorithmVersion: "hmac-sha256-v1",
          inputDigest,
          initiatedByUserId: organizer.id,
          reasonDigest: actionInput.reasonDigest,
          completedAt: new Date(),
          publishedAt: snapshot.seedRevealedAt,
        },
      });
      // The partial current-prize-item index requires this transition before
      // inserting the replacement. The transaction rolls it back if insertion fails.
      await tx.giveawayAward.update({
        where: { id: currentAward.id },
        data: { isCurrent: false, status: "superseded" },
      });
      const replacement = await this.createDrawGiveawayAward(tx, giveaway, pool, {
        entry: nextEntry,
        draw,
        snapshotEntry: nextSnapshotEntry,
        prizeItemId: prizeItem.id,
        rank: rankedUnits.indexOf(nextUnit) + 1,
        predecessorAwardId: currentAward.id,
        reservePrizeItem: false,
      });
      const resultDigest = this.calculateGiveawayDrawResultDigest(giveaway.id, draw, [
        {
          prizePoolId: replacement.prizePoolId,
          prizeItemId: replacement.prizeItemId,
          snapshotEntryId: replacement.snapshotEntryId,
          rank: replacement.rank,
          predecessorAwardId: replacement.predecessorAwardId,
        },
      ]);
      const completedDraw = await tx.giveawayDraw.update({
        where: { id: draw.id },
        data: { resultDigest },
      });
      await this.auditGiveaway(tx, giveaway.id, organizer.id, "GIVEAWAY_AWARD_REDRAWN", "award", replacement.id, {
        awardId: replacement.id,
        predecessorAwardId: currentAward.id,
        drawId: draw.id,
        reasonDigest: draw.reasonDigest,
      });
      return this.toGiveawayDrawResult(giveaway, snapshot, completedDraw);
    });
  }

  async createEventDraft(sessionToken: string, input: CreateEventInput) {
    const user = await this.requireUser(sessionToken);
    if (user.role !== "organizer" || user.verificationStatus !== "APPROVED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const organizerId = user.organizerProfile?.id;
    if (!organizerId) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const venue = await this.prisma.venue.findUnique({ where: { id: input.venueId } });
    if (!venue || venue.status !== "APPROVED") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const baseSlug = slugify(input.title);
    const existing = await this.prisma.event.findUnique({ where: { slug: baseSlug } });
    const slug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;
    const expectedRiders = Math.max(1, Number(input.expectedRiders) || 1);
    const type = input.type;
    const event = await this.prisma.event.create({
      data: {
        id: slug,
        slug,
        title: input.title.trim(),
        type: eventTypeToDb[type] as never,
        status: "PENDING_VENUE_APPROVAL",
        organizerId,
        venueId: venue.id,
        poster: "/demo/poster-tambike-cafe-classico.jpg",
        dateLabel: input.date.trim(),
        timeLabel: input.time.trim(),
        area: input.area.trim(),
        expectedRiders,
        description: `${input.title.trim()} is awaiting venue approval.`,
        whatHappens:
          "Organizer-created draft that will move through venue approval and admin publish.",
        perkPreview: input.perkPreview.trim(),
        tags: [type, "Venue approval"],
        riskFlags: this.riskFlagsFor(type, expectedRiders),
        safetyRules: defaultRulesForEvent(type),
        checkInSettings: {
          create: {
            mode: "staff_only",
            state: "closed",
            qrMode: "rotating",
          },
        },
        perks: {
          create: {
            id: `perk-${slug}`,
            type: "Check-in perk",
            description: input.perkPreview.trim(),
          },
        },
      },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });

    await this.audit("EVENT_DRAFT_CREATED", user.id, "Event", event.id);
    return this.toEvent(event);
  }

  async registerForEvent(sessionToken: string, eventId: string, input: RegistrationInput) {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireEvent(eventId);
    const cta = getEventCtaState(this.toEvent(event));
    if (!cta.canRegister && !cta.canShowInterest) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockGiveawayEvent(tx, event.id);
      const previousRsvp = await tx.rSVP.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: user.id } },
        select: { status: true, goingAt: true },
      });
      const now = new Date();
      const goingAt =
        input.status === "going"
          ? previousRsvp?.status === "going" && previousRsvp.goingAt
            ? previousRsvp.goingAt
            : now
          : null;
      const rsvp = await tx.rSVP.upsert({
        where: { eventId_userId: { eventId: event.id, userId: user.id } },
        create: {
          eventId: event.id,
          userId: user.id,
          status: input.status,
          goingAt,
          attendanceType: attendanceTypeToDb[input.attendanceType] as never,
          clubName: input.clubName?.trim() || user.clubName,
        },
        update: {
          status: input.status,
          goingAt,
          attendanceType: attendanceTypeToDb[input.attendanceType] as never,
          clubName: input.clubName?.trim() || user.clubName,
        },
      });
      const pass =
        input.status === "going"
          ? (await tx.pass.findUnique({ where: { rsvpId: rsvp.id } })) ??
            (await tx.pass.create({
              data: {
                id: `pass-${event.id}-${user.id}`,
                eventId: event.id,
                userId: user.id,
                rsvpId: rsvp.id,
                qrTokenHash: makePassToken(),
                status: "active",
              },
            }))
          : null;
      await this.reconcileAutomaticGiveawayEligibility(tx, event.id, user.id);
      return { rsvp, pass };
    });

    await this.audit("RSVP_UPDATED", user.id, "Event", event.id);
    const rsvpDto: RSVP & { userId: string } = {
      eventId: result.rsvp.eventId,
      userId: result.rsvp.userId,
      status: input.status,
      attendanceType: input.attendanceType,
      clubName: result.rsvp.clubName ?? undefined,
    };
    if (!result.pass) {
      return { rsvp: rsvpDto, pass: null };
    }
    await this.audit("PASS_CREATED", user.id, "Pass", result.pass.id);
    return { rsvp: rsvpDto, pass: this.toPass(result.pass) };
  }

  async configureCheckIn(
    sessionToken: string,
    eventId: string,
    input: CheckInConfiguration,
  ) {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    validateCheckInConfiguration(input);
    const settings = await this.prisma.$transaction(async (tx) => {
      const lockedEvent = await this.lockCheckInEvent(tx, event.id);
      const previousSettings = this.settingsForEvent(lockedEvent);
      const nextSettings = await tx.eventCheckInSettings.upsert({
        where: { eventId: lockedEvent.id },
        create: {
          eventId: lockedEvent.id,
          mode: input.mode,
          state: input.state,
          qrMode: input.qrMode,
          fixedQrAcknowledgedAt:
            input.qrMode === "fixed" && input.fixedQrAcknowledged ? new Date() : null,
        },
        update: {
          mode: input.mode,
          state: input.state,
          qrMode: input.qrMode,
          fixedQrAcknowledgedAt:
            input.qrMode === "fixed" && input.fixedQrAcknowledged ? new Date() : null,
        },
      });

      if (
        input.mode === "staff_only" ||
        input.state !== "open" ||
        previousSettings.qrMode !== input.qrMode
      ) {
        await tx.eventSelfCheckInQrSession.updateMany({
          where: { eventId: lockedEvent.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return nextSettings;
    });

    await this.audit("CHECK_IN_SETTINGS_UPDATED", user.id, "Event", event.id);
    return this.toCheckInSettings(settings);
  }

  async issueSelfCheckInQr(sessionToken: string, eventId: string): Promise<SelfCheckInQr> {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    return this.prisma.$transaction(async (tx) => {
      const lockedEvent = await this.lockCheckInEvent(tx, event.id);
      const settings = this.settingsForEvent(lockedEvent);

      this.requireSelfCheckInEnabled(settings);
      if (lockedEvent.status !== "PUBLISHED" && lockedEvent.status !== "ONGOING") {
        throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
      }
      if (settings.qrMode === "fixed") {
        return { token: `fixed:${lockedEvent.id}`, qrMode: "fixed" };
      }

      const token = `tbk_checkin_${randomBytes(24).toString("base64url")}`;
      const expiresAt = new Date(Date.now() + 90_000);
      await tx.eventSelfCheckInQrSession.create({
        data: {
          eventId: lockedEvent.id,
          tokenHash: hashToken(token),
          expiresAt,
        },
      });
      return { token, expiresAt: expiresAt.toISOString(), qrMode: "rotating" };
    });
  }

  async getSelfCheckInContext(qrToken: string): Promise<SelfCheckInContext> {
    const resolved = await this.resolveSelfCheckInQr(qrToken);
    const settings = this.settingsForEvent(resolved.event);
    if (settings.mode === "staff_only") {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
    return {
      event: this.toEvent(resolved.event),
      mode: settings.mode,
      state: settings.state,
      qrMode: settings.qrMode,
      available:
        resolved.valid &&
        settings.qrMode === resolved.qrMode &&
        settings.state === "open" &&
        (resolved.event.status === "PUBLISHED" || resolved.event.status === "ONGOING"),
    };
  }

  async selfCheckIn(sessionToken: string, qrToken: string): Promise<SelfCheckInResult> {
    const rider = await this.requireUser(sessionToken);
    if (rider.role !== "rider") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }
    const resolved = await this.resolveSelfCheckInQr(qrToken);

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const event = await this.lockCheckInEvent(tx, resolved.event.id);
        const settings = this.settingsForEvent(event);

        this.requireSelfCheckInEnabled(settings);
        if (settings.qrMode !== resolved.qrMode) {
          throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
        }

        let selfCheckInSessionId: string | undefined;
        if (resolved.qrMode === "rotating") {
          const qrSession = await tx.eventSelfCheckInQrSession.findUnique({
            where: { tokenHash: hashToken(qrToken) },
          });
          if (
            !qrSession ||
            qrSession.eventId !== event.id ||
            qrSession.revokedAt ||
            qrSession.expiresAt < new Date()
          ) {
            throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
          }
          selfCheckInSessionId = qrSession.id;
        }

        if (event.status !== "PUBLISHED" && event.status !== "ONGOING") {
          throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
        }

        const pass = await tx.pass.findFirst({
          where: { eventId: event.id, userId: rider.id },
        });
        if (!pass) {
          throw new BackendError("NOT_FOUND", "NOT_FOUND");
        }
        if (pass.status === "cancelled") {
          throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
        }

        const existing = await tx.checkIn.findUnique({
          where: { eventId_passId: { eventId: event.id, passId: pass.id } },
        });
        if (existing?.status === "pending") {
          return { status: "pending" as const, pass };
        }
        if (existing?.status === "confirmed" || pass.status === "checked_in") {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }

        if (settings.mode === "self_review") {
          await tx.checkIn.create({
            data: {
              eventId: event.id,
              passId: pass.id,
              userId: rider.id,
              status: "pending",
              method: "rider_qr",
              selfCheckInSessionId,
            },
          });
          return { status: "pending" as const, pass };
        }

        const updated = await tx.pass.updateMany({
          where: { id: pass.id, status: "active" },
          data: { status: "checked_in", checkedInAt: new Date() },
        });
        if (updated.count !== 1) {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }
        const confirmedPass = await tx.pass.findUniqueOrThrow({ where: { id: pass.id } });
        await tx.checkIn.create({
          data: {
            eventId: event.id,
            passId: pass.id,
            userId: rider.id,
            status: "confirmed",
            confirmedAt: new Date(),
            method: "rider_qr",
            selfCheckInSessionId,
          },
        });
        await this.reconcileAutomaticGiveawayEligibility(tx, event.id, rider.id);
        return { status: "confirmed" as const, pass: confirmedPass };
      });

      await this.audit("SELF_CHECK_IN_REQUESTED", rider.id, "Event", resolved.event.id);
      if (outcome.status === "confirmed") {
        await this.audit("CHECK_IN_CREATED", rider.id, "CheckIn", outcome.pass.id);
      }
      return { status: outcome.status, pass: this.toPass(outcome.pass) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
      }
      throw error;
    }
  }

  async scanPass(
    sessionToken: string,
    eventId: string,
    qrToken: string,
    method: ScanMethod,
  ) {
    const scanner = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireCheckInStaff(scanner, event);
    const staffMethod = normalizeStaffScanMethod(method);
    const pass = await this.prisma.pass.findUnique({ where: { qrTokenHash: qrToken } });
    if (!pass) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    if (pass.eventId !== event.id) {
      throw new BackendError("WRONG_EVENT", "WRONG_EVENT");
    }
    if (pass.status === "cancelled") {
      throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
    }
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.lockCheckInEvent(tx, event.id);
        const existing = await tx.checkIn.findUnique({
          where: { eventId_passId: { eventId: event.id, passId: pass.id } },
        });
        if (existing?.status === "pending") {
          const confirmedAt = new Date();
          await tx.checkIn.update({
            where: { id: existing.id },
            data: {
              status: "confirmed",
              scannedBy: scanner.id,
              confirmedAt,
              confirmationMethod: staffMethod,
            },
          });
          const confirmedPass = await tx.pass.update({
            where: { id: pass.id },
            data: { status: "checked_in", checkedInAt: confirmedAt },
          });
          await this.reconcileAutomaticGiveawayEligibility(tx, event.id, pass.userId);
          return { pass: confirmedPass, confirmation: true };
        }
        if (existing?.status === "confirmed" || pass.status === "checked_in") {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }

        const updated = await tx.pass.updateMany({
          where: { id: pass.id, status: "active" },
          data: { status: "checked_in", checkedInAt: new Date() },
        });
        if (updated.count !== 1) {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }
        const confirmedPass = await tx.pass.findUniqueOrThrow({ where: { id: pass.id } });
        await tx.checkIn.create({
          data: {
            id: `checkin-${randomUUID()}`,
            eventId: event.id,
            passId: pass.id,
            userId: pass.userId,
            scannedBy: scanner.id,
            status: "confirmed",
            confirmedAt: new Date(),
            method: staffMethod,
          },
        });
        await this.reconcileAutomaticGiveawayEligibility(tx, event.id, pass.userId);
        return { pass: confirmedPass, confirmation: false };
      });

      await this.audit(
        outcome.confirmation ? "CHECK_IN_CONFIRMED" : "CHECK_IN_CREATED",
        scanner.id,
        "CheckIn",
        outcome.pass.id,
      );
      return this.toPass(outcome.pass);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
      }
      throw error;
    }
  }

  async approveVenueWithConditions(sessionToken: string, eventId: string, conditions: string) {
    const user = await this.requireUser(sessionToken);
    if (!["venue", "admin"].includes(user.role)) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    await this.requireEvent(eventId);
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: "PENDING_ADMIN_REVIEW" },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });
    await this.prisma.eventApproval.upsert({
      where: { id: "req-shell-pugon" },
      create: {
        id: "req-shell-pugon",
        eventId,
        approvalType: "venue",
        reviewerId: user.id,
        decision: "approved_with_conditions",
        conditions: conditions.trim(),
        decidedAt: new Date(),
      },
      update: {
        reviewerId: user.id,
        decision: "approved_with_conditions",
        conditions: conditions.trim(),
        decidedAt: new Date(),
      },
    });
    await this.audit("VENUE_APPROVED", user.id, "Event", event.id);
    return { event: this.toEvent(event), conditions: conditions.trim() };
  }

  async approvePublish(sessionToken: string, eventId: string) {
    const user = await this.requireRole(sessionToken, "admin");
    await this.requireEvent(eventId);
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED" },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });
    await this.prisma.eventApproval.upsert({
      where: { id: "rev-arai-hjc-charity-ride" },
      create: {
        id: "rev-arai-hjc-charity-ride",
        eventId,
        approvalType: "admin",
        reviewerId: user.id,
        decision: "published",
        decidedAt: new Date(),
      },
      update: {
        reviewerId: user.id,
        decision: "published",
        decidedAt: new Date(),
      },
    });
    await this.audit("ADMIN_PUBLISHED", user.id, "Event", event.id);
    return this.toEvent(event);
  }

  async exportAttendeesCsv(sessionToken: string, eventId: string) {
    const user = await this.requireRole(sessionToken, "admin");
    const event = await this.requireEvent(eventId);
    const rows = ["event_id,user_email,rsvp_status,pass_status,checked_in_at"];
    const rsvps = await this.prisma.rSVP.findMany({
      where: { eventId: event.id },
      include: { user: true, pass: true },
    });

    for (const rsvp of rsvps) {
      const checkIn = rsvp.pass
        ? await this.prisma.checkIn.findFirst({
            where: { passId: rsvp.pass.id, status: "confirmed" },
          })
        : null;
      rows.push(
        [
          event.id,
          rsvp.user.email,
          rsvp.status,
          rsvp.pass?.status ?? "",
          checkIn?.confirmedAt?.toISOString() ?? checkIn?.timestamp.toISOString() ?? "",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (rsvps.length === 0) {
      rows.push([event.id, "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    await this.audit("ATTENDEE_EXPORT_CREATED", user.id, "Event", event.id);
    return rows.join("\n");
  }

  async exportLeadsCsv(sessionToken: string) {
    const user = await this.requireRole(sessionToken, "admin");
    const rows = ["event_id,lead_name,email,interest,status"];
    const leads = await this.prisma.lead.findMany({ include: { event: true, user: true } });

    for (const lead of leads) {
      rows.push(
        [
          lead.eventId,
          lead.name,
          lead.user?.email ?? "",
          lead.interestedModel,
          lead.exportedAt ? "exported" : "captured",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (leads.length === 0) {
      rows.push(["", "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    await this.audit("LEAD_EXPORT_CREATED", user.id, "Lead", "lead-export");
    return rows.join("\n");
  }

  async auditCount(action: AuditAction) {
    return this.prisma.auditLog.count({ where: { action } });
  }

  async listPublicUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        email: {
          not: {
            endsWith: "@seed.tambike.local",
          },
        },
      },
      include: { organizerProfile: true, ownedVenues: true },
      orderBy: { createdAt: "asc" },
    });
    return users.map((user) => this.toUserProfile(user));
  }

  async listEvents(query?: EventQueryInput) {
    const [events, groupedCheckIns] = await Promise.all([
      this.prisma.event.findMany({
        include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.checkIn.groupBy({
        by: ["eventId", "status"],
        _count: { _all: true },
      }),
    ]);
    const attendanceByEvent = new Map<string, { confirmed: number; pending: number }>();
    for (const checkInGroup of groupedCheckIns) {
      const current = attendanceByEvent.get(checkInGroup.eventId) ?? {
        confirmed: 0,
        pending: 0,
      };
      if (checkInGroup.status === "confirmed") {
        current.confirmed = checkInGroup._count._all;
      } else if (checkInGroup.status === "pending") {
        current.pending = checkInGroup._count._all;
      }
      attendanceByEvent.set(checkInGroup.eventId, current);
    }
    return filterEventsByQuery(
      events.map((event) => {
        const attendance = attendanceByEvent.get(event.id) ?? { confirmed: 0, pending: 0 };
        return {
          ...this.toEvent(event),
          confirmedCheckIns: attendance.confirmed,
          pendingCheckIns: attendance.pending,
        };
      }),
      query,
    );
  }

  private async listPassesForUser(userId: string) {
    const passes = await this.prisma.pass.findMany({
      where: { userId },
      orderBy: { generatedAt: "desc" },
    });
    return passes.map((pass) => this.toPass(pass));
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
    return {
      decision: record.decision as "approved" | "changes_requested" | "rejected",
      reason: this.requireGiveawayReason(record.reason),
    };
  }

  private parseGiveawayCampaignCodeInput(input: unknown): { maxUses: number; expiresAt: Date } {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (!Number.isInteger(record.maxUses) || (record.maxUses as number) <= 0) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const expiresAt =
      record.expiresAt === undefined
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : typeof record.expiresAt === "string"
          ? new Date(record.expiresAt)
          : undefined;
    if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return { maxUses: record.maxUses as number, expiresAt };
  }

  private parseManualGiveawayEntryInput(input: unknown): {
    giveawayId: string;
    riderId: string;
    reason: string;
  } {
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
    return {
      giveawayId: record.giveawayId.trim(),
      riderId: record.riderId.trim(),
      reason: this.requireGiveawayReason(record.reason),
    };
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
      !record.idempotencyKey.trim() ||
      (record.reason !== undefined && (typeof record.reason !== "string" || !record.reason.trim()))
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      giveawayId: record.giveawayId.trim(),
      idempotencyKey: record.idempotencyKey.trim(),
      reason: typeof record.reason === "string" ? record.reason.trim() : undefined,
    };
  }

  private parseGiveawayRedrawInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    if (
      typeof record.awardId !== "string" ||
      !record.awardId.trim() ||
      typeof record.idempotencyKey !== "string" ||
      !record.idempotencyKey.trim()
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return {
      awardId: record.awardId.trim(),
      idempotencyKey: record.idempotencyKey.trim(),
      reason: this.requireGiveawayReason(record.reason),
    };
  }

  private parseManualGiveawayAwardInput(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const record = input as Record<string, unknown>;
    for (const field of ["giveawayId", "prizePoolId", "riderId", "idempotencyKey"] as const) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
    }
    return {
      giveawayId: (record.giveawayId as string).trim(),
      prizePoolId: (record.prizePoolId as string).trim(),
      riderId: (record.riderId as string).trim(),
      idempotencyKey: (record.idempotencyKey as string).trim(),
      reason: this.requireGiveawayReason(record.reason),
    };
  }

  private requireGiveawayReason(reason: unknown) {
    if (typeof reason !== "string" || !reason.trim()) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return reason.trim();
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
      const seed = generateDrawSeed();
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

  private decryptGiveawayDrawSeed(
    snapshot: Pick<
      GiveawaySnapshotWithEntries,
      "encryptedSeedCiphertext" | "encryptedSeedIv" | "encryptedSeedAuthTag"
    >,
  ) {
    const encryptionKey = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new BackendError(
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
      );
    }
    try {
      return decryptDrawSeed(
        {
          algorithm: "aes-256-gcm",
          ciphertext: snapshot.encryptedSeedCiphertext,
          iv: snapshot.encryptedSeedIv,
          authTag: snapshot.encryptedSeedAuthTag,
        },
        encryptionKey,
      );
    } catch {
      throw new BackendError(
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
        "GIVEAWAY_DRAW_CONFIGURATION_ERROR",
      );
    }
  }

  private toGiveawayLockResult(
    giveaway: GiveawayConfiguration,
    snapshot: Pick<
      GiveawaySnapshotWithEntries,
      "id" | "candidateCount" | "snapshotDigest" | "seedCommitment" | "algorithmVersion"
    >,
  ) {
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

  private buildGiveawayDrawVerification(
    giveaway: GiveawayConfiguration,
    snapshot: Pick<
      GiveawaySnapshotWithEntries,
      "seedCommitment" | "snapshotDigest" | "candidateCount"
    >,
    draw: Pick<GiveawayDrawRecord, "algorithmVersion" | "resultDigest">,
    seed: Uint8Array,
    published: boolean,
  ) {
    if (!draw.resultDigest) throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
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

  private toGiveawayDrawResult(
    giveaway: GiveawayConfiguration,
    snapshot: GiveawaySnapshotWithEntries,
    draw: GiveawayDrawRecord,
  ): GiveawayDrawResult {
    const published = Boolean(snapshot.seedRevealedAt);
    const seed = published ? this.decryptGiveawayDrawSeed(snapshot) : new Uint8Array();
    return {
      drawId: draw.id,
      verification: this.buildGiveawayDrawVerification(giveaway, snapshot, draw, seed, published),
    };
  }

  private calculateGiveawayConfigDigest(giveaway: GiveawayConfiguration, mechanicsVersionId: string) {
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
            conditions: group.conditions.map((condition) => condition.config),
          })),
          prizePools: giveaway.prizePools.map((pool) => ({
            id: pool.id,
            position: pool.position,
            awardMode: pool.awardMode,
            inventoryKind: pool.inventoryLimit === null ? "unlimited" : "finite",
            inventoryLimit: pool.inventoryLimit,
            perRiderLimit: pool.maxWinsPerRider,
            eligibilityGroupIds: pool.eligibilityGroups.map((link) => link.eligibilityGroupId),
            itemIds: pool.prizeItems.map((item) => item.id),
          })),
        }),
      )
      .digest("hex");
  }

  private calculateGiveawayRankSourceDigest(input: {
    entryId: string;
    opaquePublicReference: string;
    frozenWeight: number;
    eligibilityCycleAt: Date;
    qualifiedSourceFingerprint: string;
    qualifiedEligibilityGroupIds: string[];
    qualifiedEligibilityGroupTimings: GiveawayEligibilityGroupTiming[];
  }) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          entryId: input.entryId,
          opaquePublicReference: input.opaquePublicReference,
          eligibilityCycleAt: input.eligibilityCycleAt.toISOString(),
          qualifiedSourceFingerprint: input.qualifiedSourceFingerprint,
          qualifiedGroupIds: input.qualifiedEligibilityGroupIds,
          qualifiedEligibilityGroupTimings: input.qualifiedEligibilityGroupTimings,
          weight: input.frozenWeight,
        }),
      )
      .digest("hex");
  }

  private calculateGiveawaySnapshotDigest(
    giveawayId: string,
    mechanicsVersionId: string,
    configDigest: string,
    entries: Array<{
      entryId: string;
      opaquePublicReference: string;
      frozenWeight: number;
      eligibilityCycleAt: Date;
      qualifiedSourceFingerprint: string;
      qualifiedEligibilityGroupIds: string[];
      qualifiedEligibilityGroupTimings: GiveawayEligibilityGroupTiming[];
      rankSourceDigest: string;
    }>,
  ) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          giveawayId,
          mechanicsVersionId,
          configDigest,
          entries: entries.map((entry) => ({
            entryId: entry.entryId,
            opaquePublicReference: entry.opaquePublicReference,
            frozenWeight: entry.frozenWeight,
            eligibilityCycleAt: entry.eligibilityCycleAt.toISOString(),
            qualifiedSourceFingerprint: entry.qualifiedSourceFingerprint,
            qualifiedGroupIds: entry.qualifiedEligibilityGroupIds,
            qualifiedEligibilityGroupTimings: entry.qualifiedEligibilityGroupTimings,
            rankSourceDigest: entry.rankSourceDigest,
          })),
        }),
      )
      .digest("hex");
  }

  private calculateGiveawayDrawInputDigest(
    giveaway: GiveawayConfiguration,
    snapshot: Pick<GiveawaySnapshotWithEntries, "snapshotDigest">,
    algorithmVersion: string,
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
          predecessorAwardId: actionInput.predecessorAwardId ?? null,
          prizePools: giveaway.prizePools.map((pool) => ({
            id: pool.id,
            awardMode: pool.awardMode,
            itemIds: pool.prizeItems.map((item) => item.id),
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

  private calculateGiveawayDrawResultDigest(
    giveawayId: string,
    draw: Pick<GiveawayDrawRecord, "id" | "snapshotId" | "algorithmVersion">,
    awards: Array<{
      prizePoolId: string;
      prizeItemId: string | null;
      snapshotEntryId: string | null;
      rank: number | null;
      predecessorAwardId: string | null;
    }>,
  ) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          giveawayId,
          drawId: draw.id,
          snapshotId: draw.snapshotId,
          algorithmVersion: draw.algorithmVersion,
          awards,
        }),
      )
      .digest("hex");
  }

  private async requireGiveawayRider(sessionToken: string) {
    const rider = await this.requireUser(sessionToken);
    if (rider.role !== "rider") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }
    return rider;
  }

  private requireGiveawayEntryMode(
    giveaway: Pick<GiveawayConfiguration, "status" | "entryMode">,
    entryMode: "automatic" | "opt_in" | "claim_code" | "manual_only",
  ) {
    if (giveaway.status !== "open") {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_OPEN", "GIVEAWAY_ENTRY_NOT_OPEN");
    }
    if (giveaway.entryMode !== entryMode) {
      throw new BackendError("GIVEAWAY_ENTRY_MODE_INVALID", "GIVEAWAY_ENTRY_MODE_INVALID");
    }
  }

  private assertGiveawayTransition(
    giveaway: Pick<GiveawayConfiguration, "status" | "complianceStatus">,
    next: GiveawayState,
  ) {
    try {
      assertGiveawayLifecycleTransition(
        giveaway.status as GiveawayState,
        next,
        giveaway.complianceStatus as never,
      );
    } catch {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
  }

  private async lockGiveawayEvent(tx: Prisma.TransactionClient, eventId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: {
        organizer: { select: { userId: true } },
        perks: true,
      },
    });
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    return event;
  }

  private async lockGiveawayPerk(
    tx: Prisma.TransactionClient,
    eventId: string,
    perkId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Perk" WHERE "id" = ${perkId} AND "eventId" = ${eventId} FOR UPDATE`,
    );
    if (rows.length === 0) return null;
    return tx.perk.findUnique({ where: { id: perkId } });
  }

  private async lockGiveawayCampaign(
    tx: Prisma.TransactionClient,
    giveawayId: string,
  ): Promise<GiveawayConfiguration> {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "EventGiveaway" WHERE "id" = ${giveawayId} FOR UPDATE`,
    );
    const giveaway = await tx.eventGiveaway.findUnique({
      where: { id: giveawayId },
      include: giveawayConfigurationInclude,
    });
    if (!giveaway) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    return giveaway;
  }

  private async requireGiveawayCampaign(giveawayId: string): Promise<GiveawayConfiguration> {
    const giveaway = await this.prisma.eventGiveaway.findUnique({
      where: { id: giveawayId },
      include: giveawayConfigurationInclude,
    });
    if (!giveaway) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    return giveaway;
  }

  private async lockGiveawayCampaignCode(
    tx: Prisma.TransactionClient,
    giveawayId: string,
    tokenHash: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "GiveawayCampaignCode" WHERE "giveawayId" = ${giveawayId} AND "tokenHash" = ${tokenHash} FOR UPDATE`,
    );
    if (rows.length === 0) return null;
    return tx.giveawayCampaignCode.findUnique({ where: { id: rows[0].id } });
  }

  private async lockGiveawayEntry(
    tx: Prisma.TransactionClient,
    giveawayId: string,
    riderId: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "GiveawayEntry" WHERE "giveawayId" = ${giveawayId} AND "riderId" = ${riderId} FOR UPDATE`,
    );
    return tx.giveawayEntry.findUnique({
      where: { giveawayId_riderId: { giveawayId, riderId } },
    });
  }

  private async lockGiveawayEntries(tx: Prisma.TransactionClient, giveawayId: string) {
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "GiveawayEntry"
        WHERE "giveawayId" = ${giveawayId}
        ORDER BY "id" ASC
        FOR UPDATE
      `,
    );
    return tx.giveawayEntry.findMany({
      where: { giveawayId },
      orderBy: [{ opaquePublicReference: "asc" }, { id: "asc" }],
    });
  }

  private async lockGiveawayPrizeItem(tx: Prisma.TransactionClient, prizeItemId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "GiveawayPrizeItem" WHERE "id" = ${prizeItemId} FOR UPDATE`,
    );
    if (rows.length === 0) return null;
    return tx.giveawayPrizeItem.findUnique({ where: { id: prizeItemId } });
  }

  private async lockGiveawayAward(tx: Prisma.TransactionClient, awardId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "GiveawayAward" WHERE "id" = ${awardId} FOR UPDATE`,
    );
    if (rows.length === 0) return null;
    return tx.giveawayAward.findUnique({ where: { id: awardId } });
  }

  private isDirectGiveawayAward(award: Pick<GiveawayAwardRecord, "drawId" | "snapshotEntryId">) {
    return !award.drawId && !award.snapshotEntryId;
  }

  private shouldReallocateFinalizedDirectAward(giveaway: GiveawayConfiguration) {
    return ["open", "locked", "drawing", "claims_open"].includes(giveaway.status);
  }

  /**
   * A direct award must lock its candidate entries before pool/item/award work,
   * because finalization can immediately fill the freed capacity from either
   * open entries or the locked snapshot.
   */
  private async lockDirectGiveawayAwardForFinalization(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    awardId: string,
  ): Promise<DirectGiveawayAwardFinalizationLock | null> {
    const preview = await tx.giveawayAward.findUnique({ where: { id: awardId } });
    if (!preview || !this.isDirectGiveawayAward(preview)) return null;

    const lockedEntries = this.shouldReallocateFinalizedDirectAward(giveaway)
      ? await this.lockGiveawayEntries(tx, giveaway.id)
      : undefined;
    if (lockedEntries && ["locked", "drawing", "claims_open"].includes(giveaway.status)) {
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      this.assertFrozenDirectEntryProvenance(snapshot, lockedEntries);
    }
    const pool = giveaway.prizePools.find((candidate) => candidate.id === preview.prizePoolId);
    if (!pool) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    await this.lockGiveawayPrizePool(tx, pool.id);
    if (preview.prizeItemId) {
      const prizeItem = await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      if (!prizeItem || prizeItem.prizePoolId !== pool.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
    }
    const award = await this.lockGiveawayAward(tx, awardId);
    return award && this.isDirectGiveawayAward(award) ? { award, lockedEntries } : null;
  }

  /**
   * Keep the immutable direct allocation key on the historical record. That
   * proof prevents the same entry from receiving the same immediate award when
   * the available inventory and winner caps are reconciled.
   */
  private async finalizeDirectGiveawayAward(
    tx: Prisma.TransactionClient,
    award: GiveawayAwardRecord,
    status: "declined" | "voided" | "disqualified",
    reasonDigest: string,
  ) {
    if (!this.isDirectGiveawayAward(award)) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    if (award.prizeItemId) {
      await tx.giveawayPrizeItem.updateMany({
        where: { id: award.prizeItemId, status: "reserved" },
        data: { status: "available" },
      });
    }
    return tx.giveawayAward.update({
      where: { id: award.id },
      data: { isCurrent: false, status, reasonDigest },
    });
  }

  private async reallocateFinalizedDirectGiveawayAward(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    lockedEntries: GiveawayEntryWrite["entry"][] | undefined,
  ) {
    if (giveaway.status === "open") {
      await this.reallocateImmediateGiveawayAwards(tx, giveaway);
      return;
    }
    if (["locked", "drawing", "claims_open"].includes(giveaway.status)) {
      if (!lockedEntries) throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      await this.reallocateFrozenImmediateGiveawayAwards(tx, giveaway, snapshot, lockedEntries);
    }
  }

  private async requireGiveawaySnapshot(
    tx: Prisma.TransactionClient,
    giveawayId: string,
  ): Promise<GiveawaySnapshotWithEntries> {
    const snapshot = await tx.giveawaySnapshot.findUnique({
      where: { giveawayId },
      include: giveawaySnapshotInclude,
    });
    if (!snapshot) throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    return snapshot;
  }

  /**
   * Direct replacement after lock is fail-closed: an entry row may establish
   * stable identity only when its persisted provenance still exactly matches
   * the immutable snapshot. riderId is protected by the scope-immutability
   * trigger; snapshot rows deliberately retain the opaque entry reference.
   */
  private assertFrozenDirectEntryProvenance(
    snapshot: GiveawaySnapshotWithEntries,
    lockedEntries: GiveawayEntryWrite["entry"][],
  ) {
    const lockedEntriesById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
    for (const snapshotEntry of snapshot.entries) {
      const entry = lockedEntriesById.get(snapshotEntry.entryId);
      if (
        !entry ||
        entry.status !== "locked" ||
        entry.currentWeight !== snapshotEntry.frozenWeight ||
        entry.eligibilityCycleAt.getTime() !== snapshotEntry.eligibilityCycleAt.getTime() ||
        entry.qualifiedSourceFingerprint !== snapshotEntry.qualifiedSourceFingerprint ||
        canonicalizeJson(entry.qualifiedEligibilityGroupIds) !==
          canonicalizeJson(snapshotEntry.qualifiedEligibilityGroupIds) ||
        canonicalizeJson(entry.qualifiedEligibilityGroupTimings) !==
          canonicalizeJson(snapshotEntry.qualifiedEligibilityGroupTimings)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
    }
  }

  private async nextGiveawayDrawSequence(tx: Prisma.TransactionClient, giveawayId: string) {
    const previous = await tx.giveawayDraw.findFirst({
      where: { giveawayId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    return (previous?.sequence ?? 0) + 1;
  }

  private assertGiveawayEligibilityPerks(
    event: { perks: Array<{ id: string }> },
    groups: CreateGiveawayInput["eligibilityGroups"],
  ) {
    const perkIds = new Set(event.perks.map((perk) => perk.id));
    for (const group of groups) {
      for (const condition of group.conditions) {
        if (condition.source === "perk_redemption" && !perkIds.has(condition.perkId)) {
          throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
        }
      }
    }
  }

  private async replaceGiveawayConfiguration(
    tx: Prisma.TransactionClient,
    giveawayId: string,
    groups: CreateGiveawayInput["eligibilityGroups"],
    pools: CreateGiveawayInput["prizePools"],
    defaultPresenceVerificationRequired: boolean,
  ) {
    await tx.giveawayPrizePoolEligibilityGroup.deleteMany({
      where: { prizePool: { giveawayId } },
    });
    await tx.giveawayPrizeItem.deleteMany({ where: { prizePool: { giveawayId } } });
    await tx.giveawayPrizePool.deleteMany({ where: { giveawayId } });
    await tx.giveawayEligibilityCondition.deleteMany({ where: { group: { giveawayId } } });
    await tx.giveawayEligibilityGroup.deleteMany({ where: { giveawayId } });

    const groupIdByRequestId = new Map<string, string>();
    for (const [position, group] of groups.entries()) {
      const id = `giveaway-eligibility-group-${randomUUID()}`;
      groupIdByRequestId.set(group.id, id);
      await tx.giveawayEligibilityGroup.create({
        data: {
          id,
          giveawayId,
          position,
          label: group.label,
          entryWeight: group.weight,
          conditions: {
            create: group.conditions.map((condition) => ({
              id: `giveaway-eligibility-condition-${randomUUID()}`,
              source: condition.source as never,
              perkId: condition.source === "perk_redemption" ? condition.perkId : null,
              config: this.toJsonValue(condition),
            })),
          },
        },
      });
    }

    for (const [position, pool] of pools.entries()) {
      const id = `giveaway-prize-pool-${randomUUID()}`;
      const eligibilityGroupIds = (pool.eligibilityGroupIds ?? []).map((requestId) => {
        const persistedId = groupIdByRequestId.get(requestId);
        if (!persistedId) {
          throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
        }
        return persistedId;
      });
      await tx.giveawayPrizePool.create({
        data: {
          id,
          giveawayId,
          position,
          title: pool.title,
          awardMode: pool.awardMode as never,
          fulfillmentType: pool.fulfilmentMode as never,
          inventoryLimit: pool.inventory.kind === "finite" ? pool.inventory.quantity : null,
          maxWinsPerRider: pool.perRiderLimit ?? 1,
          presenceVerificationRequired:
            pool.presenceVerificationRequired ?? defaultPresenceVerificationRequired,
          prizeItems: {
            create: pool.items.map((item, itemPosition) => ({
              id: `giveaway-prize-item-${randomUUID()}`,
              position: itemPosition,
              title: item.title,
              description: item.description ?? null,
            })),
          },
          eligibilityGroups: {
            create: eligibilityGroupIds.map((eligibilityGroupId) => ({
              id: `giveaway-prize-pool-eligibility-${randomUUID()}`,
              eligibilityGroupId,
            })),
          },
        },
      });
    }
  }

  private currentGiveawayMechanics(giveaway: GiveawayConfiguration) {
    const mechanics = giveaway.mechanicsVersions[0];
    if (!mechanics) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    return mechanics;
  }

  private toGiveawayCampaignView(giveaway: GiveawayConfiguration): GiveawayCampaignView {
    return {
      id: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      state: giveaway.status as GiveawayState,
      complianceStatus: giveaway.complianceStatus as GiveawayCampaignView["complianceStatus"],
      mechanicsVersion: this.currentGiveawayMechanics(giveaway).version,
    };
  }

  private toPublicGiveaway(giveaway: GiveawayConfiguration): PublicGiveawayCampaignSummary {
    const mechanics = this.currentGiveawayMechanics(giveaway);
    const prizePools = giveaway.prizePools.map<PublicGiveawayPrizePoolSummary>((pool) => ({
      id: pool.id,
      title: pool.title,
      awardMode: pool.awardMode as PublicGiveawayPrizePoolSummary["awardMode"],
      fulfilmentMode: pool.fulfillmentType as GiveawayFulfilmentMode,
      inventoryKind: pool.inventoryLimit === null ? "unlimited" : "finite",
      itemQuantity: pool.inventoryLimit === null ? undefined : pool.prizeItems.length,
      items: pool.prizeItems.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description ?? undefined,
      })),
      presenceVerificationRequired: pool.presenceVerificationRequired,
    }));
    return {
      id: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      kind: giveaway.kind as PublicGiveawayCampaignSummary["kind"],
      state: giveaway.status as GiveawayState,
      complianceStatus: giveaway.complianceStatus as PublicGiveawayCampaignSummary["complianceStatus"],
      entryMode: giveaway.entryMode as PublicGiveawayCampaignSummary["entryMode"],
      mechanics: mechanics.mechanics,
      terms: mechanics.terms,
      timeZone: giveaway.timeZone,
      publicVisibility: giveaway.visibility as GiveawayPublicVisibility,
      sponsorDisclosure: mechanics.sponsorDisclosure ?? undefined,
      entryOpensAt: giveaway.entryOpensAt?.toISOString(),
      entryClosesAt: giveaway.entryClosesAt?.toISOString(),
      drawAt: giveaway.drawAt?.toISOString(),
      claimDeadlineAt: giveaway.claimDeadlineAt?.toISOString(),
      prizePools,
    };
  }

  private async toRiderGiveawayState(
    giveaway: GiveawayConfiguration,
    riderId: string,
    client: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<RiderGiveawayState> {
    const entry = await client.giveawayEntry.findUnique({
      where: { giveawayId_riderId: { giveawayId: giveaway.id, riderId } },
    });
    if (!entry || entry.status === "withdrawn") {
      return { giveawayId: giveaway.id, status: "not_eligible", entryCount: 0 };
    }
    if (entry.status === "disqualified") {
      return { giveawayId: giveaway.id, status: "disqualified", entryCount: 0 };
    }
    const award = await client.giveawayAward.findFirst({
      where: {
        giveawayId: giveaway.id,
        winnerUserId: riderId,
        isCurrent: true,
        status: { in: ["pending_verification", "claimable", "verified", "fulfilled"] },
      },
      include: { prizePool: true },
      orderBy: { createdAt: "desc" },
    });
    if (!award) {
      return { giveawayId: giveaway.id, status: "entered", entryCount: entry.currentWeight };
    }
    return {
      giveawayId: giveaway.id,
      status: award.status === "fulfilled" ? "fulfilled" : "selected",
      entryCount: entry.currentWeight,
      award: {
        awardId: award.id,
        prizePoolTitle: award.prizePool.title,
        status: award.status === "fulfilled" ? "fulfilled" : "selected",
        claimDeadlineAt: award.claimDeadlineAt?.toISOString(),
        fulfilmentMode: award.prizePool.fulfillmentType as GiveawayFulfilmentMode,
      },
    };
  }

  private async resolveGiveawayAwardByAdministrator(
    sessionToken: string,
    awardId: string,
    reason: unknown,
    status: "voided" | "disqualified",
  ): Promise<RiderGiveawayState> {
    const administrator = await this.requireRole(sessionToken, "admin");
    const normalizedReason = this.requireGiveawayReason(reason);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const directAwardLock = await this.lockDirectGiveawayAwardForFinalization(tx, giveaway, awardId);
      const directAward = directAwardLock?.award;
      const award = directAward ?? (await this.lockGiveawayAward(tx, awardId));
      if (
        !award ||
        award.giveawayId !== giveaway.id ||
        !award.isCurrent ||
        (!this.isDirectGiveawayAward(award) && !(award.drawId && award.snapshotEntryId)) ||
        !["pending_verification", "claimable", "verified"].includes(award.status)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const reasonDigest = this.hashGiveawayReason(normalizedReason);
      if (directAward) {
        await this.finalizeDirectGiveawayAward(tx, award, status, reasonDigest);
      } else {
        await tx.giveawayAward.update({
          where: { id: award.id },
          data: { status, reasonDigest },
        });
      }
      await this.auditGiveaway(
        tx,
        giveaway.id,
        administrator.id,
        status === "voided" ? "GIVEAWAY_AWARD_VOIDED" : "GIVEAWAY_AWARD_DISQUALIFIED",
        "award",
        award.id,
        {
          awardId: award.id,
          drawId: award.drawId,
          status,
          reasonDigest,
          directAward: Boolean(directAward),
        },
      );
      if (directAward) {
        await this.reallocateFinalizedDirectGiveawayAward(
          tx,
          giveaway,
          directAwardLock?.lockedEntries,
        );
      }
      return this.toRiderGiveawayState(giveaway, award.winnerUserId, tx);
    });
  }

  private calculateMechanicsChecksum(mechanics: string, terms: string, sponsorDisclosure?: string | null) {
    return createHash("sha256")
      .update(
        canonicalizeJson({
          mechanics,
          terms,
          sponsorDisclosure: sponsorDisclosure ?? null,
        }),
      )
      .digest("hex");
  }

  private hashGiveawayReason(reason: string) {
    return createHash("sha256").update(reason.trim()).digest("hex");
  }

  private toOptionalDate(value: string | null | undefined) {
    return value === undefined || value === null ? null : new Date(value);
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(canonicalizeJson(value)) as Prisma.InputJsonValue;
  }

  private async evaluateGiveawayEntryQualification(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    riderId: string,
    context: { campaignCode?: boolean; manual?: boolean; actionAt?: Date } = {},
  ): Promise<GiveawayQualification> {
    const qualifiedGroups: GiveawayQualification["qualifiedGroups"] = [];
    for (const group of giveaway.eligibilityGroups) {
      if (!group.enabled) continue;
      const facts: Record<string, unknown>[] = [];
      let qualified = true;
      for (const condition of group.conditions) {
        const evaluation = await this.evaluateGiveawayCondition(
          tx,
          giveaway.eventId,
          riderId,
          {
            source: condition.source as GiveawayEligibilityConditionInput["source"],
            ...(condition.source === "perk_redemption" && condition.perkId
              ? { perkId: condition.perkId }
              : {}),
          } as GiveawayEligibilityConditionInput,
          context,
        );
        facts.push(evaluation.sourceFact);
        if (!evaluation.satisfied) qualified = false;
      }
      const derivedEligibleAt = latestGiveawayEligibilityTimestamp(
        facts.map((fact) => (typeof fact.eligibleAt === "string" ? fact.eligibleAt : undefined)),
      );
      if (qualified && derivedEligibleAt) {
        qualifiedGroups.push({
          id: group.id,
          position: group.position,
          weight: group.entryWeight,
          facts,
          derivedEligibleAt,
        });
      }
    }
    const weight = Math.min(
      qualifiedGroups.reduce((total, group) => total + group.weight, 0),
      giveaway.maxEntriesPerRider,
    );
    const sourceFacts = qualifiedGroups.map((group) => ({
      groupId: group.id,
      conditions: group.facts,
    }));
    return {
      qualifiedGroupIds: qualifiedGroups.map((group) => group.id),
      qualifiedGroups,
      weight,
      sourceFacts,
      sourceFingerprint: createHash("sha256")
        .update(canonicalizeJson({ qualifiedGroups: sourceFacts }))
        .digest("hex"),
    };
  }

  private async evaluateGiveawayCondition(
    tx: Prisma.TransactionClient,
    eventId: string,
    riderId: string,
    condition: GiveawayEligibilityConditionInput,
    context: { campaignCode?: boolean; manual?: boolean; actionAt?: Date },
  ): Promise<{ satisfied: boolean; eligibleAt?: string; sourceFact: Record<string, unknown> }> {
    switch (condition.source) {
      case "active_rsvp_pass": {
        const [rsvp, pass] = await Promise.all([
          tx.rSVP.findUnique({
            where: { eventId_userId: { eventId, userId: riderId } },
            select: { status: true, attendanceType: true, goingAt: true },
          }),
          tx.pass.findFirst({ where: { eventId, userId: riderId }, orderBy: { generatedAt: "asc" } }),
        ]);
        const satisfied = rsvp?.status === "going" && Boolean(pass && pass.status !== "cancelled");
        const eligibleAt = satisfied
          ? latestGiveawayEligibilityTimestamp([
              rsvp?.goingAt?.toISOString(),
              pass?.generatedAt.toISOString(),
            ])
          : null;
        return {
          satisfied,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            rsvpStatus: rsvp?.status ?? null,
            attendanceType: rsvp?.attendanceType ?? null,
            rsvpGoingAt: rsvp?.goingAt?.toISOString() ?? null,
            passId: pass?.id ?? null,
            passStatus: pass?.status ?? null,
            passGeneratedAt: pass?.generatedAt.toISOString() ?? null,
            eligibleAt,
          },
        };
      }
      case "confirmed_check_in": {
        const checkIns = await tx.checkIn.findMany({
          where: { eventId, userId: riderId, status: "confirmed" },
          select: { id: true, method: true, confirmationMethod: true, confirmedAt: true, timestamp: true },
          orderBy: [{ confirmedAt: "asc" }, { timestamp: "asc" }, { id: "asc" }],
        });
        const eligibleAt = earliestGiveawayEligibilityTimestamp(
          checkIns.map((checkIn) => (checkIn.confirmedAt ?? checkIn.timestamp).toISOString()),
        );
        return {
          satisfied: checkIns.length > 0,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            confirmedCheckIns: checkIns.map((checkIn) => ({
              id: checkIn.id,
              method: checkIn.method,
              confirmationMethod: checkIn.confirmationMethod ?? null,
              confirmedAt: checkIn.confirmedAt?.toISOString() ?? null,
              timestamp: checkIn.timestamp.toISOString(),
            })),
            eligibleAt,
          },
        };
      }
      case "staff_confirmed_check_in": {
        const checkIns = await tx.checkIn.findMany({
          where: { eventId, userId: riderId, status: "confirmed" },
          select: { id: true, method: true, confirmationMethod: true, confirmedAt: true, timestamp: true },
          orderBy: [{ confirmedAt: "asc" }, { timestamp: "asc" }, { id: "asc" }],
        });
        const staffCheckIns = checkIns.filter(
          (checkIn) =>
            this.isStaffCheckInMethod(checkIn.method) ||
            (checkIn.method === "rider_qr" &&
              checkIn.confirmationMethod !== null &&
              this.isStaffCheckInMethod(checkIn.confirmationMethod)),
        );
        const eligibleAt = earliestGiveawayEligibilityTimestamp(
          staffCheckIns.map((checkIn) => (checkIn.confirmedAt ?? checkIn.timestamp).toISOString()),
        );
        return {
          satisfied: staffCheckIns.length > 0,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            staffConfirmedCheckIns: staffCheckIns.map((checkIn) => ({
              id: checkIn.id,
              method: checkIn.method,
              confirmationMethod: checkIn.confirmationMethod ?? null,
              confirmedAt: checkIn.confirmedAt?.toISOString() ?? null,
              timestamp: checkIn.timestamp.toISOString(),
            })),
            eligibleAt,
          },
        };
      }
      case "perk_redemption": {
        const redemptions = await tx.perkRedemption.findMany({
          where: {
            perkId: condition.perkId,
            userId: riderId,
            status: "redeemed",
            redeemedAt: { not: null },
          },
          select: { id: true, redeemedAt: true },
          orderBy: [{ redeemedAt: "asc" }, { id: "asc" }],
        });
        const eligibleAt = earliestGiveawayEligibilityTimestamp(
          redemptions.map((redemption) => redemption.redeemedAt?.toISOString()),
        );
        return {
          satisfied: redemptions.length > 0,
          eligibleAt: eligibleAt ?? undefined,
          sourceFact: {
            source: condition.source,
            perkId: condition.perkId,
            redemptions: redemptions.map((redemption) => ({
              id: redemption.id,
              redeemedAt: redemption.redeemedAt?.toISOString() ?? null,
            })),
            eligibleAt,
          },
        };
      }
      case "campaign_code":
        return {
          satisfied: Boolean(context.campaignCode),
          eligibleAt: context.campaignCode ? context.actionAt?.toISOString() : undefined,
          sourceFact: {
            source: condition.source,
            satisfiedBy: context.campaignCode ? "claim" : null,
            eligibleAt: context.campaignCode ? context.actionAt?.toISOString() ?? null : null,
          },
        };
      case "manual":
        return {
          satisfied: Boolean(context.manual),
          eligibleAt: context.manual ? context.actionAt?.toISOString() : undefined,
          sourceFact: {
            source: condition.source,
            eligibleAt: context.manual ? context.actionAt?.toISOString() ?? null : null,
          },
        };
    }
  }

  private isStaffCheckInMethod(method: string) {
    return ["staff_camera", "staff_upload", "staff_manual", "qr", "manual"].includes(method);
  }

  private async writeGiveawayEntry(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    riderId: string,
    qualification: GiveawayQualification,
    input: {
      entryPath: "automatic" | "opt_in" | "campaign_code" | "manual";
      entryEventType:
        | "automatic_qualified"
        | "opted_in"
        | "campaign_code_claimed"
        | "manual_grant"
        | "source_revalidated";
      actorUserId?: string;
      mechanicsAcknowledgement?: { id: string; version: number; checksum: string };
      campaignCodeId?: string;
      manualGrantActive?: boolean;
      reasonDigest?: string;
      actionAt?: Date;
    },
  ): Promise<GiveawayEntryWrite> {
    const existing = await tx.giveawayEntry.findUnique({
      where: { giveawayId_riderId: { giveawayId: giveaway.id, riderId } },
    });
    const timing = reconcileGiveawayEligibilityTimings({
      previousTimings: existing ? this.entryQualifiedGroupTimings(existing) : [],
      qualifiedGroups: qualification.qualifiedGroups.map((group) => ({
        groupId: group.id,
        position: group.position,
        derivedEligibleAt: group.derivedEligibleAt,
      })),
      actionAt: input.actionAt?.toISOString(),
    });
    if (!timing.eligibilityCycleAt) {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    }
    assertGiveawayEligibilityTimingIntegrity(
      qualification.qualifiedGroupIds,
      timing.qualifiedEligibilityGroupTimings,
    );
    const acknowledgement = input.mechanicsAcknowledgement;
    const data = {
      status: "eligible" as const,
      entryPath: input.entryPath as never,
      currentWeight: qualification.weight,
      eligibilityCycleAt: new Date(timing.eligibilityCycleAt),
      qualifiedSourceFingerprint: qualification.sourceFingerprint,
      qualifiedEligibilityGroupIds: this.toJsonValue(qualification.qualifiedGroupIds),
      qualifiedEligibilityGroupTimings: this.toJsonValue(timing.qualifiedEligibilityGroupTimings),
      manualGrantActive: input.entryPath === "manual" && Boolean(input.manualGrantActive),
      acknowledgedMechanicsVersionId: acknowledgement?.id ?? null,
      acknowledgedMechanicsChecksum: acknowledgement?.checksum ?? null,
      acknowledgedMechanicsAt: acknowledgement ? new Date() : null,
    };
    const entry = existing
      ? await tx.giveawayEntry.update({ where: { id: existing.id }, data })
      : await tx.giveawayEntry.create({
          data: {
            id: `giveaway-entry-${randomUUID()}`,
            giveawayId: giveaway.id,
            riderId,
            opaquePublicReference: `entry_${randomBytes(16).toString("base64url")}`,
            ...data,
          },
        });
    const weightDelta = calculateGiveawayEntryWeightDelta(existing, qualification.weight);
    const entryEvent = await tx.giveawayEntryEvent.create({
      data: {
        id: `giveaway-entry-event-${randomUUID()}`,
        giveawayId: giveaway.id,
        entryId: entry.id,
        type: input.entryEventType as never,
        sourceKey: `${input.entryPath}:${giveaway.id}:${entry.id}:${randomUUID()}`,
        sourceSnapshot: this.toJsonValue({
          qualifiedGroupIds: qualification.qualifiedGroupIds,
          qualifiedEligibilityGroupTimings: timing.qualifiedEligibilityGroupTimings,
          eligibilityCycleAt: timing.eligibilityCycleAt,
          sourceFingerprint: qualification.sourceFingerprint,
          sourceFacts: qualification.sourceFacts,
          ...(acknowledgement
            ? {
                mechanicsVersion: acknowledgement.version,
                mechanicsChecksum: acknowledgement.checksum,
              }
            : {}),
          ...(input.campaignCodeId ? { campaignCodeId: input.campaignCodeId } : {}),
          ...(input.reasonDigest ? { reasonDigest: input.reasonDigest } : {}),
        }),
        weightDelta,
        actorUserId: input.actorUserId ?? null,
        idempotencyKey: `${input.entryPath}:${giveaway.id}:${entry.id}:${randomUUID()}`,
      },
    });
    return { entry, entryEventId: entryEvent.id };
  }

  private entryQualifiedGroupIds(entry: { qualifiedEligibilityGroupIds: Prisma.JsonValue }) {
    if (!Array.isArray(entry.qualifiedEligibilityGroupIds)) return [];
    return entry.qualifiedEligibilityGroupIds.filter(
      (value): value is string => typeof value === "string",
    );
  }

  private entryQualifiedGroupTimings(entry: {
    qualifiedEligibilityGroupIds: Prisma.JsonValue;
    qualifiedEligibilityGroupTimings: Prisma.JsonValue;
  }): GiveawayEligibilityGroupTiming[] {
    if (!Array.isArray(entry.qualifiedEligibilityGroupTimings)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    const timings = entry.qualifiedEligibilityGroupTimings.flatMap((value) => {
      const timing = value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
      if (
        !timing ||
        typeof timing.groupId !== "string" ||
        typeof timing.eligibleAt !== "string"
      ) {
        return [];
      }
      return [{ groupId: timing.groupId, eligibleAt: timing.eligibleAt }];
    });
    if (timings.length !== entry.qualifiedEligibilityGroupTimings.length) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    try {
      assertGiveawayEligibilityTimingIntegrity(this.entryQualifiedGroupIds(entry), timings);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return timings;
  }

  private isGiveawayEntryEligibleForPool(
    entry: { qualifiedEligibilityGroupIds: Prisma.JsonValue },
    pool: GiveawayConfiguration["prizePools"][number],
  ) {
    const allowedGroupIds = pool.eligibilityGroups.map((link) => link.eligibilityGroupId);
    return (
      allowedGroupIds.length === 0 ||
      allowedGroupIds.some((groupId) => this.entryQualifiedGroupIds(entry).includes(groupId))
    );
  }

  private isSnapshotEntryEligibleForPool(
    entry: GiveawaySnapshotWithEntries["entries"][number],
    pool: GiveawayConfiguration["prizePools"][number],
  ) {
    const allowedGroupIds = pool.eligibilityGroups.map((link) => link.eligibilityGroupId);
    const qualifiedGroupIds = this.entryQualifiedGroupIds(entry);
    return (
      allowedGroupIds.length === 0 ||
      allowedGroupIds.some((groupId) => qualifiedGroupIds.includes(groupId))
    );
  }

  private async canCreateDrawGiveawayAward(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    pool: GiveawayConfiguration["prizePools"][number],
    riderId: string,
    predecessorAwardIdForTotal?: string,
  ) {
    const currentAwardWhere = {
      giveawayId: giveaway.id,
      isCurrent: true,
    };
    const currentAwardTotalWhere = {
      ...currentAwardWhere,
      ...(predecessorAwardIdForTotal ? { id: { not: predecessorAwardIdForTotal } } : {}),
    };
    const [totalAwards, riderAwards, poolAwards] = await Promise.all([
      tx.giveawayAward.count({ where: currentAwardTotalWhere }),
      tx.giveawayAward.count({ where: { ...currentAwardWhere, winnerUserId: riderId } }),
      tx.giveawayAward.count({
        where: { ...currentAwardWhere, prizePoolId: pool.id, winnerUserId: riderId },
      }),
    ]);
    return (
      totalAwards < giveaway.maxWinsTotal &&
      riderAwards < giveaway.maxWinsPerRider &&
      poolAwards < pool.maxWinsPerRider
    );
  }

  private async createDrawGiveawayAward(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    pool: GiveawayConfiguration["prizePools"][number],
    input: {
      entry: GiveawayEntryWrite["entry"];
      draw: GiveawayDrawRecord;
      snapshotEntry: GiveawaySnapshotWithEntries["entries"][number];
      prizeItemId: string;
      rank: number;
      predecessorAwardId?: string;
      reservePrizeItem: boolean;
    },
  ) {
    if (input.reservePrizeItem) {
      const reservation = await tx.giveawayPrizeItem.updateMany({
        where: { id: input.prizeItemId, prizePoolId: pool.id, status: "available" },
        data: { status: "reserved" },
      });
      if (reservation.count !== 1) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
    }
    return tx.giveawayAward.create({
      data: {
        id: `giveaway-award-${randomUUID()}`,
        giveawayId: giveaway.id,
        entryId: input.entry.id,
        drawId: input.draw.id,
        prizePoolId: pool.id,
        prizeItemId: input.prizeItemId,
        snapshotEntryId: input.snapshotEntry.id,
        winnerUserId: input.entry.riderId,
        status: pool.presenceVerificationRequired ? "pending_verification" : "claimable",
        isCurrent: true,
        rank: input.rank,
        opaqueClaimReference: `claim_${randomBytes(16).toString("base64url")}`,
        claimDeadlineAt: giveaway.claimDeadlineAt,
        predecessorAwardId: input.predecessorAwardId ?? null,
      },
    });
  }

  private async canCreateDirectGiveawayAward(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    pool: GiveawayConfiguration["prizePools"][number],
    riderId: string,
  ) {
    const [totalAwards, riderAwards, poolAwards] = await Promise.all([
      tx.giveawayAward.count({ where: { giveawayId: giveaway.id, isCurrent: true } }),
      tx.giveawayAward.count({
        where: { giveawayId: giveaway.id, winnerUserId: riderId, isCurrent: true },
      }),
      tx.giveawayAward.count({
        where: { giveawayId: giveaway.id, prizePoolId: pool.id, winnerUserId: riderId, isCurrent: true },
      }),
    ]);
    return (
      totalAwards < giveaway.maxWinsTotal &&
      riderAwards < giveaway.maxWinsPerRider &&
      poolAwards < pool.maxWinsPerRider
    );
  }

  private async lockGiveawayPrizePool(tx: Prisma.TransactionClient, poolId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "GiveawayPrizePool" WHERE "id" = ${poolId} FOR UPDATE`,
    );
  }

  private async lockNextAvailablePrizeItem(tx: Prisma.TransactionClient, poolId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "GiveawayPrizeItem"
        WHERE "prizePoolId" = ${poolId} AND "status" = 'available'
        ORDER BY "position" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE
      `,
    );
    return rows[0]?.id;
  }

  private async allocateDirectGiveawayAwards(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
  ) {
    await this.reallocateImmediateGiveawayAwards(tx, giveaway);
  }

  private async allocateDirectGiveawayAwardForPool(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    pool: GiveawayConfiguration["prizePools"][number],
    entry: DirectGiveawayAllocationCandidate,
  ) {
    if (!this.isGiveawayEntryEligibleForPool(entry, pool)) return false;
    await this.lockGiveawayPrizePool(tx, pool.id);
    const allocationEligibilityAt = resolveGiveawayPoolEligibilityPriority({
      eligibilityCycleAt: entry.eligibilityCycleAt.toISOString(),
      qualifiedEligibilityGroupTimings: this.entryQualifiedGroupTimings(entry),
      permittedGroupIds: pool.eligibilityGroups.map((link) => link.eligibilityGroupId),
    });
    if (!allocationEligibilityAt) return false;
    const directAllocationKey = `direct:${entry.id}:${pool.id}:${allocationEligibilityAt}`;
    const existing = await tx.giveawayAward.findUnique({ where: { directAllocationKey } });
    if (existing) return true;
    const existingCurrentAward = await tx.giveawayAward.findFirst({
      where: {
        giveawayId: giveaway.id,
        entryId: entry.id,
        prizePoolId: pool.id,
        drawId: null,
        isCurrent: true,
      },
      select: { id: true },
    });
    if (existingCurrentAward) return true;
    if (!(await this.canCreateDirectGiveawayAward(tx, giveaway, pool, entry.riderId))) return false;

    let prizeItemId: string | null = null;
    if (pool.awardMode === "first_come") {
      prizeItemId = await this.lockNextAvailablePrizeItem(tx, pool.id);
      if (!prizeItemId) return false;
      await tx.giveawayPrizeItem.update({
        where: { id: prizeItemId },
        data: { status: "reserved" },
      });
    }

    await tx.giveawayAward.create({
      data: {
        id: `giveaway-award-${randomUUID()}`,
        giveawayId: giveaway.id,
        entryId: entry.id,
        prizePoolId: pool.id,
        prizeItemId,
        winnerUserId: entry.riderId,
        status: pool.presenceVerificationRequired ? "pending_verification" : "claimable",
        isCurrent: true,
        directAllocationKey,
        allocationEligibilityAt: new Date(allocationEligibilityAt),
        opaqueClaimReference: `claim_${randomBytes(16).toString("base64url")}`,
        claimDeadlineAt: giveaway.claimDeadlineAt,
      },
    });
    return true;
  }

  private async voidDirectGiveawayAwards(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    entry: GiveawayEntryWrite["entry"],
    actorUserId: string | undefined,
    reason: string,
    shouldVoid: (pool: GiveawayConfiguration["prizePools"][number] | undefined) => boolean = () => true,
  ) {
    const awards = await tx.giveawayAward.findMany({
      where: {
        giveawayId: giveaway.id,
        entryId: entry.id,
        drawId: null,
        isCurrent: true,
        status: { in: ["pending_verification", "claimable", "verified"] },
      },
      orderBy: { createdAt: "asc" },
    });
    const affectedPoolIds = new Set<string>();
    for (const award of awards) {
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      if (!shouldVoid(pool)) continue;
      affectedPoolIds.add(award.prizePoolId);
      await this.lockGiveawayPrizePool(tx, award.prizePoolId);
      if (award.prizeItemId) {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "GiveawayPrizeItem" WHERE "id" = ${award.prizeItemId} FOR UPDATE`,
        );
        await tx.giveawayPrizeItem.updateMany({
          where: { id: award.prizeItemId, status: "reserved" },
          data: { status: "available" },
        });
      }
      const reasonDigest = this.hashGiveawayReason(reason);
      await tx.giveawayAward.update({
        where: { id: award.id },
        data: { isCurrent: false, status: "voided", reasonDigest },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        actorUserId,
        "GIVEAWAY_AWARD_VOIDED",
        "award",
        award.id,
        {
          awardId: award.id,
          entryId: entry.id,
          prizePoolId: award.prizePoolId,
          reasonDigest,
        },
      );
    }
    return affectedPoolIds;
  }

  private async voidIneligibleDirectGiveawayAwards(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    entry: GiveawayEntryWrite["entry"],
    actorUserId: string | undefined,
    reason: string,
  ) {
    return this.voidDirectGiveawayAwards(
      tx,
      giveaway,
      entry,
      actorUserId,
      reason,
      (pool) => !pool || !this.isGiveawayEntryEligibleForPool(entry, pool),
    );
  }

  /**
   * Lock-time reconciliation defers pool/item work until every entry row is
   * already locked. This preserves the campaign -> entry -> pool -> item ->
   * award ordering while still removing stale direct allocations before the
   * snapshot becomes immutable.
   */
  private async revalidateDirectGiveawayAwardsForLockedEntries(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    entries: GiveawayEntryWrite["entry"][],
  ) {
    for (const entry of entries) {
      if (entry.status === "eligible") {
        await this.voidIneligibleDirectGiveawayAwards(
          tx,
          giveaway,
          entry,
          undefined,
          "lock_pool_revalidation",
        );
      } else {
        await this.voidDirectGiveawayAwards(
          tx,
          giveaway,
          entry,
          undefined,
          "lock_revalidation",
        );
      }
    }
  }

  private async reallocateImmediateGiveawayAwards(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
  ) {
    // A void can free campaign-wide winner capacity, not only a finite item.
    // Re-evaluate all immediate pools, preserving valid current awards and
    // filling only the remaining inventory by pool-specific eligibility time.
    for (const pool of giveaway.prizePools) {
      if (pool.awardMode !== "first_come" && pool.awardMode !== "guaranteed") continue;
      const candidates = await tx.giveawayEntry.findMany({
        where: { giveawayId: giveaway.id, status: "eligible" },
        orderBy: [{ eligibilityCycleAt: "asc" }, { id: "asc" }],
      });
      const orderedCandidates = candidates
        .filter((candidate) => this.isGiveawayEntryEligibleForPool(candidate, pool))
        .sort((left, right) =>
          compareGiveawayEntriesByPoolPriority(
            {
              id: left.id,
              eligibilityCycleAt: left.eligibilityCycleAt.toISOString(),
              qualifiedEligibilityGroupTimings: this.entryQualifiedGroupTimings(left),
            },
            {
              id: right.id,
              eligibilityCycleAt: right.eligibilityCycleAt.toISOString(),
              qualifiedEligibilityGroupTimings: this.entryQualifiedGroupTimings(right),
            },
            pool.eligibilityGroups.map((link) => link.eligibilityGroupId),
          ),
        );
      for (const candidate of orderedCandidates) {
        if (!this.isGiveawayEntryEligibleForPool(candidate, pool)) continue;
        await this.allocateDirectGiveawayAwardForPool(tx, giveaway, pool, candidate);
      }
    }
  }

  /**
   * Post-lock direct replacement is intentionally based only on snapshot
   * timing/group facts. The locked entry row supplies the stable rider and
   * entry identity, never fresh eligibility facts.
   */
  private async reallocateFrozenImmediateGiveawayAwards(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    snapshot: GiveawaySnapshotWithEntries,
    lockedEntries: GiveawayEntryWrite["entry"][],
  ) {
    this.assertFrozenDirectEntryProvenance(snapshot, lockedEntries);
    const lockedEntriesById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
    const candidates = snapshot.entries.map((snapshotEntry) => {
      const entry = lockedEntriesById.get(snapshotEntry.entryId);
      if (!entry) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const allocationCandidate: DirectGiveawayAllocationCandidate = {
        id: snapshotEntry.entryId,
        riderId: entry.riderId,
        eligibilityCycleAt: snapshotEntry.eligibilityCycleAt,
        qualifiedEligibilityGroupIds: snapshotEntry.qualifiedEligibilityGroupIds,
        qualifiedEligibilityGroupTimings: snapshotEntry.qualifiedEligibilityGroupTimings,
      };
      return { allocationCandidate, snapshotEntry };
    });
    for (const pool of giveaway.prizePools) {
      if (pool.awardMode !== "first_come" && pool.awardMode !== "guaranteed") continue;
      const orderedCandidates = candidates
        .filter(({ snapshotEntry }) => this.isSnapshotEntryEligibleForPool(snapshotEntry, pool))
        .sort((left, right) =>
          compareGiveawayEntriesByPoolPriority(
            {
              id: left.snapshotEntry.entryId,
              eligibilityCycleAt: left.snapshotEntry.eligibilityCycleAt.toISOString(),
              qualifiedEligibilityGroupTimings: this.entryQualifiedGroupTimings(left.snapshotEntry),
            },
            {
              id: right.snapshotEntry.entryId,
              eligibilityCycleAt: right.snapshotEntry.eligibilityCycleAt.toISOString(),
              qualifiedEligibilityGroupTimings: this.entryQualifiedGroupTimings(right.snapshotEntry),
            },
            pool.eligibilityGroups.map((link) => link.eligibilityGroupId),
          ),
        );
      for (const { allocationCandidate } of orderedCandidates) {
        await this.allocateDirectGiveawayAwardForPool(tx, giveaway, pool, allocationCandidate);
      }
    }
  }

  /** Reconciles only open automatic campaigns while the source Event row is locked. */
  private async reconcileAutomaticGiveawayEligibility(
    tx: Prisma.TransactionClient,
    eventId: string,
    riderId?: string,
  ) {
    const campaignIds = await tx.eventGiveaway.findMany({
      where: { eventId, status: "open", entryMode: "automatic" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (campaignIds.length === 0) return;
    const riderIds = riderId ? [riderId] : await this.riderIdsWithGiveawayActivity(tx, eventId);
    for (const campaign of campaignIds) {
      const giveaway = await this.lockGiveawayCampaign(tx, campaign.id);
      if (giveaway.status !== "open" || giveaway.entryMode !== "automatic") continue;
      let reconciledAnyEntry = false;
      for (const candidateRiderId of riderIds) {
        reconciledAnyEntry =
          (await this.reconcileAutomaticGiveawayEntry(tx, giveaway, candidateRiderId)) ||
          reconciledAnyEntry;
      }
      if (reconciledAnyEntry) {
        await this.reallocateImmediateGiveawayAwards(tx, giveaway);
      }
    }
  }

  private async riderIdsWithGiveawayActivity(tx: Prisma.TransactionClient, eventId: string) {
    const [rsvps, passes, checkIns] = await Promise.all([
      tx.rSVP.findMany({ where: { eventId }, select: { userId: true } }),
      tx.pass.findMany({ where: { eventId }, select: { userId: true } }),
      tx.checkIn.findMany({ where: { eventId }, select: { userId: true } }),
    ]);
    return [...new Set([...rsvps, ...passes, ...checkIns].map((record) => record.userId))].sort();
  }

  private async reconcileGiveawayEntryForLock(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    riderId: string,
    options: { reconcileDirectAwards?: boolean } = {},
  ) {
    const reconcileDirectAwards = options.reconcileDirectAwards ?? true;
    const entry = await this.lockGiveawayEntry(tx, giveaway.id, riderId);
    if (!entry || (entry.entryPath === "manual" && !entry.manualGrantActive)) return false;
    const qualification = await this.evaluateGiveawayEntryQualification(tx, giveaway, riderId, {
      campaignCode: entry.entryPath === "campaign_code",
      manual: entry.entryPath === "manual" && entry.manualGrantActive,
      actionAt: entry.createdAt,
    });
    if (qualification.weight <= 0) {
      if (entry.status !== "eligible") return false;
      if (reconcileDirectAwards) {
        await this.voidDirectGiveawayAwards(tx, giveaway, entry, undefined, "lock_revalidation");
      }
      const withdrawn = await tx.giveawayEntry.update({
        where: { id: entry.id },
        data: {
          status: "withdrawn",
          qualifiedSourceFingerprint: qualification.sourceFingerprint,
          qualifiedEligibilityGroupIds: this.toJsonValue([]),
          qualifiedEligibilityGroupTimings: this.toJsonValue([]),
        },
      });
      await tx.giveawayEntryEvent.create({
        data: {
          id: `giveaway-entry-event-${randomUUID()}`,
          giveawayId: giveaway.id,
          entryId: withdrawn.id,
          type: "source_revalidated",
          sourceKey: `lock-revalidation:${giveaway.id}:${withdrawn.id}:${randomUUID()}`,
          sourceSnapshot: this.toJsonValue({
            qualifiedGroupIds: [],
            qualifiedEligibilityGroupTimings: [],
            eligibilityCycleAt: entry.eligibilityCycleAt.toISOString(),
            sourceFingerprint: qualification.sourceFingerprint,
          }),
          weightDelta: -entry.currentWeight,
          idempotencyKey: `lock-revalidation:${giveaway.id}:${withdrawn.id}:${randomUUID()}`,
        },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        undefined,
        "GIVEAWAY_ENTRY_RECONCILED",
        "entry",
        withdrawn.id,
        {
          entryId: withdrawn.id,
          type: "source_revalidated",
          weightDelta: -entry.currentWeight,
          sourceFingerprint: qualification.sourceFingerprint,
        },
      );
      return true;
    }

    const timing = reconcileGiveawayEligibilityTimings({
      previousTimings: this.entryQualifiedGroupTimings(entry),
      qualifiedGroups: qualification.qualifiedGroups.map((group) => ({
        groupId: group.id,
        position: group.position,
        derivedEligibleAt: group.derivedEligibleAt,
      })),
      actionAt: entry.entryPath === "automatic" ? undefined : entry.createdAt.toISOString(),
    });
    if (!timing.eligibilityCycleAt) {
      throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
    }
    assertGiveawayEligibilityTimingIntegrity(
      qualification.qualifiedGroupIds,
      timing.qualifiedEligibilityGroupTimings,
    );
    const sameGroups =
      this.entryQualifiedGroupIds(entry).length === qualification.qualifiedGroupIds.length &&
      this.entryQualifiedGroupIds(entry).every(
        (groupId, index) => groupId === qualification.qualifiedGroupIds[index],
      );
    const sameTiming =
      JSON.stringify(this.entryQualifiedGroupTimings(entry)) ===
      JSON.stringify(timing.qualifiedEligibilityGroupTimings);
    const status = entry.status === "withdrawn" && entry.entryPath !== "manual" ? "eligible" : entry.status;
    if (status !== "eligible") return false;
    const changed =
      entry.status !== status ||
      entry.currentWeight !== qualification.weight ||
      entry.qualifiedSourceFingerprint !== qualification.sourceFingerprint ||
      !sameGroups ||
      entry.eligibilityCycleAt.toISOString() !== timing.eligibilityCycleAt ||
      !sameTiming;
    const updated = changed
      ? await tx.giveawayEntry.update({
          where: { id: entry.id },
          data: {
            status,
            currentWeight: qualification.weight,
            eligibilityCycleAt: new Date(timing.eligibilityCycleAt),
            qualifiedSourceFingerprint: qualification.sourceFingerprint,
            qualifiedEligibilityGroupIds: this.toJsonValue(qualification.qualifiedGroupIds),
            qualifiedEligibilityGroupTimings: this.toJsonValue(
              timing.qualifiedEligibilityGroupTimings,
            ),
          },
        })
      : entry;
    const voidedPoolIds = reconcileDirectAwards
      ? await this.voidIneligibleDirectGiveawayAwards(
          tx,
          giveaway,
          updated,
          undefined,
          "lock_pool_revalidation",
        )
      : new Set<string>();
    if (changed) {
      await tx.giveawayEntryEvent.create({
        data: {
          id: `giveaway-entry-event-${randomUUID()}`,
          giveawayId: giveaway.id,
          entryId: updated.id,
          type: "source_revalidated",
          sourceKey: `lock-revalidation:${giveaway.id}:${updated.id}:${randomUUID()}`,
          sourceSnapshot: this.toJsonValue({
            qualifiedGroupIds: qualification.qualifiedGroupIds,
            qualifiedEligibilityGroupTimings: timing.qualifiedEligibilityGroupTimings,
            eligibilityCycleAt: timing.eligibilityCycleAt,
            sourceFingerprint: qualification.sourceFingerprint,
          }),
          weightDelta: qualification.weight - entry.currentWeight,
          idempotencyKey: `lock-revalidation:${giveaway.id}:${updated.id}:${randomUUID()}`,
        },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        undefined,
        "GIVEAWAY_ENTRY_RECONCILED",
        "entry",
        updated.id,
        {
          entryId: updated.id,
          type: "source_revalidated",
          weightDelta: qualification.weight - entry.currentWeight,
          sourceFingerprint: qualification.sourceFingerprint,
        },
      );
    }
    return changed || voidedPoolIds.size > 0;
  }

  private async reconcileAutomaticGiveawayEntry(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    riderId: string,
    options: { reconcileDirectAwards?: boolean } = {},
  ) {
    const reconcileDirectAwards = options.reconcileDirectAwards ?? true;
    const existing = await this.lockGiveawayEntry(tx, giveaway.id, riderId);
    const qualification = await this.evaluateGiveawayEntryQualification(tx, giveaway, riderId);
    if (qualification.weight <= 0) {
      if (!existing || existing.status !== "eligible") return false;
      const withdrawn = await tx.giveawayEntry.update({
        where: { id: existing.id },
        data: {
          status: "withdrawn",
          qualifiedSourceFingerprint: qualification.sourceFingerprint,
          qualifiedEligibilityGroupIds: this.toJsonValue([]),
          qualifiedEligibilityGroupTimings: this.toJsonValue([]),
        },
      });
      if (reconcileDirectAwards) {
        await this.voidDirectGiveawayAwards(
          tx,
          giveaway,
          withdrawn,
          undefined,
          "automatic_withdrawal",
        );
      }
      await tx.giveawayEntryEvent.create({
        data: {
          id: `giveaway-entry-event-${randomUUID()}`,
          giveawayId: giveaway.id,
          entryId: withdrawn.id,
          type: "source_revalidated",
          sourceKey: `automatic-withdrawal:${giveaway.id}:${withdrawn.id}:${randomUUID()}`,
          sourceSnapshot: this.toJsonValue({
            qualifiedGroupIds: qualification.qualifiedGroupIds,
            qualifiedEligibilityGroupTimings: [],
            eligibilityCycleAt: existing.eligibilityCycleAt.toISOString(),
            sourceFingerprint: qualification.sourceFingerprint,
            sourceFacts: qualification.sourceFacts,
          }),
          weightDelta: -existing.currentWeight,
          idempotencyKey: `automatic-withdrawal:${giveaway.id}:${withdrawn.id}:${randomUUID()}`,
        },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        undefined,
        "GIVEAWAY_ENTRY_RECONCILED",
        "entry",
        withdrawn.id,
        {
          entryId: withdrawn.id,
          type: "source_revalidated",
          weightDelta: -existing.currentWeight,
          sourceFingerprint: qualification.sourceFingerprint,
        },
      );
      return true;
    }

    if (!existing) {
      const write = await this.writeGiveawayEntry(tx, giveaway, riderId, qualification, {
        entryPath: "automatic",
        entryEventType: "automatic_qualified",
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        undefined,
        "GIVEAWAY_ENTRY_RECONCILED",
        "entry",
        write.entry.id,
        {
          entryId: write.entry.id,
          type: "automatic_qualified",
          weightDelta: qualification.weight,
          sourceFingerprint: qualification.sourceFingerprint,
        },
      );
      return true;
    }

    const sameGroups =
      this.entryQualifiedGroupIds(existing).length === qualification.qualifiedGroupIds.length &&
      this.entryQualifiedGroupIds(existing).every(
        (groupId, index) => groupId === qualification.qualifiedGroupIds[index],
      );
    const timing = reconcileGiveawayEligibilityTimings({
      previousTimings: this.entryQualifiedGroupTimings(existing),
      qualifiedGroups: qualification.qualifiedGroups.map((group) => ({
        groupId: group.id,
        position: group.position,
        derivedEligibleAt: group.derivedEligibleAt,
      })),
    });
    if (!timing.eligibilityCycleAt) return false;
    const changed =
      existing.status !== "eligible" ||
      existing.currentWeight !== qualification.weight ||
      existing.qualifiedSourceFingerprint !== qualification.sourceFingerprint ||
      !sameGroups ||
      existing.eligibilityCycleAt.toISOString() !== timing.eligibilityCycleAt ||
      JSON.stringify(this.entryQualifiedGroupTimings(existing)) !==
        JSON.stringify(timing.qualifiedEligibilityGroupTimings);
    if (!changed) return false;

    const write = await this.writeGiveawayEntry(tx, giveaway, riderId, qualification, {
      entryPath: "automatic",
      entryEventType: "source_revalidated",
    });
    if (reconcileDirectAwards) {
      await this.voidIneligibleDirectGiveawayAwards(
        tx,
        giveaway,
        write.entry,
        undefined,
        "automatic_pool_revalidation",
      );
    }
    await this.auditGiveaway(
      tx,
      giveaway.id,
      undefined,
      "GIVEAWAY_ENTRY_RECONCILED",
      "entry",
      write.entry.id,
      {
        entryId: write.entry.id,
        type: "source_revalidated",
        weightDelta: qualification.weight - existing.currentWeight,
        sourceFingerprint: qualification.sourceFingerprint,
      },
    );
    return true;
  }

  private async auditGiveaway(
    tx: Prisma.TransactionClient,
    giveawayId: string,
    actorUserId: string | undefined,
    action: AuditAction,
    targetType: string,
    targetId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const previous = await tx.giveawayAuditEvent.findFirst({
      where: { giveawayId },
      orderBy: { sequence: "desc" },
      select: { sequence: true, hash: true },
    });
    const canonicalPayload = canonicalizeJson(payload);
    await tx.giveawayAuditEvent.create({
      data: {
        id: `giveaway-audit-${randomUUID()}`,
        giveawayId,
        sequence: (previous?.sequence ?? 0) + 1,
        actorUserId: actorUserId ?? null,
        action,
        targetType,
        targetId: targetId ?? null,
        canonicalPayload,
        payload: JSON.parse(canonicalPayload) as Prisma.InputJsonValue,
        previousHash: previous?.hash ?? null,
        hash: calculateGiveawayAuditHash(previous?.hash, payload),
      },
    });
  }

  private async createSessionForUser(userId: string) {
    const token = makeSessionToken();
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      },
    });
    await this.audit("SESSION_CREATED", userId, "Session", userId);
    return token;
  }

  private async getUserForSessionToken(sessionToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(sessionToken) },
      include: { user: { include: { organizerProfile: true, ownedVenues: true } } },
    });
    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    return session.user;
  }

  private async requireUser(sessionToken: string) {
    const user = await this.getUserForSessionToken(sessionToken);
    if (!user) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }
    if (user.verificationStatus === "SUSPENDED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private async requireRole(sessionToken: string, role: AccountRole) {
    const user = await this.requireUser(sessionToken);
    if (user.role !== role) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private async requireEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private async lockCheckInEvent(tx: Prisma.TransactionClient, eventId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`,
    );
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        status: true,
        checkInSettings: true,
      },
    });
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private async requireCheckInEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizer: { select: { userId: true } },
        venue: { select: { ownerUserId: true } },
        checkInSettings: true,
        perks: true,
        _count: { select: { passes: true, rsvps: true } },
      },
    });
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private async resolveSelfCheckInQr(qrToken: string) {
    if (qrToken.startsWith("fixed:")) {
      return {
        event: await this.requireCheckInEvent(qrToken.slice("fixed:".length)),
        sessionId: undefined,
        qrMode: "fixed" as const,
        valid: true,
      };
    }

    const session = await this.prisma.eventSelfCheckInQrSession.findUnique({
      where: { tokenHash: hashToken(qrToken) },
      include: {
        event: {
          include: {
            organizer: { select: { userId: true } },
            venue: { select: { ownerUserId: true } },
            checkInSettings: true,
            perks: true,
            _count: { select: { passes: true, rsvps: true } },
          },
        },
      },
    });
    if (!session) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }

    return {
      event: session.event,
      sessionId: session.id,
      qrMode: "rotating" as const,
      valid: !session.revokedAt && session.expiresAt >= new Date(),
    };
  }

  private settingsForEvent(event: {
    id: string;
    checkInSettings: {
      eventId: string;
      mode: string;
      state: string;
      qrMode: string;
      fixedQrAcknowledgedAt: Date | null;
    } | null;
  }): CheckInSettingsValue {
    return event.checkInSettings
      ? this.toCheckInSettings(event.checkInSettings)
      : {
          eventId: event.id,
          mode: "staff_only",
          state: "closed",
          qrMode: "rotating",
          fixedQrAcknowledged: false,
        };
  }

  private toCheckInSettings(settings: {
    eventId: string;
    mode: string;
    state: string;
    qrMode: string;
    fixedQrAcknowledgedAt: Date | null;
  }): CheckInSettingsValue {
    return {
      eventId: settings.eventId,
      mode: settings.mode as CheckInMode,
      state: settings.state as CheckInState,
      qrMode: settings.qrMode as OrganizerQrMode,
      fixedQrAcknowledged: Boolean(settings.fixedQrAcknowledgedAt),
    };
  }

  private requireSelfCheckInEnabled(settings: CheckInSettingsValue) {
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

  private requireCheckInConfigurator(
    user: { id: string; role: string; verificationStatus: string },
    event: { organizer: { userId: string } },
  ) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      event.organizer.userId === user.id
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private requireGiveawayConfigurator(
    user: { id: string; role: string; verificationStatus: string },
    event: { organizer: { userId: string } },
  ) {
    this.requireCheckInConfigurator(user, event);
  }

  private requireCheckInStaff(
    user: { id: string; role: string; verificationStatus: string },
    event: { organizer: { userId: string }; venue: { ownerUserId: string | null } | null },
  ) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      event.organizer.userId === user.id
    ) {
      return;
    }
    if (
      user.role === "venue" &&
      user.verificationStatus === "APPROVED" &&
      event.venue?.ownerUserId === user.id
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { organizerProfile: true, ownedVenues: true },
    });
  }

  private async audit(
    action: AuditAction,
    actorUserId: string | undefined,
    targetType: string,
    targetId?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        action,
        actorUserId,
        targetType,
        targetId,
      },
    });
  }

  private toUserProfile(user: PrismaUserRecord): UserProfile {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role as AccountRole,
      verificationStatus: user.verificationStatus as UserProfile["verificationStatus"],
      area: user.area,
      bikeModel: user.bikeModel ?? undefined,
      clubName: user.clubName ?? undefined,
      joinedAt: formatJoinedAt(user.createdAt),
      organizerProfileId: user.organizerProfile?.id,
      venueId: user.ownedVenues?.[0]?.id,
    };
  }

  private toEvent(event: PrismaEventRecord): Event {
    const type = dbEventTypeToUi[event.type] ?? "Tambike";
    return {
      id: event.id,
      title: event.title,
      type,
      status: event.status as Event["status"],
      organizerId: event.organizerId,
      venueId: event.venueId ?? venues[0].id,
      poster: event.poster,
      date: event.dateLabel,
      time: event.timeLabel,
      area: event.area,
      shortDescription: event.description,
      whatHappens: event.whatHappens,
      going: event._count?.passes ?? 0,
      interested: event._count?.rsvps ?? 0,
      expectedRiders: event.expectedRiders,
      perkPreview: event.perkPreview,
      tags: event.tags,
      riskFlags: event.riskFlags,
      rideOut: event.rideOutMeetup
        ? {
            meetup: event.rideOutMeetup,
            callTime: event.rideOutCallTime ?? "",
            departure: event.rideOutDeparture ?? "",
            destination: event.rideOutDestination ?? "",
            notes: event.rideOutNotes ?? "",
          }
        : undefined,
      rules: event.safetyRules,
      perks: event.perks.map((perk) => ({
        id: perk.id,
        type: perk.type,
        description: perk.description,
        quantity: perk.quantity ?? undefined,
      })),
    };
  }

  private toPass(pass: {
    id: string;
    eventId: string;
    qrTokenHash: string;
    status: string;
    generatedAt: Date;
  }): Pass {
    return {
      id: pass.id,
      eventId: pass.eventId,
      qrToken: pass.qrTokenHash,
      status: pass.status as Pass["status"],
      generatedAt: pass.generatedAt.toISOString(),
    };
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
