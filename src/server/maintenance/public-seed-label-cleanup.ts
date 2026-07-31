import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export const PUBLIC_SEED_USER_RENAMES = [
  {
    email: "mika.sample@tambike.ph",
    publicName: "Mika Santos",
    publicSlug: "mika-santos",
  },
  {
    email: "demo.roster.20260723.01@tambike.ph",
    publicName: "Paolo Reyes",
    publicSlug: "paolo-reyes",
  },
  {
    email: "demo.roster.20260723.02@tambike.ph",
    publicName: "Bea Navarro",
    publicSlug: "bea-navarro",
  },
  {
    email: "demo.roster.20260723.03@tambike.ph",
    publicName: "Carlo Mendoza",
    publicSlug: "carlo-mendoza",
  },
  {
    email: "demo.roster.20260723.04@tambike.ph",
    publicName: "Nina Garcia",
    publicSlug: "nina-garcia",
  },
  {
    email: "demo.roster.20260723.05@tambike.ph",
    publicName: "Jolo Ramos",
    publicSlug: "jolo-ramos",
  },
  {
    email: "demo.roster.20260723.06@tambike.ph",
    publicName: "Sam Torres",
    publicSlug: "sam-torres",
  },
  {
    email: "demo.roster.20260723.07@tambike.ph",
    publicName: "Mara Villanueva",
    publicSlug: "mara-villanueva",
  },
  {
    email: "demo.roster.20260723.08@tambike.ph",
    publicName: "Enzo Lim",
    publicSlug: "enzo-lim",
  },
  {
    email: "demo.roster.20260723.09@tambike.ph",
    publicName: "Lia Santos",
    publicSlug: "lia-santos",
  },
  {
    email: "demo.roster.20260723.10@tambike.ph",
    publicName: "Nico Bautista",
    publicSlug: "nico-bautista",
  },
  {
    email: "demo.roster.20260723.11@tambike.ph",
    publicName: "Aya Flores",
    publicSlug: "aya-flores",
  },
  {
    email: "demo.roster.20260723.12@tambike.ph",
    publicName: "Anonymous Rider 01",
    publicSlug: null,
  },
  {
    email: "demo.roster.20260723.13@tambike.ph",
    publicName: "Anonymous Rider 02",
    publicSlug: null,
  },
  {
    email: "raffle.winner.sample@tambike.ph",
    publicName: "Gabriel Cruz",
    publicSlug: null,
  },
] as const;

const SEEDED_RAFFLE_WINNER_EMAIL = "raffle.winner.sample@tambike.ph";
const CLEAN_RAFFLE_WINNER_ALIAS = "Gabriel Cruz";
const LEGACY_RAFFLE_WINNER_ALIASES = [
  "Raffle Sample Rider",
  "Raffle Winner — Sample Rider",
  "Cafe Classico Rider",
] as const;

export interface PublicSeedLabelCleanupSnapshot {
  users: Array<{
    id: string;
    email: string;
    displayName: string;
    profileSlug: string | null;
  }>;
  awards: Array<{
    id: string;
    winnerEmail: string;
    publicWinnerAlias: string | null;
  }>;
}

export interface PublicSeedLabelCleanupPlan {
  userUpdates: Array<{
    id: string;
    email: string;
    from: string;
    to: string;
    slugFrom: string | null;
    slugTo: string | null;
  }>;
  awardUpdates: Array<{
    id: string;
    from: string;
    to: string;
  }>;
}

export interface PublicSeedLabelCleanupStore {
  inspect(): Promise<PublicSeedLabelCleanupSnapshot>;
  apply(plan: PublicSeedLabelCleanupPlan): Promise<void>;
  close(): Promise<void>;
}

export interface PublicSeedLabelCleanupTransaction {
  user: {
    updateMany(input: {
      where: {
        id: string;
        email: string;
        displayName: string;
        profileSlug: string | null;
      };
      data: { displayName: string; profileSlug: string | null };
    }): Promise<{ count: number }>;
  };
  giveawayAward: {
    updateMany(input: {
      where: {
        id: string;
        winner: { email: string };
        publicWinnerAlias: string;
      };
      data: { publicWinnerAlias: string };
    }): Promise<{ count: number }>;
  };
}

const publicIdentityByEmail = new Map<
  string,
  { publicName: string; publicSlug: string | null }
>(
  PUBLIC_SEED_USER_RENAMES.map(({ email, publicName, publicSlug }) => [
    email.toLowerCase(),
    { publicName, publicSlug },
  ]),
);

