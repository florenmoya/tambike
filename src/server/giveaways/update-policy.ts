import type { GiveawayState } from "@/features/giveaways/types";

export type GiveawayMaterialUpdateBlocker =
  | "INVALID_GIVEAWAY_STATE"
  | "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED";

const immutableConfigurationStates = new Set<GiveawayState>([
  "open",
  "locked",
  "drawing",
  "claims_open",
  "completed",
  "cancelled",
  "suspended",
]);

export function getGiveawayMaterialUpdateBlocker(input: {
  state: GiveawayState;
  hasEntrantHistory?: boolean;
  changesEntrantFacingConfiguration?: boolean;
}): GiveawayMaterialUpdateBlocker | null {
  if (immutableConfigurationStates.has(input.state)) {
    return "INVALID_GIVEAWAY_STATE";
  }
  if (
    input.hasEntrantHistory &&
    input.changesEntrantFacingConfiguration
  ) {
    return "GIVEAWAY_ENTRY_CONFIGURATION_LOCKED";
  }
  return null;
}
