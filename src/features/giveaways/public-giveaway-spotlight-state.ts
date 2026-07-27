import type { PublicEventGiveaway } from "@/features/giveaways/types";

export interface PublicGiveawaySpotlightGroups {
  primaryOpen?: PublicEventGiveaway;
  completed: PublicEventGiveaway[];
  additional: PublicEventGiveaway[];
}

export function groupPublicGiveawaysForSpotlight(
  campaigns: PublicEventGiveaway[],
): PublicGiveawaySpotlightGroups {
  const open: PublicEventGiveaway[] = [];
  const completed: PublicEventGiveaway[] = [];
  const other: PublicEventGiveaway[] = [];

  for (const campaign of campaigns) {
    if (campaign.giveaway.state === "open") {
      open.push(campaign);
    } else if (campaign.giveaway.state === "completed") {
      completed.push(campaign);
    } else {
      other.push(campaign);
    }
  }

  return {
    primaryOpen: open[0],
    completed,
    additional: [...open.slice(1), ...other],
  };
}
