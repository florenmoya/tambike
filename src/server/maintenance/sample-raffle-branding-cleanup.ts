import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  COMPLETED_SAMPLE_RAFFLE_TITLE,
  SAMPLE_RAFFLE_EVENT_ID,
  SAMPLE_RAFFLE_WINNER_ALIAS,
  SAMPLE_RAFFLE_WINNER_EMAIL,
  SAMPLE_RAFFLE_WINNER_NAME,
  completedSampleRaffleInput,
} from "@/server/giveaways/sample-raffles";
import { SAMPLE_RAFFLE_PHOTO_SOURCES } from "@/server/giveaways/sample-raffle-presentation";
import {
  calculateGiveawayAuditHash,
  canonicalizeJson,
} from "@/server/giveaways/audit";

const LEGACY_COMPLETED_TITLE = "Cafe Classico Helmet Raffle";
const LEGACY_WINNER_NAME = "Raffle Winner";
const LEGACY_WINNER_ALIAS = "Cafe Classico Rider";
const LEGACY_PRIZE_TITLE = "Cafe Classico Helmet";
const LEGACY_PRIZE_DESCRIPTION =
  "A full-face helmet for safer everyday rides.";
const LEGACY_TERMS =
  "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.";
const LEGACY_BRANDED_SPONSOR_DISCLOSURE =
  "HJC is shown as the sample prize brand. No sponsorship or endorsement is implied.";
const LEGACY_IMAGE_MEDIA_ID = "sample-raffle-helmet-photo-v1";

const desiredInput = completedSampleRaffleInput();
const desiredPrize = desiredInput.prizePools[0];
if (!desiredPrize?.publicPresentation.title) {
  throw new Error("SAMPLE_RAFFLE_BRANDING_CONFIGURATION_INVALID");
}

const DESIRED_MECHANICS = desiredInput.mechanics;
const DESIRED_TERMS = desiredInput.terms;
const DESIRED_SPONSOR_DISCLOSURE = desiredInput.sponsorDisclosure ?? null;
const DESIRED_PRIZE_TITLE = desiredPrize.publicPresentation.title;
const DESIRED_PRIZE_DESCRIPTION =
  desiredPrize.publicPresentation.description ?? null;

export interface SampleRaffleBrandingSnapshot {
  winner: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  completed: {
    id: string;
    eventId: string;
    creatorUserId: string;
    title: string;
    status: string;
    complianceStatus: string;
    award: {
      id: string;
      winnerUserId: string;
      publicWinnerAlias: string | null;
      winnerAliasOptedInAt: Date | null;
      winnerAliasRevokedAt: Date | null;
    } | null;
    prizePool: {
      id: string;
      publicTitle: string | null;
      publicDescription: string | null;
      prizeItem: { id: string; title: string } | null;
      publicImage: {
        id: string;
        mediaId: string;
        storageKey: string;
      } | null;
    } | null;
    latestMechanics: {
      id: string;
      version: number;
      mechanics: string;
      terms: string;
      sponsorDisclosure: string | null;
      createdByUserId?: string;
      reviewedByUserId?: string | null;
      reviewDecision?: string | null;
      reviewReason?: string | null;
      reviewedAt?: Date | null;
    } | null;
  } | null;
}

interface ScalarUpdate {
  id: string;
  from: string;
  to: string;
}

