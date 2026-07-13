"use server";

import type {
  CreateGiveawayCampaignCodeInput,
  CreateGiveawayInput,
  FulfillGiveawayAwardInput,
  GrantManualGiveawayEntryInput,
  GiveawayWinnerPublicationInput,
  GiveawayDeliveryDetailsInput,
  RevokeManualGiveawayEntryInput,
  UpdateGiveawayInput,
  VerifyGiveawayClaimInput,
} from "@/features/giveaways/types";
import { getTambikeBackend } from "./backend";
import {
  executeGiveawayAction,
  executePublicGiveawayAction,
  type GiveawayActionResult,
} from "./giveaway-action-runtime";
import { readSessionToken } from "./session-cookie";

type GiveawayClaimTokenIssueInput = {
  rotate?: boolean;
};

/**
 * All authenticated giveaway actions share one intentionally narrow failure
 * envelope. Backend authorization remains the source of truth; callers never
 * receive backend exception messages, audit payloads, or persisted secrets.
 */
function runGiveawayAction<T>(
  operation: (sessionToken: string) => Promise<T>,
): Promise<GiveawayActionResult<T>> {
  return executeGiveawayAction({ readSessionToken }, operation);
}

/** Guest-safe public reads retain the same detail-free failure envelope. */
function runPublicGiveawayAction<T>(
  operation: (sessionToken?: string) => Promise<T>,
): Promise<GiveawayActionResult<T>> {
  return executePublicGiveawayAction({ readSessionToken }, operation);
}

export async function createGiveawayAction(input: CreateGiveawayInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.createGiveaway(sessionToken, input.eventId, input);
  });
}

export async function updateGiveawayAction(input: UpdateGiveawayInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.updateGiveaway(sessionToken, input);
  });
}

export async function listOrganizerGiveawaysAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listOrganizerGiveaways(sessionToken, eventId);
  });
}

export async function getOrganizerGiveawayWorkspaceAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getOrganizerGiveawayWorkspace(sessionToken, giveawayId);
  });
}

export async function listGiveawayCampaignCodesAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayCampaignCodes(sessionToken, giveawayId);
  });
}

export async function listGiveawayManualEntryCandidatesAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayManualEntryCandidates(sessionToken, giveawayId);
  });
}

export async function listAdminGiveawaysAction() {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listAdminGiveaways(sessionToken);
  });
}

export async function listPublicGiveawaysForEventAction(eventId: string) {
  return runPublicGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listPublicGiveawaysForEvent(eventId, sessionToken);
  });
}

export async function submitGiveawayForReviewAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.submitGiveawayForReview(sessionToken, giveawayId);
  });
}

export async function reviewGiveawayComplianceAction(giveawayId: string, input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.reviewGiveawayCompliance(sessionToken, giveawayId, input);
  });
}

export async function scheduleGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.scheduleGiveaway(sessionToken, giveawayId);
  });
}

export async function openGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.openGiveaway(sessionToken, giveawayId);
  });
}

export async function pauseGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.pauseGiveaway(sessionToken, giveawayId);
  });
}

export async function lockGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.lockGiveaway(sessionToken, giveawayId);
  });
}

export async function cancelGiveawayAction(giveawayId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.cancelGiveaway(sessionToken, giveawayId, reason);
  });
}

export async function suspendGiveawayAction(giveawayId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.suspendGiveaway(sessionToken, giveawayId, reason);
  });
}

export async function optInToGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.optInToGiveaway(sessionToken, giveawayId);
  });
}

export async function createGiveawayCampaignCodeAction(
  giveawayId: string,
  input: CreateGiveawayCampaignCodeInput,
) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.createGiveawayCampaignCode(sessionToken, giveawayId, input);
  });
}

export async function claimGiveawayCampaignCodeAction(giveawayId: string, code: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.claimGiveawayCampaignCode(sessionToken, giveawayId, code);
  });
}

export async function grantManualGiveawayEntryAction(input: GrantManualGiveawayEntryInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.grantManualGiveawayEntry(sessionToken, input);
  });
}

