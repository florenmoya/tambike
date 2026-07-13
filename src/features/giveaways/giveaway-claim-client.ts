import type { RiderGiveawayAwardSummary } from "@/features/giveaways/types";

/**
 * Client-side guard for the dedicated giveaway-claim scanner. The server
 * remains authoritative, but this prevents accidentally sending pass, perk,
 * URL, or partial-token payloads through the claim-only operator flow.
 */
const CLAIM_QR_PATTERN = /^TAMBIKE:GIVEAWAY-CLAIM:v1:tbk_gc1_[A-Za-z0-9_-]{43}$/;

export function normalizeGiveawayClaimPayload(value: string) {
  const payload = value.trim();
  return CLAIM_QR_PATTERN.test(payload) ? payload : null;
}

export type GiveawayClaimRouteStep = {
  label: "Awarded" | "Credential" | "Verification" | "Fulfilment";
  state: "complete" | "current" | "upcoming" | "unavailable";
};

/**
 * The route strip is operational state, not decoration: it only advances from
 * persisted award status and the non-secret fact that a credential exists.
 */
export function getGiveawayClaimRoute(
  status: RiderGiveawayAwardSummary["status"],
  claimCredentialIssued: boolean,
): GiveawayClaimRouteStep[] {
  if (status === "fulfilled") {
    return completeRoute();
  }

  if (status === "verified") {
    return [
      { label: "Awarded", state: "complete" },
      { label: "Credential", state: "complete" },
      { label: "Verification", state: "complete" },
      { label: "Fulfilment", state: "current" },
    ];
  }

  if (status === "pending_verification" || status === "claimable") {
    return [
      { label: "Awarded", state: "complete" },
      { label: "Credential", state: claimCredentialIssued ? "complete" : "current" },
      { label: "Verification", state: claimCredentialIssued ? "current" : "upcoming" },
      { label: "Fulfilment", state: "upcoming" },
    ];
  }

  return [
    { label: "Awarded", state: "complete" },
    { label: "Credential", state: "unavailable" },
    { label: "Verification", state: "unavailable" },
    { label: "Fulfilment", state: "unavailable" },
  ];
}

function completeRoute(): GiveawayClaimRouteStep[] {
  return [
    { label: "Awarded", state: "complete" },
    { label: "Credential", state: "complete" },
    { label: "Verification", state: "complete" },
    { label: "Fulfilment", state: "complete" },
  ];
}