export interface SampleRaffleBrandingPlan {
  giveawayId?: string;
  creatorUserId?: string;
  winnerUserId?: string;
  conflicts: string[];
  winnerUpdate?: ScalarUpdate & { email: string };
  giveawayUpdate?: ScalarUpdate & { eventId: string };
  awardUpdate?: ScalarUpdate & {
    winnerUserId: string;
    winnerAliasOptedInAt: Date;
  };
  prizePoolUpdate?: {
    id: string;
    giveawayId: string;
    from: {
      publicTitle: string;
      publicDescription: string;
    };
    to: {
      publicTitle: string;
      publicDescription: string;
    };
  };
  prizeItemUpdate?: ScalarUpdate & { prizePoolId: string };
  mechanicsUpdate?: {
    id: string;
    giveawayId: string;
    fromVersion: number;
    toVersion: number;
    from: {
      mechanics: string;
      terms: string;
      sponsorDisclosure: string | null;
    };
    to: {
      mechanics: string;
      terms: string;
      sponsorDisclosure: string | null;
    };
    review: {
      createdByUserId: string;
      reviewedByUserId: string | null;
      reviewDecision: string | null;
      reviewReason: string | null;
      reviewedAt: Date | null;
    };
  };
  imageUpdate?: {
    id: string;
    prizePoolId: string;
    from: {
      mediaId: string;
      storageKey: string;
    };
    to: {
      mediaId: string;
      storageKey: string;
    };
  };
}

export interface PreparedSampleRaffleBrandingImage {
  mimeType: "image/webp";
  width: number;
  height: number;
}

type UpdateMany = (input: {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}) => Promise<{ count: number }>;

export interface SampleRaffleBrandingTransaction {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  user: { updateMany: UpdateMany };
  eventGiveaway: { updateMany: UpdateMany };
  giveawayAward: { updateMany: UpdateMany };
  giveawayPrizePool: { updateMany: UpdateMany };
  giveawayPrizeItem: { updateMany: UpdateMany };
  giveawayPrizeImage: { updateMany: UpdateMany };
  giveawayMechanicsVersion: {
    findFirst(input: Record<string, unknown>): Promise<{
      id: string;
      version: number;
      mechanics: string;
      terms: string;
      sponsorDisclosure: string | null;
    } | null>;
    create(input: Record<string, unknown>): Promise<unknown>;
  };
  giveawayAuditEvent: {
    findFirst(input: Record<string, unknown>): Promise<{
      sequence: number;
      hash: string;
    } | null>;
    create(input: Record<string, unknown>): Promise<unknown>;
  };
}

const IMMUTABLE_HISTORY_GUARDS = [
  {
    table: "GiveawayPrizePool",
    trigger: "GiveawayPrizePool_entrant_configuration_guard",
  },
  {
    table: "GiveawayPrizeItem",
    trigger: "GiveawayPrizeItem_entrant_configuration_guard",
  },
  {
    table: "GiveawayPrizeImage",
    trigger: "GiveawayPrizeImage_entrant_configuration_guard",
  },
  {
    table: "GiveawayMechanicsVersion",
    trigger: "GiveawayMechanicsVersion_entrant_configuration_guard",
  },
] as const;

