import type {
  GiveawayPrizeDisclosure,
  GiveawayPrizeImageSummary,
  PublicPrizePresentation,
} from "./types";

export function toPublicPrizePresentation(input: {
  disclosure: GiveawayPrizeDisclosure;
  publicTitle?: string;
  publicDescription?: string;
  publicImage?: GiveawayPrizeImageSummary;
}): PublicPrizePresentation {
  if (input.disclosure === "surprise") {
    return {
      disclosure: "surprise",
      title: "Surprise prize",
    };
  }

  return {
    disclosure: "revealed",
    title: input.publicTitle?.trim() || "Prize details unavailable",
    ...(input.publicDescription?.trim()
      ? { description: input.publicDescription.trim() }
      : {}),
    ...(input.publicImage ? { image: input.publicImage } : {}),
  };
}
