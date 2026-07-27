import "server-only";

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import type {
  CreateGiveawayInput,
  IssuedGiveawayClaimToken,
  OperatorGiveawayClaimView,
  PublicGiveawayDrawVerification,
} from "@/features/giveaways/types";
import type { PrismaTambikeBackend } from "@/server/prisma-backend";
import { PrismaTambikeBackend as PrismaTambikeBackendRuntime } from "@/server/prisma-backend";

export const SAMPLE_RAFFLE_EVENT_ID = "tambike-cafe-classico";
export const COMPLETED_SAMPLE_RAFFLE_TITLE = "Cafe Classico Helmet Raffle";
export const ONGOING_SAMPLE_RAFFLE_TITLE = "Weekend Rider Gear Raffle";
export const SAMPLE_RAFFLE_WINNER_EMAIL = "raffle.winner.sample@tambike.ph";
export const SAMPLE_RAFFLE_WINNER_NAME = "Raffle Winner — Sample Rider";
export const SAMPLE_RAFFLE_WINNER_ALIAS = "Raffle Sample Rider";

export interface SampleRaffleManifest {
  eventId: string;
  completedTitle: string;
  ongoingTitle: string;
  winnerEmail: string;
  winnerName: string;
  winnerAlias: string;
}

export const productionSampleRaffleManifest: SampleRaffleManifest = {
  eventId: SAMPLE_RAFFLE_EVENT_ID,
  completedTitle: COMPLETED_SAMPLE_RAFFLE_TITLE,
  ongoingTitle: ONGOING_SAMPLE_RAFFLE_TITLE,
  winnerEmail: SAMPLE_RAFFLE_WINNER_EMAIL,
  winnerName: SAMPLE_RAFFLE_WINNER_NAME,
  winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
};

export type SampleRaffleProvisioningErrorCode =
  | "PRODUCTION_CONFIRMATION_REQUIRED"
  | "DATABASE_TARGET_REQUIRED"
  | "DIRECT_LOCK_REQUIRED"
  | "ORGANIZER_CREDENTIAL_REQUIRED"
  | "ADMIN_CREDENTIAL_REQUIRED"
  | "WINNER_CREDENTIAL_REQUIRED"
  | "DRAW_ENCRYPTION_KEY_REQUIRED"
  | "HOST_EVENT_INVALID"
  | "AUTHENTICATION_FAILED"
  | "CONFLICTING_SAMPLE_STATE"
  | "FINAL_INVARIANT_FAILED";

export class SampleRaffleProvisioningError extends Error {
  constructor(readonly code: SampleRaffleProvisioningErrorCode) {
    super(code);
    this.name = "SampleRaffleProvisioningError";
  }

  toJSON() {
    return { code: this.code };
  }
}

export interface SampleRaffleProvisioningInput {
  confirmedProduction: boolean;
  organizerPassword?: string;
  adminPassword?: string;
  winnerPassword?: string;
  drawEncryptionKeyPresent: boolean;
  databaseTargetPresent: boolean;
  directLockPresent: boolean;
}

export interface SampleRaffleProvisioningReceipt {
  eventId: string;
  completed: {
    giveawayId: string;
    title: string;
    state: "completed";
    winnerCount: 1;
    winnerAlias: string;
  };
  ongoing: {
    giveawayId: string;
    title: string;
    state: "open";
    winnerCount: 0;
  };
  changed: boolean;
}

export interface SampleRaffleCampaignInspection {
  giveawayId: string;
  title: string;
  state: string;
  winnerCount: number;
  winnerAlias?: string;
}

export interface SampleRaffleCompletedAwardInspection {
  status: string;
  winnerAlias?: string;
  winnerAliasPublished: boolean;
}

export interface SampleRaffleCompletedCampaignInspection extends SampleRaffleCampaignInspection {
  complianceStatus: string;
  drawCount: number;
  publishedDrawCount: number;
  currentAwardCount: number;
  fulfilledAwardCount: number;
  publicWinnerAliases: string[];
  winnerUserId?: string;
  currentAwards: SampleRaffleCompletedAwardInspection[];
}

