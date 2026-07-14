import { createHash } from "node:crypto";

export type GiveawayPresentationLabelKindValue = "consented_name" | "masked";

export type GiveawayPresentationLabelInput = {
  entryId: string;
  opaquePublicReference: string;
  displayName: string;
  optedIn: boolean;
};

export type DerivedGiveawayPresentationLabel = {
  entryId: string;
  presentationLabel: string;
  presentationLabelKind: GiveawayPresentationLabelKindValue;
};

const MAX_PRESENTATION_LABEL_CHARACTERS = 40;
const MASKED_LABEL_PREFIX = "Rider ";
const MASKED_CODE_INITIAL_LENGTH = 4;
const MASKED_CODE_LENGTH_STEP = 2;
const MAX_MASKED_CODE_CHARACTERS =
  MAX_PRESENTATION_LABEL_CHARACTERS - Array.from(MASKED_LABEL_PREFIX).length;
const safeUnicodeNameTokenPattern = /^\p{L}[\p{L}\p{M}\p{Pd}'\u2019.]*$/u;

/** Removes non-rendering controls and canonicalizes visible spacing without changing name case. */
export function normalizeGiveawayDisplayName(displayName: string): string {
  return displayName
    .replace(/\s/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ +/gu, " ")
    .trim();
}

/** A preference is active only until an explicit revocation is recorded. */
export function isGiveawayLivePresentationOptedIn(input: {
  optedInAt?: Date | string | null;
  revokedAt?: Date | string | null;
}): boolean {
  return Boolean(input.optedInAt && !input.revokedAt);
}

/** Derives every final snapshot label together so masked and consented collisions are resolved consistently. */
export function deriveGiveawayPresentationLabels(
  entries: readonly GiveawayPresentationLabelInput[],
): DerivedGiveawayPresentationLabel[] {
  const hashes = entries.map((entry) =>
    createHash("sha256").update(entry.opaquePublicReference).digest("hex").toUpperCase(),
  );
  const codeLengths = entries.map(() => MASKED_CODE_INITIAL_LENGTH);

  for (
    let nextLength = MASKED_CODE_INITIAL_LENGTH + MASKED_CODE_LENGTH_STEP;
    nextLength <= Math.min(hashes[0]?.length ?? 0, MAX_MASKED_CODE_CHARACTERS);
    nextLength += MASKED_CODE_LENGTH_STEP
  ) {
    const indexesByCode = new Map<string, number[]>();
    for (let index = 0; index < hashes.length; index += 1) {
      const code = hashes[index].slice(0, codeLengths[index]);
      indexesByCode.set(code, [...(indexesByCode.get(code) ?? []), index]);
    }
    let hasCollidingCodes = false;
    for (const indexes of indexesByCode.values()) {
      if (indexes.length < 2) continue;
      hasCollidingCodes = true;
      for (const index of indexes) codeLengths[index] = nextLength;
    }
    if (!hasCollidingCodes) break;
  }

  const maskedCodes = hashes.map((hash, index) => hash.slice(0, codeLengths[index]));
  if (new Set(maskedCodes).size !== maskedCodes.length) {
    throw new Error("GIVEAWAY_PRESENTATION_LABEL_CODE_CAP_EXCEEDED");
  }
  const consentedBases = entries.map((entry) =>
    entry.optedIn ? consentedBaseLabel(entry.displayName) : undefined,
  );
  const consentedIndexesByLabel = new Map<string, number[]>();
  consentedBases.forEach((label, index) => {
    if (!label) return;
    const key = label.toLocaleLowerCase("und");
    consentedIndexesByLabel.set(key, [...(consentedIndexesByLabel.get(key) ?? []), index]);
  });
  const duplicateConsentedIndexes = new Set(
    [...consentedIndexesByLabel.values()].filter((indexes) => indexes.length > 1).flat(),
  );

  return entries.map((entry, index) => {
    const consentedLabel = consentedBases[index];
    if (!consentedLabel) {
      return {
        entryId: entry.entryId,
        presentationLabel: `${MASKED_LABEL_PREFIX}${maskedCodes[index]}`,
        presentationLabelKind: "masked",
      };
    }
    return {
      entryId: entry.entryId,
      presentationLabel: duplicateConsentedIndexes.has(index)
        ? appendMaskedCode(consentedLabel, maskedCodes[index])
        : consentedLabel,
      presentationLabelKind: "consented_name",
    };
  });
}

/** Derives the current rider-only preview; snapshot-wide collision suffixes are added only at lock. */
export function deriveGiveawayPresentationLabelPreview(
  input: Omit<GiveawayPresentationLabelInput, "entryId">,
) {
  const { presentationLabel, presentationLabelKind } = deriveGiveawayPresentationLabels([
    { ...input, entryId: "preview" },
  ])[0];
  return { presentationLabel, presentationLabelKind };
}

function consentedBaseLabel(displayName: string): string | undefined {
  const normalized = normalizeGiveawayDisplayName(displayName);
  if (!normalized) return undefined;
  const tokens = normalized.split(" ");
  if (tokens.some((token) => !safeUnicodeNameTokenPattern.test(token))) return undefined;
  if (tokens.length === 1) return takeUnicodeCharacters(tokens[0], MAX_PRESENTATION_LABEL_CHARACTERS);

  const lastInitial = Array.from(tokens.at(-1) ?? "")[0];
  if (!lastInitial || !/^\p{L}$/u.test(lastInitial)) return undefined;
  const suffix = ` ${lastInitial}.`;
  const firstToken = takeUnicodeCharacters(
    tokens[0],
    MAX_PRESENTATION_LABEL_CHARACTERS - Array.from(suffix).length,
  );
  return firstToken ? `${firstToken}${suffix}` : undefined;
}

function appendMaskedCode(label: string, code: string) {
  const suffix = ` \u00b7 ${code}`;
  const base = takeUnicodeCharacters(
    label,
    MAX_PRESENTATION_LABEL_CHARACTERS - Array.from(suffix).length,
  ).trimEnd();
  return `${base}${suffix}`;
}

function takeUnicodeCharacters(value: string, maximum: number) {
  return Array.from(value).slice(0, maximum).join("");
}
