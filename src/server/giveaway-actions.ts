"use server";

import type {
  CreateGiveawayInput,
  FulfillGiveawayAwardInput,
  GiveawayDeliveryDetailsInput,
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

export function createGiveawayAction(input: CreateGiveawayInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.createGiveaway(sessionToken, input.eventId, input);
  });
}

export function updateGiveawayAction(input: UpdateGiveawayInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.updateGiveaway(sessionToken, input);
  });
}

export function listOrganizerGiveawaysAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listOrganizerGiveaways(sessionToken, eventId);
  });
}

export function getOrganizerGiveawayWorkspaceAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getOrganizerGiveawayWorkspace(sessionToken, giveawayId);
  });
}

export function listAdminGiveawaysAction() {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listAdminGiveaways(sessionToken);
  });
}

export function listPublicGiveawaysForEventAction(eventId: string) {
  return runPublicGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listPublicGiveawaysForEvent(eventId, sessionToken);
  });
}

export function submitGiveawayForReviewAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.submitGiveawayForReview(sessionToken, giveawayId);
  });
}

export function reviewGiveawayComplianceAction(giveawayId: string, input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.reviewGiveawayCompliance(sessionToken, giveawayId, input);
  });
}

export function scheduleGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.scheduleGiveaway(sessionToken, giveawayId);
  });
}

export function openGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.openGiveaway(sessionToken, giveawayId);
  });
}

export function pauseGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.pauseGiveaway(sessionToken, giveawayId);
  });
}

export function lockGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.lockGiveaway(sessionToken, giveawayId);
  });
}

export function cancelGiveawayAction(giveawayId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.cancelGiveaway(sessionToken, giveawayId, reason);
  });
}

export function suspendGiveawayAction(giveawayId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.suspendGiveaway(sessionToken, giveawayId, reason);
  });
}

export function optInToGiveawayAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.optInToGiveaway(sessionToken, giveawayId);
  });
}

export function createGiveawayCampaignCodeAction(giveawayId: string, input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.createGiveawayCampaignCode(sessionToken, giveawayId, input);
  });
}

export function claimGiveawayCampaignCodeAction(giveawayId: string, code: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.claimGiveawayCampaignCode(sessionToken, giveawayId, code);
  });
}

export function grantManualGiveawayEntryAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.grantManualGiveawayEntry(sessionToken, input);
  });
}

export function revokeManualGiveawayEntryAction(
  giveawayId: string,
  riderId: string,
  reason: string,
) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.revokeManualGiveawayEntry(sessionToken, giveawayId, riderId, reason);
  });
}

export function getRiderGiveawayStateAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getRiderGiveawayState(sessionToken, giveawayId);
  });
}

export function listRiderGiveawayStatesForEventAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listRiderGiveawayStatesForEvent(sessionToken, eventId);
  });
}

export function getRiderGiveawayClaimContextAction(awardId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getRiderGiveawayClaimContext(sessionToken, awardId);
  });
}

export function declineGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.declineGiveawayAward(sessionToken, awardId, reason);
  });
}

export function runGiveawayDrawAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.runGiveawayDraw(sessionToken, input);
  });
}

export function selectManualGiveawayAwardAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.selectManualGiveawayAward(sessionToken, input);
  });
}

export function publishGiveawayDrawAction(giveawayId: string, drawId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.publishGiveawayDraw(sessionToken, giveawayId, drawId);
  });
}

/**
 * This is the only action permitted to return a raw claim secret. The backend
 * enforces that the caller is the winning rider and stores only a hash.
 */
export function issueGiveawayClaimTokenAction(
  awardId: string,
  input: GiveawayClaimTokenIssueInput = {},
) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.issueGiveawayClaimToken(sessionToken, awardId, input);
  });
}

export function resolveGiveawayClaimAction(payload: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.resolveGiveawayClaim(sessionToken, payload);
  });
}

export function verifyGiveawayClaimAction(input: VerifyGiveawayClaimInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.verifyGiveawayClaim(sessionToken, input);
  });
}

export function fulfillGiveawayAwardAction(input: FulfillGiveawayAwardInput) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.fulfillGiveawayAward(sessionToken, input);
  });
}

export function listGiveawayOperatorClaimsAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayOperatorClaims(sessionToken, giveawayId);
  });
}

export function listEventGiveawayOperatorClaimsAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listEventGiveawayOperatorClaims(sessionToken, eventId);
  });
}

export function listGiveawayOperatorCandidatesAction(eventId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayOperatorCandidates(sessionToken, eventId);
  });
}

export function grantGiveawayOperatorAction(giveawayId: string, userId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.grantGiveawayOperator(sessionToken, giveawayId, userId);
  });
}

export function revokeGiveawayOperatorAction(assignmentId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.revokeGiveawayOperator(sessionToken, assignmentId, reason);
  });
}

export function submitGiveawayDeliveryDetailsAction(
  awardId: string,
  input: GiveawayDeliveryDetailsInput,
) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.submitGiveawayDeliveryDetails(sessionToken, awardId, input);
  });
}

export function readGiveawayDeliveryDetailsAction(awardId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.readGiveawayDeliveryDetails(sessionToken, awardId);
  });
}

export function withdrawGiveawayDeliveryDetailsAction(awardId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.withdrawGiveawayDeliveryDetails(sessionToken, awardId);
  });
}

export function voidGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.voidGiveawayAward(sessionToken, awardId, reason);
  });
}

export function disqualifyGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.disqualifyGiveawayAward(sessionToken, awardId, reason);
  });
}

export function redrawGiveawayAwardAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.redrawGiveawayAward(sessionToken, input);
  });
}

export function recoverExpiredDirectGiveawayAwardAction(input: unknown) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.recoverExpiredDirectGiveawayAward(sessionToken, input);
  });
}

export function settleGiveawayAwardAction(awardId: string, reason: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.settleGiveawayAward(sessionToken, awardId, reason);
  });
}

export function completeGiveawayClaimsAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.completeGiveawayClaims(sessionToken, giveawayId);
  });
}

export function getOrganizerGiveawayReportAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getOrganizerGiveawayReport(sessionToken, giveawayId);
  });
}

export function getAdminGiveawayAuditAction(giveawayId: string) {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.getAdminGiveawayAudit(sessionToken, giveawayId);
  });
}

export function listGiveawayNotificationsAction() {
  return runGiveawayAction(async (sessionToken) => {
    const backend = await getTambikeBackend();
    return backend.listGiveawayNotifications(sessionToken);
  });
}