export interface SampleRaffleOngoingCampaignInspection extends SampleRaffleCampaignInspection {
  complianceStatus: string;
  snapshotCount: number;
  drawCount: number;
  awardCount: number;
  resultCount: number;
}

export interface SampleRaffleTargetInspection {
  eventId: string;
  hostEventValid: boolean;
  dedicatedWinnerId?: string;
  completedCampaigns: SampleRaffleCompletedCampaignInspection[];
  ongoingCampaigns: SampleRaffleOngoingCampaignInspection[];
}

export interface SampleRaffleProvisioningLock {
  id: string;
}

type Session = { sessionToken: string };
type WinnerSession = Session & { riderId: string };

/**
 * These are the production backend operations an adapter may delegate to.
 * The provisioner itself only accepts narrow, secret-safe domain dependencies.
 */
export type SampleRaffleBackendOperations = Pick<
  PrismaTambikeBackend,
  | "createGiveaway"
  | "submitGiveawayForReview"
  | "reviewGiveawayCompliance"
  | "openGiveaway"
  | "grantManualGiveawayEntry"
  | "lockGiveaway"
  | "selectManualGiveawayAward"
  | "publishGiveawayDraw"
  | "setGiveawayWinnerPublication"
  | "issueGiveawayClaimToken"
  | "verifyGiveawayClaim"
  | "fulfillGiveawayAward"
  | "completeGiveawayClaims"
>;

export interface SampleRaffleProvisionerDependencies {
  inspectTarget(manifest: SampleRaffleManifest): Promise<SampleRaffleTargetInspection>;
  acquireLock(): Promise<SampleRaffleProvisioningLock>;
  releaseLock(lock: SampleRaffleProvisioningLock): Promise<void>;
  authenticateOrganizer(password: string): Promise<Session>;
  authenticateAdmin(password: string): Promise<Session>;
  ensureWinner(input: { email: string; name: string; password: string }): Promise<WinnerSession>;
  ensureWinnerRegistration(winner: WinnerSession, eventId: string): Promise<void>;
  createCompletedCampaign(organizer: Session, input: CreateGiveawayInput): Promise<{ giveawayId: string }>;
  submitCompletedCampaign(organizer: Session, giveawayId: string): Promise<void>;
  approveCompletedCampaign(admin: Session, giveawayId: string): Promise<void>;
  openCompletedCampaign(organizer: Session, giveawayId: string): Promise<void>;
  grantCompletedEntry(organizer: Session, giveawayId: string, winner: WinnerSession): Promise<void>;
  lockCompletedCampaign(organizer: Session, giveawayId: string): Promise<void>;
  selectCompletedWinner(
    organizer: Session,
    giveawayId: string,
    winner: WinnerSession,
  ): Promise<{ awardId: string; drawId: string }>;
  publishCompletedDraw(
    organizer: Session,
    giveawayId: string,
    drawId: string,
  ): Promise<Pick<PublicGiveawayDrawVerification, "giveawayId"> | void>;
  publishWinnerAlias(winner: WinnerSession, awardId: string, alias: string): Promise<void>;
  issueClaim(winner: WinnerSession, awardId: string): Promise<Pick<IssuedGiveawayClaimToken, "qrPayload">>;
  verifyClaim(
    admin: Session,
    claimPayload: string,
  ): Promise<Pick<OperatorGiveawayClaimView, "awardId"> | void>;
  fulfillAward(
    admin: Session,
    awardId: string,
  ): Promise<Pick<OperatorGiveawayClaimView, "awardId"> | void>;
  completeClaims(organizer: Session, giveawayId: string): Promise<void>;
  createOngoingCampaign(organizer: Session, input: CreateGiveawayInput): Promise<{ giveawayId: string }>;
  submitOngoingCampaign(organizer: Session, giveawayId: string): Promise<void>;
  approveOngoingCampaign(admin: Session, giveawayId: string): Promise<void>;
  openOngoingCampaign(organizer: Session, giveawayId: string): Promise<void>;
  finish(): Promise<void>;
}