export function buildPublicSeedLabelCleanupPlan(
  snapshot: PublicSeedLabelCleanupSnapshot,
): PublicSeedLabelCleanupPlan {
  const userUpdates = snapshot.users.flatMap((user) => {
    const publicIdentity = publicIdentityByEmail.get(
      user.email.trim().toLowerCase(),
    );
    if (
      !publicIdentity ||
      (user.displayName === publicIdentity.publicName &&
        user.profileSlug === publicIdentity.publicSlug)
    ) {
      return [];
    }
    return [
      {
        id: user.id,
        email: user.email,
        from: user.displayName,
        to: publicIdentity.publicName,
        slugFrom: user.profileSlug,
        slugTo: publicIdentity.publicSlug,
      },
    ];
  });
  const legacyAliases = new Set<string>(LEGACY_RAFFLE_WINNER_ALIASES);
  const awardUpdates = snapshot.awards.flatMap((award) => {
    if (
      award.winnerEmail.trim().toLowerCase() !== SEEDED_RAFFLE_WINNER_EMAIL ||
      !award.publicWinnerAlias ||
      !legacyAliases.has(award.publicWinnerAlias)
    ) {
      return [];
    }
    return [
      {
        id: award.id,
        from: award.publicWinnerAlias,
        to: CLEAN_RAFFLE_WINNER_ALIAS,
      },
    ];
  });

  return { userUpdates, awardUpdates };
}

export function describePublicSeedDatabaseTarget(databaseUrl: string) {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("DATABASE_URL_MUST_BE_POSTGRES");
  }
  const database = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
  if (!target.hostname || !database) {
    throw new Error("DATABASE_URL_TARGET_REQUIRED");
  }
  return { host: target.hostname, database };
}

export async function applyPublicSeedLabelCleanupPlan(
  transaction: PublicSeedLabelCleanupTransaction,
  plan: PublicSeedLabelCleanupPlan,
) {
  for (const update of plan.userUpdates) {
    const result = await transaction.user.updateMany({
      where: {
        id: update.id,
        email: update.email,
        displayName: update.from,
        profileSlug: update.slugFrom,
      },
      data: {
        displayName: update.to,
        profileSlug: update.slugTo,
      },
    });
    if (result.count !== 1) {
      throw new Error(`PUBLIC_SEED_USER_CHANGED:${update.id}`);
    }
  }
  for (const update of plan.awardUpdates) {
    const result = await transaction.giveawayAward.updateMany({
      where: {
        id: update.id,
        winner: { email: SEEDED_RAFFLE_WINNER_EMAIL },
        publicWinnerAlias: update.from,
      },
      data: { publicWinnerAlias: update.to },
    });
    if (result.count !== 1) {
      throw new Error(`PUBLIC_SEED_AWARD_CHANGED:${update.id}`);
    }
  }
}

export function createPrismaPublicSeedLabelCleanup(
  databaseUrl: string,
): PublicSeedLabelCleanupStore {
  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
  const seedEmails = PUBLIC_SEED_USER_RENAMES.map(({ email }) => email);

  return {
    async inspect() {
      const [users, awards] = await Promise.all([
        prisma.user.findMany({
          where: { email: { in: seedEmails } },
          select: {
            id: true,
            email: true,
            displayName: true,
            profileSlug: true,
          },
          orderBy: { email: "asc" },
        }),
        prisma.giveawayAward.findMany({
          where: {
            winner: { email: SEEDED_RAFFLE_WINNER_EMAIL },
            publicWinnerAlias: { in: [...LEGACY_RAFFLE_WINNER_ALIASES] },
          },
          select: {
            id: true,
            publicWinnerAlias: true,
            winner: { select: { email: true } },
          },
          orderBy: { id: "asc" },
        }),
      ]);
      return {
        users,
        awards: awards.map((award) => ({
          id: award.id,
          winnerEmail: award.winner.email,
          publicWinnerAlias: award.publicWinnerAlias,
        })),
      };
    },
    async apply(plan) {
      await prisma.$transaction(async (tx) => {
        await applyPublicSeedLabelCleanupPlan(
          {
            user: {
              updateMany: (input) => tx.user.updateMany(input),
            },
            giveawayAward: {
              updateMany: (input) => tx.giveawayAward.updateMany(input),
            },
          },
          plan,
        );
      });
    },
    close: () => prisma.$disconnect(),
  };
}
