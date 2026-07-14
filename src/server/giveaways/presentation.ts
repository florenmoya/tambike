import { createHash } from "node:crypto";

import type { OrganizerGiveawayPresentation } from "@/features/giveaways/types";
import { deriveGiveawayPresentationLabels } from "./presentation-labels";

type PresentationErrorCode = "INVALID_GIVEAWAY_STATE" | "GIVEAWAY_AWARD_INVALID";

export class GiveawayPresentationIntegrityError extends Error {
  constructor(public readonly code: PresentationErrorCode) {
    super(code);
    this.name = "GiveawayPresentationIntegrityError";
  }
}

type PresentationSnapshotEntry = {
  id: string;
  giveawayId: string;
  entryId: string;
  riderId: string;
  opaquePublicReference: string;
  presentationLabel?: string | null;
};

type PresentationPrizePool = {
  id: string;
  position: number;
  title: string;
  awardMode: string;
  items: ReadonlyArray<{
    id: string;
    position: number;
    title: string;
  }>;
};

type PresentationAward = {
  id: string;
  giveawayId: string;
  drawId?: string | null;
  entryId: string;
  winnerUserId: string;
  snapshotEntryId?: string | null;
  prizePoolId: string;
  prizeItemId?: string | null;
};

export type OrganizerGiveawayPresentationSource = {
  giveawayId: string;
  eventId: string;
  giveawayTitle: string;
  draw: {
    id: string;
    snapshotId: string;
    type: string;
    status: string;
    algorithmVersion: string;
    resultDigest?: string | null;
  };
  snapshot: {
    id: string;
    giveawayId: string;
    candidateCount: number;
    entries: readonly PresentationSnapshotEntry[];
  };
  prizePools: readonly PresentationPrizePool[];
  awards: readonly PresentationAward[];
};

/** Builds the exact privacy-safe organizer payload from already-authorized persisted records. */
export function buildOrganizerGiveawayPresentation(
  source: OrganizerGiveawayPresentationSource,
): OrganizerGiveawayPresentation {
  assertSupportedPresentationDraw(source);

  const fallbackLabels = deriveGiveawayPresentationLabels(
    source.snapshot.entries.map((entry) => ({
      entryId: entry.id,
      opaquePublicReference: entry.opaquePublicReference,
      displayName: "",
      optedIn: false,
    })),
  );
  const fallbackLabelBySnapshotEntryId = new Map(
    fallbackLabels.map((entry) => [entry.entryId, entry.presentationLabel]),
  );
  const effectiveLabelBySnapshotEntryId = new Map<string, string>();
  const snapshotEntryById = new Map<string, PresentationSnapshotEntry>();
  for (const entry of source.snapshot.entries) {
    if (
      !entry.id ||
      entry.giveawayId !== source.giveawayId ||
      snapshotEntryById.has(entry.id)
    ) {
      failAwardIntegrity();
    }
    const effectiveLabel =
      entry.presentationLabel === null || entry.presentationLabel === undefined
        ? fallbackLabelBySnapshotEntryId.get(entry.id)
        : entry.presentationLabel;
    if (!effectiveLabel?.trim()) failAwardIntegrity();
    snapshotEntryById.set(entry.id, entry);
    effectiveLabelBySnapshotEntryId.set(entry.id, effectiveLabel);
  }

  const resultDigest = source.draw.resultDigest!;
  const labelBank = source.snapshot.entries
    .map((entry) => ({
      id: entry.id,
      label: effectiveLabelBySnapshotEntryId.get(entry.id)!,
      sortKey: createHash("sha256")
        .update(`${resultDigest}:${entry.id}`)
        .digest("hex")
        .toLowerCase(),
    }))
    .sort(
      (left, right) =>
        left.sortKey.localeCompare(right.sortKey) || left.id.localeCompare(right.id),
    )
    .slice(0, 24)
    .map((entry) => entry.label);

  const prizePoolById = new Map(source.prizePools.map((pool) => [pool.id, pool]));
  const orderedSlides = source.awards
    .filter((award) => award.drawId === source.draw.id)
    .flatMap((award) => {
      if (award.giveawayId !== source.giveawayId) failAwardIntegrity();
      const pool = prizePoolById.get(award.prizePoolId);
      if (!pool) failAwardIntegrity();
      if (pool.awardMode !== "random_draw") return [];

      const snapshotEntry = award.snapshotEntryId
        ? snapshotEntryById.get(award.snapshotEntryId)
        : undefined;
      const item = award.prizeItemId
        ? pool.items.find((candidate) => candidate.id === award.prizeItemId)
        : undefined;
      const winnerLabel = award.snapshotEntryId
        ? effectiveLabelBySnapshotEntryId.get(award.snapshotEntryId)
        : undefined;
      if (
        !snapshotEntry ||
        snapshotEntry.entryId !== award.entryId ||
        snapshotEntry.riderId !== award.winnerUserId ||
        !item ||
        !winnerLabel?.trim()
      ) {
        failAwardIntegrity();
      }
      return [
        {
          awardId: award.id,
          poolPosition: pool.position,
          itemPosition: item.position,
          prizePoolTitle: pool.title,
          prizeItemTitle: item.title,
          winnerLabel,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.poolPosition - right.poolPosition ||
        left.itemPosition - right.itemPosition ||
        left.awardId.localeCompare(right.awardId),
    );

  return {
    giveawayId: source.giveawayId,
    eventId: source.eventId,
    drawId: source.draw.id,
    giveawayTitle: source.giveawayTitle,
    drawStatus: source.draw.status as OrganizerGiveawayPresentation["drawStatus"],
    resultDigest,
    candidateCount: source.snapshot.candidateCount,
    labelBank,
    slides: orderedSlides.map((slide, index) => ({
      position: index + 1,
      prizePoolTitle: slide.prizePoolTitle,
      prizeItemTitle: slide.prizeItemTitle,
      winnerLabel: slide.winnerLabel,
    })),
  };
}

function assertSupportedPresentationDraw(source: OrganizerGiveawayPresentationSource) {
  if (
    source.draw.snapshotId !== source.snapshot.id ||
    source.snapshot.giveawayId !== source.giveawayId ||
    source.snapshot.candidateCount !== source.snapshot.entries.length ||
    source.draw.type !== "initial" ||
    source.draw.algorithmVersion !== "hmac-sha256-v1" ||
    !["completed", "published"].includes(source.draw.status) ||
    !source.draw.resultDigest?.trim()
  ) {
    throw new GiveawayPresentationIntegrityError("INVALID_GIVEAWAY_STATE");
  }
}

function failAwardIntegrity(): never {
  throw new GiveawayPresentationIntegrityError("GIVEAWAY_AWARD_INVALID");
}