export function completedSampleRaffleInput(
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): CreateGiveawayInput {
  return {
    eventId: manifest.eventId,
    title: manifest.completedTitle,
    kind: "raffle",
    entryMode: "manual_only",
    maxEntriesPerRider: 1,
    mechanics: "One designated demo rider entry is selected for this sample raffle.",
    terms: "Sample raffle for demonstrating a completed Tambike winner flow.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "event_page",
    presenceVerificationRequired: false,
    eligibilityGroups: [
      { id: "sample-manual-entry", label: "Designated sample entry", weight: 1, conditions: [{ source: "manual" }] },
    ],
    prizePools: [
      {
        id: "sample-helmet-pool",
        title: "Helmet",
        awardMode: "manual_selection",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Cafe Classico Helmet" }],
      },
    ],
  };
}

export function ongoingSampleRaffleInput(
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): CreateGiveawayInput {
  return {
    eventId: manifest.eventId,
    title: manifest.ongoingTitle,
    kind: "raffle",
    entryMode: "opt_in",
    maxEntriesPerRider: 1,
    mechanics: "Registered event riders may enter once while this sample raffle is open.",
    terms: "Sample ongoing raffle. No winner has been selected.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "event_page",
    presenceVerificationRequired: false,
    eligibilityGroups: [
      { id: "active-rsvp-pass", label: "Active RSVP and pass", weight: 1, conditions: [{ source: "active_rsvp_pass" }] },
    ],
    prizePools: [
      {
        id: "sample-rider-gear-pool",
        title: "Rider gear package",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Weekend Rider Gear Package" }],
      },
    ],
  };
}

function hasCredential(value: string | undefined) {
  return Boolean(value?.trim());
}

function finalReceipt(
  inspection: SampleRaffleTargetInspection,
  manifest: SampleRaffleManifest,
  changed: boolean,
): SampleRaffleProvisioningReceipt | null {
  const completed = inspection.completedCampaigns;
  const ongoing = inspection.ongoingCampaigns;
  if (completed.length !== 1 || ongoing.length !== 1) return null;
  const [completedCampaign] = completed;
  const [ongoingCampaign] = ongoing;
  if (
    completedCampaign.title !== manifest.completedTitle ||
    completedCampaign.state !== "completed" ||
    completedCampaign.complianceStatus !== "approved" ||
    completedCampaign.drawCount !== 1 ||
    completedCampaign.publishedDrawCount !== 1 ||
    completedCampaign.currentAwardCount !== 1 ||
    completedCampaign.fulfilledAwardCount !== 1 ||
    completedCampaign.publicWinnerAliases.length !== 1 ||
    completedCampaign.publicWinnerAliases[0] !== manifest.winnerAlias ||
    !inspection.dedicatedWinnerId ||
    completedCampaign.winnerUserId !== inspection.dedicatedWinnerId ||
    completedCampaign.winnerCount !== 1 ||
    completedCampaign.currentAwards.length !== 1 ||
    completedCampaign.currentAwards[0]?.status !== "fulfilled" ||
    completedCampaign.currentAwards[0]?.winnerAlias !== manifest.winnerAlias ||
    !completedCampaign.currentAwards[0]?.winnerAliasPublished ||
    completedCampaign.winnerAlias !== manifest.winnerAlias ||
    ongoingCampaign.title !== manifest.ongoingTitle ||
    ongoingCampaign.state !== "open" ||
    ongoingCampaign.complianceStatus !== "approved" ||
    ongoingCampaign.winnerCount !== 0 ||
    ongoingCampaign.snapshotCount !== 0 ||
    ongoingCampaign.drawCount !== 0 ||
    ongoingCampaign.awardCount !== 0 ||
    ongoingCampaign.resultCount !== 0
  ) {
    return null;
  }
  return {
    eventId: manifest.eventId,
    completed: {
      giveawayId: completedCampaign.giveawayId,
      title: manifest.completedTitle,
      state: "completed",
      winnerCount: 1,
      winnerAlias: manifest.winnerAlias,
    },
    ongoing: {
      giveawayId: ongoingCampaign.giveawayId,
      title: manifest.ongoingTitle,
      state: "open",
      winnerCount: 0,
    },
    changed,
  };
}

