import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client as PgClient, Pool } from "pg";

import type {
  CreateGiveawayInput,
  IssuedGiveawayClaimToken,
  OperatorGiveawayClaimView,
  PublicGiveawayDrawVerification,
} from "@/features/giveaways/types";
import type { PrismaTambikeBackend } from "@/server/prisma-backend";
import { PrismaTambikeBackend as PrismaTambikeBackendRuntime } from "@/server/prisma-backend";
import { loadMemberMediaConfig } from "@/server/member-media/config";
import { normalizeMemberImage } from "@/server/member-media/image-normalizer";
import { createS3MemberMediaStore } from "@/server/member-media/s3-store";
import type { MemberMediaStore } from "@/server/member-media/store";
import {
  refreshSampleRafflePresentation,
  SAMPLE_RAFFLE_PHOTO_SOURCES,
  type RefreshSampleRafflePresentationPersistenceInput,
} from "@/server/giveaways/sample-raffle-presentation";
import {
  calculateGiveawayAuditHash,
  canonicalizeJson,
} from "@/server/giveaways/audit";

export const SAMPLE_RAFFLE_EVENT_ID = "tambike-cafe-classico";
export const COMPLETED_SAMPLE_RAFFLE_TITLE = "Cafe Classico Helmet Raffle";
export const ONGOING_SAMPLE_RAFFLE_TITLE = "Weekend Rider Gear Raffle";
export const SAMPLE_RAFFLE_WINNER_EMAIL = "raffle.winner.sample@tambike.ph";
export const SAMPLE_RAFFLE_WINNER_NAME = "Raffle Winner";
export const SAMPLE_RAFFLE_WINNER_ALIAS = "Cafe Classico Rider";

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
  | "IMMUTABLE_SAMPLE_PRESENTATION_REPLACEMENT_REQUIRED"
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
  replaceExisting?: boolean;
  trustedProductionJob?: boolean;
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
  presentation?: SampleRafflePresentationInspection;
}

export interface SampleRafflePresentationInspection {
  mechanics: string;
  terms: string;
  prizePoolId: string;
  publicTitle?: string;
  publicDescription?: string;
  publicImageMediaId?: string;
}

