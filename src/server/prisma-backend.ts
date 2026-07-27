import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
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
  GiveawayDeliveryDetailsInput,
  GiveawayEligibilityConditionInput,
  GiveawayFulfilmentMode,
  GiveawayLifecycleAdvanceResult,
  GiveawayManualEntryCandidate,
  GiveawayManualAwardReplacementOptions,
  GiveawayManualSelectionCandidate,
  GiveawayNotification,
  GiveawayNotificationKind,
  GiveawayOperatorCandidate,
  GiveawayPrizeImageSummary,
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
  OperatorGiveawayClaimView,
  OrganizerGiveawayReport,
  PrivateGiveawayDeliveryDetails,
  PublicEventGiveaway,
  PublicGiveawayCampaignSummary,
  PublicGiveawayDrawVerification,
  PublicGiveawayPrizePoolSummary,
  PublicGiveawayResult,
  RiderEventGiveawayState,
  RiderGiveawayClaimContext,
  RiderGiveawayEntryStatus,
  RiderGiveawayState,
  ReplaceManualGiveawayAwardInput,
  SelectManualGiveawayAwardInput,
  UpdateGiveawayInput,
  VerifyGiveawayClaimInput,
} from "@/features/giveaways/types";
import { toPublicPrizePresentation } from "@/features/giveaways/public-prize-presentation";
import {
  assertGiveawayLifecycleTransition,
  parseCreateGiveawayInput,
  validateGiveawayUpdateInput,
} from "@/features/giveaways/validation";
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
import type {
  MemberProfileEditorView,
  MemberProfileView,
  MotorcycleShowcase,
  EventAttendeePublicPreview,
  EventAttendeeRosterPage,
  EventAttendeeSummary,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "@/features/member-profiles/types";
import {
  BackendError,
  type AuditAction,
  type RegistrationInput,
} from "./backend";
import { calculateGiveawayAuditHash, canonicalizeJson } from "./giveaways/audit";
import { getGiveawayMaterialUpdateBlocker } from "./giveaways/update-policy";
import {
  buildPublicDrawVerification,
  createDrawSeedCommitment,
  decryptDrawSeed,
  encryptDrawSeed,
  generateDrawSeed,
  rankFrozenWeightedEntries,
} from "./giveaways/draw-engine";
import {
  deriveGiveawayPresentationLabelPreview,
  deriveGiveawayPresentationLabels,
  isGiveawayLivePresentationOptedIn,
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
  calculateGiveawayEntryWeightDelta,
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
} from "./giveaways/notifications";
import {
  canViewMemberProfile,
  parseMotorcycleInput,
  parseProfileInput,
  profileOwnerLockResource,
  profileSlugAllocationLockResource,
  resolveStableProfileSlug,
  toMemberProfileEditorView,
  toMemberProfileView as sanitizeMemberProfile,
} from "./member-profiles/profile-domain";
import {
  decodeRosterCursor,
  encodeRosterCursor,
  normalizeRosterPageLimit,
  PUBLIC_ATTENDEE_PREVIEW_LIMIT,
} from "./member-profiles/roster-domain";
import { createPrismaPgPool } from "./prisma-pg-pool";
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
import {
  createGiveawayPrizeMediaLifecycleService,
  GiveawayPrizeMediaLifecycleError,
  type AuthorizedGiveawayPrizeMediaDescriptor,
  type FinalizeGiveawayPrizeImageInput,
  type GiveawayPrizeMediaLifecycleOptions,
  type GiveawayPrizeMediaPersistence,
} from "./giveaway-prize-media/service";

type SignupWithPasswordInput = SignupInput & {
  password: string;
};

type PrismaEventRecord = {
  id: string;
  title: string;
  type: string;
  status: string;
  organizerId: string;
  locationName: string;
  locationAddress: string;
  locationMapLink: string | null;
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
      publicImage: true,
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

type ElapsedDirectGiveawayRecoveryReservation = {
  reservedTotalAwardSlots: number;
  protectedPrizeItemIdsByPool: ReadonlyMap<string, ReadonlySet<string>>;
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

type GiveawayCampaignView = GiveawayCampaignListItem;

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

  return [...baseRules, "Respect event staff"];
}

export class PrismaTambikeBackend {
  private readonly memberMedia;
  private readonly giveawayPrizeMedia;

  private constructor(
    private readonly prisma: PrismaClient,
    options: {
      memberMedia?: MemberMediaLifecycleOptions;
      giveawayPrizeMedia?: GiveawayPrizeMediaLifecycleOptions;
    } = {},
  ) {
    this.memberMedia = createMemberMediaLifecycleService(options.memberMedia);
    this.giveawayPrizeMedia = createGiveawayPrizeMediaLifecycleService(
      options.giveawayPrizeMedia,
    );
  }

  static create(
    databaseUrl: string,
    options: {
      memberMedia?: MemberMediaLifecycleOptions;
      giveawayPrizeMedia?: GiveawayPrizeMediaLifecycleOptions;
    } = {},
  ) {
    const pool = createPrismaPgPool(databaseUrl);
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });
    return new PrismaTambikeBackend(new PrismaClient({ adapter }), options);
  }

  async disconnect() {
    await this.prisma.$disconnect();
  }

  async getSnapshot(sessionToken?: string) {
    const currentUser = sessionToken ? await this.getUserForSessionToken(sessionToken) : null;
    const [users, events, currentPasses, persistedSettings] = await Promise.all([
      currentUser?.role === "admin" && currentUser.verificationStatus !== "SUSPENDED"
        ? this.listPublicUsers()
        : Promise.resolve([]),
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
      include: { organizerProfile: true },
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
      include: { organizerProfile: true },
    });
    await this.audit("PROFILE_UPDATED", user.id, "User", user.id);
    return this.toUserProfile(updated);
  }

  async getMemberProfile(
    sessionToken: string | undefined,
    slug: string,
  ): Promise<MemberProfileView> {
    const profile = await this.prisma.user.findUnique({
      where: { profileSlug: slug },
      include: {
        organizerProfile: { select: { id: true } },
        motorcycle: { include: { photos: { orderBy: { position: "asc" } } } },
      },
    });
    if (!profile?.profileSlug) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    const sessionUser = sessionToken ? await this.getUserForSessionToken(sessionToken) : null;
    const viewer =
      sessionUser && sessionUser.verificationStatus !== "SUSPENDED"
        ? { role: sessionUser.role, ownsProfile: sessionUser.id === profile.id }
        : null;
    if (!canViewMemberProfile(viewer, profile.profileVisibility)) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return this.sanitizeMemberProfile(profile);
  }

  async getMemberProfileEditor(sessionToken: string): Promise<MemberProfileEditorView> {
    const sessionUser = await this.requireUser(sessionToken);
    const profile = await this.prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      include: {
        organizerProfile: { select: { id: true } },
        motorcycle: { include: { photos: { orderBy: { position: "asc" } } } },
      },
    });
    const hostedEventCount = profile.organizerProfile
      ? await this.prisma.event.count({ where: { organizerId: profile.organizerProfile.id } })
      : undefined;
    return toMemberProfileEditorView(
      {
        ...this.toInternalMemberProfile(profile, hostedEventCount),
        slug: profile.profileSlug,
      },
      profile.defaultRosterIdentity,
    );
  }

  async updateMemberProfile(
    sessionToken: string,
    input: UpdateMemberProfileInput,
  ): Promise<MemberProfileEditorView> {
    const sessionUser = await this.requireUser(sessionToken);
    let parsed: UpdateMemberProfileInput;
    try {
      parsed = parseProfileInput(input);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    await this.prisma.$transaction(async (tx) => {
      const profileSlug = await resolveStableProfileSlug(parsed.displayName, {
        acquireOwnerLock: () => {
          const resource = profileOwnerLockResource(sessionUser.id);
          return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`;
        },
        readCurrentSlug: async () =>
          (
            await tx.user.findUniqueOrThrow({
              where: { id: sessionUser.id },
              select: { profileSlug: true },
            })
          ).profileSlug,
        acquireSlugAllocationLock: () => {
          const resource = profileSlugAllocationLockResource();
          return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`;
        },
        allocateSlug: (base) => this.allocatePrismaProfileSlug(tx, base),
      });
      await tx.user.update({
        where: { id: sessionUser.id },
        data: {
          displayName: parsed.displayName,
          area: parsed.area,
          profileBio: parsed.bio ?? null,
          profileVisibility: parsed.visibility,
          defaultRosterIdentity: parsed.defaultRosterIdentity,
          profileSlug,
        },
      });
    });
    await this.audit("PROFILE_UPDATED", sessionUser.id, "User", sessionUser.id);
    return this.getMemberProfileEditor(sessionToken);
  }

  async upsertMotorcycle(
    sessionToken: string,
    input: UpsertMotorcycleInput,
  ): Promise<MotorcycleShowcase> {
    const user = await this.requireUser(sessionToken);
    let parsed: UpsertMotorcycleInput;
    try {
      parsed = parseMotorcycleInput(input);
    } catch {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const motorcycle = await this.prisma.motorcycle.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        make: parsed.make,
        model: parsed.model,
        year: parsed.year,
        displacementCc: parsed.displacementCc,
        nickname: parsed.nickname,
        description: parsed.description,
      },
      update: {
        make: parsed.make,
        model: parsed.model,
        year: parsed.year ?? null,
        displacementCc: parsed.displacementCc ?? null,
        nickname: parsed.nickname ?? null,
        description: parsed.description ?? null,
      },
      include: { photos: { orderBy: { position: "asc" } } },
    });
    return {
      make: motorcycle.make,
      model: motorcycle.model,
      year: motorcycle.year ?? undefined,
      displacementCc: motorcycle.displacementCc ?? undefined,
      nickname: motorcycle.nickname ?? undefined,
      description: motorcycle.description ?? undefined,
      photos: motorcycle.photos.map((photo) => ({
        url: `/media/${encodeURIComponent(photo.mediaId)}`,
        position: photo.position,
        width: photo.width,
        height: photo.height,
      })),
    };
  }

  async createMemberMediaUpload(sessionToken: string, mimeType: string) {
    const user = await this.requireUser(sessionToken);
    try {
      return await this.memberMedia.createUpload(user.id, mimeType);
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async finalizeMemberMedia(sessionToken: string, input: FinalizeMemberMediaInput) {
    const user = await this.requireUser(sessionToken);
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
    const user = await this.requireUser(sessionToken);
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
    const user = await this.requireUser(sessionToken);
    try {
      await this.memberMedia.reorder(user.id, mediaIds, this.memberMediaPersistence());
      return this.getMemberProfileEditor(sessionToken);
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async authorizeMemberMedia(
    sessionToken: string | undefined,
    mediaId: string,
  ): Promise<AuthorizedMemberMediaDescriptor> {
    return this.resolveMemberMediaDescriptor(sessionToken, mediaId);
  }

  async getMemberMedia(sessionToken: string | undefined, mediaId: string) {
    const descriptor = await this.authorizeMemberMedia(sessionToken, mediaId);
    try {
      return await this.memberMedia.read(descriptor);
    } catch (error) {
      throw this.toMemberMediaBackendError(error);
    }
  }

  async createGiveawayPrizeImageUpload(
    sessionToken: string,
    giveawayId: string,
    prizePoolId: string,
    mimeType: string,
  ) {
    const user = await this.requireUser(sessionToken);
    try {
      return await this.giveawayPrizeMedia.createUpload(
        user.id,
        giveawayId,
        prizePoolId,
        mimeType,
        this.giveawayPrizeMediaPersistence(),
      );
    } catch (error) {
      throw this.toGiveawayPrizeMediaBackendError(error);
    }
  }

  async finalizeGiveawayPrizeImage(
    sessionToken: string,
    input: FinalizeGiveawayPrizeImageInput,
  ) {
    const user = await this.requireUser(sessionToken);
    try {
      return await this.giveawayPrizeMedia.finalize(
        user.id,
        input,
        this.giveawayPrizeMediaPersistence(),
      );
    } catch (error) {
      throw this.toGiveawayPrizeMediaBackendError(error);
    }
  }

  async deleteGiveawayPrizeImage(
    sessionToken: string,
    giveawayId: string,
    prizePoolId: string,
    mediaId: string,
  ) {
    const user = await this.requireUser(sessionToken);
    try {
      await this.giveawayPrizeMedia.delete(
        user.id,
        { giveawayId, prizePoolId, mediaId },
        this.giveawayPrizeMediaPersistence(),
      );
    } catch (error) {
      throw this.toGiveawayPrizeMediaBackendError(error);
    }
  }

  async authorizeGiveawayPrizeImageMedia(
    sessionToken: string | undefined,
    mediaId: string,
  ): Promise<AuthorizedGiveawayPrizeMediaDescriptor> {
    const image = await this.prisma.giveawayPrizeImage.findUnique({
      where: { mediaId },
      select: {
        storageKey: true,
        mimeType: true,
        prizePool: {
          select: {
            giveawayId: true,
            publicDisclosure: true,
          },
        },
      },
    });
    if (
      !image ||
      image.mimeType !== "image/webp" ||
      image.prizePool.publicDisclosure !== "revealed"
    ) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    const giveaway = await this.requireGiveawayCampaign(
      image.prizePool.giveawayId,
    );
    if (
      !["PUBLISHED", "ONGOING", "COMPLETED"].includes(giveaway.event.status)
    ) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    const viewer = sessionToken
      ? await this.getUserForSessionToken(sessionToken)
      : null;
    const viewerId =
      viewer?.verificationStatus === "SUSPENDED" ? undefined : viewer?.id;
    if (!(await this.canViewPublicEventGiveaway(giveaway, viewerId))) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    if (
      giveaway.visibility !== "event_page" &&
      giveaway.visibility !== "registered_riders" &&
      giveaway.visibility !== "eligible_riders"
    ) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    return {
      storageKey: image.storageKey,
      mimeType: "image/webp",
      visibility: giveaway.visibility,
    };
  }

  async getGiveawayPrizeImageMedia(
    sessionToken: string | undefined,
    mediaId: string,
  ) {
    const descriptor = await this.authorizeGiveawayPrizeImageMedia(
      sessionToken,
      mediaId,
    );
    try {
      return await this.giveawayPrizeMedia.read(descriptor);
    } catch (error) {
      throw this.toGiveawayPrizeMediaBackendError(error);
    }
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
      const lifecycleBlocker = getGiveawayMaterialUpdateBlocker({
        state: giveaway.status as GiveawayState,
      });
      if (lifecycleBlocker) {
        throw new BackendError(lifecycleBlocker, lifecycleBlocker);
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
      const entrantHistoryBlocker = getGiveawayMaterialUpdateBlocker({
        state: giveaway.status as GiveawayState,
        hasEntrantHistory,
        changesEntrantFacingConfiguration,
      });
      if (entrantHistoryBlocker) {
        throw new BackendError(entrantHistoryBlocker, entrantHistoryBlocker);
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

  /** Configuration-only workspace read for the event owner or an administrator. */
  async getOrganizerGiveawayWorkspace(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OrganizerGiveawayWorkspace> {
    const user = await this.requireUser(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    this.requireGiveawayConfigurator(user, giveaway.event);
    return this.toOrganizerGiveawayWorkspace(giveaway);
  }

  /**
   * Server-owned operational state for an organizer/admin workspace. This is
   * deliberately separate from editable mechanics and aggregate reports so a
   * reload never loses valid actions, while entrants and claim data stay out
   * of the DTO.
   */
  async getOrganizerGiveawayOperations(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OrganizerGiveawayOperations> {
    const user = await this.requireUser(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    this.requireGiveawayConfigurator(user, giveaway.event);
    const [awards, draws] = await Promise.all([
      this.prisma.giveawayAward.findMany({
        where: { giveawayId: giveaway.id },
        select: {
          id: true,
          drawId: true,
          prizePoolId: true,
          prizeItemId: true,
          snapshotEntryId: true,
          predecessorAwardId: true,
          status: true,
          isCurrent: true,
          recoveryClosedAt: true,
          claimDeadlineAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.giveawayDraw.findMany({
        where: { giveawayId: giveaway.id },
        select: {
          id: true,
          type: true,
          status: true,
          sequence: true,
          algorithmVersion: true,
        },
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
      }),
    ]);
    const drawsById = new Map(draws.map((draw) => [draw.id, draw]));
    const recoverableAwards: OrganizerGiveawayOperations["recoverableAwards"] = [];
    for (const award of awards) {
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      if (!pool || !["declined", "voided", "disqualified", "expired"].includes(award.status)) {
        continue;
      }
      const draw = award.drawId ? drawsById.get(award.drawId) : undefined;
      const isDirectAward = !award.drawId && !award.snapshotEntryId;
      if (
        !isDirectAward &&
        ["drawing", "claims_open"].includes(giveaway.status) &&
        award.isCurrent &&
        award.drawId &&
        award.snapshotEntryId &&
        draw?.algorithmVersion === "hmac-sha256-v1" &&
        pool.awardMode === "random_draw"
      ) {
        recoverableAwards.push({
          awardId: award.id,
          label: `Random redraw for ${pool.title}`,
          status: award.status as OrganizerGiveawayOperations["recoverableAwards"][number]["status"],
          recoveryKind: "random_redraw",
          claimDeadlineRequired: !this.hasUsableGiveawayReplacementDeadline(giveaway),
        });
        continue;
      }
      if (
        !isDirectAward &&
        giveaway.status === "claims_open" &&
        award.isCurrent &&
        award.drawId &&
        award.snapshotEntryId &&
        draw?.algorithmVersion === "manual-selection-v1" &&
        pool.awardMode === "manual_selection" &&
        award.prizeItemId &&
        !awards.some((candidate) => candidate.predecessorAwardId === award.id)
      ) {
        recoverableAwards.push({
          awardId: award.id,
          label: `Manual replacement for ${pool.title}`,
          status: award.status as OrganizerGiveawayOperations["recoverableAwards"][number]["status"],
          recoveryKind: "manual_replacement",
          claimDeadlineRequired: !this.hasUsableGiveawayReplacementDeadline(giveaway),
        });
        continue;
      }
      if (
        isDirectAward &&
        giveaway.status === "claims_open" &&
        !award.isCurrent &&
        !award.recoveryClosedAt &&
        this.isGiveawayClaimDeadlineElapsed(award) &&
        ["first_come", "guaranteed"].includes(pool.awardMode)
      ) {
        recoverableAwards.push({
          awardId: award.id,
          label: `Direct re-offer for ${pool.title}`,
          status: award.status as OrganizerGiveawayOperations["recoverableAwards"][number]["status"],
          recoveryKind: "direct_reoffer",
          // Direct recovery has no inherited replacement deadline: the action
          // always requires an explicit future deadline, even when the
          // campaign-level deadline has not elapsed.
          claimDeadlineRequired: true,
        });
      }
    }
    const publishableDraw = draws
      .filter((draw) => draw.status === "completed")
      .sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id))[0];
    const presentationDraws = draws.filter(
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
      canCancel:
        awards.length === 0 && ["draft", "scheduled", "open", "paused"].includes(giveaway.status),
      canRunInitialRandomDraw:
        ["locked", "drawing"].includes(giveaway.status) &&
        giveaway.prizePools.some((pool) => pool.awardMode === "random_draw") &&
        !draws.some(
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
    const user = await this.requireUser(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    this.requireGiveawayConfigurator(user, giveaway.event);
    const draw = await this.prisma.giveawayDraw.findFirst({
      where: { id: drawId, giveawayId: giveaway.id },
      select: {
        id: true,
        snapshotId: true,
        type: true,
        status: true,
        algorithmVersion: true,
        resultDigest: true,
        snapshot: {
          select: {
            id: true,
            giveawayId: true,
            candidateCount: true,
            entries: {
              select: {
                id: true,
                entryId: true,
                opaquePublicReference: true,
                presentationLabel: true,
                entry: { select: { giveawayId: true, riderId: true } },
              },
            },
          },
        },
        awards: {
          select: {
            id: true,
            giveawayId: true,
            drawId: true,
            entryId: true,
            winnerUserId: true,
            snapshotEntryId: true,
            prizePoolId: true,
            prizeItemId: true,
          },
        },
      },
    });
    if (!draw) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    if (draw.snapshot.giveawayId !== giveaway.id) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }

    try {
      return buildOrganizerGiveawayPresentation({
        giveawayId: giveaway.id,
        eventId: giveaway.eventId,
        giveawayTitle: giveaway.title,
        draw,
        snapshot: {
          id: draw.snapshot.id,
          giveawayId: draw.snapshot.giveawayId,
          candidateCount: draw.snapshot.candidateCount,
          entries: draw.snapshot.entries.map((entry) => ({
            id: entry.id,
            giveawayId: entry.entry.giveawayId,
            entryId: entry.entryId,
            riderId: entry.entry.riderId,
            opaquePublicReference: entry.opaquePublicReference,
            presentationLabel: entry.presentationLabel,
          })),
        },
        prizePools: giveaway.prizePools.map((pool) => ({
          id: pool.id,
          position: pool.position,
          title: pool.title,
          awardMode: pool.awardMode,
          items: pool.prizeItems.map((item) => ({
            id: item.id,
            position: item.position,
            title: item.title,
          })),
        })),
        awards: draw.awards,
      });
    } catch (error) {
      if (error instanceof GiveawayPresentationIntegrityError) {
        throw new BackendError(error.code, error.code);
      }
      throw error;
    }
  }

  /**
   * Authorized configuration inventory only. This deliberately selects none
   * of the raw-code, hash, claimant, or creator fields.
   */
  async listGiveawayCampaignCodes(
    sessionToken: string,
    giveawayId: string,
  ): Promise<GiveawayCampaignCodeSummary[]> {
    const user = await this.requireUser(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    this.requireGiveawayConfigurator(user, giveaway.event);
    if (giveaway.entryMode !== "claim_code") {
      throw new BackendError("GIVEAWAY_ENTRY_MODE_INVALID", "GIVEAWAY_ENTRY_MODE_INVALID");
    }
    const codes = await this.prisma.giveawayCampaignCode.findMany({
      where: { giveawayId: giveaway.id },
      select: {
        id: true,
        maxUses: true,
        useCount: true,
        expiresAt: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const now = Date.now();

    return codes.map((code) => {
      const status: GiveawayCampaignCodeStatus = code.revokedAt
        ? "revoked"
        : code.expiresAt.getTime() <= now
          ? "expired"
          : code.useCount >= code.maxUses
            ? "exhausted"
            : "active";
      return {
        id: code.id,
        maxUses: code.maxUses,
        usedUses: code.useCount,
        expiresAt: code.expiresAt.toISOString(),
        createdAt: code.createdAt.toISOString(),
        status,
      };
    });
  }

  /**
   * Event-scoped choices for the open manual-entry control. The response
   * intentionally contains no email, phone, source facts, or entry state.
   */
  async listGiveawayManualEntryCandidates(
    sessionToken: string,
    giveawayId: string,
  ): Promise<GiveawayManualEntryCandidate[]> {
    const user = await this.requireUser(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    this.requireGiveawayConfigurator(user, giveaway.event);
    if (giveaway.status !== "open" || giveaway.entryMode !== "manual_only") return [];

    const [activityRiderIds, activeManualEntries] = await Promise.all([
      this.riderIdsWithGiveawayActivity(this.prisma, giveaway.eventId),
      this.prisma.giveawayEntry.findMany({
        where: {
          giveawayId: giveaway.id,
          entryPath: "manual",
          status: "eligible",
          manualGrantActive: true,
        },
        select: { riderId: true },
      }),
    ]);
    const activeManualRiderIds = new Set(activeManualEntries.map((entry) => entry.riderId));
    const riderIds = [...new Set([...activityRiderIds, ...activeManualRiderIds])];
    if (riderIds.length === 0) return [];
    const riders = await this.prisma.user.findMany({
      where: {
        id: { in: riderIds },
      },
      select: { id: true, displayName: true, role: true, verificationStatus: true },
    });
    const actionAt = new Date();
    const candidates = await Promise.all(
      riders.map(async (rider) => {
        if (activeManualRiderIds.has(rider.id)) {
          return { riderId: rider.id, label: rider.displayName.trim() || "Unnamed rider" };
        }
        if (rider.role !== "rider" || rider.verificationStatus === "SUSPENDED") return null;
        const qualification = await this.evaluateGiveawayEntryQualification(
          this.prisma,
          giveaway,
          rider.id,
          { manual: true, actionAt },
        );
        return qualification.weight > 0
          ? { riderId: rider.id, label: rider.displayName.trim() || "Unnamed rider" }
          : null;
      }),
    );
    return candidates
      .filter((candidate): candidate is GiveawayManualEntryCandidate => candidate !== null)
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) || left.riderId.localeCompare(right.riderId),
      );
  }

  /**
   * Organizer-only manual award choices come solely from a locked snapshot.
   * The response deliberately exposes no rider profile, contact, entry, or
   * qualification data—only an opaque snapshot reference and its safe label.
   */
  async listGiveawayManualSelectionCandidates(
    sessionToken: string,
    giveawayId: string,
    prizePoolId: string,
  ): Promise<GiveawayManualSelectionCandidate[]> {
    const user = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if (!["locked", "drawing"].includes(giveaway.status)) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const pool = giveaway.prizePools.find((candidate) => candidate.id === prizePoolId);
      if (!pool || pool.awardMode !== "manual_selection") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      if (!pool.prizeItems.some((item) => item.status === "available")) return [];

      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const entriesById = new Map(
        (
          await tx.giveawayEntry.findMany({
            where: {
              giveawayId: giveaway.id,
              id: { in: snapshot.entries.map((entry) => entry.entryId) },
            },
            select: { id: true, riderId: true },
          })
        ).map((entry) => [entry.id, entry]),
      );
      const candidates: GiveawayManualSelectionCandidate[] = [];
      for (const snapshotEntry of snapshot.entries) {
        const entry = entriesById.get(snapshotEntry.entryId);
        if (!entry) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
        if (
          !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
          !(await this.canCreateDrawGiveawayAward(tx, giveaway, pool, entry.riderId))
        ) {
          continue;
        }
        candidates.push({
          snapshotEntryId: snapshotEntry.id,
          label: `Locked entry ${snapshotEntry.opaquePublicReference}`,
        });
      }
      return candidates;
    });
  }

  /**
   * Returns only opaque frozen entries that can replace one terminal manual
   * award. The source is derived server-side, so callers cannot swap pools,
   * prize items, or rider facts.
   */
  async listManualGiveawayReplacementCandidates(
    sessionToken: string,
    sourceAwardId: string,
  ): Promise<GiveawayManualAwardReplacementOptions> {
    const user = await this.requireUser(sessionToken);
    const normalizedSourceAwardId = this.requireOpaqueGiveawayLedgerText(sourceAwardId);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: normalizedSourceAwardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const sourceAward = await tx.giveawayAward.findUnique({
        where: { id: normalizedSourceAwardId },
      });
      if (
        giveaway.status !== "claims_open" ||
        !sourceAward ||
        sourceAward.giveawayId !== giveaway.id ||
        !sourceAward.isCurrent
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const { pool } = await this.requireManualGiveawayReplacementSource(
        tx,
        giveaway,
        snapshot,
        sourceAward,
      );
      const lockedEntries = await this.lockGiveawayEntries(tx, giveaway.id);
      this.assertFrozenDirectEntryProvenance(snapshot, lockedEntries);
      const entriesById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
      const candidates: GiveawayManualSelectionCandidate[] = [];
      for (const snapshotEntry of snapshot.entries) {
        const entry = entriesById.get(snapshotEntry.entryId);
        if (!entry) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        if (
          entry.status !== "locked" ||
          !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
          !(await this.canCreateDrawGiveawayAward(
            tx,
            giveaway,
            pool,
            entry.riderId,
            sourceAward.id,
          ))
        ) {
          continue;
        }
        candidates.push({
          snapshotEntryId: snapshotEntry.id,
          label: `Locked entry ${snapshotEntry.opaquePublicReference}`,
        });
      }
      return {
        sourceAwardId: sourceAward.id,
        label: `Manual replacement for ${pool.title}`,
        status: sourceAward.status as GiveawayManualAwardReplacementOptions["status"],
        claimDeadlineRequired: !this.hasUsableGiveawayReplacementDeadline(giveaway),
        candidates,
      };
    });
  }

  /** Minimal cross-event administrator campaign list; entrant records stay private. */
  async listAdminGiveaways(sessionToken: string): Promise<GiveawayCampaignListItem[]> {
    await this.requireRole(sessionToken, "admin");
    const giveaways = await this.prisma.eventGiveaway.findMany({
      include: giveawayConfigurationInclude,
      orderBy: [{ eventId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return giveaways.map((giveaway) => this.toGiveawayCampaignView(giveaway));
  }

  async getOrganizerGiveawayReport(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OrganizerGiveawayReport> {
    const user = await this.requireUser(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    this.requireGiveawayConfigurator(user, giveaway.event);
    const [entryRows, awardRows] = await Promise.all([
      this.prisma.giveawayEntry.findMany({
        where: { giveawayId: giveaway.id },
        select: { status: true },
      }),
      this.prisma.giveawayAward.findMany({
        where: { giveawayId: giveaway.id },
        select: { status: true },
      }),
    ]);
    const entries: OrganizerGiveawayReport["entries"] = {
      eligible: 0,
      locked: 0,
      disqualified: 0,
      withdrawn: 0,
    };
    for (const entry of entryRows) entries[entry.status as keyof typeof entries] += 1;
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
    for (const award of awardRows) {
      if (award.status !== "superseded") awards[award.status as keyof typeof awards] += 1;
    }
    return {
      giveawayId: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      state: giveaway.status as GiveawayState,
      complianceStatus: giveaway.complianceStatus as OrganizerGiveawayReport["complianceStatus"],
      entries,
      awards,
      prizePools: giveaway.prizePools.map((pool) => ({
        id: pool.id,
        title: pool.title,
        awardMode: pool.awardMode as OrganizerGiveawayReport["prizePools"][number]["awardMode"],
        fulfilmentMode:
          pool.fulfillmentType as OrganizerGiveawayReport["prizePools"][number]["fulfilmentMode"],
        ...(pool.inventoryLimit === null
          ? {}
          : {
              availableItemCount: pool.prizeItems.filter((item) => item.status === "available").length,
              reservedItemCount: pool.prizeItems.filter((item) => item.status === "reserved").length,
              fulfilledItemCount: pool.prizeItems.filter((item) => item.status === "fulfilled").length,
            }),
      })),
    };
  }

  async getAdminGiveawayAudit(sessionToken: string, giveawayId: string): Promise<AdminGiveawayAudit> {
    await this.requireRole(sessionToken, "admin");
    await this.requireGiveawayCampaign(giveawayId);
    const events = await this.prisma.giveawayAuditEvent.findMany({
      where: { giveawayId },
      select: {
        id: true,
        sequence: true,
        action: true,
        targetType: true,
        targetId: true,
        actorUserId: true,
        previousHash: true,
        hash: true,
        createdAt: true,
      },
      orderBy: { sequence: "asc" },
    });
    return {
      giveawayId,
      events: events.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        action: event.action,
        targetType: event.targetType,
        ...(event.targetId ? { targetId: event.targetId } : {}),
        ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
        ...(event.previousHash ? { previousHash: event.previousHash } : {}),
        hash: event.hash,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  async listGiveawayNotifications(sessionToken: string): Promise<GiveawayNotification[]> {
    const user = await this.requireUser(sessionToken);
    const notifications = await this.prisma.notification.findMany({
      where: {
        userId: user.id,
        kind: {
          in: [
            "giveaway_entry",
            "giveaway_winner",
            "giveaway_claim_verified",
            "giveaway_claim_expired",
            "giveaway_fulfilled",
          ],
        },
      },
      select: { id: true, kind: true, title: true, body: true, href: true, createdAt: true, readAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return notifications.map((notification) => ({
      id: notification.id,
      kind: notification.kind as GiveawayNotificationKind,
      title: notification.title,
      body: notification.body,
      ...(notification.href ? { href: notification.href } : {}),
      createdAt: notification.createdAt.toISOString(),
      ...(notification.readAt ? { readAt: notification.readAt.toISOString() } : {}),
    }));
  }

  async exportGiveawayCsv(sessionToken: string, giveawayId: string) {
    const administrator = await this.requireRole(sessionToken, "admin");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      const entries = await tx.giveawayEntry.findMany({
        where: { giveawayId: giveaway.id },
        include: {
          rider: { select: { email: true } },
          awards: {
            include: {
              prizePool: { select: { title: true } },
              prizeItem: { select: { title: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { id: "asc" },
      });
      const rows: Array<Record<string, unknown>> = [];
      for (const entry of entries) {
        const awards = entry.awards.length > 0 ? entry.awards : [undefined];
        for (const award of awards) {
          rows.push({
            giveaway_id: giveaway.id,
            event_id: giveaway.eventId,
            giveaway_title: giveaway.title,
            entry_reference: entry.opaquePublicReference,
            entry_status: entry.status,
            entry_path: entry.entryPath,
            award_id: award?.id ?? "",
            award_status: award?.status ?? "",
            prize_pool: award?.prizePool.title ?? "",
            prize_item: award?.prizeItem?.title ?? "",
            winner_user_id: award?.winnerUserId ?? "",
            winner_email: award ? entry.rider.email : "",
            entry_created_at: entry.createdAt.toISOString(),
            award_created_at: award?.createdAt.toISOString() ?? "",
          });
        }
      }
      await this.auditGiveaway(tx, giveaway.id, administrator.id, "GIVEAWAY_EXPORT_CREATED", "giveaway", giveaway.id, {
        rowCount: rows.length,
        format: "csv",
      });
      return buildGiveawayCsv(
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
    });
  }

  async getPublicGiveaway(
    giveawayId: string,
    sessionToken?: string,
  ): Promise<PublicGiveawayCampaignSummary> {
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    const event = await this.requireEvent(giveaway.eventId);
    if (
      !["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status) ||
      !this.isPublicEventGiveaway(giveaway) ||
      giveaway.visibility === "hidden"
    ) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    if (giveaway.visibility === "registered_riders") {
      const rider = await this.requireUser(sessionToken ?? "");
      if (!(await this.canViewPublicEventGiveaway(giveaway, rider.id))) {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
    }
    if (giveaway.visibility === "eligible_riders") {
      const rider = await this.requireUser(sessionToken ?? "");
      if (!(await this.canViewPublicEventGiveaway(giveaway, rider.id))) {
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
    const event = await this.requireEvent(eventId);
    if (!["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status)) return [];
    const viewer = sessionToken ? await this.getUserForSessionToken(sessionToken) : null;
    const viewerId = viewer?.verificationStatus === "SUSPENDED" ? undefined : viewer?.id;
    const giveaways = await this.prisma.eventGiveaway.findMany({
      where: { eventId },
      include: giveawayConfigurationInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const visible: PublicEventGiveaway[] = [];
    for (const giveaway of giveaways) {
      if (!(await this.canViewPublicEventGiveaway(giveaway, viewerId))) continue;
      visible.push({
        giveaway: this.toPublicGiveaway(giveaway),
        results: await this.toPublicGiveawayResults(giveaway),
        drawVerifications: await this.toPublicGiveawayDrawVerifications(giveaway),
      });
    }
    return visible;
  }

  async getRiderGiveawayState(sessionToken: string, giveawayId: string): Promise<RiderGiveawayState> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    return this.toRiderGiveawayState(giveaway, rider.id);
  }

  async setGiveawayLivePresentationPreference(
    sessionToken: string,
    giveawayId: string,
    optedIn: boolean,
  ): Promise<RiderGiveawayState> {
    const rider = await this.requireGiveawayRider(sessionToken);
    if (typeof optedIn !== "boolean") throw new BackendError("INVALID_INPUT", "INVALID_INPUT");

    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      if (giveaway.status !== "open") {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_OPEN", "GIVEAWAY_ENTRY_NOT_OPEN");
      }
      const entry = await this.lockGiveawayEntry(tx, giveaway.id, rider.id);
      if (!entry || entry.status !== "eligible") {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
      }
      if (!optedIn && !isGiveawayLivePresentationOptedIn({
        optedInAt: entry.livePresentationOptedInAt,
        revokedAt: entry.livePresentationRevokedAt,
      })) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }

      const now = new Date();
      await tx.giveawayEntry.update({
        where: { id: entry.id },
        data: optedIn
          ? { livePresentationOptedInAt: now, livePresentationRevokedAt: null }
          : { livePresentationRevokedAt: now },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        rider.id,
        optedIn
          ? "GIVEAWAY_LIVE_PRESENTATION_OPTED_IN"
          : "GIVEAWAY_LIVE_PRESENTATION_REVOKED",
        "entry",
        entry.id,
        { optedIn },
      );
      return this.toRiderGiveawayState(giveaway, rider.id, tx);
    });
  }

  /** Rider-only event list; hidden campaigns appear only when the rider has their own state. */
  async listRiderGiveawayStatesForEvent(
    sessionToken: string,
    eventId: string,
  ): Promise<RiderEventGiveawayState[]> {
    const rider = await this.requireGiveawayRider(sessionToken);
    await this.requireEvent(eventId);
    const giveaways = await this.prisma.eventGiveaway.findMany({
      where: { eventId },
      include: giveawayConfigurationInclude,
      orderBy: [{ title: "asc" }, { id: "asc" }],
    });
    const states: RiderEventGiveawayState[] = [];
    for (const giveaway of giveaways) {
      const riderState = await this.toRiderGiveawayState(giveaway, rider.id);
      if (
        !(await this.canViewPublicEventGiveaway(giveaway, rider.id)) &&
        riderState.status === "not_eligible"
      ) {
        continue;
      }
      states.push({
        giveawayId: giveaway.id,
        giveawayTitle: giveaway.title,
        giveawayState: giveaway.status as GiveawayState,
        entryMode: giveaway.entryMode as RiderEventGiveawayState["entryMode"],
        riderState,
      });
    }
    return states;
  }

  /** A winner's own, nonsecret claim-page context. */
  async getRiderGiveawayClaimContext(
    sessionToken: string,
    awardId: string,
  ): Promise<RiderGiveawayClaimContext> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const award = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: {
        id: true,
        giveawayId: true,
        winnerUserId: true,
        status: true,
        isCurrent: true,
        claimTokenHash: true,
        claimDeadlineAt: true,
        prizePool: { select: { title: true, fulfillmentType: true } },
        deliveryDetail: { select: { id: true, purgedAt: true } },
      },
    });
    if (!award || !award.isCurrent || award.winnerUserId !== rider.id || award.status === "superseded") {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const giveaway = await this.requireGiveawayCampaign(award.giveawayId);
    return {
      awardId: award.id,
      giveawayId: giveaway.id,
      giveawayTitle: giveaway.title,
      giveawayState: giveaway.status as GiveawayState,
      award: {
        prizePoolTitle: award.prizePool.title,
        status: award.status as RiderGiveawayClaimContext["award"]["status"],
        ...(award.claimDeadlineAt ? { claimDeadlineAt: award.claimDeadlineAt.toISOString() } : {}),
        fulfilmentMode: award.prizePool.fulfillmentType as GiveawayFulfilmentMode,
      },
      deliveryDetailsSubmitted: Boolean(award.deliveryDetail && !award.deliveryDetail.purgedAt),
      claimCredentialIssued: Boolean(award.claimTokenHash),
    };
  }

  /** A rider explicitly grants or withdraws public display consent for their own draw-backed award. */
  async setGiveawayWinnerPublication(
    sessionToken: string,
    awardId: string,
    input: GiveawayWinnerPublicationInput,
  ): Promise<RiderGiveawayState> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const preference = this.parseGiveawayWinnerPublicationInput(input);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const award = await this.lockGiveawayAward(tx, awardId);
      if (
        !award ||
        award.giveawayId !== giveaway.id ||
        award.winnerUserId !== rider.id ||
        !award.isCurrent ||
        !award.drawId ||
        !award.snapshotEntryId ||
        !["pending_verification", "claimable", "verified", "fulfilled"].includes(award.status)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const [snapshot, entry] = await Promise.all([
        tx.giveawaySnapshot.findUnique({
          where: { giveawayId: giveaway.id },
          select: { seedRevealedAt: true },
        }),
        tx.giveawayEntry.findUnique({
          where: { id: award.entryId },
          select: { opaquePublicReference: true },
        }),
      ]);
      if (!snapshot?.seedRevealedAt || !entry) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      if (preference.published && this.isOpaqueGiveawayWinnerAlias(preference.alias, entry.opaquePublicReference)) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
      if (!preference.published && (!award.publicWinnerAlias || !award.winnerAliasOptedInAt)) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }

      const now = new Date();
      await tx.giveawayAward.update({
        where: { id: award.id },
        data: preference.published
          ? { publicWinnerAlias: preference.alias, winnerAliasOptedInAt: now, winnerAliasRevokedAt: null }
          : { winnerAliasRevokedAt: now },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        rider.id,
        preference.published
          ? "GIVEAWAY_WINNER_PUBLICATION_OPTED_IN"
          : "GIVEAWAY_WINNER_PUBLICATION_REVOKED",
        "award",
        award.id,
        { awardId: award.id, public: preference.published },
      );
      return this.toRiderGiveawayState(giveaway, rider.id, tx);
    });
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

  /** An owner/admin explicitly schedules an already-approved campaign. */
  async scheduleGiveaway(sessionToken: string, giveawayId: string) {
    const actor = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(actor, giveaway.event);
      if (
        giveaway.status !== "draft" ||
        giveaway.complianceStatus !== "approved" ||
        !giveaway.entryOpensAt ||
        giveaway.entryOpensAt.getTime() <= Date.now()
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      this.assertGiveawayTransition(giveaway, "scheduled");
      await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "scheduled" } });
      const scheduled = await this.lockGiveawayCampaign(tx, giveaway.id);
      await this.auditGiveaway(
        tx,
        scheduled.id,
        actor.id,
        "GIVEAWAY_SCHEDULED",
        "giveaway",
        scheduled.id,
        { entryOpensAt: scheduled.entryOpensAt?.toISOString() ?? null },
      );
      return this.toGiveawayCampaignView(scheduled);
    });
  }

  /**
   * Trusted scheduler entry point. The caller supplies a server clock; each
   * operation then locks and rechecks its campaign inside its own interactive
   * transaction. It only moves lifecycle state forward and never publishes,
   * reopens, or creates a redraw.
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
    // Retention is a privileged system task and intentionally runs before
    // lifecycle actor lookup. Due encrypted payloads must be purged even when
    // their original organizer is no longer eligible to operate a campaign.
    result.purgedDeliveryDetails = await this.purgeExpiredGiveawayDeliveryDetailsAsSystem(now);
    const giveaways = await this.prisma.eventGiveaway.findMany({
      where: { status: { in: ["scheduled", "open", "locked", "claims_open", "completed"] } },
      include: giveawayConfigurationInclude,
      orderBy: { id: "asc" },
    });

    for (const giveaway of giveaways) {
      const actor = await this.findGiveawayCronActor(giveaway);
      if (!actor) continue;
      let state = giveaway.status as GiveawayState;

      if (state === "scheduled" && this.isGiveawayScheduleDue(giveaway.entryOpensAt, now)) {
        try {
          const opened = await this.openGiveawayAsActor(actor, giveaway.id, {
            initiatedVia: "cron",
            now,
          });
          state = opened.state;
          result.opened += 1;
        } catch (error) {
          if (!(error instanceof BackendError)) throw error;
          continue;
        }
      }

      if (state === "open" && this.isGiveawayScheduleDue(giveaway.entryClosesAt, now)) {
        try {
          await this.lockGiveawayAsActor(actor, giveaway.id, { initiatedVia: "cron", now });
          state = "locked";
          result.locked += 1;
        } catch (error) {
          if (!(error instanceof BackendError)) throw error;
          continue;
        }
      }

      const drawAt = giveaway.drawAt;
      if (state === "locked" && drawAt && this.isGiveawayScheduleDue(drawAt, now)) {
        try {
          await this.runGiveawayDrawAsActor(
            actor,
            {
              giveawayId: giveaway.id,
              idempotencyKey: `cron-initial-draw:${giveaway.id}:${drawAt.toISOString()}`,
              reason: "scheduled_initial_draw",
            },
            { initiatedVia: "cron", now },
          );
          state = "drawing";
          result.drawn += 1;
        } catch (error) {
          if (!(error instanceof BackendError)) throw error;
          continue;
        }
      }

      if (state === "claims_open") {
        const expired = await this.expireGiveawayClaimsAsActor(actor, giveaway.id, {
          initiatedVia: "cron",
          now,
        });
        result.expired += expired.expiredCount;
        if (
          await this.completeGiveawayClaimsAsActor(actor, giveaway.id, {
            initiatedVia: "cron",
            now,
          })
        ) {
          result.completed += 1;
        }
      }
    }
    return result;
  }

  async openGiveaway(sessionToken: string, giveawayId: string) {
    const user = await this.requireUser(sessionToken);
    return this.openGiveawayAsActor(user, giveawayId);
  }

  private async openGiveawayAsActor(
    user: PrismaUserRecord,
    giveawayId: string,
    options: { initiatedVia?: "cron"; now?: Date } = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if (
        options.initiatedVia === "cron" &&
        (giveaway.status !== "scheduled" || !this.isGiveawayScheduleDue(giveaway.entryOpensAt, options.now))
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
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
        ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
      });
      return this.toGiveawayCampaignView(updated);
    });
  }

  async pauseGiveaway(sessionToken: string, giveawayId: string) {
    const user = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(user, giveaway.event);
      if (!["scheduled", "open"].includes(giveaway.status)) {
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

  async createGiveawayCampaignCode(
    sessionToken: string,
    giveawayId: string,
    input: CreateGiveawayCampaignCodeInput,
  ): Promise<IssuedGiveawayCampaignCode> {
    const organizer = await this.requireUser(sessionToken);
    const parsed = this.parseGiveawayCampaignCodeInput(input);
    const code = `gwy_${randomBytes(24).toString("base64url")}`;
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      if (giveaway.entryMode !== "claim_code") {
        throw new BackendError("GIVEAWAY_ENTRY_MODE_INVALID", "GIVEAWAY_ENTRY_MODE_INVALID");
      }
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
    input: GrantManualGiveawayEntryInput,
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
      if (rider.verificationStatus === "SUSPENDED") {
        throw new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE");
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
    return this.lockGiveawayAsActor(organizer, giveawayId);
  }

  private async lockGiveawayAsActor(
    organizer: PrismaUserRecord,
    giveawayId: string,
    options: { initiatedVia?: "cron"; now?: Date } = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      if (
        options.initiatedVia === "cron" &&
        (giveaway.status !== "open" || !this.isGiveawayScheduleDue(giveaway.entryClosesAt, options.now))
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
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
      const riders = await tx.user.findMany({
        where: { id: { in: eligibleEntries.map((entry) => entry.riderId) } },
        select: { id: true, displayName: true },
      });
      const displayNamesByRider = new Map(riders.map((rider) => [rider.id, rider.displayName]));
      const presentationLabels = new Map(
        deriveGiveawayPresentationLabels(
          eligibleEntries.map((entry) => ({
            entryId: entry.id,
            opaquePublicReference: entry.opaquePublicReference,
            displayName: displayNamesByRider.get(entry.riderId) ?? "",
            optedIn: isGiveawayLivePresentationOptedIn({
              optedInAt: entry.livePresentationOptedInAt,
              revokedAt: entry.livePresentationRevokedAt,
            }),
          })),
        ).map((label) => [label.entryId, label]),
      );
      const mechanics = this.currentGiveawayMechanics(giveaway);
      const configDigest = this.calculateGiveawayConfigDigest(giveaway, mechanics.id);
      const frozenEntries = eligibleEntries.map((entry) => {
        const qualifiedEligibilityGroupIds = this.entryQualifiedGroupIds(entry);
        const qualifiedEligibilityGroupTimings = this.entryQualifiedGroupTimings(entry);
        const presentation = presentationLabels.get(entry.id);
        if (!presentation) throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
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
          presentationLabel: presentation.presentationLabel,
          presentationLabelKind: presentation.presentationLabelKind,
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
              presentationLabel: entry.presentationLabel,
              presentationLabelKind: entry.presentationLabelKind,
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
        ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
      });
      return this.toGiveawayLockResult(locked, snapshot);
    });
  }

  async runGiveawayDraw(sessionToken: string, input: unknown): Promise<GiveawayDrawResult> {
    const parsed = this.parseGiveawayDrawInput(input);
    const organizer = await this.requireUser(sessionToken);
    return this.runGiveawayDrawAsActor(organizer, parsed);
  }

  private async runGiveawayDrawAsActor(
    organizer: PrismaUserRecord,
    parsed: { giveawayId: string; idempotencyKey: string; reason?: string },
    options: { initiatedVia?: "cron"; now?: Date } = {},
  ): Promise<GiveawayDrawResult> {
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, parsed.giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      if (
        options.initiatedVia === "cron" &&
        (giveaway.status !== "locked" || !this.isGiveawayScheduleDue(giveaway.drawAt, options.now))
      ) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
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
        ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
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
      if (!["locked", "drawing"].includes(giveaway.status)) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const pool = giveaway.prizePools.find((candidate) => candidate.id === parsed.prizePoolId);
      if (!pool || pool.awardMode !== "manual_selection") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const entriesById = new Map(
        (await this.lockGiveawayEntries(tx, giveaway.id)).map((entry) => [entry.id, entry]),
      );
      this.assertFrozenDirectEntryProvenance(snapshot, [...entriesById.values()]);
      const snapshotEntry = snapshot.entries.find((entry) => entry.id === parsed.snapshotEntryId);
      const entry = snapshotEntry ? entriesById.get(snapshotEntry.entryId) : undefined;
      if (!snapshotEntry || !entry) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const actionInput: GiveawayDrawActionInput = {
        action: "manual_selection",
        reasonDigest: this.hashGiveawayReason(parsed.reason),
        prizePoolId: parsed.prizePoolId,
        // The API accepts only a snapshot reference; the persisted draw digest
        // remains tied to the resolved frozen rider identity for replay safety.
        riderId: entry.riderId,
        snapshotEntryId: snapshotEntry.id,
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
      if (
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
      if (draw.status === "published") {
        const seed = this.decryptGiveawayDrawSeed(snapshot);
        return this.buildGiveawayDrawVerification(giveaway, snapshot, draw, seed, true);
      }
      if (draw.status !== "completed") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      if (giveaway.status !== "drawing") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      if (
        !snapshot.seedRevealedAt &&
        await this.hasAwardableManualSelectionCandidates(tx, giveaway, snapshot)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const seed = this.decryptGiveawayDrawSeed(snapshot);
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
      const awards = await tx.giveawayAward.findMany({
        where: { giveawayId: giveaway.id, drawId: { not: null } },
        select: { id: true, winnerUserId: true },
        orderBy: { id: "asc" },
      });
      for (const award of awards) {
        await this.notifyGiveaway(tx, giveaway, award.winnerUserId, "giveaway_winner", {
          awardId: award.id,
        });
      }
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
      this.requireGiveawayRiderDeclineGate(award);
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
          directAward,
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
        claimDeadlineAt: parsed.claimDeadlineAt,
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
      const replacementDeadline = this.resolveGiveawayReplacementClaimDeadline(
        giveaway,
        parsed.claimDeadlineAt,
      );
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
        claimDeadlineAt: replacementDeadline,
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
        claimDeadlineAt: replacementDeadline?.toISOString() ?? null,
      });
      if (snapshot.seedRevealedAt) {
        await this.notifyGiveaway(tx, giveaway, replacement.winnerUserId, "giveaway_winner", {
          awardId: replacement.id,
        });
      }
      return this.toGiveawayDrawResult(giveaway, snapshot, completedDraw);
    });
  }

  /**
   * Replaces one terminal, published manual-selection award. This deliberately
   * does not use the HMAC redraw path: an organizer selects a new opaque
   * frozen entry, the old terminal award remains truthful history, and the
   * committed seed is neither generated nor rerolled.
   */
  async replaceManualGiveawayAward(
    sessionToken: string,
    input: unknown,
  ): Promise<GiveawayDrawResult> {
    const parsed = this.parseManualGiveawayReplacementInput(input);
    const organizer = await this.requireUser(sessionToken);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: parsed.sourceAwardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      this.requireGiveawayConfigurator(organizer, giveaway.event);
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const publishedAt = snapshot.seedRevealedAt;
      const sourceAward = await tx.giveawayAward.findUnique({ where: { id: parsed.sourceAwardId } });
      if (!sourceAward || sourceAward.giveawayId !== giveaway.id || !publishedAt) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      // Resolve only immutable lineage before looking up an idempotent replay.
      // A successful successor may have fulfilled the shared prize item since
      // the first request, so its historical result must remain replayable
      // without accepting that fulfilled item for a fresh replacement.
      const replayLineage = await this.requireManualGiveawayReplacementLineage(
        tx,
        giveaway,
        snapshot,
        sourceAward,
      );
      const lockedEntries = await this.lockGiveawayEntries(tx, giveaway.id);
      this.assertFrozenDirectEntryProvenance(snapshot, lockedEntries);
      const entriesById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
      const snapshotEntry = snapshot.entries.find((entry) => entry.id === parsed.snapshotEntryId);
      const entry = snapshotEntry ? entriesById.get(snapshotEntry.entryId) : undefined;
      if (!snapshotEntry || !entry || entry.status !== "locked") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const actionInput: GiveawayDrawActionInput = {
        action: "manual_replacement",
        reasonDigest: this.hashGiveawayReason(parsed.reason),
        prizePoolId: replayLineage.pool.id,
        riderId: entry.riderId,
        snapshotEntryId: snapshotEntry.id,
        predecessorAwardId: sourceAward.id,
        claimDeadlineAt: parsed.claimDeadlineAt,
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
      const { originalDraw, pool, prizeItem: sourcePrizeItem } =
        await this.requireManualGiveawayReplacementSource(tx, giveaway, snapshot, sourceAward);
      if (giveaway.status !== "claims_open" || !sourceAward.isCurrent) {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const existingSuccessor = await tx.giveawayAward.findFirst({
        where: { predecessorAwardId: sourceAward.id },
        select: { id: true },
      });
      if (existingSuccessor) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      if (
        !this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) ||
        !(await this.canCreateDrawGiveawayAward(
          tx,
          giveaway,
          pool,
          entry.riderId,
          sourceAward.id,
        ))
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const replacementDeadline = this.resolveGiveawayReplacementClaimDeadline(
        giveaway,
        parsed.claimDeadlineAt,
      );
      await this.lockGiveawayPrizePool(tx, pool.id);
      const prizeItem = await this.lockGiveawayPrizeItem(tx, sourcePrizeItem.id);
      if (!prizeItem || prizeItem.prizePoolId !== pool.id || prizeItem.status !== "reserved") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const currentAward = await this.lockGiveawayAward(tx, sourceAward.id);
      if (!currentAward || !currentAward.isCurrent) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const currentSource = await this.requireManualGiveawayReplacementSource(
        tx,
        giveaway,
        snapshot,
        currentAward,
      );
      if (
        currentSource.originalDraw.id !== originalDraw.id ||
        currentSource.pool.id !== pool.id ||
        currentSource.prizeItem.id !== prizeItem.id
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
          status: "published",
          idempotencyKey: parsed.idempotencyKey,
          algorithmVersion: "manual-selection-v1",
          inputDigest,
          initiatedByUserId: organizer.id,
          reasonDigest: actionInput.reasonDigest,
          completedAt: new Date(),
          publishedAt,
        },
      });
      // Preserve the terminal outcome and reason digest. Only the current
      // allocation pointer changes so the same reserved item can have one
      // successor under the partial current-prize-item constraint.
      await tx.giveawayAward.update({
        where: { id: currentAward.id },
        data: { isCurrent: false },
      });
      const replacement = await this.createDrawGiveawayAward(tx, giveaway, pool, {
        entry,
        draw,
        snapshotEntry,
        prizeItemId: prizeItem.id,
        rank: 1,
        predecessorAwardId: currentAward.id,
        reservePrizeItem: false,
        claimDeadlineAt: replacementDeadline,
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
      const publishedDraw = await tx.giveawayDraw.update({
        where: { id: draw.id },
        data: { resultDigest },
      });
      await this.auditGiveaway(
        tx,
        giveaway.id,
        organizer.id,
        "GIVEAWAY_MANUAL_AWARD_REPLACED",
        "award",
        replacement.id,
        {
          awardId: replacement.id,
          predecessorAwardId: currentAward.id,
          drawId: draw.id,
          originalDrawId: originalDraw.id,
          reasonDigest: draw.reasonDigest,
          claimDeadlineAt: replacementDeadline?.toISOString() ?? null,
        },
      );
      await this.notifyGiveaway(tx, giveaway, replacement.winnerUserId, "giveaway_winner", {
        awardId: replacement.id,
      });
      return this.toGiveawayDrawResult(giveaway, snapshot, publishedDraw);
    });
  }

  /**
   * Returns the raw claim secret only to the winning rider. The persisted award
   * keeps a giveaway-domain hash and a monotonic rotation version instead.
   */
  async issueGiveawayClaimToken(
    sessionToken: string,
    awardId: string,
    input: { rotate?: boolean } = {},
  ): Promise<IssuedGiveawayClaimToken> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const parsed = this.parseGiveawayClaimTokenIssueInput(input);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const preview = await tx.giveawayAward.findUnique({
        where: { id: awardId },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const award = await this.lockGiveawayAward(tx, awardId);
      if (!award || award.giveawayId !== giveaway.id || award.winnerUserId !== rider.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      this.requireGiveawayClaimGate(giveaway, award, ["pending_verification", "claimable"]);
      if (award.claimTokenHash && !parsed.rotate) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }

      const token = createGiveawayClaimToken();
      const issuedAt = new Date();
      const nextVersion = award.claimTokenVersion + 1;
      await tx.giveawayAward.update({
        where: { id: award.id },
        data: {
          claimTokenHash: hashGiveawayClaimToken(token),
          claimTokenIssuedAt: issuedAt,
          claimTokenVersion: nextVersion,
        },
      });
      await this.auditGiveaway(tx, giveaway.id, rider.id, "GIVEAWAY_CLAIM_TOKEN_ISSUED", "award", award.id, {
        awardId: award.id,
        claimTokenVersion: nextVersion,
        rotated: parsed.rotate,
      });
      return {
        awardId: award.id,
        token,
        qrPayload: toGiveawayClaimQrPayload(token),
        version: nextVersion,
      };
    });
  }

  /** A read-only operator preview. It intentionally does not write an audit record. */
  async resolveGiveawayClaim(
    sessionToken: string,
    payload: string,
  ): Promise<OperatorGiveawayClaimView> {
    const operator = await this.requireUser(sessionToken);
    const tokenHash = this.parseGiveawayClaimPayloadHash(payload);
    const award = await this.prisma.giveawayAward.findUnique({ where: { claimTokenHash: tokenHash } });
    if (!award) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    const giveaway = await this.requireGiveawayCampaign(award.giveawayId);
    await this.requireGiveawayOperator(this.prisma, operator, giveaway);
    this.requireGiveawayClaimGate(giveaway, award, ["pending_verification", "claimable", "verified"]);
    return this.toOperatorGiveawayClaimView(giveaway, award);
  }

  async verifyGiveawayClaim(
    sessionToken: string,
    input: VerifyGiveawayClaimInput,
  ): Promise<OperatorGiveawayClaimView> {
    const operator = await this.requireUser(sessionToken);
    const parsed = this.parseGiveawayClaimVerificationInput(input);
    const tokenHash = this.parseGiveawayClaimPayloadHash(parsed.payload);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { claimTokenHash: tokenHash },
      select: { id: true, giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const preview = await tx.giveawayAward.findUnique({
        where: { id: location.id },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const award = await this.lockGiveawayAward(tx, location.id);
      if (!award || award.claimTokenHash !== tokenHash || award.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      await this.requireGiveawayOperator(tx, operator, giveaway);
      const requestDigest = createHash("sha256")
        .update(canonicalizeJson({ method: parsed.method, presenceObserved: parsed.presenceObserved }))
        .digest("hex");
      const replay = await tx.giveawayClaimVerification.findUnique({
        where: { awardId_idempotencyKey: { awardId: award.id, idempotencyKey: parsed.idempotencyKey } },
      });
      if (replay) {
        if (replay.requestDigest !== requestDigest) {
          throw new BackendError("GIVEAWAY_IDEMPOTENCY_CONFLICT", "GIVEAWAY_IDEMPOTENCY_CONFLICT");
        }
        return this.toOperatorGiveawayClaimView(giveaway, award);
      }
      this.requireGiveawayClaimGate(giveaway, award, ["pending_verification", "claimable"]);
      if (this.requiresGiveawayPresence(giveaway, pool) && !parsed.presenceObserved) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const verification = await tx.giveawayClaimVerification.create({
        data: {
          id: `giveaway-claim-verification-${randomUUID()}`,
          awardId: award.id,
          method: parsed.method as never,
          result: "verified",
          operatorActorUserId: operator.id,
          idempotencyKey: parsed.idempotencyKey,
          requestDigest,
          presenceObserved: parsed.presenceObserved,
        },
      });
      const verifiedAward = await tx.giveawayAward.update({
        where: { id: award.id },
        data: { status: "verified" },
      });
      await this.auditGiveaway(tx, giveaway.id, operator.id, "GIVEAWAY_CLAIM_VERIFIED", "award", award.id, {
        awardId: award.id,
        verificationId: verification.id,
        method: parsed.method,
        presenceObserved: parsed.presenceObserved,
      });
      await this.notifyGiveaway(tx, giveaway, award.winnerUserId, "giveaway_claim_verified", {
        awardId: award.id,
      });
      return this.toOperatorGiveawayClaimView(giveaway, verifiedAward);
    });
  }

  async fulfillGiveawayAward(
    sessionToken: string,
    input: FulfillGiveawayAwardInput,
  ): Promise<OperatorGiveawayClaimView> {
    const operator = await this.requireUser(sessionToken);
    const parsed = this.parseGiveawayFulfillmentInput(input);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: parsed.awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const preview = await tx.giveawayAward.findUnique({
        where: { id: parsed.awardId },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const award = await this.lockGiveawayAward(tx, parsed.awardId);
      if (!award || award.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      await this.requireGiveawayOperator(tx, operator, giveaway);
      const requestDigest = createHash("sha256")
        .update(canonicalizeJson({ reference: parsed.reference ?? null }))
        .digest("hex");
      const replay = await tx.giveawayFulfillment.findUnique({
        where: { awardId_idempotencyKey: { awardId: award.id, idempotencyKey: parsed.idempotencyKey } },
      });
      if (replay) {
        if (replay.requestDigest !== requestDigest) {
          throw new BackendError("GIVEAWAY_IDEMPOTENCY_CONFLICT", "GIVEAWAY_IDEMPOTENCY_CONFLICT");
        }
        return this.toOperatorGiveawayClaimView(giveaway, award);
      }
      this.requireGiveawayClaimGate(giveaway, award, ["verified"], { enforceDeadline: false });
      if (pool.fulfillmentType === "delivery") {
        const detail = await this.lockGiveawayDeliveryDetail(tx, award.id);
        if (
          !detail ||
          detail.purgedAt ||
          !detail.encryptedPayload ||
          !detail.encryptedIv ||
          !detail.encryptedAuthTag ||
          detail.retentionExpiresAt.getTime() <= Date.now()
        ) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
      }
      if (award.prizeItemId) {
        const item = await tx.giveawayPrizeItem.findUnique({ where: { id: award.prizeItemId } });
        if (!item || item.prizePoolId !== pool.id || item.status !== "reserved") {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
      }
      const fulfillment = await tx.giveawayFulfillment.create({
        data: {
          id: `giveaway-fulfillment-${randomUUID()}`,
          awardId: award.id,
          type: pool.fulfillmentType,
          status: "fulfilled",
          operatorActorUserId: operator.id,
          idempotencyKey: parsed.idempotencyKey,
          requestDigest,
          reference: parsed.reference ?? null,
        },
      });
      const fulfilledAward = await tx.giveawayAward.update({
        where: { id: award.id },
        data: { status: "fulfilled" },
      });
      if (award.prizeItemId) {
        await tx.giveawayPrizeItem.update({
          where: { id: award.prizeItemId },
          data: { status: "fulfilled" },
        });
      }
      await this.auditGiveaway(tx, giveaway.id, operator.id, "GIVEAWAY_AWARD_FULFILLED", "award", award.id, {
        awardId: award.id,
        fulfillmentId: fulfillment.id,
        fulfillmentType: pool.fulfillmentType,
      });
      await this.notifyGiveaway(tx, giveaway, award.winnerUserId, "giveaway_fulfilled", {
        awardId: award.id,
      });
      return this.toOperatorGiveawayClaimView(giveaway, fulfilledAward);
    });
  }

  async grantGiveawayOperator(
    sessionToken: string,
    giveawayId: string,
    userId: string,
  ): Promise<{ id: string }> {
    const actor = await this.requireUser(sessionToken);
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(actor, giveaway.event);
      const assignee = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!assignee) throw new BackendError("NOT_FOUND", "NOT_FOUND");
      const existing = await tx.giveawayOperator.findFirst({
        where: { giveawayId: giveaway.id, userId: assignee.id, revokedAt: null },
        select: { id: true },
      });
      if (existing) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      const assignment = await tx.giveawayOperator.create({
        data: {
          id: `giveaway-operator-${randomUUID()}`,
          giveawayId: giveaway.id,
          userId: assignee.id,
          grantedByUserId: actor.id,
        },
      });
      await this.auditGiveaway(tx, giveaway.id, actor.id, "GIVEAWAY_OPERATOR_GRANTED", "operator", assignment.id, {
        operatorAssignmentId: assignment.id,
      });
      return { id: assignment.id };
    });
  }

  async revokeGiveawayOperator(
    sessionToken: string,
    assignmentId: string,
    reason: unknown,
  ): Promise<{ id: string }> {
    const actor = await this.requireUser(sessionToken);
    const normalizedReason = this.requireGiveawayReason(reason);
    const location = await this.prisma.giveawayOperator.findUnique({
      where: { id: assignmentId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      this.requireGiveawayConfigurator(actor, giveaway.event);
      const assignment = await this.lockGiveawayOperator(tx, assignmentId);
      if (!assignment || assignment.giveawayId !== giveaway.id || assignment.revokedAt) {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
      const revocationReasonDigest = this.hashGiveawayReason(normalizedReason);
      await tx.giveawayOperator.update({
        where: { id: assignment.id },
        data: {
          revokedAt: new Date(),
          revokedByUserId: actor.id,
          revocationReasonDigest,
        },
      });
      await this.auditGiveaway(tx, giveaway.id, actor.id, "GIVEAWAY_OPERATOR_REVOKED", "operator", assignment.id, {
        operatorAssignmentId: assignment.id,
        reasonDigest: revocationReasonDigest,
      });
      return { id: assignment.id };
    });
  }

  async listGiveawayOperatorClaims(
    sessionToken: string,
    giveawayId: string,
  ): Promise<OperatorGiveawayClaimView[]> {
    const operator = await this.requireUser(sessionToken);
    const giveaway = await this.requireGiveawayCampaign(giveawayId);
    await this.requireGiveawayOperator(this.prisma, operator, giveaway);
    if (giveaway.status === "suspended") {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    const awards = await this.prisma.giveawayAward.findMany({
      where: {
        giveawayId,
        isCurrent: true,
        status: { in: ["pending_verification", "claimable", "verified"] },
      },
      orderBy: [{ claimDeadlineAt: "asc" }, { createdAt: "asc" }],
    });
    return awards
      .filter(
        (award) => award.status === "verified" || !this.isGiveawayClaimDeadlineElapsed(award),
      )
      .map((award) => this.toOperatorGiveawayClaimView(giveaway, award));
  }

  /** Event-scoped operator queue for the owner, admins, and assigned operators. */
  async listEventGiveawayOperatorClaims(
    sessionToken: string,
    eventId: string,
  ): Promise<EventGiveawayOperatorQueueItem[]> {
    const operator = await this.requireUser(sessionToken);
    await this.requireEvent(eventId);
    const giveaways = await this.prisma.eventGiveaway.findMany({
      where: { eventId },
      include: giveawayConfigurationInclude,
      orderBy: [{ title: "asc" }, { id: "asc" }],
    });
    const queue: EventGiveawayOperatorQueueItem[] = [];
    for (const giveaway of giveaways) {
      try {
        await this.requireGiveawayOperator(this.prisma, operator, giveaway);
      } catch (error) {
        if (error instanceof BackendError && error.code === "FORBIDDEN") continue;
        throw error;
      }
      if (giveaway.status === "suspended") continue;
      const awards = await this.prisma.giveawayAward.findMany({
        where: {
          giveawayId: giveaway.id,
          isCurrent: true,
          status: { in: ["pending_verification", "claimable", "verified"] },
        },
        orderBy: [{ claimDeadlineAt: "asc" }, { createdAt: "asc" }],
      });
      for (const award of awards) {
        if (award.status !== "verified" && this.isGiveawayClaimDeadlineElapsed(award)) continue;
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
    const actor = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireGiveawayConfigurator(actor, event);
    const users = await this.prisma.user.findMany({
      where: {
        verificationStatus: { not: "SUSPENDED" },
        role: { not: "admin" },
      },
      select: { id: true, displayName: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
    return users
      .map((user) => ({ id: user.id, label: user.displayName.trim() || "Unnamed operator" }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  }

  async submitGiveawayDeliveryDetails(
    sessionToken: string,
    awardId: string,
    input: GiveawayDeliveryDetailsInput,
  ): Promise<void> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const parsed = this.parseGiveawayDeliveryDetailsInput(input);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

    await this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const preview = await tx.giveawayAward.findUnique({
        where: { id: awardId },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const award = await this.lockGiveawayAward(tx, awardId);
      if (!award || award.giveawayId !== giveaway.id || award.winnerUserId !== rider.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      this.requireGiveawayClaimGate(giveaway, award, ["verified"], { enforceDeadline: false });
      if (pool.fulfillmentType !== "delivery") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const existing = await this.lockGiveawayDeliveryDetail(tx, award.id);
      if (existing) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

      const payloadVersion = "delivery-v1";
      const aadVersion = "aad-v1";
      const encryptionKeyVersion = "delivery-key-v1";
      let encrypted: ReturnType<typeof encryptGiveawayDeliveryPayload>;
      try {
        encrypted = encryptGiveawayDeliveryPayload(
          parsed.details,
          { awardId: award.id, payloadVersion, aadVersion, encryptionKeyVersion },
          this.requireGiveawayDeliveryEncryptionKey(),
        );
      } catch {
        throw new BackendError(
          "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
          "GIVEAWAY_DELIVERY_CONFIGURATION_ERROR",
        );
      }
      const consentedAt = new Date();
      const detail = await tx.giveawayDeliveryDetail.create({
        data: {
          id: `giveaway-delivery-${randomUUID()}`,
          awardId: award.id,
          submittedByUserId: rider.id,
          consentVersion: parsed.consentVersion,
          payloadVersion,
          aadVersion,
          encryptedPayload: encrypted.ciphertext,
          encryptedIv: encrypted.iv,
          encryptedAuthTag: encrypted.authTag,
          encryptionKeyVersion,
          winnerConsentedAt: consentedAt,
          retentionExpiresAt: new Date(consentedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await this.auditGiveaway(tx, giveaway.id, rider.id, "GIVEAWAY_DELIVERY_SUBMITTED", "delivery_detail", detail.id, {
        awardId: award.id,
        consentVersion: detail.consentVersion,
        retentionExpiresAt: detail.retentionExpiresAt.toISOString(),
      });
    });
  }

  async readGiveawayDeliveryDetails(
    sessionToken: string,
    awardId: string,
  ): Promise<PrivateGiveawayDeliveryDetails> {
    const operator = await this.requireUser(sessionToken);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const preview = await tx.giveawayAward.findUnique({
        where: { id: awardId },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const award = await this.lockGiveawayAward(tx, awardId);
      if (!award || !award.isCurrent || !["verified", "fulfilled"].includes(award.status)) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      await this.requireGiveawayOperator(tx, operator, giveaway);
      if (giveaway.status === "suspended" || pool.fulfillmentType !== "delivery") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const detail = await this.lockGiveawayDeliveryDetail(tx, award.id);
      if (
        !detail ||
        detail.purgedAt ||
        !detail.encryptedPayload ||
        !detail.encryptedIv ||
        !detail.encryptedAuthTag ||
        detail.retentionExpiresAt.getTime() <= Date.now()
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
      await this.auditGiveaway(tx, giveaway.id, operator.id, "GIVEAWAY_DELIVERY_READ", "delivery_detail", detail.id, {
        awardId: award.id,
        deliveryDetailId: detail.id,
      });
      return {
        awardId: award.id,
        consentVersion: detail.consentVersion,
        retentionExpiresAt: detail.retentionExpiresAt.toISOString(),
        details,
      };
    });
  }

  async withdrawGiveawayDeliveryDetails(sessionToken: string, awardId: string): Promise<void> {
    const rider = await this.requireGiveawayRider(sessionToken);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    await this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      const preview = await tx.giveawayAward.findUnique({
        where: { id: awardId },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const award = await this.lockGiveawayAward(tx, awardId);
      if (!award || award.winnerUserId !== rider.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const detail = await this.lockGiveawayDeliveryDetail(tx, award.id);
      if (!detail || detail.purgedAt) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      await this.purgeGiveawayDeliveryDetail(tx, giveaway, detail, rider.id, "withdrawn");
    });
  }

  async purgeExpiredGiveawayDeliveryDetails(sessionToken: string): Promise<{ purgedCount: number }> {
    const administrator = await this.requireRole(sessionToken, "admin");
    return { purgedCount: await this.purgeExpiredGiveawayDeliveryDetailsAsActor(administrator, new Date()) };
  }

  private async purgeExpiredGiveawayDeliveryDetailsAsSystem(now: Date): Promise<number> {
    return this.purgeExpiredGiveawayDeliveryDetailsAsActor(undefined, now, { initiatedVia: "cron" });
  }

  private async purgeExpiredGiveawayDeliveryDetailsAsActor(
    actor: PrismaUserRecord | undefined,
    now: Date,
    options: { initiatedVia?: "cron" } = {},
  ): Promise<number> {
    const expired = await this.prisma.giveawayDeliveryDetail.findMany({
      where: {
        purgedAt: null,
        retentionExpiresAt: { lte: now },
      },
      select: { awardId: true, award: { select: { giveawayId: true } } },
      orderBy: [{ award: { giveawayId: "asc" } }, { awardId: "asc" }],
    });
    let purgedCount = 0;
    for (const candidate of expired) {
      const didPurge = await this.prisma.$transaction(async (tx) => {
        const giveaway = await this.lockGiveawayCampaign(tx, candidate.award.giveawayId);
        if (actor) this.requireGiveawayConfigurator(actor, giveaway.event);
        const preview = await tx.giveawayAward.findUnique({
          where: { id: candidate.awardId },
          select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
        });
        if (!preview || preview.giveawayId !== giveaway.id) return false;
        const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
        await this.lockGiveawayPrizePool(tx, pool.id);
        if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
        const award = await this.lockGiveawayAward(tx, candidate.awardId);
        if (!award) return false;
        const detail = await this.lockGiveawayDeliveryDetail(tx, award.id);
        if (!detail || detail.purgedAt || detail.retentionExpiresAt.getTime() > now.getTime()) return false;
        await this.purgeGiveawayDeliveryDetail(tx, giveaway, detail, actor?.id, "retention_expired", options);
        return true;
      });
      if (didPurge) purgedCount += 1;
    }
    return purgedCount;
  }

  /**
   * Expiry is intentionally non-drawing. A direct finite award is made
   * historical and its item released; a draw award remains a current expired
   * predecessor until an authorized redraw or explicit settlement chooses it.
   */
  async expireGiveawayClaims(sessionToken: string, giveawayId: string): Promise<{ expiredCount: number }> {
    const administrator = await this.requireRole(sessionToken, "admin");
    return this.expireGiveawayClaimsAsActor(administrator, giveawayId);
  }

  private async expireGiveawayClaimsAsActor(
    administrator: PrismaUserRecord,
    giveawayId: string,
    options: { initiatedVia?: "cron"; now?: Date } = {},
  ): Promise<{ expiredCount: number }> {
    const now = options.now ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      if (giveaway.status !== "claims_open") {
        throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      }
      const candidates = await tx.giveawayAward.findMany({
        where: {
          giveawayId: giveaway.id,
          isCurrent: true,
          status: { in: ["pending_verification", "claimable"] },
          claimDeadlineAt: { lte: now },
        },
        select: { id: true, prizePoolId: true, prizeItemId: true },
        orderBy: [{ prizePoolId: "asc" }, { prizeItemId: "asc" }, { id: "asc" }],
      });
      let expiredCount = 0;
      for (const candidate of candidates) {
        const pool = this.requireGiveawayPrizePool(giveaway, candidate.prizePoolId);
        await this.lockGiveawayPrizePool(tx, pool.id);
        if (candidate.prizeItemId) await this.lockGiveawayPrizeItem(tx, candidate.prizeItemId);
        const award = await this.lockGiveawayAward(tx, candidate.id);
        if (
          !award ||
          award.giveawayId !== giveaway.id ||
          !award.isCurrent ||
          !["pending_verification", "claimable"].includes(award.status) ||
          !this.isGiveawayClaimDeadlineElapsed(award, now)
        ) {
          continue;
        }
        const reasonDigest = this.hashGiveawayReason("claim_deadline_elapsed");
        if (this.isDirectGiveawayAward(award)) {
          await this.finalizeDirectGiveawayAward(tx, award, "expired", reasonDigest);
        } else {
          await tx.giveawayAward.update({
            where: { id: award.id },
            data: { status: "expired", reasonDigest },
          });
        }
        const detail = await this.lockGiveawayDeliveryDetail(tx, award.id);
        if (detail && !detail.purgedAt) {
          await this.purgeGiveawayDeliveryDetail(tx, giveaway, detail, administrator.id, "award_expired");
        }
        await this.auditGiveaway(tx, giveaway.id, administrator.id, "GIVEAWAY_CLAIM_EXPIRED", "award", award.id, {
          awardId: award.id,
          directAward: this.isDirectGiveawayAward(award),
          ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
        });
        await this.notifyGiveaway(tx, giveaway, award.winnerUserId, "giveaway_claim_expired", {
          awardId: award.id,
        });
        expiredCount += 1;
      }
      return { expiredCount };
    });
  }

  /**
   * Re-offers a released direct prize only through an explicit, auditable
   * owner/admin action. The frozen snapshot—not live eligibility—is the sole
   * source of replacement candidates, and the new winner gets a fresh,
   * award-specific deadline.
   */
  async recoverExpiredDirectGiveawayAward(
    sessionToken: string,
    input: unknown,
  ): Promise<{ awardId: string | null }> {
    const actor = await this.requireUser(sessionToken);
    const parsed = this.parseExpiredDirectGiveawayRecoveryInput(input);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: parsed.awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");

    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      this.requireGiveawayConfigurator(actor, giveaway.event);
      if (giveaway.status !== "claims_open") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const preview = await tx.giveawayAward.findUnique({
        where: { id: parsed.awardId },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      if (pool.awardMode !== "first_come" && pool.awardMode !== "guaranteed") {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const sourceAward = await this.lockGiveawayAward(tx, parsed.awardId);
      if (
        !sourceAward ||
        sourceAward.giveawayId !== giveaway.id ||
        !this.isDirectGiveawayAward(sourceAward) ||
        sourceAward.isCurrent ||
        sourceAward.recoveryClosedAt ||
        !["expired", "voided", "disqualified", "declined"].includes(sourceAward.status) ||
        !this.isGiveawayClaimDeadlineElapsed(sourceAward)
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }

      const deadline = new Date(parsed.claimDeadlineAt);
      const lockedEntries = await this.lockGiveawayEntries(tx, giveaway.id);
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      const reasonDigest = this.hashGiveawayReason(parsed.reason);
      const replacement = await this.recoverFrozenImmediateGiveawayAwardSlot(
        tx,
        giveaway,
        sourceAward,
        pool,
        snapshot,
        lockedEntries,
        deadline,
      );
      if (replacement) {
        await this.linkGiveawayDirectRecoverySource(
          tx,
          giveaway,
          sourceAward,
          replacement,
          reasonDigest,
          "explicit",
        );
      }
      await this.auditGiveaway(tx, giveaway.id, actor.id, "GIVEAWAY_AWARD_RECOVERED", "award", sourceAward.id, {
        awardId: sourceAward.id,
        replacementAwardId: replacement?.id ?? null,
        reasonDigest,
        claimDeadlineAt: deadline.toISOString(),
      });
      return { awardId: replacement?.id ?? null };
    });
  }

  async settleGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: unknown,
  ): Promise<{ id: string }> {
    const actor = await this.requireUser(sessionToken);
    const normalizedReason = this.requireGiveawayRecoveryClosureReason(reason);
    const location = await this.prisma.giveawayAward.findUnique({
      where: { id: awardId },
      select: { giveawayId: true },
    });
    if (!location) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, location.giveawayId);
      this.requireGiveawayConfigurator(actor, giveaway.event);
      const preview = await tx.giveawayAward.findUnique({
        where: { id: awardId },
        select: { id: true, giveawayId: true, prizePoolId: true, prizeItemId: true },
      });
      if (!preview || preview.giveawayId !== giveaway.id) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
      const award = await this.lockGiveawayAward(tx, awardId);
      if (!award) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const closableDirectRecoverySource =
        this.isDirectGiveawayAward(award) &&
        !award.isCurrent &&
        !award.recoveryClosedAt &&
        ["declined", "disqualified", "expired", "voided"].includes(award.status);
      if (
        giveaway.status !== "claims_open" ||
        (!closableDirectRecoverySource &&
          (!award.isCurrent || !["declined", "disqualified", "expired", "voided"].includes(award.status)))
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const reasonDigest = this.hashGiveawayReason(normalizedReason);
      if (closableDirectRecoverySource) {
        await this.closeGiveawayDirectRecoverySource(tx, award, reasonDigest);
      } else {
        await tx.giveawayAward.update({
          where: { id: award.id },
          data: { isCurrent: false, reasonDigest },
        });
        if (this.isDirectGiveawayAward(award)) {
          await this.closeGiveawayDirectRecoverySource(tx, award, reasonDigest);
        }
      }
      if (award.prizeItemId) {
        await tx.giveawayPrizeItem.updateMany({
          where: { id: award.prizeItemId, status: "reserved" },
          data: { status: "available" },
        });
      }
      const detail = await this.lockGiveawayDeliveryDetail(tx, award.id);
      if (detail && !detail.purgedAt) {
        await this.purgeGiveawayDeliveryDetail(tx, giveaway, detail, actor.id, "award_expired");
      }
      await this.auditGiveaway(tx, giveaway.id, actor.id, "GIVEAWAY_AWARD_SETTLED", "award", award.id, {
        awardId: award.id,
        status: award.status,
        reasonDigest,
        recoveryClosed: this.isDirectGiveawayAward(award),
      });
      return { id: award.id };
    });
  }

  async completeGiveawayClaims(sessionToken: string, giveawayId: string): Promise<{ completed: true }> {
    const actor = await this.requireUser(sessionToken);
    if (!(await this.completeGiveawayClaimsAsActor(actor, giveawayId))) {
      throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
    }
    return { completed: true };
  }

  private async completeGiveawayClaimsAsActor(
    actor: PrismaUserRecord,
    giveawayId: string,
    options: { initiatedVia?: "cron"; now?: Date } = {},
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const giveaway = await this.lockGiveawayCampaign(tx, giveawayId);
      this.requireGiveawayConfigurator(actor, giveaway.event);
      if (giveaway.status !== "claims_open") {
        return false;
      }
      const unresolved = await tx.giveawayAward.findFirst({
        where: {
          giveawayId: giveaway.id,
          isCurrent: true,
          status: { not: "fulfilled" },
        },
        select: { id: true },
      });
      if (unresolved) return false;
      if (await this.hasUnresolvedTerminalDirectGiveawayAward(tx, giveaway)) {
        return false;
      }
      await tx.eventGiveaway.update({ where: { id: giveaway.id }, data: { status: "completed" } });
      await this.auditGiveaway(tx, giveaway.id, actor.id, "GIVEAWAY_COMPLETED", "giveaway", giveaway.id, {
        giveawayId: giveaway.id,
        completion: options.initiatedVia ? "cron_eligible_settlement" : "explicit_claim_settlement",
        ...(options.initiatedVia ? { initiatedVia: options.initiatedVia } : {}),
      });
      return true;
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

    const baseSlug = slugify(title);
    const existing = await this.prisma.event.findUnique({ where: { slug: baseSlug } });
    const slug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;
    const type = input.type;
    const event = await this.prisma.event.create({
      data: {
        id: slug,
        slug,
        title,
        type: eventTypeToDb[type] as never,
        status: "PENDING_ADMIN_REVIEW",
        organizerId,
        locationName: location.locationName,
        locationAddress: location.locationAddress,
        locationMapLink: location.locationMapLink ?? null,
        poster: "/demo/poster-tambike-cafe-classico.jpg",
        dateLabel: date,
        timeLabel: time,
        area: location.area,
        expectedRiders,
        description: `${title} is awaiting admin review.`,
        whatHappens:
          "Organizer-created draft that will move through admin publish.",
        perkPreview,
        tags: [type, "Admin review"],
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
            description: perkPreview,
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
          rosterIdentity: user.defaultRosterIdentity,
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
      rosterIdentity: result.rsvp.rosterIdentity,
    };
    if (!result.pass) {
      return { rsvp: rsvpDto, pass: null };
    }
    await this.audit("PASS_CREATED", user.id, "Pass", result.pass.id);
    return { rsvp: rsvpDto, pass: this.toPass(result.pass) };
  }

  async configureEventRoster(
    sessionToken: string,
    eventId: string,
    input: { enabled: boolean },
  ): Promise<EventAttendeeSummary> {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireRosterEvent(eventId);
    this.requireRosterConfigurator(user, event);
    if (typeof input?.enabled !== "boolean") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`,
      );
      const previousEnabled =
        (await tx.eventRosterSettings.findUnique({
          where: { eventId },
          select: { enabled: true },
        }))?.enabled ?? false;
      await tx.eventRosterSettings.upsert({
        where: { eventId },
        create: { eventId, enabled: input.enabled },
        update: { enabled: input.enabled },
      });
      await tx.auditLog.create({
        data: {
          action: "ROSTER_SETTINGS_UPDATED",
          actorUserId: user.id,
          targetType: "Event",
          targetId: eventId,
          metadata: {
            previousEnabled,
            nextEnabled: input.enabled,
          },
        },
      });
    });
    return this.buildPrismaRosterSummary(eventId, event.title, input.enabled);
  }

  async listEventAttendees(
    sessionToken: string | undefined,
    eventId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<EventAttendeeRosterPage> {
    const event = await this.requireRosterEvent(eventId);
    const enabled = event.rosterSettings?.enabled ?? false;
    if (enabled) {
      if (!sessionToken) throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
      await this.requireUser(sessionToken);
    }
    const limit = normalizeRosterPageLimit(options.limit);
    const cursor = options.cursor ? decodeRosterCursor(options.cursor) : undefined;

    const summary = await this.buildPrismaRosterSummary(event.id, event.title, enabled);
    if (!enabled) {
      return { summary, attendees: [], pageSize: limit };
    }

    const visibleWhere = {
      eventId,
      status: "going" as const,
      goingAt: { not: null },
      user: {
        defaultRosterIdentity: "VISIBLE" as const,
        profileSlug: { not: null },
        profileVisibility: { not: "PRIVATE" as const },
      },
      ...(cursor
        ? {
            OR: [
              { goingAt: { gt: new Date(cursor.goingAt) } },
              { goingAt: new Date(cursor.goingAt), id: { gt: cursor.rsvpId } },
            ],
          }
        : {}),
    } satisfies Prisma.RSVPWhereInput;
    const rows = await this.prisma.rSVP.findMany({
      where: visibleWhere,
      orderBy: [{ goingAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        goingAt: true,
        user: {
          include: {
            motorcycle: { include: { photos: { orderBy: { position: "asc" } } } },
          },
        },
      },
    });
    const hasNextPage = rows.length > limit;
    const selected = rows.slice(0, limit);
    const attendees = await Promise.all(
      selected.map(async ({ user: attendee }) => {
        const profile = await this.sanitizeMemberProfile(attendee);
        return {
          slug: profile.slug,
          displayName: profile.displayName,
          area: profile.area,
          profilePhotoUrl: profile.profilePhotoUrl,
          motorcycle: profile.motorcycle,
        };
      }),
    );
    const last = selected.at(-1);
    return {
      summary,
      attendees,
      nextCursor:
        hasNextPage && last?.goingAt
          ? encodeRosterCursor({ goingAt: last.goingAt.toISOString(), rsvpId: last.id })
          : undefined,
      pageSize: limit,
    };
  }

  async getEventAttendeeSummary(eventId: string): Promise<EventAttendeeSummary> {
    const event = await this.requireRosterEvent(eventId);
    return this.buildPrismaRosterSummary(
      event.id,
      event.title,
      event.rosterSettings?.enabled ?? false,
    );
  }

  async getPublicEventAttendeePreview(
    eventId: string,
  ): Promise<EventAttendeePublicPreview> {
    const event = await this.requireRosterEvent(eventId);
    const enabled = event.rosterSettings?.enabled ?? false;
    const summary = await this.buildPrismaRosterSummary(
      event.id,
      event.title,
      enabled,
    );
    if (!enabled) return { summary, attendees: [] };

    const rows = await this.prisma.rSVP.findMany({
      where: {
        eventId,
        status: "going",
        goingAt: { not: null },
        user: {
          defaultRosterIdentity: "VISIBLE",
          profileSlug: { not: null },
          profileVisibility: "PUBLIC",
        },
      },
      orderBy: [{ goingAt: "asc" }, { id: "asc" }],
      take: PUBLIC_ATTENDEE_PREVIEW_LIMIT,
      select: {
        user: {
          include: {
            motorcycle: {
              include: { photos: { orderBy: { position: "asc" } } },
            },
          },
        },
      },
    });

    const attendees = await Promise.all(
      rows.map(async ({ user }) => {
        const profile = await this.sanitizeMemberProfile(user);
        return {
          slug: profile.slug,
          displayName: profile.displayName,
          area: profile.area,
          profilePhotoUrl: profile.profilePhotoUrl,
        };
      }),
    );
    return { summary, attendees };
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

  async approvePublish(sessionToken: string, eventId: string) {
    const user = await this.requireRole(sessionToken, "admin");
    await this.requireEvent(eventId);
    const event = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.updateMany({
        where: { id: eventId, status: "PENDING_ADMIN_REVIEW" },
        data: { status: "PUBLISHED" },
      });
      if (updated.count !== 1) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }

      await tx.eventApproval.upsert({
        where: { id: `admin-review-${eventId}` },
        create: {
          id: `admin-review-${eventId}`,
          eventId,
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

      return tx.event.findUniqueOrThrow({
        where: { id: eventId },
        include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
      });
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
      include: { organizerProfile: true },
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
    return alias === entryReference || /^(?:entry|claim)_[A-Za-z0-9_-]+$/i.test(alias);
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
      (record.claimDeadlineAt !== undefined &&
        (typeof record.claimDeadlineAt !== "string" || !record.claimDeadlineAt.trim()))
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

  private parseGiveawayClaimTokenIssueInput(input: unknown) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== "rotate") ||
      ((input as Record<string, unknown>).rotate !== undefined &&
        typeof (input as Record<string, unknown>).rotate !== "boolean")
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return { rotate: (input as { rotate?: boolean }).rotate === true };
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

  private parseGiveawayClaimPayloadHash(payload: string) {
    try {
      return hashGiveawayClaimToken(parseGiveawayClaimQrPayload(payload));
    } catch {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
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
          !["sourceAwardId", "snapshotEntryId", "reason", "idempotencyKey", "claimDeadlineAt"].includes(
            key,
          ),
      ) ||
      (record.claimDeadlineAt !== undefined &&
        (typeof record.claimDeadlineAt !== "string" || !record.claimDeadlineAt.trim()))
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    for (const field of ["sourceAwardId", "snapshotEntryId", "idempotencyKey"] as const) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
    }
    return {
      sourceAwardId: this.requireOpaqueGiveawayLedgerText(record.sourceAwardId),
      snapshotEntryId: this.requireOpaqueGiveawayLedgerText(record.snapshotEntryId),
      idempotencyKey: this.requireOpaqueGiveawayLedgerText(record.idempotencyKey),
      reason: this.requireGiveawayReason(record.reason),
      ...(typeof record.claimDeadlineAt === "string"
        ? { claimDeadlineAt: this.resolveExplicitGiveawayClaimDeadline(record.claimDeadlineAt) }
        : {}),
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
          snapshotEntryId: actionInput.snapshotEntryId ?? null,
          predecessorAwardId: actionInput.predecessorAwardId ?? null,
          claimDeadlineAt: actionInput.claimDeadlineAt ?? null,
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

  private requireGiveawayClaimGate(
    giveaway: Pick<GiveawayConfiguration, "status">,
    award: Pick<GiveawayAwardRecord, "isCurrent" | "status" | "claimDeadlineAt">,
    acceptedStatuses: readonly string[],
    options: { enforceDeadline?: boolean } = {},
  ) {
    if (
      giveaway.status !== "claims_open" ||
      !award.isCurrent ||
      !acceptedStatuses.includes(award.status) ||
      ((options.enforceDeadline ?? true) && this.isGiveawayClaimDeadlineElapsed(award))
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
  }

  /** A rider may decline a verified claim after its cutoff, but never a late unclaimed award. */
  private requireGiveawayRiderDeclineGate(
    award: Pick<GiveawayAwardRecord, "isCurrent" | "status" | "claimDeadlineAt">,
  ) {
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
    return Boolean(award.claimDeadlineAt && award.claimDeadlineAt.getTime() <= now.getTime());
  }

  /**
   * Keep claims open for every unclosed terminal direct source. Its deadline
   * controls re-offer timing, not whether a future human resolution exists.
   */
  private async hasUnresolvedTerminalDirectGiveawayAward(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
  ) {
    const awards = await tx.giveawayAward.findMany({
      where: {
        giveawayId: giveaway.id,
        drawId: null,
        snapshotEntryId: null,
        isCurrent: false,
        recoveryClosedAt: null,
        status: { in: ["declined", "voided", "disqualified", "expired"] },
      },
      select: { prizePoolId: true, claimDeadlineAt: true },
      orderBy: { id: "asc" },
    });
    return awards.some((award) => {
      const pool = giveaway.prizePools.find((candidate) => candidate.id === award.prizePoolId);
      return pool?.awardMode === "first_come" || pool?.awardMode === "guaranteed";
    });
  }

  /** A new winner may never inherit an elapsed campaign deadline. */
  private resolveGiveawayReplacementClaimDeadline(
    giveaway: Pick<GiveawayConfiguration, "claimDeadlineAt">,
    requestedDeadlineAt?: string,
  ) {
    if (requestedDeadlineAt) {
      return new Date(requestedDeadlineAt);
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

  private hasUsableGiveawayReplacementDeadline(
    giveaway: Pick<GiveawayConfiguration, "claimDeadlineAt">,
  ) {
    return !giveaway.claimDeadlineAt || giveaway.claimDeadlineAt.getTime() > Date.now();
  }

  private requiresGiveawayPresence(
    giveaway: Pick<GiveawayConfiguration, "presenceVerificationRequired">,
    pool: Pick<GiveawayConfiguration["prizePools"][number], "presenceVerificationRequired">,
  ) {
    return giveaway.presenceVerificationRequired || pool.presenceVerificationRequired;
  }

  private requireGiveawayPrizePool(
    giveaway: Pick<GiveawayConfiguration, "prizePools">,
    prizePoolId: string,
  ) {
    const pool = giveaway.prizePools.find((candidate) => candidate.id === prizePoolId);
    if (!pool) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    return pool;
  }

  private async requireGiveawayOperator(
    client: Prisma.TransactionClient | PrismaClient,
    user: { id: string; role: string; verificationStatus: string },
    giveaway: GiveawayConfiguration,
  ) {
    if (user.role === "admin") return;
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      giveaway.event.organizer.userId === user.id
    ) {
      return;
    }
    const operator = await client.giveawayOperator.findFirst({
      where: { giveawayId: giveaway.id, userId: user.id, revokedAt: null },
      select: { id: true },
    });
    if (!operator) throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private toOperatorGiveawayClaimView(
    giveaway: GiveawayConfiguration,
    award: GiveawayAwardRecord,
  ): OperatorGiveawayClaimView {
    if (
      !["pending_verification", "claimable", "verified", "fulfilled", "expired", "voided"].includes(
        award.status,
      )
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const pool = this.requireGiveawayPrizePool(giveaway, award.prizePoolId);
    return {
      awardId: award.id,
      giveawayId: giveaway.id,
      claimReference: award.opaqueClaimReference,
      prizePoolTitle: pool.title,
      fulfilmentMode: pool.fulfillmentType as GiveawayFulfilmentMode,
      presenceVerificationRequired: this.requiresGiveawayPresence(giveaway, pool),
      claimDeadlineAt: award.claimDeadlineAt?.toISOString(),
      status: award.status as OperatorGiveawayClaimView["status"],
    };
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

  /**
   * Cron has no user session, so explicitly apply the active-user guard before
   * accepting the immutable creator as lifecycle provenance. This prevents a
   * suspended admin-shaped creator from bypassing `requireUser()` semantics.
   */
  private async findGiveawayCronActor(giveaway: GiveawayConfiguration): Promise<PrismaUserRecord | null> {
    const actor = await this.prisma.user.findUnique({
      where: { id: giveaway.creatorUserId },
      include: { organizerProfile: true },
    });
    if (!actor || actor.verificationStatus === "SUSPENDED") return null;
    try {
      this.requireGiveawayConfigurator(actor, giveaway.event);
      return actor;
    } catch {
      return null;
    }
  }

  private isGiveawayScheduleDue(value: Date | null | undefined, now: Date | undefined) {
    return Boolean(value && now && value.getTime() <= now.getTime());
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

  private async lockGiveawayDeliveryDetail(tx: Prisma.TransactionClient, awardId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "GiveawayDeliveryDetail" WHERE "awardId" = ${awardId} FOR UPDATE`,
    );
    if (rows.length === 0) return null;
    return tx.giveawayDeliveryDetail.findUnique({ where: { awardId } });
  }

  private async lockGiveawayOperator(tx: Prisma.TransactionClient, assignmentId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "GiveawayOperator" WHERE "id" = ${assignmentId} FOR UPDATE`,
    );
    if (rows.length === 0) return null;
    return tx.giveawayOperator.findUnique({ where: { id: assignmentId } });
  }

  private async purgeGiveawayDeliveryDetail(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    detail: Prisma.GiveawayDeliveryDetailGetPayload<Record<string, never>>,
    actorUserId: string | undefined,
    reason: "withdrawn" | "retention_expired" | "award_expired",
    options: { initiatedVia?: "cron" } = {},
  ) {
    if (detail.purgedAt) return;
    await tx.giveawayDeliveryDetail.update({
      where: { id: detail.id },
      data: {
        encryptedPayload: null,
        encryptedIv: null,
        encryptedAuthTag: null,
        purgedAt: new Date(),
      },
    });
    await this.auditGiveaway(
      tx,
      giveaway.id,
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

  private isDirectGiveawayAward(award: Pick<GiveawayAwardRecord, "drawId" | "snapshotEntryId">) {
    return !award.drawId && !award.snapshotEntryId;
  }

  private async closeGiveawayDirectRecoverySource(
    tx: Prisma.TransactionClient,
    award: GiveawayAwardRecord,
    reasonDigest: string,
  ) {
    if (!this.isDirectGiveawayAward(award) || award.recoveryClosedAt) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    const closed = await tx.giveawayAward.updateMany({
      where: { id: award.id, recoveryClosedAt: null },
      data: {
        recoveryClosedAt: new Date(),
        recoveryClosedReasonDigest: reasonDigest,
      },
    });
    if (closed.count !== 1) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
  }

  private async linkGiveawayDirectRecoverySource(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
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
      sourceAward.prizePoolId !== replacement.prizePoolId
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    await this.closeGiveawayDirectRecoverySource(tx, sourceAward, reasonDigest);
    if (initiatedVia === "automatic") {
      await this.auditGiveaway(
        tx,
        giveaway.id,
        undefined,
        "GIVEAWAY_DIRECT_RECOVERY_LINKED",
        "award",
        sourceAward.id,
        {
          awardId: sourceAward.id,
          replacementAwardId: replacement.id,
          reasonDigest,
          initiatedVia,
        },
      );
    }
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
    status: "declined" | "voided" | "disqualified" | "expired",
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
    sourceAward: GiveawayAwardRecord,
    lockedEntries: GiveawayEntryWrite["entry"][] | undefined,
  ) {
    if (sourceAward.recoveryClosedAt || this.isGiveawayClaimDeadlineElapsed(sourceAward)) return;
    const pool = this.requireGiveawayPrizePool(giveaway, sourceAward.prizePoolId);
    if (pool.awardMode !== "first_come" && pool.awardMode !== "guaranteed") return;
    let replacement: GiveawayAwardRecord | null = null;
    if (giveaway.status === "open") {
      replacement = await this.reallocateImmediateDirectGiveawayAwardSlot(tx, giveaway, sourceAward, pool);
    } else if (
      ["locked", "drawing", "claims_open"].includes(giveaway.status) &&
      this.hasUsableGiveawayReplacementDeadline(giveaway)
    ) {
      if (!lockedEntries) throw new BackendError("INVALID_GIVEAWAY_STATE", "INVALID_GIVEAWAY_STATE");
      const snapshot = await this.requireGiveawaySnapshot(tx, giveaway.id);
      replacement = await this.recoverFrozenImmediateGiveawayAwardSlot(
        tx,
        giveaway,
        sourceAward,
        pool,
        snapshot,
        lockedEntries,
        giveaway.claimDeadlineAt,
      );
    }
    if (replacement) {
      await this.linkGiveawayDirectRecoverySource(
        tx,
        giveaway,
        sourceAward,
        replacement,
        this.hashGiveawayReason("automatic_direct_reallocation"),
        "automatic",
      );
    }
  }

  private async reallocateImmediateDirectGiveawayAwardSlot(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    sourceAward: GiveawayAwardRecord,
    pool: GiveawayConfiguration["prizePools"][number],
  ): Promise<GiveawayAwardRecord | null> {
    let prizeItemId: string | null = null;
    if (pool.awardMode === "first_come") {
      if (!sourceAward.prizeItemId) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const targetPrizeItem = await this.lockGiveawayPrizeItem(tx, sourceAward.prizeItemId);
      if (
        !targetPrizeItem ||
        targetPrizeItem.prizePoolId !== pool.id ||
        targetPrizeItem.status !== "available"
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      prizeItemId = targetPrizeItem.id;
    }
    const elapsedRecoveryReservation = await this.getElapsedDirectGiveawayRecoveryReservation(
      tx,
      giveaway,
      sourceAward.id,
    );
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
    for (const entry of orderedCandidates) {
      const allocationEligibilityAt = resolveGiveawayPoolEligibilityPriority({
        eligibilityCycleAt: entry.eligibilityCycleAt.toISOString(),
        qualifiedEligibilityGroupTimings: this.entryQualifiedGroupTimings(entry),
        permittedGroupIds: pool.eligibilityGroups.map((link) => link.eligibilityGroupId),
      });
      if (!allocationEligibilityAt) continue;
      const directAllocationKey = `direct:${entry.id}:${pool.id}:${allocationEligibilityAt}`;
      const [historicAward, currentPoolAward, canAward] = await Promise.all([
        tx.giveawayAward.findUnique({ where: { directAllocationKey } }),
        tx.giveawayAward.findFirst({
          where: {
            giveawayId: giveaway.id,
            entryId: entry.id,
            prizePoolId: pool.id,
            drawId: null,
            isCurrent: true,
          },
          select: { id: true },
        }),
        this.canCreateDirectGiveawayAward(
          tx,
          giveaway,
          pool,
          entry.riderId,
          elapsedRecoveryReservation.reservedTotalAwardSlots,
        ),
      ]);
      if (historicAward || currentPoolAward || !canAward) continue;
      if (prizeItemId) {
        const reservation = await tx.giveawayPrizeItem.updateMany({
          where: { id: prizeItemId, prizePoolId: pool.id, status: "available" },
          data: { status: "reserved" },
        });
        if (reservation.count !== 1) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
      }
      const award = await tx.giveawayAward.create({
        data: {
          id: `giveaway-award-${randomUUID()}`,
          giveawayId: giveaway.id,
          entryId: entry.id,
          prizePoolId: pool.id,
          prizeItemId,
          winnerUserId: entry.riderId,
          status: this.requiresGiveawayPresence(giveaway, pool)
            ? "pending_verification"
            : "claimable",
          isCurrent: true,
          directAllocationKey,
          allocationEligibilityAt: new Date(allocationEligibilityAt),
          recoverySourceAwardId: sourceAward.id,
          opaqueClaimReference: `claim_${randomBytes(16).toString("base64url")}`,
          claimDeadlineAt: giveaway.claimDeadlineAt,
        },
      });
      await this.notifyGiveaway(tx, giveaway, award.winnerUserId, "giveaway_winner", {
        awardId: award.id,
      });
      return award;
    }
    return null;
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
    const [currentGroups, currentPools, referencedGroups, referencedPools] = await Promise.all([
      tx.giveawayEligibilityGroup.findMany({
        where: { giveawayId },
        select: { id: true, position: true },
      }),
      tx.giveawayPrizePool.findMany({
        where: { giveawayId },
        select: {
          id: true,
          position: true,
          publicImage: {
            select: {
              id: true,
              uploadedByUserId: true,
              storageKey: true,
            },
          },
        },
      }),
      groups.length
        ? tx.giveawayEligibilityGroup.findMany({
            where: { id: { in: groups.map((group) => group.id) } },
            select: { id: true, giveawayId: true },
          })
        : Promise.resolve([]),
      pools.length
        ? tx.giveawayPrizePool.findMany({
            where: { id: { in: pools.map((pool) => pool.id) } },
            select: { id: true, giveawayId: true },
          })
        : Promise.resolve([]),
    ]);
    if (
      referencedGroups.some((group) => group.giveawayId !== giveawayId) ||
      referencedPools.some((pool) => pool.giveawayId !== giveawayId)
    ) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const currentGroupIds = new Set(currentGroups.map((group) => group.id));
    const currentPoolIds = new Set(currentPools.map((pool) => pool.id));
    const currentPoolsById = new Map(
      currentPools.map((pool) => [pool.id, pool]),
    );
    const retainedGroupIds = new Set(
      groups.filter((group) => currentGroupIds.has(group.id)).map((group) => group.id),
    );
    const retainedPoolIds = new Set(
      pools.filter((pool) => currentPoolIds.has(pool.id)).map((pool) => pool.id),
    );
    const removedGroupIds = currentGroups
      .map((group) => group.id)
      .filter((id) => !retainedGroupIds.has(id));
    const removedPoolIds = currentPools
      .map((pool) => pool.id)
      .filter((id) => !retainedPoolIds.has(id));

    await tx.giveawayPrizePoolEligibilityGroup.deleteMany({
      where: { prizePool: { giveawayId } },
    });
    await tx.giveawayPrizeItem.deleteMany({ where: { prizePool: { giveawayId } } });
    await tx.giveawayEligibilityCondition.deleteMany({ where: { group: { giveawayId } } });
    if (removedPoolIds.length) {
      const cleanupAfter = new Date();
      for (const pool of currentPools) {
        if (!removedPoolIds.includes(pool.id) || !pool.publicImage) continue;
        await tx.memberMediaCleanupIntent.upsert({
          where: { storageKey: pool.publicImage.storageKey },
          create: {
            userId: pool.publicImage.uploadedByUserId,
            storageKey: pool.publicImage.storageKey,
            cleanupAfter,
          },
          update: { cleanupAfter },
        });
      }
      await tx.giveawayPrizeImage.deleteMany({
        where: { prizePoolId: { in: removedPoolIds } },
      });
      await tx.giveawayPrizePool.deleteMany({
        where: { id: { in: removedPoolIds }, giveawayId },
      });
    }
    if (removedGroupIds.length) {
      await tx.giveawayEligibilityGroup.deleteMany({
        where: { id: { in: removedGroupIds }, giveawayId },
      });
    }

    const temporaryGroupPositionBase =
      Math.max(groups.length, ...currentGroups.map((group) => group.position)) + 1;
    const temporaryPoolPositionBase =
      Math.max(pools.length, ...currentPools.map((pool) => pool.position)) + 1;
    for (const [temporaryPosition, id] of [...retainedGroupIds].entries()) {
      await tx.giveawayEligibilityGroup.update({
        where: { id },
        data: { position: temporaryGroupPositionBase + temporaryPosition },
      });
    }
    for (const [temporaryPosition, id] of [...retainedPoolIds].entries()) {
      await tx.giveawayPrizePool.update({
        where: { id },
        data: { position: temporaryPoolPositionBase + temporaryPosition },
      });
    }

    const groupIdByRequestId = new Map<string, string>();
    for (const [position, group] of groups.entries()) {
      const id = currentGroupIds.has(group.id)
        ? group.id
        : `giveaway-eligibility-group-${randomUUID()}`;
      groupIdByRequestId.set(group.id, id);
      const data = {
        position,
        label: group.label,
        entryWeight: group.weight,
        enabled: true,
        conditions: {
          create: group.conditions.map((condition) => ({
            id: `giveaway-eligibility-condition-${randomUUID()}`,
            source: condition.source as never,
            perkId: condition.source === "perk_redemption" ? condition.perkId : null,
            config: this.toJsonValue(condition),
          })),
        },
      };
      if (currentGroupIds.has(id)) {
        await tx.giveawayEligibilityGroup.update({
          where: { id },
          data,
        });
      } else {
        await tx.giveawayEligibilityGroup.create({
          data: {
            id,
            giveawayId,
            ...data,
          },
        });
      }
    }

    for (const [position, pool] of pools.entries()) {
      const id = currentPoolIds.has(pool.id)
        ? pool.id
        : `giveaway-prize-pool-${randomUUID()}`;
      const currentPool = currentPoolsById.get(id);
      if (
        pool.publicPresentation.disclosure === "surprise" &&
        currentPool?.publicImage
      ) {
        const cleanupAfter = new Date();
        await tx.memberMediaCleanupIntent.upsert({
          where: { storageKey: currentPool.publicImage.storageKey },
          create: {
            userId: currentPool.publicImage.uploadedByUserId,
            storageKey: currentPool.publicImage.storageKey,
            cleanupAfter,
          },
          update: { cleanupAfter },
        });
        await tx.giveawayPrizeImage.delete({
          where: { id: currentPool.publicImage.id },
        });
      }
      const eligibilityGroupIds = (pool.eligibilityGroupIds ?? []).map((requestId) => {
        const persistedId = groupIdByRequestId.get(requestId);
        if (!persistedId) {
          throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
        }
        return persistedId;
      });
      const data = {
        position,
        title: pool.title,
        publicDisclosure: pool.publicPresentation.disclosure as never,
        publicTitle:
          pool.publicPresentation.disclosure === "revealed"
            ? (pool.publicPresentation.title?.trim() ?? null)
            : null,
        publicDescription:
          pool.publicPresentation.disclosure === "revealed"
            ? (pool.publicPresentation.description?.trim() || null)
            : null,
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
      };
      if (currentPoolIds.has(id)) {
        await tx.giveawayPrizePool.update({
          where: { id },
          data,
        });
      } else {
        await tx.giveawayPrizePool.create({
          data: {
            id,
            giveawayId,
            ...data,
          },
        });
      }
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
      awardMode: pool.awardMode as PublicGiveawayPrizePoolSummary["awardMode"],
      inventoryKind: pool.inventoryLimit === null ? "unlimited" : "finite",
      itemQuantity: pool.inventoryLimit === null ? undefined : pool.prizeItems.length,
      presenceVerificationRequired: this.requiresGiveawayPresence(giveaway, pool),
      presentation: toPublicPrizePresentation({
        disclosure: pool.publicDisclosure,
        publicTitle: pool.publicTitle ?? undefined,
        publicDescription: pool.publicDescription ?? undefined,
        publicImage: pool.publicImage
          ? {
              mediaId: pool.publicImage.mediaId,
              url: `/giveaway-prize-media/${encodeURIComponent(pool.publicImage.mediaId)}`,
              width: pool.publicImage.width,
              height: pool.publicImage.height,
            }
          : undefined,
      }),
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

  private async canViewPublicEventGiveaway(
    giveaway: GiveawayConfiguration,
    viewerId?: string,
  ) {
    if (!this.isPublicEventGiveaway(giveaway)) return false;
    if (giveaway.visibility === "hidden") return false;
    if (giveaway.visibility === "event_page") return true;
    if (!viewerId) return false;
    if (giveaway.visibility === "registered_riders") {
      const rsvp = await this.prisma.rSVP.findUnique({
        where: { eventId_userId: { eventId: giveaway.eventId, userId: viewerId } },
        select: { status: true },
      });
      return rsvp?.status === "going";
    }
    const entry = await this.prisma.giveawayEntry.findUnique({
      where: { giveawayId_riderId: { giveawayId: giveaway.id, riderId: viewerId } },
      select: { status: true },
    });
    return Boolean(entry && entry.status !== "withdrawn");
  }

  private isPublicEventGiveaway(giveaway: GiveawayConfiguration) {
    return (
      giveaway.complianceStatus === "approved" &&
      !["draft", "cancelled", "suspended"].includes(giveaway.status)
    );
  }

  /** Returns only published fairness receipts; candidate rows and seed ciphertext stay server-private. */
  private async toPublicGiveawayDrawVerifications(
    giveaway: GiveawayConfiguration,
    client: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<PublicGiveawayDrawVerification[]> {
    if (!process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY) return [];
    const [snapshot, draws] = await Promise.all([
      client.giveawaySnapshot.findUnique({
        where: { giveawayId: giveaway.id },
        select: {
          seedCommitment: true,
          snapshotDigest: true,
          candidateCount: true,
          encryptedSeedCiphertext: true,
          encryptedSeedIv: true,
          encryptedSeedAuthTag: true,
          seedRevealedAt: true,
        },
      }),
      client.giveawayDraw.findMany({
        where: { giveawayId: giveaway.id, status: "published" },
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
      }),
    ]);
    if (!snapshot?.seedRevealedAt || draws.length === 0) return [];
    const seed = this.decryptGiveawayDrawSeed(snapshot);
    return draws.map((draw) => this.buildGiveawayDrawVerification(giveaway, snapshot, draw, seed, true));
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

  private async toPublicGiveawayResults(
    giveaway: GiveawayConfiguration,
  ): Promise<PublicGiveawayResult[]> {
    if (!["claims_open", "completed"].includes(giveaway.status)) return [];
    const snapshot = await this.prisma.giveawaySnapshot.findUnique({
      where: { giveawayId: giveaway.id },
      select: { seedRevealedAt: true },
    });
    if (!snapshot?.seedRevealedAt) return [];
    const awards = await this.prisma.giveawayAward.findMany({
      where: {
        giveawayId: giveaway.id,
        isCurrent: true,
        status: { in: ["pending_verification", "claimable", "verified", "fulfilled"] },
      },
      select: {
        id: true,
        drawId: true,
        snapshotEntryId: true,
        publicWinnerAlias: true,
        winnerAliasOptedInAt: true,
        winnerAliasRevokedAt: true,
        prizePool: {
          select: {
            position: true,
            publicDisclosure: true,
            publicTitle: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });
    return awards
      .filter(
        (award) =>
          Boolean(award.drawId && award.snapshotEntryId) && this.isGiveawayWinnerAliasPublic(award),
      )
      .sort(
        (left, right) =>
          left.prizePool.position - right.prizePool.position ||
          (left.publicWinnerAlias ?? "").localeCompare(right.publicWinnerAlias ?? "") ||
          left.id.localeCompare(right.id),
      )
      .map((award) => ({
        prizeTitle: toPublicPrizePresentation({
          disclosure: award.prizePool.publicDisclosure,
          publicTitle: award.prizePool.publicTitle ?? undefined,
        }).title,
        winnerAlias: award.publicWinnerAlias!,
      }));
  }

  private toOrganizerGiveawayWorkspace(
    giveaway: GiveawayConfiguration,
  ): OrganizerGiveawayWorkspace {
    const mechanics = this.currentGiveawayMechanics(giveaway);
    return {
      id: giveaway.id,
      eventId: giveaway.eventId,
      title: giveaway.title,
      kind: giveaway.kind as OrganizerGiveawayWorkspace["kind"],
      state: giveaway.status as GiveawayState,
      complianceStatus: giveaway.complianceStatus as OrganizerGiveawayWorkspace["complianceStatus"],
      entryMode: giveaway.entryMode as OrganizerGiveawayWorkspace["entryMode"],
      maxEntriesPerRider: giveaway.maxEntriesPerRider,
      mechanics: mechanics.mechanics,
      terms: mechanics.terms,
      sponsorDisclosure: mechanics.sponsorDisclosure ?? undefined,
      timeZone: giveaway.timeZone,
      winnerLimits: { perRider: giveaway.maxWinsPerRider, total: giveaway.maxWinsTotal },
      publicVisibility: giveaway.visibility as GiveawayPublicVisibility,
      presenceVerificationRequired: giveaway.presenceVerificationRequired,
      entryOpensAt: giveaway.entryOpensAt?.toISOString(),
      entryClosesAt: giveaway.entryClosesAt?.toISOString(),
      drawAt: giveaway.drawAt?.toISOString(),
      claimDeadlineAt: giveaway.claimDeadlineAt?.toISOString(),
      eligibilityGroups: giveaway.eligibilityGroups.map((group) => ({
        id: group.id,
        label: group.label,
        weight: group.entryWeight,
        conditions: group.conditions.map((condition) =>
          this.toOrganizerGiveawayEligibilityCondition(condition),
        ),
      })),
      prizePools: giveaway.prizePools.map((pool) => this.toOrganizerGiveawayPrizePool(pool)),
    };
  }

  private toOrganizerGiveawayEligibilityCondition(condition: {
    source: string;
    perkId: string | null;
  }): GiveawayEligibilityConditionInput {
    switch (condition.source) {
      case "active_rsvp_pass":
      case "confirmed_check_in":
      case "staff_confirmed_check_in":
      case "campaign_code":
      case "manual":
        return { source: condition.source };
      case "perk_redemption":
        if (!condition.perkId) throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
        return { source: "perk_redemption", perkId: condition.perkId };
      default:
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
  }

  private toOrganizerGiveawayPrizePool(
    pool: GiveawayConfiguration["prizePools"][number],
  ): GiveawayPrizePoolInput {
    const base = {
      id: pool.id,
      title: pool.title,
      fulfilmentMode: pool.fulfillmentType as GiveawayFulfilmentMode,
      publicPresentation: {
        disclosure: pool.publicDisclosure,
        ...(pool.publicDisclosure === "revealed" && pool.publicTitle
          ? { title: pool.publicTitle }
          : {}),
        ...(pool.publicDisclosure === "revealed" && pool.publicDescription
          ? { description: pool.publicDescription }
          : {}),
      },
      ...(pool.publicImage
        ? {
            publicImage: {
              mediaId: pool.publicImage.mediaId,
              url: `/giveaway-prize-media/${encodeURIComponent(pool.publicImage.mediaId)}`,
              width: pool.publicImage.width,
              height: pool.publicImage.height,
            },
          }
        : {}),
      eligibilityGroupIds: pool.eligibilityGroups.length
        ? pool.eligibilityGroups.map((link) => link.eligibilityGroupId)
        : undefined,
      perRiderLimit: pool.maxWinsPerRider,
      presenceVerificationRequired: pool.presenceVerificationRequired,
    };
    if (pool.inventoryLimit === null) {
      return { ...base, awardMode: "guaranteed", inventory: { kind: "unlimited" }, items: [] };
    }
    return {
      ...base,
      awardMode: pool.awardMode as Exclude<GiveawayPrizePoolInput["awardMode"], "guaranteed">,
      inventory: { kind: "finite", quantity: pool.inventoryLimit },
      items: pool.prizeItems.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description ?? undefined,
      })),
    } as GiveawayPrizePoolInput;
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
    const livePresentation = await this.toRiderGiveawayLivePresentation(
      giveaway,
      entry,
      client,
    );
    const proof = await this.toRiderGiveawayDrawProof(giveaway, entry, client);
    const award = await client.giveawayAward.findFirst({
      where: {
        giveawayId: giveaway.id,
        winnerUserId: riderId,
        status: {
          in: [
            "pending_verification",
            "claimable",
            "verified",
            "fulfilled",
            "declined",
            "disqualified",
            "expired",
            "voided",
          ],
        },
      },
      include: { prizePool: true },
      orderBy: [{ isCurrent: "desc" }, { createdAt: "desc" }],
    });
    if (!award) {
      return {
        giveawayId: giveaway.id,
        status: "entered",
        entryCount: entry.currentWeight,
        livePresentation,
        ...(proof ? { proof } : {}),
      };
    }
    return {
      giveawayId: giveaway.id,
      status: award.status as RiderGiveawayEntryStatus,
      entryCount: entry.currentWeight,
      livePresentation,
      award: {
        awardId: award.id,
        prizePoolTitle: award.prizePool.title,
        status: award.status as NonNullable<RiderGiveawayState["award"]>["status"],
        claimDeadlineAt: award.claimDeadlineAt?.toISOString(),
        fulfilmentMode: award.prizePool.fulfillmentType as GiveawayFulfilmentMode,
        winnerPublication: {
          isPublic: this.isGiveawayWinnerAliasPublic(award),
          ...(award.publicWinnerAlias ? { alias: award.publicWinnerAlias } : {}),
        },
      },
      ...(proof ? { proof } : {}),
    };
  }

  private async toRiderGiveawayLivePresentation(
    giveaway: GiveawayConfiguration,
    entry: {
      id: string;
      riderId: string;
      status: string;
      opaquePublicReference: string;
      livePresentationOptedInAt: Date | null;
      livePresentationRevokedAt: Date | null;
    },
    client: Prisma.TransactionClient | PrismaClient,
  ): Promise<NonNullable<RiderGiveawayState["livePresentation"]>> {
    const optedIn = isGiveawayLivePresentationOptedIn({
      optedInAt: entry.livePresentationOptedInAt,
      revokedAt: entry.livePresentationRevokedAt,
    });
    const [snapshotEntry, rider] = await Promise.all([
      client.giveawaySnapshotEntry.findFirst({
        where: { entryId: entry.id, snapshot: { is: { giveawayId: giveaway.id } } },
        select: { presentationLabel: true },
      }),
      client.user.findUnique({
        where: { id: entry.riderId },
        select: { displayName: true },
      }),
    ]);
    const preview = deriveGiveawayPresentationLabelPreview({
      opaquePublicReference: entry.opaquePublicReference,
      displayName: rider?.displayName ?? "",
      optedIn,
    });
    return {
      optedIn,
      canUpdate: giveaway.status === "open" && entry.status === "eligible",
      labelPreview: snapshotEntry?.presentationLabel ?? preview.presentationLabel,
    };
  }

  private async toRiderGiveawayDrawProof(
    giveaway: GiveawayConfiguration,
    entry: { id: string },
    client: Prisma.TransactionClient | PrismaClient,
  ) {
    const snapshotEntry = await client.giveawaySnapshotEntry.findFirst({
      where: {
        entryId: entry.id,
        snapshot: { is: { giveawayId: giveaway.id } },
      },
      select: { opaquePublicReference: true },
    });
    if (!snapshotEntry) return undefined;
    const drawVerifications = await this.toPublicGiveawayDrawVerifications(giveaway, client);
    if (drawVerifications.length === 0) return undefined;
    return {
      entryReference: snapshotEntry.opaquePublicReference,
      drawVerifications,
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
          directAward,
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
    tx: Prisma.TransactionClient | PrismaClient,
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
    tx: Prisma.TransactionClient | PrismaClient,
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
    await this.notifyGiveaway(tx, giveaway, riderId, "giveaway_entry");
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

  /**
   * Resolves the immutable lineage that a manual replacement is allowed to
   * use. Callers separately decide whether the source must still be current
   * so an idempotent replay remains possible after success made it historical.
   */
  private async requireManualGiveawayReplacementSource(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    snapshot: GiveawaySnapshotWithEntries,
    sourceAward: GiveawayAwardRecord,
  ) {
    const lineage = await this.requireManualGiveawayReplacementLineage(
      tx,
      giveaway,
      snapshot,
      sourceAward,
    );
    if (lineage.prizeItem.status !== "reserved") {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    return lineage;
  }

  /**
   * Immutable post-publication lineage used to bind an idempotent replacement
   * replay. Unlike a fresh replacement, it deliberately tolerates a later
   * prize-item fulfillment so the original result remains recoverable.
   */
  private async requireManualGiveawayReplacementLineage(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    snapshot: GiveawaySnapshotWithEntries,
    sourceAward: GiveawayAwardRecord,
  ) {
    const [originalDraw, prizeItem] = await Promise.all([
      sourceAward.drawId
        ? tx.giveawayDraw.findUnique({ where: { id: sourceAward.drawId } })
        : Promise.resolve(null),
      sourceAward.prizeItemId
        ? tx.giveawayPrizeItem.findUnique({ where: { id: sourceAward.prizeItemId } })
        : Promise.resolve(null),
    ]);
    const pool = giveaway.prizePools.find((candidate) => candidate.id === sourceAward.prizePoolId);
    if (
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
      prizeItem.prizePoolId !== pool.id
    ) {
      throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
    }
    return { originalDraw, pool, prizeItem };
  }

  /**
   * Publication is the irreversible boundary for a snapshot. Before revealing
   * its seed, ensure no manual pool has both inventory and a frozen entry that
   * still fits the campaign and per-pool award caps. An empty or exhausted
   * candidate set is deliberately publishable even when inventory remains.
   */
  private async hasAwardableManualSelectionCandidates(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    snapshot: GiveawaySnapshotWithEntries,
  ) {
    const manualPools = giveaway.prizePools.filter(
      (pool) => pool.awardMode === "manual_selection",
    );
    if (manualPools.length === 0) return false;

    const lockedEntries = await this.lockGiveawayEntries(tx, giveaway.id);
    this.assertFrozenDirectEntryProvenance(snapshot, lockedEntries);
    const entriesById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
    for (const pool of manualPools) {
      if (!pool.prizeItems.some((item) => item.status === "available")) continue;
      for (const snapshotEntry of snapshot.entries) {
        const entry = entriesById.get(snapshotEntry.entryId);
        if (!entry) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
        if (
          this.isSnapshotEntryEligibleForPool(snapshotEntry, pool) &&
          await this.canCreateDrawGiveawayAward(tx, giveaway, pool, entry.riderId)
        ) {
          return true;
        }
      }
    }
    return false;
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
      claimDeadlineAt?: Date | null;
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
        status: this.requiresGiveawayPresence(giveaway, pool)
          ? "pending_verification"
          : "claimable",
        isCurrent: true,
        rank: input.rank,
        opaqueClaimReference: `claim_${randomBytes(16).toString("base64url")}`,
        claimDeadlineAt: input.claimDeadlineAt ?? giveaway.claimDeadlineAt,
        predecessorAwardId: input.predecessorAwardId ?? null,
      },
    });
  }

  private async canCreateDirectGiveawayAward(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    pool: GiveawayConfiguration["prizePools"][number],
    riderId: string,
    reservedTotalAwardSlots: number = 0,
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
      totalAwards + reservedTotalAwardSlots < giveaway.maxWinsTotal &&
      riderAwards < giveaway.maxWinsPerRider &&
      poolAwards < pool.maxWinsPerRider
    );
  }

  private async lockGiveawayPrizePool(tx: Prisma.TransactionClient, poolId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "GiveawayPrizePool" WHERE "id" = ${poolId} FOR UPDATE`,
    );
  }

  private async lockNextAvailablePrizeItem(
    tx: Prisma.TransactionClient,
    poolId: string,
    protectedPrizeItemIds: ReadonlySet<string> = new Set(),
  ) {
    const candidates = await tx.giveawayPrizeItem.findMany({
      where: {
        prizePoolId: poolId,
        status: "available",
        ...(protectedPrizeItemIds.size > 0 ? { id: { notIn: [...protectedPrizeItemIds] } } : {}),
      },
      select: { id: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    for (const candidate of candidates) {
      const locked = await this.lockGiveawayPrizeItem(tx, candidate.id);
      if (locked?.prizePoolId === poolId && locked.status === "available") return locked.id;
    }
    return null;
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
    options: {
      claimDeadlineAt?: Date | null;
      reservedTotalAwardSlots?: number;
      protectedPrizeItemIds?: ReadonlySet<string>;
    } = {},
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
    if (
      !(await this.canCreateDirectGiveawayAward(
        tx,
        giveaway,
        pool,
        entry.riderId,
        options.reservedTotalAwardSlots ?? 0,
      ))
    ) {
      return false;
    }

    let prizeItemId: string | null = null;
    if (pool.awardMode === "first_come") {
      prizeItemId = await this.lockNextAvailablePrizeItem(tx, pool.id, options.protectedPrizeItemIds);
      if (!prizeItemId) return false;
      await tx.giveawayPrizeItem.update({
        where: { id: prizeItemId },
        data: { status: "reserved" },
      });
    }

    const award = await tx.giveawayAward.create({
      data: {
        id: `giveaway-award-${randomUUID()}`,
        giveawayId: giveaway.id,
        entryId: entry.id,
        prizePoolId: pool.id,
        prizeItemId,
        winnerUserId: entry.riderId,
        status: this.requiresGiveawayPresence(giveaway, pool)
          ? "pending_verification"
          : "claimable",
        isCurrent: true,
        directAllocationKey,
        allocationEligibilityAt: new Date(allocationEligibilityAt),
        opaqueClaimReference: `claim_${randomBytes(16).toString("base64url")}`,
        claimDeadlineAt: options.claimDeadlineAt ?? giveaway.claimDeadlineAt,
      },
    });
    await this.notifyGiveaway(tx, giveaway, award.winnerUserId, "giveaway_winner", {
      awardId: award.id,
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
      await this.closeGiveawayDirectRecoverySource(tx, award, reasonDigest);
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
          recoveryClosed: true,
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
    await this.resolvePendingDirectGiveawayRecoverySources(tx, giveaway);
    const elapsedRecoveryReservation = await this.getElapsedDirectGiveawayRecoveryReservation(tx, giveaway);
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
        await this.allocateDirectGiveawayAwardForPool(tx, giveaway, pool, candidate, {
          reservedTotalAwardSlots: elapsedRecoveryReservation.reservedTotalAwardSlots,
          protectedPrizeItemIds: elapsedRecoveryReservation.protectedPrizeItemIdsByPool.get(pool.id),
        });
      }
    }
  }

  /**
   * Generic open-campaign allocation can run after a paused campaign reopens
   * or after a new eligible entry arrives. Resolve terminal direct sources
   * first, so a replacement is auditable as that source's only successor.
   */
  private async resolvePendingDirectGiveawayRecoverySources(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
  ) {
    if (giveaway.status !== "open") return;
    const poolPositionById = new Map(giveaway.prizePools.map((pool) => [pool.id, pool.position]));
    const previews = await tx.giveawayAward.findMany({
      where: {
        giveawayId: giveaway.id,
        drawId: null,
        snapshotEntryId: null,
        isCurrent: false,
        recoveryClosedAt: null,
        status: { in: ["declined", "voided", "disqualified", "expired"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    previews.sort(
      (left, right) =>
        (poolPositionById.get(left.prizePoolId) ?? Number.MAX_SAFE_INTEGER) -
          (poolPositionById.get(right.prizePoolId) ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );

    for (const preview of previews) {
      if (this.isGiveawayClaimDeadlineElapsed(preview)) continue;
      const pool = this.requireGiveawayPrizePool(giveaway, preview.prizePoolId);
      if (pool.awardMode !== "first_come" && pool.awardMode !== "guaranteed") continue;
      await this.lockGiveawayPrizePool(tx, pool.id);
      if (preview.prizeItemId) {
        const prizeItem = await this.lockGiveawayPrizeItem(tx, preview.prizeItemId);
        if (!prizeItem || prizeItem.prizePoolId !== pool.id) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
      }
      const sourceAward = await this.lockGiveawayAward(tx, preview.id);
      if (
        !sourceAward ||
        !this.isDirectGiveawayAward(sourceAward) ||
        sourceAward.isCurrent ||
        sourceAward.recoveryClosedAt ||
        this.isGiveawayClaimDeadlineElapsed(sourceAward) ||
        !["declined", "voided", "disqualified", "expired"].includes(sourceAward.status)
      ) {
        continue;
      }
      await this.reallocateFinalizedDirectGiveawayAward(tx, giveaway, sourceAward, undefined);
    }
  }

  /**
   * Elapsed terminal direct awards remain recoverable only through the explicit
   * path. Generic allocation must therefore reserve their total-win capacity
   * and, for finite pools, their exact released prize item.
   */
  private async getElapsedDirectGiveawayRecoveryReservation(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    excludedSourceAwardId?: string,
  ): Promise<ElapsedDirectGiveawayRecoveryReservation> {
    const sources = await tx.giveawayAward.findMany({
      where: {
        giveawayId: giveaway.id,
        drawId: null,
        snapshotEntryId: null,
        isCurrent: false,
        recoveryClosedAt: null,
        status: { in: ["declined", "voided", "disqualified", "expired"] },
        claimDeadlineAt: { not: null, lte: new Date() },
        ...(excludedSourceAwardId ? { id: { not: excludedSourceAwardId } } : {}),
      },
      select: { prizePoolId: true, prizeItemId: true },
      orderBy: { id: "asc" },
    });
    const protectedPrizeItemIdsByPool = new Map<string, Set<string>>();
    for (const source of sources) {
      if (!source.prizeItemId) continue;
      const protectedPrizeItemIds =
        protectedPrizeItemIdsByPool.get(source.prizePoolId) ?? new Set<string>();
      protectedPrizeItemIds.add(source.prizeItemId);
      protectedPrizeItemIdsByPool.set(source.prizePoolId, protectedPrizeItemIds);
    }
    return {
      reservedTotalAwardSlots: sources.length,
      protectedPrizeItemIdsByPool,
    };
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
    options: { prizePoolId?: string; claimDeadlineAt?: Date | null } = {},
  ) {
    this.assertFrozenDirectEntryProvenance(snapshot, lockedEntries);
    const elapsedRecoveryReservation = await this.getElapsedDirectGiveawayRecoveryReservation(tx, giveaway);
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
      if (options.prizePoolId && pool.id !== options.prizePoolId) continue;
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
        await this.allocateDirectGiveawayAwardForPool(tx, giveaway, pool, allocationCandidate, {
          claimDeadlineAt: options.claimDeadlineAt,
          reservedTotalAwardSlots: elapsedRecoveryReservation.reservedTotalAwardSlots,
          protectedPrizeItemIds: elapsedRecoveryReservation.protectedPrizeItemIdsByPool.get(pool.id),
        });
      }
    }
  }

  /**
   * An explicit recovery re-offers one specific historical direct-award slot.
   * It cannot turn an audit for one released prize into a bulk allocation of
   * every currently available item in the same pool.
   */
  private async recoverFrozenImmediateGiveawayAwardSlot(
    tx: Prisma.TransactionClient,
    giveaway: GiveawayConfiguration,
    sourceAward: GiveawayAwardRecord,
    pool: GiveawayConfiguration["prizePools"][number],
    snapshot: GiveawaySnapshotWithEntries,
    lockedEntries: GiveawayEntryWrite["entry"][],
    claimDeadlineAt: Date | null,
    recoverySourceAwardId: string = sourceAward.id,
  ): Promise<GiveawayAwardRecord | null> {
    this.assertFrozenDirectEntryProvenance(snapshot, lockedEntries);
    let prizeItemId: string | null = null;
    if (pool.awardMode === "first_come") {
      if (!sourceAward.prizeItemId) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      const targetPrizeItem = await tx.giveawayPrizeItem.findUnique({
        where: { id: sourceAward.prizeItemId },
      });
      if (
        !targetPrizeItem ||
        targetPrizeItem.prizePoolId !== pool.id ||
        targetPrizeItem.status !== "available"
      ) {
        throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
      }
      prizeItemId = targetPrizeItem.id;
    }

    const elapsedRecoveryReservation = await this.getElapsedDirectGiveawayRecoveryReservation(
      tx,
      giveaway,
      sourceAward.id,
    );

    const lockedEntriesById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
    const candidates = snapshot.entries
      .map((snapshotEntry) => {
        const entry = lockedEntriesById.get(snapshotEntry.entryId);
        if (!entry) throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        return { entry, snapshotEntry };
      })
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

    for (const { entry, snapshotEntry } of candidates) {
      const allocationEligibilityAt = resolveGiveawayPoolEligibilityPriority({
        eligibilityCycleAt: snapshotEntry.eligibilityCycleAt.toISOString(),
        qualifiedEligibilityGroupTimings: this.entryQualifiedGroupTimings(snapshotEntry),
        permittedGroupIds: pool.eligibilityGroups.map((link) => link.eligibilityGroupId),
      });
      if (!allocationEligibilityAt) continue;
      const directAllocationKey = `direct:${entry.id}:${pool.id}:${allocationEligibilityAt}`;
      const [historicAward, currentPoolAward, canAward] = await Promise.all([
        tx.giveawayAward.findUnique({ where: { directAllocationKey } }),
        tx.giveawayAward.findFirst({
          where: {
            giveawayId: giveaway.id,
            entryId: entry.id,
            prizePoolId: pool.id,
            drawId: null,
            isCurrent: true,
          },
          select: { id: true },
        }),
        this.canCreateDirectGiveawayAward(
          tx,
          giveaway,
          pool,
          entry.riderId,
          elapsedRecoveryReservation.reservedTotalAwardSlots,
        ),
      ]);
      if (historicAward || currentPoolAward || !canAward) continue;

      if (prizeItemId) {
        const reservation = await tx.giveawayPrizeItem.updateMany({
          where: { id: prizeItemId, prizePoolId: pool.id, status: "available" },
          data: { status: "reserved" },
        });
        if (reservation.count !== 1) {
          throw new BackendError("GIVEAWAY_AWARD_INVALID", "GIVEAWAY_AWARD_INVALID");
        }
      }
      const award = await tx.giveawayAward.create({
        data: {
          id: `giveaway-award-${randomUUID()}`,
          giveawayId: giveaway.id,
          entryId: entry.id,
          prizePoolId: pool.id,
          prizeItemId,
          winnerUserId: entry.riderId,
          status: this.requiresGiveawayPresence(giveaway, pool)
            ? "pending_verification"
            : "claimable",
          isCurrent: true,
          directAllocationKey,
          allocationEligibilityAt: new Date(allocationEligibilityAt),
          recoverySourceAwardId,
          opaqueClaimReference: `claim_${randomBytes(16).toString("base64url")}`,
          claimDeadlineAt,
        },
      });
      await this.notifyGiveaway(tx, giveaway, award.winnerUserId, "giveaway_winner", {
        awardId: award.id,
      });
      return award;
    }
    return null;
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

  private async riderIdsWithGiveawayActivity(
    tx: Prisma.TransactionClient | PrismaClient,
    eventId: string,
  ) {
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

  /**
   * Persist only recipient-scoped, nonsecret giveaway notices. The database
   * uniqueness constraint makes retries and concurrent lifecycle work
   * idempotent without ever storing a claim QR or raw delivery data.
   */
  private async notifyGiveaway(
    tx: Prisma.TransactionClient,
    giveaway: Pick<GiveawayConfiguration, "id" | "title">,
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
    assertSafeGiveawayNotification(draft);
    await tx.notification.upsert({
      where: {
        userId_dedupeKey: {
          userId: draft.userId,
          dedupeKey: draft.dedupeKey,
        },
      },
      create: {
        userId: draft.userId,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        href: draft.href ?? null,
        dedupeKey: draft.dedupeKey,
      },
      update: {},
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
      include: { user: { include: { organizerProfile: true } } },
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

  private async requireRosterEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        organizer: { select: { userId: true } },
        rosterSettings: { select: { enabled: true } },
      },
    });
    if (!event) throw new BackendError("NOT_FOUND", "NOT_FOUND");
    return event;
  }

  private async buildPrismaRosterSummary(
    eventId: string,
    eventTitle: string,
    enabled: boolean,
  ): Promise<EventAttendeeSummary> {
    const [goingCount, visibleCount] = await Promise.all([
      this.prisma.rSVP.count({ where: { eventId, status: "going" } }),
      enabled
        ? this.prisma.rSVP.count({
            where: {
              eventId,
              status: "going",
              goingAt: { not: null },
              user: {
                defaultRosterIdentity: "VISIBLE",
                profileSlug: { not: null },
                profileVisibility: { not: "PRIVATE" },
              },
            },
          })
        : Promise.resolve(0),
    ]);
    return {
      eventId,
      eventTitle,
      rosterEnabled: enabled,
      goingCount,
      visibleCount,
      anonymousCount: goingCount - visibleCount,
    };
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

  private requireRosterConfigurator(
    user: { id: string; role: string },
    event: { organizer: { userId: string } },
  ) {
    if (user.role === "admin") return;
    if (user.role === "organizer" && event.organizer.userId === user.id) return;
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

  private findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { organizerProfile: true },
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

  private async allocatePrismaProfileSlug(tx: Prisma.TransactionClient, base: string) {
    if (!(await tx.user.findUnique({ where: { profileSlug: base }, select: { id: true } }))) {
      return base;
    }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!(await tx.user.findUnique({ where: { profileSlug: candidate }, select: { id: true } }))) {
        return candidate;
      }
    }
  }

  private toInternalMemberProfile(
    profile: {
      id: string;
      email: string;
      passwordHash: string;
      verificationStatus: string;
      profileSlug: string | null;
      displayName: string;
      area: string;
      role: string;
      profileBio: string | null;
      profileVisibility: "PUBLIC" | "MEMBERS_ONLY" | "PRIVATE";
      profilePhotoMediaId: string | null;
      profilePhotoStorageKey: string | null;
      createdAt: Date;
      motorcycle: {
        id: string;
        userId: string;
        make: string;
        model: string;
        year: number | null;
        displacementCc: number | null;
        nickname: string | null;
        description: string | null;
        photos: Array<{
          id: string;
          mediaId: string;
          storageKey: string;
          position: number;
          width: number;
          height: number;
        }>;
      } | null;
    },
    hostedEventCount?: number,
  ) {
    return {
      userId: profile.id,
      email: profile.email,
      passwordHash: profile.passwordHash,
      verificationStatus: profile.verificationStatus,
      profilePhotoStorageKey: profile.profilePhotoStorageKey,
      slug: profile.profileSlug ?? "",
      displayName: profile.displayName,
      area: profile.area,
      role: profile.role as "rider" | "organizer" | "admin",
      bio: profile.profileBio,
      visibility: profile.profileVisibility,
      joinedAt: formatJoinedAt(profile.createdAt),
      profilePhotoMediaId: profile.profilePhotoMediaId,
      motorcycle: profile.motorcycle,
      hostedEventCount,
    };
  }

  private async sanitizeMemberProfile(
    profile: Parameters<PrismaTambikeBackend["toInternalMemberProfile"]>[0],
  ) {
    const hostedEventCount = profile.role === "organizer"
      ? await this.prisma.event.count({
          where: {
            organizer: { userId: profile.id },
          },
        })
      : undefined;
    return sanitizeMemberProfile(this.toInternalMemberProfile(profile, hostedEventCount));
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
    };
  }

  private toGiveawayPrizeImageSummary(image: {
    mediaId: string;
    width: number;
    height: number;
  }): GiveawayPrizeImageSummary {
    return {
      mediaId: image.mediaId,
      url: `/giveaway-prize-media/${encodeURIComponent(image.mediaId)}`,
      width: image.width,
      height: image.height,
    };
  }

  private async requireGiveawayPrizePoolAccess(
    client: Prisma.TransactionClient | PrismaClient,
    userId: string,
    giveawayId: string,
    prizePoolId: string,
  ) {
    const [user, pool] = await Promise.all([
      client.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, verificationStatus: true },
      }),
      client.giveawayPrizePool.findUnique({
        where: { id: prizePoolId },
        include: {
          publicImage: true,
          giveaway: {
            select: {
              id: true,
              status: true,
              complianceStatus: true,
              event: {
                include: {
                  organizer: { select: { userId: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    if (!user) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }
    if (!pool || pool.giveaway.id !== giveawayId) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    this.requireGiveawayConfigurator(user, pool.giveaway.event);
    if (pool.publicDisclosure !== "revealed") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    return pool;
  }

  private async requireGiveawayPrizeMediaMutationAccess(
    tx: Prisma.TransactionClient,
    userId: string,
    giveawayId: string,
    prizePoolId: string,
  ) {
    const pool = await this.requireGiveawayPrizePoolAccess(
      tx,
      userId,
      giveawayId,
      prizePoolId,
    );
    const [entryCount, entryEventCount] = await Promise.all([
      tx.giveawayEntry.count({ where: { giveawayId } }),
      tx.giveawayEntryEvent.count({ where: { giveawayId } }),
    ]);
    const blocker = getGiveawayMaterialUpdateBlocker({
      state: pool.giveaway.status as GiveawayState,
      hasEntrantHistory: entryCount > 0 || entryEventCount > 0,
      changesEntrantFacingConfiguration: true,
    });
    if (blocker) {
      throw new BackendError(blocker, blocker);
    }
    return pool;
  }

  private async recordGiveawayPrizeMediaUpdate(
    tx: Prisma.TransactionClient,
    giveawayId: string,
    actorUserId: string,
    operation: "replaced" | "removed",
  ) {
    await tx.eventGiveaway.update({
      where: { id: giveawayId },
      data: {
        complianceStatus: "draft",
        complianceReviewer: { disconnect: true },
        complianceReviewedAt: null,
        complianceReviewReason: null,
      },
    });
    await this.auditGiveaway(
      tx,
      giveawayId,
      actorUserId,
      "GIVEAWAY_UPDATED",
      "giveaway",
      giveawayId,
      {
        change: "public_prize_image",
        operation,
        complianceStatus: "draft",
      },
    );
  }

  private giveawayPrizeMediaPersistence(): GiveawayPrizeMediaPersistence {
    return {
      authorizePool: async ({ userId, giveawayId, prizePoolId }) => {
        await this.requireGiveawayPrizePoolAccess(
          this.prisma,
          userId,
          giveawayId,
          prizePoolId,
        );
      },
      replaceFinalized: (input) =>
        this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "EventGiveaway"
            WHERE "id" = ${input.giveawayId}
            FOR UPDATE
          `;
          await tx.$queryRaw`
            SELECT "id"
            FROM "GiveawayPrizePool"
            WHERE "id" = ${input.prizePoolId}
            FOR UPDATE
          `;
          const pool = await this.requireGiveawayPrizeMediaMutationAccess(
            tx,
            input.userId,
            input.giveawayId,
            input.prizePoolId,
          );
          const cleanupIntent = await tx.memberMediaCleanupIntent.findUnique({
            where: { storageKey: input.storageKey },
            select: { id: true },
          });
          if (!cleanupIntent) {
            throw new Error("MEMBER_MEDIA_CLEANUP_INTENT_MISSING");
          }
          if (pool.publicImage) {
            await tx.memberMediaCleanupIntent.upsert({
              where: { storageKey: pool.publicImage.storageKey },
              create: {
                userId: pool.publicImage.uploadedByUserId,
                storageKey: pool.publicImage.storageKey,
                cleanupAfter: input.finalizedAt,
              },
              update: { cleanupAfter: input.finalizedAt },
            });
          }
          const image = await tx.giveawayPrizeImage.upsert({
            where: { prizePoolId: input.prizePoolId },
            create: {
              id: `giveaway-prize-image-${randomUUID()}`,
              prizePoolId: input.prizePoolId,
              uploadedByUserId: input.userId,
              mediaId: input.mediaId,
              storageKey: input.storageKey,
              mimeType: input.mimeType,
              width: input.width,
              height: input.height,
              finalizedAt: input.finalizedAt,
            },
            update: {
              uploadedByUserId: input.userId,
              mediaId: input.mediaId,
              storageKey: input.storageKey,
              mimeType: input.mimeType,
              width: input.width,
              height: input.height,
              finalizedAt: input.finalizedAt,
            },
          });
          await tx.memberMediaCleanupIntent.delete({
            where: { storageKey: input.storageKey },
          });
          await this.recordGiveawayPrizeMediaUpdate(
            tx,
            input.giveawayId,
            input.userId,
            "replaced",
          );
          return this.toGiveawayPrizeImageSummary(image);
        }),
      remove: (input) =>
        this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "EventGiveaway"
            WHERE "id" = ${input.giveawayId}
            FOR UPDATE
          `;
          await tx.$queryRaw`
            SELECT "id"
            FROM "GiveawayPrizePool"
            WHERE "id" = ${input.prizePoolId}
            FOR UPDATE
          `;
          const pool = await this.requireGiveawayPrizeMediaMutationAccess(
            tx,
            input.userId,
            input.giveawayId,
            input.prizePoolId,
          );
          const image = pool.publicImage;
          if (!image || image.mediaId !== input.mediaId) {
            throw new BackendError("NOT_FOUND", "NOT_FOUND");
          }
          const cleanupAfter = new Date();
          await tx.memberMediaCleanupIntent.upsert({
            where: { storageKey: image.storageKey },
            create: {
              userId: image.uploadedByUserId,
              storageKey: image.storageKey,
              cleanupAfter,
            },
            update: { cleanupAfter },
          });
          await tx.giveawayPrizeImage.delete({ where: { id: image.id } });
          await this.recordGiveawayPrizeMediaUpdate(
            tx,
            input.giveawayId,
            input.userId,
            "removed",
          );
          return image.storageKey;
        }),
      registerCleanup: ({ userId, storageKey, cleanupAfter }) =>
        this.registerMemberMediaCleanup(userId, storageKey, cleanupAfter),
      activateCleanup: ({ storageKey, cleanupAfter }) =>
        this.activateMemberMediaCleanup(storageKey, cleanupAfter),
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
      locationName: event.locationName,
      locationAddress: event.locationAddress,
      locationMapLink: event.locationMapLink ?? undefined,
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

  private memberMediaPersistence(): MemberMediaPersistence {
    return {
      registerCleanup: (userId, storageKey, cleanupAfter) =>
        this.registerMemberMediaCleanup(userId, storageKey, cleanupAfter),
      activateCleanup: (storageKey, cleanupAfter) =>
        this.activateMemberMediaCleanup(storageKey, cleanupAfter),
      saveFinalized: (userId, record, tempKey, cleanupAfter) =>
        this.saveFinalizedMemberMedia(userId, record, tempKey, cleanupAfter),
      remove: (userId, mediaId, cleanupAfter) =>
        this.removeMemberMediaRecord(userId, mediaId, cleanupAfter),
      reorder: (userId, mediaIds) => this.reorderMemberMediaRecords(userId, mediaIds),
      claimCleanup: (input) => this.claimMemberMediaCleanup(input),
      completeCleanup: (id, claimToken) => this.completeMemberMediaCleanup(id, claimToken),
      failCleanup: (id, claimToken, attemptedAt, retryAt) =>
        this.failMemberMediaCleanup(id, claimToken, attemptedAt, retryAt),
    };
  }

  private async registerMemberMediaCleanup(
    userId: string,
    storageKey: string,
    cleanupAfter: Date,
  ) {
    await this.prisma.memberMediaCleanupIntent.upsert({
      where: { storageKey },
      create: { userId, storageKey, cleanupAfter },
      update: { cleanupAfter },
    });
  }

  private async activateMemberMediaCleanup(storageKey: string, cleanupAfter: Date) {
    const activated = await this.prisma.memberMediaCleanupIntent.updateMany({
      where: { storageKey },
      data: { cleanupAfter },
    });
    if (activated.count !== 1) throw new Error("MEMBER_MEDIA_CLEANUP_INTENT_MISSING");
  }

  private async claimMemberMediaCleanup(input: {
    limit: number;
    now: Date;
    claimExpiresAt: Date;
  }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
      throw new Error("MEMBER_MEDIA_CLEANUP_CLAIM_LIMIT_INVALID");
    }
    const claimToken = randomUUID();
    return this.prisma.$transaction(async (tx) => tx.$queryRaw<Array<{
      id: string;
      storageKey: string;
      claimToken: string;
      attemptCount: number;
    }>>`
      WITH candidates AS (
        SELECT "id"
        FROM "MemberMediaCleanupIntent"
        WHERE "cleanupAfter" <= ${input.now}
          AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" <= ${input.now})
        ORDER BY "cleanupAfter" ASC, "createdAt" ASC, "id" ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE "MemberMediaCleanupIntent" AS intent
        SET "claimToken" = ${claimToken},
            "claimExpiresAt" = ${input.claimExpiresAt},
            "updatedAt" = ${input.now}
        FROM candidates
        WHERE intent."id" = candidates."id"
        RETURNING intent."id", intent."storageKey", intent."claimToken",
          intent."attemptCount", intent."cleanupAfter", intent."createdAt"
      )
      SELECT "id", "storageKey", "claimToken", "attemptCount"
      FROM claimed
      ORDER BY "cleanupAfter" ASC, "createdAt" ASC, "id" ASC
    `);
  }

  private async completeMemberMediaCleanup(id: string, claimToken: string) {
    await this.prisma.memberMediaCleanupIntent.deleteMany({ where: { id, claimToken } });
  }

  private async failMemberMediaCleanup(
    id: string,
    claimToken: string,
    attemptedAt: Date,
    retryAt: Date,
  ) {
    await this.prisma.memberMediaCleanupIntent.updateMany({
      where: { id, claimToken },
      data: {
        attemptCount: { increment: 1 },
        lastAttemptAt: attemptedAt,
        cleanupAfter: retryAt,
        claimToken: null,
        claimExpiresAt: null,
      },
    });
  }

  private async lockMemberMediaOwner(tx: Prisma.TransactionClient, userId: string) {
    const resource = profileOwnerLockResource(userId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`;
  }

  private saveFinalizedMemberMedia(
    userId: string,
    record: FinalizedMemberMediaRecord,
    tempKey: string,
    cleanupAfter: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMemberMediaOwner(tx, userId);
      const finalCleanupIntent = await tx.memberMediaCleanupIntent.findUnique({
        where: { storageKey: record.storageKey },
        select: { id: true },
      });
      if (!finalCleanupIntent) throw new Error("MEMBER_MEDIA_CLEANUP_INTENT_MISSING");
      if (record.purpose === "avatar") {
        const owner = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { profilePhotoStorageKey: true },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            profilePhotoMediaId: record.mediaId,
            profilePhotoStorageKey: record.storageKey,
            profilePhotoMimeType: record.mimeType,
            profilePhotoWidth: record.width,
            profilePhotoHeight: record.height,
            profilePhotoFinalizedAt: record.finalizedAt,
          },
        });
        await tx.memberMediaCleanupIntent.upsert({
          where: { storageKey: tempKey },
          create: { userId, storageKey: tempKey, cleanupAfter },
          update: { cleanupAfter },
        });
        if (owner.profilePhotoStorageKey) {
          await tx.memberMediaCleanupIntent.upsert({
            where: { storageKey: owner.profilePhotoStorageKey },
            create: { userId, storageKey: owner.profilePhotoStorageKey, cleanupAfter },
            update: { cleanupAfter },
          });
        }
        await tx.memberMediaCleanupIntent.delete({
          where: { id: finalCleanupIntent.id },
        });
        return { mediaId: record.mediaId };
      }

      const motorcycle = await tx.motorcycle.findUnique({
        where: { userId },
        include: { photos: { orderBy: { position: "asc" } } },
      });
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
      if (existing) {
        await tx.motorcyclePhoto.update({
          where: { id: existing.id },
          data: {
            mediaId: record.mediaId,
            storageKey: record.storageKey,
            mimeType: record.mimeType,
            width: record.width,
            height: record.height,
            finalizedAt: record.finalizedAt,
          },
        });
      } else {
        await tx.motorcyclePhoto.create({
          data: {
            motorcycleId: motorcycle.id,
            position,
            mediaId: record.mediaId,
            storageKey: record.storageKey,
            mimeType: record.mimeType,
            width: record.width,
            height: record.height,
            finalizedAt: record.finalizedAt,
          },
        });
      }
      await tx.memberMediaCleanupIntent.upsert({
        where: { storageKey: tempKey },
        create: { userId, storageKey: tempKey, cleanupAfter },
        update: { cleanupAfter },
      });
      if (existing) {
        await tx.memberMediaCleanupIntent.upsert({
          where: { storageKey: existing.storageKey },
          create: { userId, storageKey: existing.storageKey, cleanupAfter },
          update: { cleanupAfter },
        });
      }
      await tx.memberMediaCleanupIntent.delete({
        where: { id: finalCleanupIntent.id },
      });
      return { mediaId: record.mediaId };
    });
  }

  private removeMemberMediaRecord(userId: string, mediaId: string, cleanupAfter: Date) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMemberMediaOwner(tx, userId);
      const owner = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { profilePhotoMediaId: true, profilePhotoStorageKey: true },
      });
      if (owner.profilePhotoMediaId === mediaId && owner.profilePhotoStorageKey) {
        await tx.user.update({
          where: { id: userId },
          data: {
            profilePhotoMediaId: null,
            profilePhotoStorageKey: null,
            profilePhotoMimeType: null,
            profilePhotoWidth: null,
            profilePhotoHeight: null,
            profilePhotoFinalizedAt: null,
          },
        });
        await tx.memberMediaCleanupIntent.upsert({
          where: { storageKey: owner.profilePhotoStorageKey },
          create: { userId, storageKey: owner.profilePhotoStorageKey, cleanupAfter },
          update: { cleanupAfter },
        });
        return;
      }

      const photo = await tx.motorcyclePhoto.findUnique({
        where: { mediaId },
        include: { motorcycle: { select: { id: true, userId: true } } },
      });
      if (!photo || photo.motorcycle.userId !== userId) {
        throw new BackendError("NOT_FOUND", "NOT_FOUND");
      }
      await tx.motorcyclePhoto.delete({ where: { id: photo.id } });
      const remaining = await tx.motorcyclePhoto.findMany({
        where: { motorcycleId: photo.motorcycle.id },
        orderBy: { position: "asc" },
      });
      await this.replaceMotorcyclePhotoOrder(tx, photo.motorcycle.id, remaining);
      await tx.memberMediaCleanupIntent.upsert({
        where: { storageKey: photo.storageKey },
        create: { userId, storageKey: photo.storageKey, cleanupAfter },
        update: { cleanupAfter },
      });
    });
  }

  private reorderMemberMediaRecords(userId: string, mediaIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockMemberMediaOwner(tx, userId);
      const motorcycle = await tx.motorcycle.findUnique({
        where: { userId },
        include: { photos: true },
      });
      if (
        !motorcycle ||
        mediaIds.length !== motorcycle.photos.length ||
        new Set(mediaIds).size !== mediaIds.length ||
        mediaIds.some((mediaId) => !motorcycle.photos.some((photo) => photo.mediaId === mediaId))
      ) {
        throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
      }
      const photosByMediaId = new Map(
        motorcycle.photos.map((photo) => [photo.mediaId, photo]),
      );
      const orderedPhotos = mediaIds.map((mediaId) => photosByMediaId.get(mediaId)!);
      await this.replaceMotorcyclePhotoOrder(tx, motorcycle.id, orderedPhotos);
    });
  }

  private async replaceMotorcyclePhotoOrder(
    tx: Prisma.TransactionClient,
    motorcycleId: string,
    photos: Prisma.MotorcyclePhotoGetPayload<Record<string, never>>[],
  ) {
    await tx.motorcyclePhoto.deleteMany({ where: { motorcycleId } });
    if (photos.length === 0) return;
    await tx.motorcyclePhoto.createMany({
      data: photos.map((photo, position) => ({
        id: photo.id,
        motorcycleId: photo.motorcycleId,
        position,
        mediaId: photo.mediaId,
        storageKey: photo.storageKey,
        mimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        finalizedAt: photo.finalizedAt,
        createdAt: photo.createdAt,
      })),
    });
  }

  private async resolveMemberMediaDescriptor(
    sessionToken: string | undefined,
    mediaId: string,
  ): Promise<AuthorizedMemberMediaDescriptor> {
    const avatarOwner = await this.prisma.user.findUnique({
      where: { profilePhotoMediaId: mediaId },
      select: {
        id: true,
        role: true,
        profileSlug: true,
        profileVisibility: true,
        profilePhotoStorageKey: true,
        profilePhotoMimeType: true,
      },
    });
    const motorcyclePhoto = avatarOwner
      ? null
      : await this.prisma.motorcyclePhoto.findUnique({
          where: { mediaId },
          select: {
            storageKey: true,
            mimeType: true,
            motorcycle: {
              select: {
                user: {
                  select: { id: true, role: true, profileSlug: true, profileVisibility: true },
                },
              },
            },
          },
        });
    const owner = avatarOwner ?? motorcyclePhoto?.motorcycle.user;
    const storageKey = avatarOwner?.profilePhotoStorageKey ?? motorcyclePhoto?.storageKey;
    const mimeType = avatarOwner?.profilePhotoMimeType ?? motorcyclePhoto?.mimeType;
    if (!owner || !storageKey || mimeType !== "image/webp") {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    const sessionUser = sessionToken ? await this.getUserForSessionToken(sessionToken) : null;
    const validSessionUser = sessionUser?.verificationStatus === "SUSPENDED" ? null : sessionUser;
    const ownsProfile = validSessionUser?.id === owner.id;
    const viewer = validSessionUser
      ? { role: validSessionUser.role as AccountRole, ownsProfile }
      : null;
    if (
      (!owner.profileSlug && !ownsProfile) ||
      !canViewMemberProfile(viewer, owner.profileVisibility)
    ) {
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

  private toGiveawayPrizeMediaBackendError(error: unknown): unknown {
    if (error instanceof BackendError) return error;
    if (error instanceof MemberMediaError) {
      return new BackendError("INVALID_IMAGE", "INVALID_IMAGE");
    }
    if (error instanceof GiveawayPrizeMediaLifecycleError) {
      return new BackendError(error.code, error.code);
    }
    return error;
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