function hasNoSampleCampaigns(inspection: SampleRaffleTargetInspection) {
  return inspection.completedCampaigns.length === 0 && inspection.ongoingCampaigns.length === 0;
}

function validateInput(input: SampleRaffleProvisioningInput) {
  if (!input.confirmedProduction) throw new SampleRaffleProvisioningError("PRODUCTION_CONFIRMATION_REQUIRED");
  if (input.databaseTargetPresent !== true) throw new SampleRaffleProvisioningError("DATABASE_TARGET_REQUIRED");
  if (input.directLockPresent !== true) throw new SampleRaffleProvisioningError("DIRECT_LOCK_REQUIRED");
  if (!hasCredential(input.organizerPassword)) throw new SampleRaffleProvisioningError("ORGANIZER_CREDENTIAL_REQUIRED");
  if (!hasCredential(input.adminPassword)) throw new SampleRaffleProvisioningError("ADMIN_CREDENTIAL_REQUIRED");
  if (!hasCredential(input.winnerPassword)) throw new SampleRaffleProvisioningError("WINNER_CREDENTIAL_REQUIRED");
}

export async function provisionSampleRaffles(
  input: SampleRaffleProvisioningInput,
  dependencies: SampleRaffleProvisionerDependencies,
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): Promise<SampleRaffleProvisioningReceipt> {
  validateInput(input);

  const firstInspection = await dependencies.inspectTarget(manifest);
  if (!firstInspection.hostEventValid || firstInspection.eventId !== manifest.eventId) {
    throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
  }
  const existingReceipt = finalReceipt(firstInspection, manifest, false);
  if (existingReceipt) return existingReceipt;
  if (!hasNoSampleCampaigns(firstInspection)) {
    throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
  }
  if (!input.drawEncryptionKeyPresent) throw new SampleRaffleProvisioningError("DRAW_ENCRYPTION_KEY_REQUIRED");

  const lock = await dependencies.acquireLock();
  try {
    const lockedInspection = await dependencies.inspectTarget(manifest);
    if (!lockedInspection.hostEventValid || lockedInspection.eventId !== manifest.eventId) {
      throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
    }
    const lockedReceipt = finalReceipt(lockedInspection, manifest, false);
    if (lockedReceipt) return lockedReceipt;
    if (!hasNoSampleCampaigns(lockedInspection)) {
      throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
    }

    let organizer: Session;
    let admin: Session;
    let winner: WinnerSession;
    try {
      organizer = await dependencies.authenticateOrganizer(input.organizerPassword!);
      admin = await dependencies.authenticateAdmin(input.adminPassword!);
      winner = await dependencies.ensureWinner({
        email: manifest.winnerEmail,
        name: manifest.winnerName,
        password: input.winnerPassword!,
      });
    } catch (error) {
      if (error instanceof SampleRaffleProvisioningError) throw error;
      throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
    }

    await dependencies.ensureWinnerRegistration(winner, manifest.eventId);
    const completed = await dependencies.createCompletedCampaign(organizer, completedSampleRaffleInput(manifest));
    await dependencies.submitCompletedCampaign(organizer, completed.giveawayId);
    await dependencies.approveCompletedCampaign(admin, completed.giveawayId);
    await dependencies.openCompletedCampaign(organizer, completed.giveawayId);
    await dependencies.grantCompletedEntry(organizer, completed.giveawayId, winner);
    await dependencies.lockCompletedCampaign(organizer, completed.giveawayId);
    const selected = await dependencies.selectCompletedWinner(organizer, completed.giveawayId, winner);
    await dependencies.publishCompletedDraw(organizer, completed.giveawayId, selected.drawId);
    await dependencies.publishWinnerAlias(winner, selected.awardId, manifest.winnerAlias);
    const claim = await dependencies.issueClaim(winner, selected.awardId);
    await dependencies.verifyClaim(admin, claim.qrPayload);
    await dependencies.fulfillAward(admin, selected.awardId);
    await dependencies.completeClaims(organizer, completed.giveawayId);

    const ongoing = await dependencies.createOngoingCampaign(organizer, ongoingSampleRaffleInput(manifest));
    await dependencies.submitOngoingCampaign(organizer, ongoing.giveawayId);
    await dependencies.approveOngoingCampaign(admin, ongoing.giveawayId);
    await dependencies.openOngoingCampaign(organizer, ongoing.giveawayId);

    const finalInspection = await dependencies.inspectTarget(manifest);
    const receipt = finalReceipt(finalInspection, manifest, true);
    if (!receipt) throw new SampleRaffleProvisioningError("FINAL_INVARIANT_FAILED");
    return receipt;
  } finally {
    try {
      await dependencies.releaseLock(lock);
    } finally {
      await dependencies.finish();
    }
  }
}