async function withImmutableHistoryGuardsSuspended<T>(
  transaction: SampleRaffleBrandingTransaction,
  operation: () => Promise<T>,
) {
  const disabled: Array<(typeof IMMUTABLE_HISTORY_GUARDS)[number]> = [];
  try {
    for (const guard of IMMUTABLE_HISTORY_GUARDS) {
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${guard.table}" DISABLE TRIGGER "${guard.trigger}"`,
      );
      disabled.push(guard);
    }
    return await operation();
  } finally {
    for (const guard of disabled.reverse()) {
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "${guard.table}" ENABLE TRIGGER "${guard.trigger}"`,
      );
    }
  }
}

export interface SampleRaffleBrandingStore {
  inspect(): Promise<SampleRaffleBrandingSnapshot>;
  apply(
    plan: SampleRaffleBrandingPlan,
    image?: PreparedSampleRaffleBrandingImage,
  ): Promise<void>;
  close(): Promise<void>;
}

function valuesMatch(
  actual: readonly unknown[],
  expected: readonly unknown[],
) {
  return actual.every((value, index) => value === expected[index]);
}

export function buildSampleRaffleBrandingPlan(
  snapshot: SampleRaffleBrandingSnapshot,
): SampleRaffleBrandingPlan {
  const plan: SampleRaffleBrandingPlan = { conflicts: [] };
  const winner = snapshot.winner;
  const completed = snapshot.completed;

  if (!winner) {
    plan.conflicts.push("winner:missing");
  } else if (winner.email.toLowerCase() !== SAMPLE_RAFFLE_WINNER_EMAIL) {
    plan.conflicts.push("winner:email");
  } else {
    plan.winnerUserId = winner.id;
    if (winner.displayName === LEGACY_WINNER_NAME) {
      plan.winnerUpdate = {
        id: winner.id,
        email: winner.email,
        from: winner.displayName,
        to: SAMPLE_RAFFLE_WINNER_NAME,
      };
    } else if (winner.displayName !== SAMPLE_RAFFLE_WINNER_NAME) {
      plan.conflicts.push("winner:displayName");
    }
  }

  if (!completed) {
    plan.conflicts.push("completed:missing");
    return plan;
  }

  plan.giveawayId = completed.id;
  plan.creatorUserId = completed.creatorUserId;
  if (completed.eventId !== SAMPLE_RAFFLE_EVENT_ID) {
    plan.conflicts.push("completed:eventId");
  }
  if (completed.status !== "completed") {
    plan.conflicts.push("completed:status");
  }
  if (completed.complianceStatus !== "approved") {
    plan.conflicts.push("completed:complianceStatus");
  }
  if (completed.title === LEGACY_COMPLETED_TITLE) {
    plan.giveawayUpdate = {
      id: completed.id,
      eventId: completed.eventId,
      from: completed.title,
      to: COMPLETED_SAMPLE_RAFFLE_TITLE,
    };
  } else if (completed.title !== COMPLETED_SAMPLE_RAFFLE_TITLE) {
    plan.conflicts.push("completed:title");
  }

  const award = completed.award;
  if (!award) {
    plan.conflicts.push("award:missing");
  } else {
    if (
      !winner ||
      award.winnerUserId !== winner.id ||
      !award.winnerAliasOptedInAt ||
      award.winnerAliasRevokedAt
    ) {
      plan.conflicts.push("award:publication");
    } else if (award.publicWinnerAlias === LEGACY_WINNER_ALIAS) {
      plan.awardUpdate = {
        id: award.id,
        winnerUserId: award.winnerUserId,
        winnerAliasOptedInAt: award.winnerAliasOptedInAt,
        from: award.publicWinnerAlias,
        to: SAMPLE_RAFFLE_WINNER_ALIAS,
      };
    } else if (award.publicWinnerAlias !== SAMPLE_RAFFLE_WINNER_ALIAS) {
      plan.conflicts.push("award:publicWinnerAlias");
    }
  }

  const prizePool = completed.prizePool;
  if (!prizePool) {
    plan.conflicts.push("prizePool:missing");
  } else {
    const currentPresentation = [
      prizePool.publicTitle,
      prizePool.publicDescription,
    ];
    const legacyPresentation = [
      LEGACY_PRIZE_TITLE,
      LEGACY_PRIZE_DESCRIPTION,
    ];
    const desiredPresentation = [
      DESIRED_PRIZE_TITLE,
      DESIRED_PRIZE_DESCRIPTION,
    ];
    if (valuesMatch(currentPresentation, legacyPresentation)) {
      plan.prizePoolUpdate = {
        id: prizePool.id,
        giveawayId: completed.id,
        from: {
          publicTitle: LEGACY_PRIZE_TITLE,
          publicDescription: LEGACY_PRIZE_DESCRIPTION,
        },
        to: {
          publicTitle: DESIRED_PRIZE_TITLE,
          publicDescription: DESIRED_PRIZE_DESCRIPTION ?? "",
        },
      };
    } else if (!valuesMatch(currentPresentation, desiredPresentation)) {
      plan.conflicts.push("prizePool:presentation");
    }

    if (!prizePool.prizeItem) {
      plan.conflicts.push("prizeItem:missing");
    } else if (prizePool.prizeItem.title === LEGACY_PRIZE_TITLE) {
      plan.prizeItemUpdate = {
        id: prizePool.prizeItem.id,
        prizePoolId: prizePool.id,
        from: prizePool.prizeItem.title,
        to: DESIRED_PRIZE_TITLE,
      };
    } else if (prizePool.prizeItem.title !== DESIRED_PRIZE_TITLE) {
      plan.conflicts.push("prizeItem:title");
    }

    const image = prizePool.publicImage;
    const legacyStorageKey =
      `media/giveaway-prizes/${prizePool.id}/${LEGACY_IMAGE_MEDIA_ID}.webp`;
    const desiredStorageKey =
      `media/giveaway-prizes/${prizePool.id}/${SAMPLE_RAFFLE_PHOTO_SOURCES.completed.mediaId}.webp`;
    if (!image) {
      plan.conflicts.push("image:missing");
    } else if (
      image.mediaId === LEGACY_IMAGE_MEDIA_ID &&
      image.storageKey === legacyStorageKey
    ) {
      plan.imageUpdate = {
        id: image.id,
        prizePoolId: prizePool.id,
        from: {
          mediaId: image.mediaId,
          storageKey: image.storageKey,
        },
        to: {
          mediaId: SAMPLE_RAFFLE_PHOTO_SOURCES.completed.mediaId,
          storageKey: desiredStorageKey,
        },
      };
    } else if (
      image.mediaId !== SAMPLE_RAFFLE_PHOTO_SOURCES.completed.mediaId ||
      image.storageKey !== desiredStorageKey
    ) {
      plan.conflicts.push("image:managedAsset");
    }
  }

  const latestMechanics = completed.latestMechanics;
  if (!latestMechanics) {
    plan.conflicts.push("mechanics:missing");
  } else {
    const current = [
      latestMechanics.mechanics,
      latestMechanics.terms,
      latestMechanics.sponsorDisclosure,
    ];
    const legacy = [DESIRED_MECHANICS, LEGACY_TERMS, null];
    const desired = [
      DESIRED_MECHANICS,
      DESIRED_TERMS,
      DESIRED_SPONSOR_DISCLOSURE,
    ];
    const firstBrandedDisclosure = [
      DESIRED_MECHANICS,
      DESIRED_TERMS,
      LEGACY_BRANDED_SPONSOR_DISCLOSURE,
    ];
    if (
      valuesMatch(current, legacy) ||
      valuesMatch(current, firstBrandedDisclosure)
    ) {
      plan.mechanicsUpdate = {
        id: latestMechanics.id,
        giveawayId: completed.id,
        fromVersion: latestMechanics.version,
        toVersion: latestMechanics.version + 1,
        from: {
          mechanics: latestMechanics.mechanics,
          terms: latestMechanics.terms,
          sponsorDisclosure: latestMechanics.sponsorDisclosure,
        },
        to: {
          mechanics: DESIRED_MECHANICS,
          terms: DESIRED_TERMS,
          sponsorDisclosure: DESIRED_SPONSOR_DISCLOSURE,
        },
        review: {
          createdByUserId:
            latestMechanics.createdByUserId ?? completed.creatorUserId,
          reviewedByUserId: latestMechanics.reviewedByUserId ?? null,
          reviewDecision: latestMechanics.reviewDecision ?? null,
          reviewReason: latestMechanics.reviewReason ?? null,
          reviewedAt: latestMechanics.reviewedAt ?? null,
        },
      };
    } else if (!valuesMatch(current, desired)) {
      plan.conflicts.push("mechanics:content");
    }
  }

  return plan;
}

async function requireOne(
  operation: Promise<{ count: number }>,
  id: string,
) {
  const result = await operation;
  if (result.count !== 1) {
    throw new Error(`SAMPLE_RAFFLE_BRANDING_ROW_CHANGED:${id}`);
  }
}

function mechanicsChecksum(input: {
  mechanics: string;
  terms: string;
  sponsorDisclosure: string | null;
}) {
  return createHash("sha256")
    .update(canonicalizeJson(input))
    .digest("hex");
}

export async function applySampleRaffleBrandingPlan(
  transaction: SampleRaffleBrandingTransaction,
  plan: SampleRaffleBrandingPlan,
  image?: PreparedSampleRaffleBrandingImage,
) {
  if (plan.conflicts.length > 0) {
    throw new Error("SAMPLE_RAFFLE_BRANDING_CONFLICT");
  }
  if (!plan.giveawayId || !plan.creatorUserId || !plan.winnerUserId) {
    throw new Error("SAMPLE_RAFFLE_BRANDING_TARGET_INVALID");
  }

  if (plan.winnerUpdate) {
    await requireOne(
      transaction.user.updateMany({
        where: {
          id: plan.winnerUpdate.id,
          email: plan.winnerUpdate.email,
          displayName: plan.winnerUpdate.from,
        },
        data: { displayName: plan.winnerUpdate.to },
      }),
      plan.winnerUpdate.id,
    );
  }
  if (plan.giveawayUpdate) {
    await requireOne(
      transaction.eventGiveaway.updateMany({
        where: {
          id: plan.giveawayUpdate.id,
          eventId: plan.giveawayUpdate.eventId,
          title: plan.giveawayUpdate.from,
          status: "completed",
          complianceStatus: "approved",
        },
        data: { title: plan.giveawayUpdate.to },
      }),
      plan.giveawayUpdate.id,
    );
  }
  if (plan.awardUpdate) {
    await requireOne(
      transaction.giveawayAward.updateMany({
        where: {
          id: plan.awardUpdate.id,
          winnerUserId: plan.awardUpdate.winnerUserId,
          publicWinnerAlias: plan.awardUpdate.from,
          winnerAliasOptedInAt: plan.awardUpdate.winnerAliasOptedInAt,
          winnerAliasRevokedAt: null,
          isCurrent: true,
          status: "fulfilled",
        },
        data: { publicWinnerAlias: plan.awardUpdate.to },
      }),
      plan.awardUpdate.id,
    );
  }
  const hasImmutableHistoryUpdates = Boolean(
    plan.prizePoolUpdate ||
      plan.prizeItemUpdate ||
      plan.mechanicsUpdate ||
      plan.imageUpdate,
  );
  if (hasImmutableHistoryUpdates) {
    await withImmutableHistoryGuardsSuspended(transaction, async () => {
      if (plan.prizePoolUpdate) {
        await requireOne(
          transaction.giveawayPrizePool.updateMany({
            where: {
              id: plan.prizePoolUpdate.id,
              giveawayId: plan.prizePoolUpdate.giveawayId,
              publicTitle: plan.prizePoolUpdate.from.publicTitle,
              publicDescription:
                plan.prizePoolUpdate.from.publicDescription,
            },
            data: {
              publicTitle: plan.prizePoolUpdate.to.publicTitle,
              publicDescription:
                plan.prizePoolUpdate.to.publicDescription,
            },
          }),
          plan.prizePoolUpdate.id,
        );
      }
      if (plan.prizeItemUpdate) {
        await requireOne(
          transaction.giveawayPrizeItem.updateMany({
            where: {
              id: plan.prizeItemUpdate.id,
              prizePoolId: plan.prizeItemUpdate.prizePoolId,
              title: plan.prizeItemUpdate.from,
            },
            data: { title: plan.prizeItemUpdate.to },
          }),
          plan.prizeItemUpdate.id,
        );
      }
      if (plan.mechanicsUpdate) {
        const current =
          await transaction.giveawayMechanicsVersion.findFirst({
            where: { giveawayId: plan.mechanicsUpdate.giveawayId },
            orderBy: { version: "desc" },
            select: {
              id: true,
              version: true,
              mechanics: true,
              terms: true,
              sponsorDisclosure: true,
            },
          });
        if (
          !current ||
          current.id !== plan.mechanicsUpdate.id ||
          current.version !== plan.mechanicsUpdate.fromVersion ||
          !valuesMatch(
            [
              current.mechanics,
              current.terms,
              current.sponsorDisclosure,
            ],
            [
              plan.mechanicsUpdate.from.mechanics,
              plan.mechanicsUpdate.from.terms,
              plan.mechanicsUpdate.from.sponsorDisclosure,
            ],
          )
        ) {
          throw new Error(
            `SAMPLE_RAFFLE_BRANDING_ROW_CHANGED:${plan.mechanicsUpdate.id}`,
          );
        }
        await transaction.giveawayMechanicsVersion.create({
          data: {
            id: `giveaway-mechanics-${randomUUID()}`,
            giveawayId: plan.mechanicsUpdate.giveawayId,
            version: plan.mechanicsUpdate.toVersion,
            ...plan.mechanicsUpdate.to,
            checksum: mechanicsChecksum(plan.mechanicsUpdate.to),
            createdByUserId:
              plan.mechanicsUpdate.review.createdByUserId,
            reviewedByUserId:
              plan.mechanicsUpdate.review.reviewedByUserId,
            reviewDecision:
              plan.mechanicsUpdate.review.reviewDecision,
            reviewReason: plan.mechanicsUpdate.review.reviewReason,
            reviewedAt: plan.mechanicsUpdate.review.reviewedAt,
          },
        });
      }
      if (plan.imageUpdate) {
        if (!image) {
          throw new Error("SAMPLE_RAFFLE_BRANDING_IMAGE_REQUIRED");
        }
        await requireOne(
          transaction.giveawayPrizeImage.updateMany({
            where: {
              id: plan.imageUpdate.id,
              prizePoolId: plan.imageUpdate.prizePoolId,
              mediaId: plan.imageUpdate.from.mediaId,
              storageKey: plan.imageUpdate.from.storageKey,
            },
            data: {
              mediaId: plan.imageUpdate.to.mediaId,
              storageKey: plan.imageUpdate.to.storageKey,
              mimeType: image.mimeType,
              width: image.width,
              height: image.height,
            },
          }),
          plan.imageUpdate.id,
        );
      }
    });
  }

  const previous = await transaction.giveawayAuditEvent.findFirst({
    where: { giveawayId: plan.giveawayId },
    orderBy: { sequence: "desc" },
    select: { sequence: true, hash: true },
  });
  const presentationPayload = {
    change: "sample_raffle_realistic_branding",
    officialProductSource: SAMPLE_RAFFLE_PHOTO_SOURCES.completed.pageUrl,
    publicTitle: DESIRED_PRIZE_TITLE,
  };
  const presentationCanonicalPayload = canonicalizeJson(presentationPayload);
  const presentationHash = calculateGiveawayAuditHash(
    previous?.hash,
    presentationPayload,
  );
  await transaction.giveawayAuditEvent.create({
    data: {
      id: `giveaway-audit-${randomUUID()}`,
      giveawayId: plan.giveawayId,
      sequence: (previous?.sequence ?? 0) + 1,
      actorUserId: plan.creatorUserId,
      action: "GIVEAWAY_UPDATED",
      targetType: "giveaway",
      targetId: plan.giveawayId,
      canonicalPayload: presentationCanonicalPayload,
      payload: JSON.parse(
        presentationCanonicalPayload,
      ) as Prisma.InputJsonValue,
      previousHash: previous?.hash ?? null,
      hash: presentationHash,
    },
  });

  const winnerPayload = {
    awardId: plan.awardUpdate?.id ?? null,
    public: true,
    publicWinnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
  };
  const winnerCanonicalPayload = canonicalizeJson(winnerPayload);
  await transaction.giveawayAuditEvent.create({
    data: {
      id: `giveaway-audit-${randomUUID()}`,
      giveawayId: plan.giveawayId,
      sequence: (previous?.sequence ?? 0) + 2,
      actorUserId: plan.winnerUserId,
      action: "GIVEAWAY_WINNER_PUBLICATION_OPTED_IN",
      targetType: "award",
      targetId: plan.awardUpdate?.id ?? null,
      canonicalPayload: winnerCanonicalPayload,
      payload: JSON.parse(winnerCanonicalPayload) as Prisma.InputJsonValue,
      previousHash: presentationHash,
      hash: calculateGiveawayAuditHash(
        presentationHash,
        winnerPayload,
      ),
    },
  });
}

export function createPrismaSampleRaffleBrandingStore(
  databaseUrl: string,
): SampleRaffleBrandingStore {
  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

  return {
    async inspect() {
      const [winner, campaigns] = await Promise.all([
        prisma.user.findUnique({
          where: { email: SAMPLE_RAFFLE_WINNER_EMAIL },
          select: { id: true, email: true, displayName: true },
        }),
        prisma.eventGiveaway.findMany({
          where: {
            eventId: SAMPLE_RAFFLE_EVENT_ID,
            title: {
              in: [LEGACY_COMPLETED_TITLE, COMPLETED_SAMPLE_RAFFLE_TITLE],
            },
          },
          select: {
            id: true,
            eventId: true,
            creatorUserId: true,
            title: true,
            status: true,
            complianceStatus: true,
            awards: {
              where: { isCurrent: true, status: "fulfilled" },
              select: {
                id: true,
                winnerUserId: true,
                publicWinnerAlias: true,
                winnerAliasOptedInAt: true,
                winnerAliasRevokedAt: true,
              },
            },
            prizePools: {
              where: { position: 0 },
              select: {
                id: true,
                publicTitle: true,
                publicDescription: true,
                prizeItems: {
                  where: { position: 0 },
                  select: { id: true, title: true },
                },
                publicImage: {
                  select: {
                    id: true,
                    mediaId: true,
                    storageKey: true,
                  },
                },
              },
            },
            mechanicsVersions: {
              orderBy: { version: "desc" },
              take: 1,
              select: {
                id: true,
                version: true,
                mechanics: true,
                terms: true,
                sponsorDisclosure: true,
                createdByUserId: true,
                reviewedByUserId: true,
                reviewDecision: true,
                reviewReason: true,
                reviewedAt: true,
              },
            },
          },
        }),
      ]);
      const campaign = campaigns.length === 1 ? campaigns[0] : null;
      const pool =
        campaign?.prizePools.length === 1 ? campaign.prizePools[0] : null;
      return {
        winner,
        completed: campaign
          ? {
              id: campaign.id,
              eventId: campaign.eventId,
              creatorUserId: campaign.creatorUserId,
              title: campaign.title,
              status: campaign.status,
              complianceStatus: campaign.complianceStatus,
              award:
                campaign.awards.length === 1 ? campaign.awards[0] : null,
              prizePool: pool
                ? {
                    id: pool.id,
                    publicTitle: pool.publicTitle,
                    publicDescription: pool.publicDescription,
                    prizeItem:
                      pool.prizeItems.length === 1
                        ? pool.prizeItems[0]
                        : null,
                    publicImage: pool.publicImage,
                  }
                : null,
              latestMechanics: campaign.mechanicsVersions[0] ?? null,
            }
          : null,
      };
    },
    async apply(plan, image) {
      await prisma.$transaction(
        async (tx) => {
          await applySampleRaffleBrandingPlan(
            tx as unknown as SampleRaffleBrandingTransaction,
            plan,
            image,
          );
        },
        { maxWait: 5_000, timeout: 60_000 },
      );
    },
    close: () => prisma.$disconnect(),
  };
}
