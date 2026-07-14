export const GIVEAWAY_PRESENTATION_TEXT_MAX_CHARACTERS = 500;

const presentationControlPattern = /[\p{Cc}\p{Cf}]/u;
const presentationControlRunPattern = /[\p{Cc}\p{Cf}]+/gu;

export function isGiveawayPresentationSafeText(
  value: unknown,
  maximumCharacters = GIVEAWAY_PRESENTATION_TEXT_MAX_CHARACTERS,
): value is string {
  return (
    typeof value === "string" &&
    Number.isInteger(maximumCharacters) &&
    maximumCharacters > 0 &&
    value.trim().length > 0 &&
    Array.from(value).length <= maximumCharacters &&
    !presentationControlPattern.test(value)
  );
}

/**
 * Preserves ordinary persisted titles byte-for-byte, while making historical
 * control-laden or oversized values safe for the presentation channel.
 */
export function sanitizeGiveawayPresentationText(
  value: unknown,
  fallback: string,
): string {
  if (isGiveawayPresentationSafeText(value)) return value;

  const safeFallback = isGiveawayPresentationSafeText(fallback) ? fallback : "Untitled";
  if (typeof value !== "string") return safeFallback;

  const normalized = value.replace(presentationControlRunPattern, " ").trim();
  const capped = Array.from(normalized)
    .slice(0, GIVEAWAY_PRESENTATION_TEXT_MAX_CHARACTERS)
    .join("")
    .trimEnd();
  return isGiveawayPresentationSafeText(capped) ? capped : safeFallback;
}