const SAMPLE_RAFFLE_LOCK_KEY = "tambike:production-sample-raffles:v1";
const SAMPLE_COMPLETED_SELECTION_KEY = "sample-completed-manual-selection-v1";
const SAMPLE_COMPLETED_VERIFICATION_KEY = "sample-completed-claim-verification-v1";
const SAMPLE_COMPLETED_FULFILMENT_KEY = "sample-completed-fulfilment-v1";

export interface PrismaSampleRaffleProvisioner {
  dependencies: SampleRaffleProvisionerDependencies;
  close(): Promise<void>;
}

function parsePostgresDatabaseUrl(
  value: string | undefined,
  code: "DATABASE_TARGET_REQUIRED" | "DIRECT_LOCK_REQUIRED",
) {
  const trimmed = value?.trim();
  if (!trimmed) throw new SampleRaffleProvisioningError(code);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SampleRaffleProvisioningError(code);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new SampleRaffleProvisioningError(code);
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).trim();
  } catch {
    throw new SampleRaffleProvisioningError(code);
  }
  if (!databaseName) throw new SampleRaffleProvisioningError(code);
  return { value: trimmed, parsed, databaseName };
}

export function validateDirectSampleRaffleLockUrl(value: string | undefined) {
  const target = parsePostgresDatabaseUrl(value, "DIRECT_LOCK_REQUIRED");
  const hostname = target.parsed.hostname.toLowerCase();
  if (
    hostname.includes("pooler") ||
    hostname.includes("pgbouncer") ||
    target.parsed.port === "6543" ||
    target.parsed.searchParams.get("pgbouncer")?.toLowerCase() === "true" ||
    target.parsed.searchParams.get("pool_mode")?.toLowerCase() === "transaction"
  ) {
    throw new SampleRaffleProvisioningError("DIRECT_LOCK_REQUIRED");
  }
  return target.value;
}

export function toSampleRaffleCliErrorCode(error: unknown) {
  if (error instanceof SampleRaffleProvisioningError) return error.code;
  return "SAMPLE_RAFFLE_PROVISIONING_FAILED";
}

async function disconnectAll(steps: Array<() => Promise<void>>) {
  const results = await Promise.allSettled(steps.map((step) => step()));
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (failures.length > 0) {
    throw new AggregateError(failures, "SAMPLE_RAFFLE_PROVISIONER_CLOSE_FAILED");
  }
}