export interface SampleRaffleCompletedAwardInspection {
  awardId: string;
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
  archiveExistingLifecycle(input: {
    inspection: SampleRaffleTargetInspection;
    manifest: SampleRaffleManifest;
  }): Promise<void>;
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
  prepareCreatedPresentation(input: {
    inspection: SampleRaffleTargetInspection;
    manifest: SampleRaffleManifest;
  }): Promise<void>;
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
    mechanics: "One eligible rider was selected from valid entries.",
    terms:
      "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.",
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
        publicPresentation: {
          disclosure: "revealed",
          title: "Cafe Classico Helmet",
          description: "A full-face helmet for safer everyday rides.",
        },
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
    mechanics: "Registered event riders may enter once while the raffle is open.",
    terms:
      "One winner will receive the Weekend Rider Gear Package. The organizer will announce and contact the winner after the draw.",
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
        publicPresentation: {
          disclosure: "revealed",
          title: "Weekend Rider Gear Package",
          description: "Helmet, riding gloves, and Tambike gear for your next ride.",
        },
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
  if (!hasExpectedSampleLifecycle(inspection, manifest)) return null;
  const completed = inspection.completedCampaigns;
  const ongoing = inspection.ongoingCampaigns;
  const [completedCampaign] = completed;
  const [ongoingCampaign] = ongoing;
  const completedExpected = completedSampleRaffleInput(manifest);
  const ongoingExpected = ongoingSampleRaffleInput(manifest);
  const completedPrize = completedExpected.prizePools[0]?.publicPresentation;
  const ongoingPrize = ongoingExpected.prizePools[0]?.publicPresentation;
  if (
    completedCampaign.currentAwards[0]?.winnerAlias !== manifest.winnerAlias ||
    !completedCampaign.currentAwards[0]?.winnerAliasPublished ||
    completedCampaign.winnerAlias !== manifest.winnerAlias ||
    completedCampaign.presentation?.mechanics !== completedExpected.mechanics ||
    completedCampaign.presentation.terms !== completedExpected.terms ||
    completedCampaign.presentation.publicTitle !== completedPrize?.title ||
    completedCampaign.presentation.publicDescription !== completedPrize?.description ||
    !completedCampaign.presentation.publicImageMediaId ||
    ongoingCampaign.presentation?.mechanics !== ongoingExpected.mechanics ||
    ongoingCampaign.presentation.terms !== ongoingExpected.terms ||
    ongoingCampaign.presentation.publicTitle !== ongoingPrize?.title ||
    ongoingCampaign.presentation.publicDescription !== ongoingPrize?.description ||
    !ongoingCampaign.presentation.publicImageMediaId
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

function hasExpectedSampleLifecycle(
  inspection: SampleRaffleTargetInspection,
  manifest: SampleRaffleManifest,
) {
  const completed = inspection.completedCampaigns;
  const ongoing = inspection.ongoingCampaigns;
  if (completed.length !== 1 || ongoing.length !== 1) return false;
  const [completedCampaign] = completed;
  const [ongoingCampaign] = ongoing;
  return (
    completedCampaign.title === manifest.completedTitle &&
    completedCampaign.state === "completed" &&
    completedCampaign.complianceStatus === "approved" &&
    completedCampaign.drawCount === 1 &&
    completedCampaign.publishedDrawCount === 1 &&
    completedCampaign.currentAwardCount === 1 &&
    completedCampaign.fulfilledAwardCount === 1 &&
    completedCampaign.publicWinnerAliases.length === 1 &&
    Boolean(inspection.dedicatedWinnerId) &&
    completedCampaign.winnerUserId === inspection.dedicatedWinnerId &&
    completedCampaign.winnerCount === 1 &&
    completedCampaign.currentAwards.length === 1 &&
    completedCampaign.currentAwards[0]?.status === "fulfilled" &&
    ongoingCampaign.title === manifest.ongoingTitle &&
    ongoingCampaign.state === "open" &&
    ongoingCampaign.complianceStatus === "approved" &&
    ongoingCampaign.winnerCount === 0 &&
    ongoingCampaign.snapshotCount === 0 &&
    ongoingCampaign.drawCount === 0 &&
    ongoingCampaign.awardCount === 0 &&
    ongoingCampaign.resultCount === 0
  );
}

function hasNoSampleCampaigns(inspection: SampleRaffleTargetInspection) {
  return inspection.completedCampaigns.length === 0 && inspection.ongoingCampaigns.length === 0;
}

function hasExpectedDraftPair(
  inspection: SampleRaffleTargetInspection,
  manifest: SampleRaffleManifest,
) {
  const completed = inspection.completedCampaigns[0];
  const ongoing = inspection.ongoingCampaigns[0];
  return (
    inspection.completedCampaigns.length === 1 &&
    inspection.ongoingCampaigns.length === 1 &&
    completed?.title === manifest.completedTitle &&
    completed.state === "draft" &&
    completed.complianceStatus === "draft" &&
    completed.winnerCount === 0 &&
    completed.drawCount === 0 &&
    completed.currentAwardCount === 0 &&
    completed.currentAwards.length === 0 &&
    ongoing?.title === manifest.ongoingTitle &&
    ongoing.state === "draft" &&
    ongoing.complianceStatus === "draft" &&
    ongoing.winnerCount === 0 &&
    ongoing.snapshotCount === 0 &&
    ongoing.drawCount === 0 &&
    ongoing.awardCount === 0 &&
    ongoing.resultCount === 0
  );
}

export function expectedSampleRafflePresentationComplianceStatus(
  state: string,
) {
  return state === "draft" ? "draft" : "approved";
}

function validateInput(input: SampleRaffleProvisioningInput) {
  if (!input.confirmedProduction) throw new SampleRaffleProvisioningError("PRODUCTION_CONFIRMATION_REQUIRED");
  if (input.databaseTargetPresent !== true) throw new SampleRaffleProvisioningError("DATABASE_TARGET_REQUIRED");
  if (input.directLockPresent !== true) throw new SampleRaffleProvisioningError("DIRECT_LOCK_REQUIRED");
}

function validateCreationCredentials(input: SampleRaffleProvisioningInput) {
  if (input.trustedProductionJob === true) return;
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
  const firstHasReplaceableLifecycle =
    hasExpectedSampleLifecycle(firstInspection, manifest);
  const firstHasRecoverableDraftPair =
    hasExpectedDraftPair(firstInspection, manifest);
  if (
    !hasNoSampleCampaigns(firstInspection) &&
    !firstHasReplaceableLifecycle &&
    !firstHasRecoverableDraftPair
  ) {
    throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
  }
  if (firstHasReplaceableLifecycle && input.replaceExisting !== true) {
    throw new SampleRaffleProvisioningError(
      "IMMUTABLE_SAMPLE_PRESENTATION_REPLACEMENT_REQUIRED",
    );
  }
  if (
    hasNoSampleCampaigns(firstInspection) ||
    firstHasReplaceableLifecycle ||
    firstHasRecoverableDraftPair
  ) {
    validateCreationCredentials(input);
    if (!input.drawEncryptionKeyPresent) {
      throw new SampleRaffleProvisioningError("DRAW_ENCRYPTION_KEY_REQUIRED");
    }
  }

  const lock = await dependencies.acquireLock();
  try {
    const lockedInspection = await dependencies.inspectTarget(manifest);
    if (!lockedInspection.hostEventValid || lockedInspection.eventId !== manifest.eventId) {
      throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
    }
    const lockedReceipt = finalReceipt(lockedInspection, manifest, false);
    if (lockedReceipt) return lockedReceipt;
    const lockedHasExpectedLifecycle =
      hasExpectedSampleLifecycle(lockedInspection, manifest);
    const lockedHasExpectedDraftPair =
      hasExpectedDraftPair(lockedInspection, manifest);
    if (
      !hasNoSampleCampaigns(lockedInspection) &&
      !lockedHasExpectedLifecycle &&
      !lockedHasExpectedDraftPair
    ) {
      throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
    }

    if (lockedHasExpectedLifecycle) {
      if (input.replaceExisting !== true) {
        throw new SampleRaffleProvisioningError(
          "IMMUTABLE_SAMPLE_PRESENTATION_REPLACEMENT_REQUIRED",
        );
      }
      await dependencies.archiveExistingLifecycle({
        inspection: lockedInspection,
        manifest,
      });
      const archivedInspection = await dependencies.inspectTarget(manifest);
      if (!hasNoSampleCampaigns(archivedInspection)) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
    }

    validateCreationCredentials(input);
    if (!input.drawEncryptionKeyPresent) {
      throw new SampleRaffleProvisioningError("DRAW_ENCRYPTION_KEY_REQUIRED");
    }
    let organizer: Session;
    let admin: Session;
    let winner: WinnerSession;
    try {
      organizer = await dependencies.authenticateOrganizer(input.organizerPassword ?? "");
      admin = await dependencies.authenticateAdmin(input.adminPassword ?? "");
      winner = await dependencies.ensureWinner({
        email: manifest.winnerEmail,
        name: manifest.winnerName,
        password: input.winnerPassword ?? "",
      });
    } catch (error) {
      if (error instanceof SampleRaffleProvisioningError) throw error;
      throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
    }

    await dependencies.ensureWinnerRegistration(winner, manifest.eventId);
    const completed = lockedHasExpectedDraftPair
      ? { giveawayId: lockedInspection.completedCampaigns[0].giveawayId }
      : await dependencies.createCompletedCampaign(
          organizer,
          completedSampleRaffleInput(manifest),
        );
    const ongoing = lockedHasExpectedDraftPair
      ? { giveawayId: lockedInspection.ongoingCampaigns[0].giveawayId }
      : await dependencies.createOngoingCampaign(
          organizer,
          ongoingSampleRaffleInput(manifest),
        );
    const draftInspection = await dependencies.inspectTarget(manifest);
    if (!hasExpectedDraftPair(draftInspection, manifest)) {
      throw new SampleRaffleProvisioningError("FINAL_INVARIANT_FAILED");
    }
    await dependencies.prepareCreatedPresentation({
      inspection: draftInspection,
      manifest,
    });

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

function sampleRaffleMechanicsChecksum(
  mechanics: string,
  terms: string,
  sponsorDisclosure: string | null,
) {
  return createHash("sha256")
    .update(canonicalizeJson({ mechanics, terms, sponsorDisclosure }))
    .digest("hex");
}

export interface PrismaSampleRaffleProvisioner {
  dependencies: SampleRaffleProvisionerDependencies;
  close(): Promise<void>;
}

export interface SampleRaffleLockClient {
  connect(): Promise<void>;
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export interface DedicatedSampleRaffleLock {
  acquire(): Promise<void>;
  release(): Promise<void>;
  close(): Promise<void>;
}

export function createDedicatedSampleRaffleLock(
  connectionString: string,
  createClient: (connectionString: string) => SampleRaffleLockClient =
    (value) =>
      new PgClient({ connectionString: value }) as unknown as SampleRaffleLockClient,
): DedicatedSampleRaffleLock {
  let client: SampleRaffleLockClient | undefined;
  let acquired = false;

  const closeClient = async () => {
    const activeClient = client;
    client = undefined;
    acquired = false;
    if (activeClient) await activeClient.end();
  };

  return {
    async acquire() {
      if (client) throw new Error("ADVISORY_LOCK_ACQUISITION_FAILED");
      const activeClient = createClient(connectionString);
      client = activeClient;
      try {
        await activeClient.connect();
        const result = await activeClient.query(
          "SELECT pg_advisory_lock(hashtextextended($1, 0)) AS locked",
          [SAMPLE_RAFFLE_LOCK_KEY],
        );
        if (result.rows.length !== 1) {
          throw new Error("ADVISORY_LOCK_ACQUISITION_FAILED");
        }
        acquired = true;
      } catch (error) {
        try {
          await closeClient();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "ADVISORY_LOCK_ACQUISITION_FAILED",
          );
        }
        throw error;
      }
    },
    async release() {
      const activeClient = client;
      if (!activeClient) return;
      let releaseFailure: unknown;
      try {
        if (acquired) {
          const result = await activeClient.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [SAMPLE_RAFFLE_LOCK_KEY],
          );
          if (result.rows[0]?.unlocked !== true) {
            throw new Error("ADVISORY_LOCK_RELEASE_FAILED");
          }
        }
      } catch (error) {
        releaseFailure = error;
      }
      try {
        await closeClient();
      } catch (cleanupError) {
        if (releaseFailure) {
          throw new AggregateError(
            [releaseFailure, cleanupError],
            "ADVISORY_LOCK_RELEASE_FAILED",
          );
        }
        throw cleanupError;
      }
      if (releaseFailure) throw releaseFailure;
    },
    async close() {
      if (!client) return;
      await closeClient();
    },
  };
}

export interface PrismaSampleRafflePresentationOptions {
  fetchPhoto?: (url: string) => Promise<Response>;
  normalizePhoto?: typeof normalizeMemberImage;
  mediaStore?: Pick<MemberMediaStore, "putObject" | "deleteObject">;
  trustedExistingActorSessions?: boolean;
  createLockClient?: (connectionString: string) => SampleRaffleLockClient;
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

export interface SampleRaffleDatabaseIdentity {
  databaseName: string;
  serverAddress: string | null;
  serverPort: number | null;
}

export function validateSampleRaffleDatabaseIdentities(
  runtime: SampleRaffleDatabaseIdentity,
  direct: SampleRaffleDatabaseIdentity,
) {
  if (
    !runtime.databaseName ||
    !runtime.serverAddress ||
    runtime.serverPort === null ||
    runtime.databaseName !== direct.databaseName ||
    runtime.serverAddress !== direct.serverAddress ||
    runtime.serverPort !== direct.serverPort
  ) {
    throw new SampleRaffleProvisioningError("DIRECT_LOCK_REQUIRED");
  }
}

async function readSampleRaffleDatabaseIdentity(
  pool: Pool,
): Promise<SampleRaffleDatabaseIdentity> {
  const result = await pool.query<SampleRaffleDatabaseIdentity>(`
    SELECT
      current_database() AS "databaseName",
      inet_server_addr()::text AS "serverAddress",
      inet_server_port() AS "serverPort"
  `);
  if (result.rows.length !== 1) {
    throw new SampleRaffleProvisioningError("DIRECT_LOCK_REQUIRED");
  }
  return result.rows[0];
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

export async function createPrismaSampleRaffleProvisioner(
  runtimeDatabaseUrl: string,
  directDatabaseUrl: string,
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
  presentationOptions: PrismaSampleRafflePresentationOptions = {},
): Promise<PrismaSampleRaffleProvisioner> {
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
  const runtimeIdentityPool = new Pool({
    connectionString: runtimeTarget.value,
    max: 1,
  });
  try {
    const [runtimeIdentity, directIdentity] = await Promise.all([
      readSampleRaffleDatabaseIdentity(runtimeIdentityPool),
      readSampleRaffleDatabaseIdentity(inspectionPool),
    ]);
    validateSampleRaffleDatabaseIdentities(runtimeIdentity, directIdentity);
  } catch (error) {
    await Promise.allSettled([
      runtimeIdentityPool.end(),
      inspectionPool.end(),
    ]);
    throw error;
  }
  try {
    await runtimeIdentityPool.end();
  } catch (error) {
    await Promise.allSettled([inspectionPool.end()]);
    throw error;
  }
  const inspectionPrisma = new PrismaClient({
    adapter: new PrismaPg(inspectionPool, { disposeExternalPool: true }),
  });
  const backend = PrismaTambikeBackendRuntime.create(runtimeTarget.value);
  const dedicatedLock = createDedicatedSampleRaffleLock(
    directTarget.value,
    presentationOptions.createLockClient,
  );
  let hostOrganizerUserId: string | undefined;
  let hostOrganizerEmail: string | undefined;
  let authenticatedOrganizerUserId: string | undefined;
  let authenticatedAdminUserId: string | undefined;
  let samplePrizeMediaStore: MemberMediaStore | undefined;
  let finishPromise: Promise<void> | undefined;
  const trustedSessionIds: string[] = [];
  const manualSelectionByGiveaway = new Map<string, {
    prizePoolId: string;
    snapshotEntryId: string;
    winnerUserId: string;
  }>();

  const finish = () => {
    finishPromise ??= (async () => {
      let cleanupFailure: unknown;
      try {
        if (trustedSessionIds.length > 0) {
          await inspectionPrisma.session.deleteMany({
            where: { id: { in: trustedSessionIds } },
          });
        }
      } catch (error) {
        cleanupFailure = error;
      }
      try {
        await disconnectAll([
          () => dedicatedLock.close(),
          () => backend.disconnect(),
          () => inspectionPrisma.$disconnect(),
        ]);
      } catch (error) {
        if (cleanupFailure) {
          throw new AggregateError(
            [cleanupFailure, error],
            "SAMPLE_RAFFLE_PROVISIONER_CLOSE_FAILED",
          );
        }
        throw error;
      }
      if (cleanupFailure) throw cleanupFailure;
    })();
    return finishPromise;
  };

  const createTrustedActorSession = async (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    const session = await inspectionPrisma.session.create({
      data: {
        tokenHash: createHash("sha256").update(token).digest("base64url"),
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      select: { id: true },
    });
    trustedSessionIds.push(session.id);
    return token;
  };

  const resolveSamplePrizeMediaStore = () => {
    samplePrizeMediaStore ??=
      presentationOptions.mediaStore
        ? {
            createPresignedPost: async () => {
              throw new Error("SAMPLE_RAFFLE_PRESIGNED_UPLOAD_UNAVAILABLE");
            },
            getObject: async () => {
              throw new Error("SAMPLE_RAFFLE_MEDIA_READ_UNAVAILABLE");
            },
            ...presentationOptions.mediaStore,
          }
        : createS3MemberMediaStore(loadMemberMediaConfig());
    return samplePrizeMediaStore;
  };

  const inspectTarget = async (): Promise<SampleRaffleTargetInspection> => {
    const event = await inspectionPrisma.event.findUnique({
      where: { id: manifest.eventId },
      select: {
        status: true,
        organizer: {
          select: { userId: true, user: { select: { email: true } } },
        },
      },
    });
    const dedicatedWinner = await inspectionPrisma.user.findUnique({
      where: { email: manifest.winnerEmail },
      select: { id: true },
    });
    const campaigns = await inspectionPrisma.eventGiveaway.findMany({
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
        mechanicsVersions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            mechanics: true,
            terms: true,
          },
        },
        prizePools: {
          orderBy: { position: "asc" },
          take: 1,
          select: {
            id: true,
            publicTitle: true,
            publicDescription: true,
            publicImage: { select: { mediaId: true } },
          },
        },
        snapshot: { select: { id: true } },
        draws: {
          orderBy: { id: "asc" },
          select: { status: true },
        },
        awards: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            status: true,
            isCurrent: true,
            winnerUserId: true,
            publicWinnerAlias: true,
            winnerAliasOptedInAt: true,
            winnerAliasRevokedAt: true,
          },
        },
      },
    });
    hostOrganizerUserId = event?.organizer.userId;
    hostOrganizerEmail = event?.organizer.user.email;

    const completedCampaigns = campaigns
      .filter((campaign) => campaign.title === manifest.completedTitle)
      .map((campaign): SampleRaffleCompletedCampaignInspection => {
        const currentAwards = campaign.awards.filter((award) => award.isCurrent);
        const mechanics = campaign.mechanicsVersions[0];
        const prizePool = campaign.prizePools[0];
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
            awardId: award.id,
            status: award.status,
            winnerAlias: award.publicWinnerAlias ?? undefined,
            winnerAliasPublished: Boolean(
              award.publicWinnerAlias &&
              award.winnerAliasOptedInAt &&
              !award.winnerAliasRevokedAt,
            ),
          })),
          presentation:
            mechanics && prizePool
              ? {
                  mechanics: mechanics.mechanics,
                  terms: mechanics.terms,
                  prizePoolId: prizePool.id,
                  publicTitle: prizePool.publicTitle ?? undefined,
                  publicDescription: prizePool.publicDescription ?? undefined,
                  publicImageMediaId: prizePool.publicImage?.mediaId,
                }
              : undefined,
        };
      });

    const ongoingCampaigns = campaigns
      .filter((campaign) => campaign.title === manifest.ongoingTitle)
      .map((campaign): SampleRaffleOngoingCampaignInspection => {
        const currentAwards = campaign.awards.filter((award) => award.isCurrent);
        const mechanics = campaign.mechanicsVersions[0];
        const prizePool = campaign.prizePools[0];
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
          presentation:
            mechanics && prizePool
              ? {
                  mechanics: mechanics.mechanics,
                  terms: mechanics.terms,
                  prizePoolId: prizePool.id,
                  publicTitle: prizePool.publicTitle ?? undefined,
                  publicDescription: prizePool.publicDescription ?? undefined,
                  publicImageMediaId: prizePool.publicImage?.mediaId,
                }
              : undefined,
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

  const persistSampleRafflePresentation = async (
    input: RefreshSampleRafflePresentationPersistenceInput,
  ) => {
    if (
      !hostOrganizerUserId ||
      (authenticatedOrganizerUserId &&
        authenticatedOrganizerUserId !== hostOrganizerUserId)
    ) {
      throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
    }
    const approvedAdmin = authenticatedAdminUserId
      ? { id: authenticatedAdminUserId }
      : await inspectionPrisma.user.findFirst({
          where: {
            email: "admin@bayanko.ph",
            role: "admin",
            verificationStatus: "APPROVED",
          },
          select: { id: true },
        });
    if (!approvedAdmin) {
      throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
    }
    const organizerUserId = hostOrganizerUserId;
    const adminUserId = approvedAdmin.id;
    const now = new Date();
    const completedExpected = completedSampleRaffleInput(input.manifest);
    const ongoingExpected = ongoingSampleRaffleInput(input.manifest);
    const targets = [
      {
        inspection: input.completed,
        expectedState: input.completed.state,
        expected: completedExpected,
        image: input.images.completed,
        source: SAMPLE_RAFFLE_PHOTO_SOURCES.completed,
      },
      {
        inspection: input.ongoing,
        expectedState: input.ongoing.state,
        expected: ongoingExpected,
        image: input.images.ongoing,
        source: SAMPLE_RAFFLE_PHOTO_SOURCES.ongoing,
      },
    ] as const;

    await inspectionPrisma.$transaction(async (tx) => {
      for (const target of targets) {
        const presentation = target.inspection.presentation;
        const expectedPrize = target.expected.prizePools[0]?.publicPresentation;
        if (
          !presentation ||
          !expectedPrize ||
          expectedPrize.disclosure !== "revealed"
        ) {
          throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
        }
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "EventGiveaway" WHERE "id" = ${target.inspection.giveawayId} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "GiveawayPrizePool" WHERE "id" = ${presentation.prizePoolId} FOR UPDATE`,
        );
        const campaign = await tx.eventGiveaway.findUnique({
          where: { id: target.inspection.giveawayId },
          select: {
            id: true,
            eventId: true,
            title: true,
            status: true,
            complianceStatus: true,
            mechanicsVersions: {
              orderBy: { version: "desc" },
              take: 1,
              select: {
                version: true,
                mechanics: true,
                terms: true,
                sponsorDisclosure: true,
              },
            },
            prizePools: {
              where: { id: presentation.prizePoolId },
              select: {
                id: true,
                publicImage: { select: { mediaId: true } },
              },
            },
          },
        });
        const currentMechanics = campaign?.mechanicsVersions[0];
        const prizePool = campaign?.prizePools[0];
        if (
          !campaign ||
          campaign.eventId !== input.manifest.eventId ||
          campaign.title !== target.inspection.title ||
          campaign.status !== target.expectedState ||
          campaign.complianceStatus !==
            expectedSampleRafflePresentationComplianceStatus(
              target.expectedState,
            ) ||
          !currentMechanics ||
          !prizePool ||
          prizePool.id !== presentation.prizePoolId
        ) {
          throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
        }

        let mechanicsVersion = currentMechanics.version;
        const desiredSponsorDisclosure =
          target.expected.sponsorDisclosure?.trim() || null;
        if (
          currentMechanics.mechanics !== target.expected.mechanics ||
          currentMechanics.terms !== target.expected.terms ||
          currentMechanics.sponsorDisclosure !== desiredSponsorDisclosure
        ) {
          mechanicsVersion += 1;
          await tx.giveawayMechanicsVersion.create({
            data: {
              id: `giveaway-mechanics-${randomUUID()}`,
              giveawayId: campaign.id,
              version: mechanicsVersion,
              mechanics: target.expected.mechanics,
              terms: target.expected.terms,
              sponsorDisclosure: desiredSponsorDisclosure,
              checksum: sampleRaffleMechanicsChecksum(
                target.expected.mechanics,
                target.expected.terms,
                desiredSponsorDisclosure,
              ),
              createdByUserId: organizerUserId,
              reviewedByUserId: adminUserId,
              reviewDecision: "approved",
              reviewReason: "Public sample raffle presentation refresh",
              reviewedAt: now,
            },
          });
        }

        await tx.giveawayPrizePool.update({
          where: { id: prizePool.id },
          data: {
            publicDisclosure: "revealed",
            publicTitle: expectedPrize.title,
            publicDescription: expectedPrize.description ?? null,
          },
        });

        if (target.image) {
          if (prizePool.publicImage) {
            throw new SampleRaffleProvisioningError(
              "CONFLICTING_SAMPLE_STATE",
            );
          }
          await tx.giveawayPrizeImage.create({
            data: {
              id: `giveaway-prize-image-${target.image.mediaId}`,
              prizePoolId: prizePool.id,
              uploadedByUserId: organizerUserId,
              mediaId: target.image.mediaId,
              storageKey: target.image.storageKey,
              mimeType: target.image.mimeType,
              width: target.image.width,
              height: target.image.height,
              finalizedAt: now,
            },
          });
        }

        const auditPayload = {
          change: "sample_public_presentation_refresh",
          mechanicsVersion,
          photoSource: target.image ? target.source.pageUrl : null,
          publicTitle: expectedPrize.title,
        };
        const previous = await tx.giveawayAuditEvent.findFirst({
          where: { giveawayId: campaign.id },
          orderBy: { sequence: "desc" },
          select: { sequence: true, hash: true },
        });
        const canonicalPayload = canonicalizeJson(auditPayload);
        await tx.giveawayAuditEvent.create({
          data: {
            id: `giveaway-audit-${randomUUID()}`,
            giveawayId: campaign.id,
            sequence: (previous?.sequence ?? 0) + 1,
            actorUserId: organizerUserId,
            action: "GIVEAWAY_UPDATED",
            targetType: "giveaway",
            targetId: campaign.id,
            canonicalPayload,
            payload: JSON.parse(canonicalPayload) as Prisma.InputJsonValue,
            previousHash: previous?.hash ?? null,
            hash: calculateGiveawayAuditHash(
              previous?.hash,
              auditPayload,
            ),
          },
        });
      }

      if (input.completed.state !== "completed") return;

      const completedAwardInspection = input.completed.currentAwards[0];
      if (
        input.completed.currentAwards.length !== 1 ||
        !completedAwardInspection
      ) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GiveawayAward" WHERE "id" = ${completedAwardInspection.awardId} FOR UPDATE`,
      );
      const completedAward = await tx.giveawayAward.findUnique({
        where: { id: completedAwardInspection.awardId },
        select: {
          id: true,
          giveawayId: true,
          winnerUserId: true,
          isCurrent: true,
          status: true,
          publicWinnerAlias: true,
          winnerAliasOptedInAt: true,
          winnerAliasRevokedAt: true,
          winner: { select: { email: true } },
        },
      });
      if (
        !completedAward ||
        completedAward.giveawayId !== input.completed.giveawayId ||
        completedAward.winner.email !== input.manifest.winnerEmail ||
        !completedAward.isCurrent ||
        completedAward.status !== "fulfilled" ||
        !completedAward.winnerAliasOptedInAt ||
        completedAward.winnerAliasRevokedAt
      ) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      if (completedAward.publicWinnerAlias !== input.manifest.winnerAlias) {
        await tx.giveawayAward.update({
          where: { id: completedAward.id },
          data: {
            publicWinnerAlias: input.manifest.winnerAlias,
            winnerAliasOptedInAt: now,
            winnerAliasRevokedAt: null,
          },
        });
        const winnerAuditPayload = {
          awardId: completedAward.id,
          public: true,
        };
        const previous = await tx.giveawayAuditEvent.findFirst({
          where: { giveawayId: input.completed.giveawayId },
          orderBy: { sequence: "desc" },
          select: { sequence: true, hash: true },
        });
        const canonicalPayload = canonicalizeJson(winnerAuditPayload);
        await tx.giveawayAuditEvent.create({
          data: {
            id: `giveaway-audit-${randomUUID()}`,
            giveawayId: input.completed.giveawayId,
            sequence: (previous?.sequence ?? 0) + 1,
            actorUserId: completedAward.winnerUserId,
            action: "GIVEAWAY_WINNER_PUBLICATION_OPTED_IN",
            targetType: "award",
            targetId: completedAward.id,
            canonicalPayload,
            payload: JSON.parse(canonicalPayload) as Prisma.InputJsonValue,
            previousHash: previous?.hash ?? null,
            hash: calculateGiveawayAuditHash(
              previous?.hash,
              winnerAuditPayload,
            ),
          },
        });
      }
    }, {
      maxWait: 5_000,
      timeout: 60_000,
    });
  };

  const dependencies: SampleRaffleProvisionerDependencies = {
    inspectTarget,
    async acquireLock() {
      await dedicatedLock.acquire();
      return { id: SAMPLE_RAFFLE_LOCK_KEY };
    },
    async releaseLock() {
      await dedicatedLock.release();
    },
    async archiveExistingLifecycle({ inspection, manifest: archiveManifest }) {
      const completed = inspection.completedCampaigns[0];
      const ongoing = inspection.ongoingCampaigns[0];
      if (
        inspection.completedCampaigns.length !== 1 ||
        inspection.ongoingCampaigns.length !== 1 ||
        !completed ||
        !ongoing ||
        completed.title !== archiveManifest.completedTitle ||
        ongoing.title !== archiveManifest.ongoingTitle
      ) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      await inspectionPrisma.$transaction(async (tx) => {
        for (const target of [completed, ongoing]) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "EventGiveaway" WHERE "id" = ${target.giveawayId} FOR UPDATE`,
          );
          const campaign = await tx.eventGiveaway.findUnique({
            where: { id: target.giveawayId },
            select: {
              id: true,
              eventId: true,
              title: true,
              creatorUserId: true,
            },
          });
          if (
            !campaign ||
            campaign.eventId !== archiveManifest.eventId ||
            campaign.title !== target.title
          ) {
            throw new SampleRaffleProvisioningError(
              "CONFLICTING_SAMPLE_STATE",
            );
          }
          const archivedTitle =
            `Archived sample · ${campaign.title} · ${campaign.id}`;
          await tx.eventGiveaway.update({
            where: { id: campaign.id },
            data: {
              title: archivedTitle,
              visibility: "hidden",
            },
          });
          const auditPayload = {
            change: "sample_lifecycle_archived_for_replacement",
            previousTitle: campaign.title,
            title: archivedTitle,
            visibility: "hidden",
          };
          const previous = await tx.giveawayAuditEvent.findFirst({
            where: { giveawayId: campaign.id },
            orderBy: { sequence: "desc" },
            select: { sequence: true, hash: true },
          });
          const canonicalPayload = canonicalizeJson(auditPayload);
          await tx.giveawayAuditEvent.create({
            data: {
              id: `giveaway-audit-${randomUUID()}`,
              giveawayId: campaign.id,
              sequence: (previous?.sequence ?? 0) + 1,
              actorUserId: campaign.creatorUserId,
              action: "GIVEAWAY_UPDATED",
              targetType: "giveaway",
              targetId: campaign.id,
              canonicalPayload,
              payload: JSON.parse(canonicalPayload) as Prisma.InputJsonValue,
              previousHash: previous?.hash ?? null,
              hash: calculateGiveawayAuditHash(
                previous?.hash,
                auditPayload,
              ),
            },
          });
        }
      });
    },
    async authenticateOrganizer(password) {
      if (!hostOrganizerEmail) {
        throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
      }
      if (presentationOptions.trustedExistingActorSessions) {
        if (!hostOrganizerUserId) {
          throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
        }
        authenticatedOrganizerUserId = hostOrganizerUserId;
        return {
          sessionToken: await createTrustedActorSession(hostOrganizerUserId),
        };
      }
      const result = await backend.loginWithPassword(hostOrganizerEmail, password);
      if (
        result.user.role !== "organizer" ||
        !hostOrganizerUserId ||
        result.user.id !== hostOrganizerUserId
      ) {
        throw new SampleRaffleProvisioningError("HOST_EVENT_INVALID");
      }
      authenticatedOrganizerUserId = result.user.id;
      return { sessionToken: result.sessionToken };
    },
    async authenticateAdmin(password) {
      if (presentationOptions.trustedExistingActorSessions) {
        const approvedAdmin = await inspectionPrisma.user.findFirst({
          where: {
            email: "admin@bayanko.ph",
            role: "admin",
            verificationStatus: "APPROVED",
          },
          select: { id: true },
        });
        if (!approvedAdmin) {
          throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
        }
        authenticatedAdminUserId = approvedAdmin.id;
        return {
          sessionToken: await createTrustedActorSession(approvedAdmin.id),
        };
      }
      const result = await backend.loginWithPassword("admin@bayanko.ph", password);
      if (result.user.role !== "admin") {
        throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
      }
      authenticatedAdminUserId = result.user.id;
      return { sessionToken: result.sessionToken };
    },
    async ensureWinner(input) {
      const existing = await inspectionPrisma.user.findUnique({
        where: { email: input.email },
        select: { id: true, role: true },
      });
      if (presentationOptions.trustedExistingActorSessions) {
        if (!existing || existing.role !== "rider") {
          throw new SampleRaffleProvisioningError("AUTHENTICATION_FAILED");
        }
        return {
          sessionToken: await createTrustedActorSession(existing.id),
          riderId: existing.id,
        };
      }
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
    async prepareCreatedPresentation({ inspection, manifest: refreshManifest }) {
      const completed = inspection.completedCampaigns[0];
      const ongoing = inspection.ongoingCampaigns[0];
      if (
        inspection.completedCampaigns.length !== 1 ||
        inspection.ongoingCampaigns.length !== 1 ||
        !completed ||
        !ongoing ||
        completed.state !== "draft" ||
        ongoing.state !== "draft" ||
        completed.currentAwards.length !== 0
      ) {
        throw new SampleRaffleProvisioningError("CONFLICTING_SAMPLE_STATE");
      }
      await refreshSampleRafflePresentation(
        {
          manifest: refreshManifest,
          completed,
          ongoing,
        },
        {
          fetchPhoto: presentationOptions.fetchPhoto ?? ((url) => fetch(url)),
          normalizePhoto:
            presentationOptions.normalizePhoto ?? normalizeMemberImage,
          mediaStore: resolveSamplePrizeMediaStore(),
          persist: persistSampleRafflePresentation,
        },
      );
    },
    finish,
  };

  return {
    dependencies,
    close: finish,
  };
}
