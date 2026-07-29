import { describe, expect, test } from "vitest";

import {
  PUBLIC_SEED_USER_RENAMES,
  applyPublicSeedLabelCleanupPlan,
  buildPublicSeedLabelCleanupPlan,
} from "@/server/maintenance/public-seed-label-cleanup";

describe("public seed label cleanup plan", () => {
  test("plans only exact known seeded identity renames", () => {
    const plan = buildPublicSeedLabelCleanupPlan({
      users: [
        {
          id: "mika",
          email: "mika.sample@tambike.ph",
          displayName: "Mika Santos — Sample Rider",
        },
        {
          id: "real",
          email: "real@example.com",
          displayName: "Demo Sample",
        },
      ],
      awards: [],
    });

    expect(plan).toEqual({
      userUpdates: [
        {
          id: "mika",
          email: "mika.sample@tambike.ph",
          from: "Mika Santos — Sample Rider",
          to: "Mika Santos",
        },
      ],
      awardUpdates: [],
    });
  });

  test("is idempotent when public seed labels are already clean", () => {
    expect(
      buildPublicSeedLabelCleanupPlan({
        users: [
          {
            id: "mika",
            email: "mika.sample@tambike.ph",
            displayName: "Mika Santos",
          },
        ],
        awards: [],
      }),
    ).toEqual({ userUpdates: [], awardUpdates: [] });
  });

  test("rewrites only legacy aliases owned by the seeded raffle winner", () => {
    const plan = buildPublicSeedLabelCleanupPlan({
      users: [],
      awards: [
        {
          id: "seed-award",
          winnerEmail: "raffle.winner.sample@tambike.ph",
          publicWinnerAlias: "Raffle Sample Rider",
        },
        {
          id: "real-award",
          winnerEmail: "real@example.com",
          publicWinnerAlias: "Raffle Sample Rider",
        },
        {
          id: "clean-seed-award",
          winnerEmail: "raffle.winner.sample@tambike.ph",
          publicWinnerAlias: "Cafe Classico Rider",
        },
      ],
    });

    expect(plan).toEqual({
      userUpdates: [],
      awardUpdates: [
        {
          id: "seed-award",
          from: "Raffle Sample Rider",
          to: "Cafe Classico Rider",
        },
      ],
    });
  });

  test("defines every known seeded rider as an exact identity mapping", () => {
    expect(PUBLIC_SEED_USER_RENAMES).toHaveLength(15);
    expect(PUBLIC_SEED_USER_RENAMES).toContainEqual({
      email: "demo.roster.20260723.01@tambike.ph",
      publicName: "Paolo Reyes",
    });
    expect(PUBLIC_SEED_USER_RENAMES).toContainEqual({
      email: "demo.roster.20260723.13@tambike.ph",
      publicName: "Anonymous Rider 02",
    });
    expect(PUBLIC_SEED_USER_RENAMES).toContainEqual({
      email: "raffle.winner.sample@tambike.ph",
      publicName: "Raffle Winner",
    });
  });

  test("aborts when a previewed row no longer matches during apply", async () => {
    await expect(
      applyPublicSeedLabelCleanupPlan(
        {
          user: {
            updateMany: async () => ({ count: 0 }),
          },
          giveawayAward: {
            updateMany: async () => ({ count: 1 }),
          },
        },
        {
          userUpdates: [
            {
              id: "mika",
              email: "mika.sample@tambike.ph",
              from: "Mika Santos — Sample Rider",
              to: "Mika Santos",
            },
          ],
          awardUpdates: [],
        },
      ),
    ).rejects.toThrow("PUBLIC_SEED_USER_CHANGED:mika");
  });
});