export function createPrismaSampleRaffleProvisioner(
  runtimeDatabaseUrl: string,
  directDatabaseUrl: string,
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): PrismaSampleRaffleProvisioner {
  const runtimeTarget = parsePostgresDatabaseUrl(runtimeDatabaseUrl, "DATABASE_TARGET_REQUIRED");
  const directTarget = parsePostgresDatabaseUrl(
    validateDirectSampleRaffleLockUrl(directDatabaseUrl),
    "DIRECT_LOCK_REQUIRED",
  );
  if (runtimeTarget.databaseName !== directTarget.databaseName) {
    throw new SampleRaffleProvisioningError("DIRECT_LOCK_REQUIRED");
  }

  const inspectionPool = new Pool({
    connectionString: directTarget.value,
    max: 1,
  });
  const inspectionPrisma = new PrismaClient({
    adapter: new PrismaPg(inspectionPool, { disposeExternalPool: true }),
  });
  const backend = PrismaTambikeBackendRuntime.create(runtimeTarget.value);
  let lockHeld = false;
  let hostOrganizerUserId: string | undefined;
  let hostOrganizerEmail: string | undefined;
  let finishPromise: Promise<void> | undefined;
  const manualSelectionByGiveaway = new Map<string, {
    prizePoolId: string;
    snapshotEntryId: string;
    winnerUserId: string;
  }>();

  const finish = () => {
    finishPromise ??= disconnectAll([
      () => backend.disconnect(),
      () => inspectionPrisma.$disconnect(),
    ]);
    return finishPromise;
  };

  const inspectTarget = async (): Promise<SampleRaffleTargetInspection> => {
    const [event, dedicatedWinner, campaigns] = await Promise.all([
      inspectionPrisma.event.findUnique({
        where: { id: manifest.eventId },
        select: {
          status: true,
          organizer: { select: { userId: true, user: { select: { email: true } } } },
        },
      }),
      inspectionPrisma.user.findUnique({
        where: { email: manifest.winnerEmail },
        select: { id: true },
      }),
      inspectionPrisma.eventGiveaway.findMany({
        where: {
          eventId: manifest.eventId,
          title: { in: [manifest.completedTitle, manifest.ongoingTitle] },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          complianceStatus: true,
          snapshot: { select: { id: true } },
          draws: {
            orderBy: { id: "asc" },
            select: { status: true },
          },
          awards: {
            orderBy: { id: "asc" },
            select: {
              status: true,
              isCurrent: true,
              winnerUserId: true,
              publicWinnerAlias: true,
              winnerAliasOptedInAt: true,
              winnerAliasRevokedAt: true,
            },
          },
        },
      }),
    ]);
    hostOrganizerUserId = event?.organizer.userId;
    hostOrganizerEmail = event?.organizer.user.email;

    const completedCampaigns = campaigns
      .filter((campaign) => campaign.title === manifest.completedTitle)
      .map((campaign): SampleRaffleCompletedCampaignInspection => {
        const currentAwards = campaign.awards.filter((award) => award.isCurrent);
        const publicWinnerAliases = currentAwards
          .filter((award) =>
            Boolean(
              award.publicWinnerAlias &&
              award.winnerAliasOptedInAt &&
              !award.winnerAliasRevokedAt,
            ))
          .map((award) => award.publicWinnerAlias!)
          .sort();
        const winnerIds = [...new Set(currentAwards.map((award) => award.winnerUserId))];
        return {
          giveawayId: campaign.id,
          title: campaign.title,
          state: campaign.status,
          complianceStatus: campaign.complianceStatus,
          winnerCount: currentAwards.length,
          winnerAlias: publicWinnerAliases.length === 1 ? publicWinnerAliases[0] : undefined,
          drawCount: campaign.draws.length,
          publishedDrawCount: campaign.draws.filter((draw) => draw.status === "published").length,
          currentAwardCount: currentAwards.length,
          fulfilledAwardCount: currentAwards.filter((award) => award.status === "fulfilled").length,
          publicWinnerAliases,
          winnerUserId: winnerIds.length === 1 ? winnerIds[0] : undefined,
          currentAwards: currentAwards.map((award) => ({
            status: award.status,
            winnerAlias: award.publicWinnerAlias ?? undefined,
            winnerAliasPublished: Boolean(
              award.publicWinnerAlias &&
              award.winnerAliasOptedInAt &&
              !award.winnerAliasRevokedAt,
            ),
          })),
        };
      });

    const ongoingCampaigns = campaigns
      .filter((campaign) => campaign.title === manifest.ongoingTitle)
      .map((campaign): SampleRaffleOngoingCampaignInspection => {
        const currentAwards = campaign.awards.filter((award) => award.isCurrent);
        return {
          giveawayId: campaign.id,
          title: campaign.title,
          state: campaign.status,
          complianceStatus: campaign.complianceStatus,
          winnerCount: currentAwards.length,
          snapshotCount: campaign.snapshot ? 1 : 0,
          drawCount: campaign.draws.length,
          awardCount: campaign.awards.length,
          resultCount: campaign.draws.filter((draw) => draw.status === "published").length,
        };
      });

    return {
      eventId: manifest.eventId,
      hostEventValid: event?.status === "PUBLISHED",
      dedicatedWinnerId: dedicatedWinner?.id,
      completedCampaigns,
      ongoingCampaigns,
    };
  };

  const dependencies: SampleRaffleProvisionerDependencies = {
    inspectTarget,
    async acquireLock() {
      const rows = await inspectionPrisma.$queryRaw<Array<{ locked: string }>>(
        Prisma.sql`SELECT pg_advisory_lock(hashtextextended(${SAMPLE_RAFFLE_LOCK_KEY}, 0))::text AS locked`,
      );
      if (rows.length !== 1) throw new Error("ADVISORY_LOCK_ACQUISITION_FAILED");
      lockHeld = true;
      return { id: SAMPLE_RAFFLE_LOCK_KEY };
    },
    async releaseLock() {
      if (!lockHeld) return;
      const rows = await inspectionPrisma.$queryRaw<Array<{ unlocked: boolean }>>(
        Prisma.sql`SELECT pg_advisory_unlock(hashtextextended(${SAMPLE_RAFFLE_LOCK_KEY}, 0)) AS unlocked`,
      );
      lockHeld = false;
      if (rows[0]?.unlocked !== true) {
        throw new Error("ADVISORY_LOCK_RELEASE_FAILED");
      }
    },
    async authenticateOrganizer(password) {
      if (!hostOrganizerEmail) {
        throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
      }
      const result = await backend.loginWithPassword(hostOrganizerEmail, password);
      if (
        result.user.role !== "organizer" ||
        !hostOrganizerUserId ||
        result.user.id !== hostOrganizerUserId
      ) {
        throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
      }
      return { sessionToken: result.sessionToken };
    },
    async authenticateAdmin(password) {
      const result = await backend.loginWithPassword("ops@tambike.example", password);
      if (result.user.role !== "admin") {
        throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
      }
      return { sessionToken: result.sessionToken };
    },
    async ensureWinner(input) {
      const existing = await inspectionPrisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      const result = existing
        ? await backend.loginWithPassword(input.email, input.password)
        : await backend.signUpRider({
            email: input.email,
            displayName: input.name,
            area: "Davao City",
            password: input.password,
          });
      if (result.user.role !== "rider") {
        throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
      }
      return { sessionToken: result.sessionToken, riderId: result.user.id };
    },
    async ensureWinnerRegistration(winner, eventId) {
      await backend.registerForEvent(winner.sessionToken, eventId, {
        status: "going",
        attendanceType: "direct",
      });
    },
    async createCompletedCampaign(organizer, input) {
      const campaign = await backend.createGiveaway(organizer.sessionToken, input.eventId, input);
      return { giveawayId: campaign.id };
    },
    async submitCompletedCampaign(organizer, giveawayId) {
      await backend.submitGiveawayForReview(organizer.sessionToken, giveawayId);
    },
    async approveCompletedCampaign(admin, giveawayId) {
      await backend.reviewGiveawayCompliance(admin.sessionToken, giveawayId, { decision: "approved" });
    },
    async openCompletedCampaign(organizer, giveawayId) {
      await backend.openGiveaway(organizer.sessionToken, giveawayId);
    },
    async grantCompletedEntry(organizer, giveawayId, winner) {
      await backend.grantManualGiveawayEntry(organizer.sessionToken, {
        giveawayId,
        riderId: winner.riderId,
        reason: "Dedicated production sample raffle winner",
      });
    },
    async lockCompletedCampaign(organizer, giveawayId) {
      await backend.lockGiveaway(organizer.sessionToken, giveawayId);
      const campaign = await inspectionPrisma.eventGiveaway.findUnique({
        where: { id: giveawayId },
        select: {
          prizePools: {
            where: { awardMode: "manual_selection" },
            select: { id: true },
          },
        },
      });
      if (campaign?.prizePools.length !== 1) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      const prizePoolId = campaign.prizePools[0].id;
      const candidates = await backend.listGiveawayManualSelectionCandidates(
        organizer.sessionToken,
        giveawayId,
        prizePoolId,
      );
      if (candidates.length !== 1) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      const candidate = await inspectionPrisma.giveawaySnapshotEntry.findUnique({
        where: { id: candidates[0].snapshotEntryId },
        select: { entry: { select: { riderId: true } } },
      });
      if (!candidate) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      manualSelectionByGiveaway.set(giveawayId, {
        prizePoolId,
        snapshotEntryId: candidates[0].snapshotEntryId,
        winnerUserId: candidate.entry.riderId,
      });
    },
    async selectCompletedWinner(organizer, giveawayId, winner) {
      const selection = manualSelectionByGiveaway.get(giveawayId);
      if (!selection || selection.winnerUserId !== winner.riderId) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      const draw = await backend.selectManualGiveawayAward(organizer.sessionToken, {
        giveawayId,
        prizePoolId: selection.prizePoolId,
        snapshotEntryId: selection.snapshotEntryId,
        reason: "Dedicated production sample raffle winner",
        idempotencyKey: SAMPLE_COMPLETED_SELECTION_KEY,
      });
      const awards = await inspectionPrisma.giveawayAward.findMany({
        where: {
          giveawayId,
          drawId: draw.drawId,
          winnerUserId: winner.riderId,
          isCurrent: true,
        },
        select: { id: true },
      });
      if (awards.length !== 1) {
        throw new SampleRaffleProvisioningError("FINAL_INVARIANT_FAILED");
      }
      return { awardId: awards[0].id, drawId: draw.drawId };
    },
    async publishCompletedDraw(organizer, giveawayId, drawId) {
      return backend.publishGiveawayDraw(organizer.sessionToken, giveawayId, drawId);
    },
    async publishWinnerAlias(winner, awardId, alias) {
      await backend.setGiveawayWinnerPublication(winner.sessionToken, awardId, {
        published: true,
        alias,
      });
    },
    async issueClaim(winner, awardId) {
      return backend.issueGiveawayClaimToken(winner.sessionToken, awardId);
    },
    async verifyClaim(admin, claimPayload) {
      return backend.verifyGiveawayClaim(admin.sessionToken, {
        payload: claimPayload,
        method: "manual",
        idempotencyKey: SAMPLE_COMPLETED_VERIFICATION_KEY,
      });
    },
    async fulfillAward(admin, awardId) {
      return backend.fulfillGiveawayAward(admin.sessionToken, {
        awardId,
        idempotencyKey: SAMPLE_COMPLETED_FULFILMENT_KEY,
        reference: "sample-display",
      });
    },
    async completeClaims(organizer, giveawayId) {
      await backend.completeGiveawayClaims(organizer.sessionToken, giveawayId);
    },
    async createOngoingCampaign(organizer, input) {
      const campaign = await backend.createGiveaway(organizer.sessionToken, input.eventId, input);
      return { giveawayId: campaign.id };
    },
    async submitOngoingCampaign(organizer, giveawayId) {
      await backend.submitGiveawayForReview(organizer.sessionToken, giveawayId);
    },
    async approveOngoingCampaign(admin, giveawayId) {
      await backend.reviewGiveawayCompliance(admin.sessionToken, giveawayId, { decision: "approved" });
    },
    async openOngoingCampaign(organizer, giveawayId) {
      await backend.openGiveaway(organizer.sessionToken, giveawayId);
    },
    finish,
  };

  return {
    dependencies,
    close: finish,
  };
}
