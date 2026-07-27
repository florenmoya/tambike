import "server-only";

import type {
  CreateGiveawayInput,
  IssuedGiveawayClaimToken,
  OperatorGiveawayClaimView,
  PublicGiveawayDrawVerification,
} from "@/features/giveaways/types";
import type { PrismaTambikeBackend } from "@/server/prisma-backend";

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
}

export interface SampleRaffleProvisioningInput {
  confirmedProduction: boolean;
  organizerPassword?: string;
  adminPassword?: string;
  winnerPassword?: string;
  drawEncryptionKeyPresent: boolean;
  databaseTargetPresent?: boolean;
  directLockPresent?: boolean;
}

export interface SampleRaffleProvisioningReceipt {
  eventId: string;
  completed: {
    giveawayId: string;
    state: "completed";
    winnerCount: 1;
    winnerAlias: typeof SAMPLE_RAFFLE_WINNER_ALIAS;
  };
  ongoing: {
    giveawayId: string;
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

export interface SampleRaffleTargetInspection {
  eventId: string;
  hostEventValid: boolean;
  completedCampaigns: SampleRaffleCampaignInspection[];
  ongoingCampaigns: SampleRaffleCampaignInspection[];
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
    completedCampaign.winnerCount !== 1 ||
    completedCampaign.winnerAlias !== SAMPLE_RAFFLE_WINNER_ALIAS ||
    ongoingCampaign.title !== manifest.ongoingTitle ||
    ongoingCampaign.state !== "open" ||
    ongoingCampaign.winnerCount !== 0
  ) {
    return null;
  }
  return {
    eventId: manifest.eventId,
    completed: {
      giveawayId: completedCampaign.giveawayId,
      state: "completed",
      winnerCount: 1,
      winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
    },
    ongoing: {
      giveawayId: ongoingCampaign.giveawayId,
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
  if (input.databaseTargetPresent === false) throw new SampleRaffleProvisioningError("DATABASE_TARGET_REQUIRED");
  if (input.directLockPresent === false) throw new SampleRaffleProvisioningError("DIRECT_LOCK_REQUIRED");
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
    } catch {
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
    await dependencies.releaseLock(lock);
    await dependencies.finish();
  }
}