export async function revokeManualGiveawayEntryAction(input: RevokeManualGiveawayEntryInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.revokeManualGiveawayEntry(
      sessionToken,
      input.giveawayId,
      input.riderId,
      input.reason,
    );
  });
}

export async function getRiderGiveawayStateAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getRiderGiveawayState(sessionToken, giveawayId);
  });
}

export async function setGiveawayWinnerPublicationAction(
  awardId: string,
  input: GiveawayWinnerPublicationInput,
) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.setGiveawayWinnerPublication(sessionToken, awardId, input);
  });
}

export async function listRiderGiveawayStatesForEventAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listRiderGiveawayStatesForEvent(sessionToken, eventId);
  });
}

export async function getRiderGiveawayClaimContextAction(awardId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getRiderGiveawayClaimContext(sessionToken, awardId);
  });
}

export async function declineGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.declineGiveawayAward(sessionToken, awardId, reason);
  });
}

export async function runGiveawayDrawAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.runGiveawayDraw(sessionToken, input);
  });
}

export async function selectManualGiveawayAwardAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.selectManualGiveawayAward(sessionToken, input);
  });
}

export async function publishGiveawayDrawAction(giveawayId: string, drawId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.publishGiveawayDraw(sessionToken, giveawayId, drawId);
  });
}

/**
 * This is the only action permitted to return a raw claim secret. The backend
 * enforces that the caller is the winning rider and stores only a hash.
 */
export async function issueGiveawayClaimTokenAction(
  awardId: string,
  input: GiveawayClaimTokenIssueInput = {},
) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.issueGiveawayClaimToken(sessionToken, awardId, input);
  });
}

export async function resolveGiveawayClaimAction(payload: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.resolveGiveawayClaim(sessionToken, payload);
  });
}

export async function verifyGiveawayClaimAction(input: VerifyGiveawayClaimInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.verifyGiveawayClaim(sessionToken, input);
  });
}

export async function fulfillGiveawayAwardAction(input: FulfillGiveawayAwardInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.fulfillGiveawayAward(sessionToken, input);
  });
}

export async function listGiveawayOperatorClaimsAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayOperatorClaims(sessionToken, giveawayId);
  });
}

export async function listEventGiveawayOperatorClaimsAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listEventGiveawayOperatorClaims(sessionToken, eventId);
  });
}

export async function listGiveawayOperatorCandidatesAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayOperatorCandidates(sessionToken, eventId);
  });
}

export async function grantGiveawayOperatorAction(giveawayId: string, userId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.grantGiveawayOperator(sessionToken, giveawayId, userId);
  });
}

export async function revokeGiveawayOperatorAction(assignmentId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.revokeGiveawayOperator(sessionToken, assignmentId, reason);
  });
}

export async function submitGiveawayDeliveryDetailsAction(
  awardId: string,
  input: GiveawayDeliveryDetailsInput,
) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.submitGiveawayDeliveryDetails(sessionToken, awardId, input);
  });
}

export async function readGiveawayDeliveryDetailsAction(awardId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.readGiveawayDeliveryDetails(sessionToken, awardId);
  });
}

export async function withdrawGiveawayDeliveryDetailsAction(awardId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.withdrawGiveawayDeliveryDetails(sessionToken, awardId);
  });
}

export async function voidGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.voidGiveawayAward(sessionToken, awardId, reason);
  });
}

export async function disqualifyGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.disqualifyGiveawayAward(sessionToken, awardId, reason);
  });
}

export async function redrawGiveawayAwardAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.redrawGiveawayAward(sessionToken, input);
  });
}

export async function recoverExpiredDirectGiveawayAwardAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.recoverExpiredDirectGiveawayAward(sessionToken, input);
  });
}

export async function settleGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.settleGiveawayAward(sessionToken, awardId, reason);
  });
}

export async function completeGiveawayClaimsAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.completeGiveawayClaims(sessionToken, giveawayId);
  });
}

export async function getOrganizerGiveawayReportAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getOrganizerGiveawayReport(sessionToken, giveawayId);
  });
}

export async function getAdminGiveawayAuditAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getAdminGiveawayAudit(sessionToken, giveawayId);
  });
}

export async function listGiveawayNotificationsAction() {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayNotifications(sessionToken);
  });
}
