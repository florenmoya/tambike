import { describe, expect, it, vi } from "vitest";

import {
  applySampleRaffleBrandingPlan,
  buildSampleRaffleBrandingPlan,
  type SampleRaffleBrandingSnapshot,
  type SampleRaffleBrandingTransaction,
} from "../../src/server/maintenance/sample-raffle-branding-cleanup";

const legacySnapshot: SampleRaffleBrandingSnapshot = {
  winner: {
    id: "winner-id",
    email: "raffle.winner.sample@tambike.ph",
    displayName: "Raffle Winner",
  },
  completed: {
    id: "completed-id",
    eventId: "tambike-cafe-classico",
    creatorUserId: "organizer-id",
    title: "Cafe Classico Helmet Raffle",
    status: "completed",
    complianceStatus: "approved",
    award: {
      id: "award-id",
      winnerUserId: "winner-id",
      publicWinnerAlias: "Cafe Classico Rider",
      winnerAliasOptedInAt: new Date("2026-07-20T00:00:00.000Z"),
      winnerAliasRevokedAt: null,
    },
    prizePool: {
      id: "completed-pool-id",
      publicTitle: "Cafe Classico Helmet",
      publicDescription: "A full-face helmet for safer everyday rides.",
      prizeItem: {
        id: "item-id",
        title: "Cafe Classico Helmet",
      },
      publicImage: {
        id: "image-id",
        mediaId: "sample-raffle-helmet-photo-v1",
        storageKey:
          "media/giveaway-prizes/completed-pool-id/sample-raffle-helmet-photo-v1.webp",
      },
    },
    latestMechanics: {
      id: "mechanics-id",
      version: 1,
      mechanics: "One eligible rider was selected from valid entries.",
      terms:
        "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.",
      sponsorDisclosure: null,
    },
  },
};

describe("sample raffle branding cleanup plan", () => {
  it("plans the exact completed legacy raffle without touching the ongoing raffle", () => {
    const plan = buildSampleRaffleBrandingPlan(legacySnapshot);

    expect(plan).toMatchObject({
      conflicts: [],
      winnerUpdate: {
        id: "winner-id",
        from: "Raffle Winner",
        to: "Gabriel Cruz",
      },
      giveawayUpdate: {
        id: "completed-id",
        from: "Cafe Classico Helmet Raffle",
        to: "HJC C10 FOP Helmet Raffle",
      },
      awardUpdate: {
        id: "award-id",
        from: "Cafe Classico Rider",
        to: "Gabriel Cruz",
      },
      prizePoolUpdate: {
        id: "completed-pool-id",
        from: {
          publicTitle: "Cafe Classico Helmet",
          publicDescription: "A full-face helmet for safer everyday rides.",
        },
        to: {
          publicTitle: "HJC C10 FOP Full-Face Helmet",
          publicDescription:
            "A branded full-face helmet for everyday road riding.",
        },
      },
      prizeItemUpdate: {
        id: "item-id",
        from: "Cafe Classico Helmet",
        to: "HJC C10 FOP Full-Face Helmet",
      },
      mechanicsUpdate: {
        id: "mechanics-id",
        fromVersion: 1,
        toVersion: 2,
        to: {
          mechanics: "One eligible rider was selected from valid entries.",
          terms:
            "The winner receives one HJC C10 FOP Full-Face Helmet. The organizer will contact the winner with claiming instructions.",
          sponsorDisclosure:
            "HJC is not affiliated with or endorsing this event.",
        },
      },
      imageUpdate: {
        id: "image-id",
        prizePoolId: "completed-pool-id",
        from: {
          mediaId: "sample-raffle-helmet-photo-v1",
          storageKey:
            "media/giveaway-prizes/completed-pool-id/sample-raffle-helmet-photo-v1.webp",
        },
        to: {
          mediaId: "sample-raffle-hjc-c10-fop-photo-v1",
          storageKey:
            "media/giveaway-prizes/completed-pool-id/sample-raffle-hjc-c10-fop-photo-v1.webp",
        },
      },
    });
    expect(JSON.stringify(plan)).not.toContain("Weekend Rider Gear Raffle");
  });

  it("is idempotent after every public value is already updated", () => {
    const updated: SampleRaffleBrandingSnapshot = structuredClone(legacySnapshot);
    updated.winner!.displayName = "Gabriel Cruz";
    updated.completed!.title = "HJC C10 FOP Helmet Raffle";
    updated.completed!.award!.publicWinnerAlias = "Gabriel Cruz";
    updated.completed!.prizePool!.publicTitle =
      "HJC C10 FOP Full-Face Helmet";
    updated.completed!.prizePool!.publicDescription =
      "A branded full-face helmet for everyday road riding.";
    updated.completed!.prizePool!.prizeItem!.title =
      "HJC C10 FOP Full-Face Helmet";
    updated.completed!.prizePool!.publicImage!.mediaId =
      "sample-raffle-hjc-c10-fop-photo-v1";
    updated.completed!.prizePool!.publicImage!.storageKey =
      "media/giveaway-prizes/completed-pool-id/sample-raffle-hjc-c10-fop-photo-v1.webp";
    updated.completed!.latestMechanics = {
      id: "mechanics-id-v2",
      version: 2,
      mechanics: "One eligible rider was selected from valid entries.",
      terms:
        "The winner receives one HJC C10 FOP Full-Face Helmet. The organizer will contact the winner with claiming instructions.",
      sponsorDisclosure:
        "HJC is not affiliated with or endorsing this event.",
    };

    expect(buildSampleRaffleBrandingPlan(updated)).toEqual({
      giveawayId: "completed-id",
      creatorUserId: "organizer-id",
      winnerUserId: "winner-id",
      conflicts: [],
    });
  });

  it("plans only a new mechanics version when the first branded disclosure is already live", () => {
    const updated: SampleRaffleBrandingSnapshot = structuredClone(legacySnapshot);
    updated.winner!.displayName = "Gabriel Cruz";
    updated.completed!.title = "HJC C10 FOP Helmet Raffle";
    updated.completed!.award!.publicWinnerAlias = "Gabriel Cruz";
    updated.completed!.prizePool!.publicTitle =
      "HJC C10 FOP Full-Face Helmet";
    updated.completed!.prizePool!.publicDescription =
      "A branded full-face helmet for everyday road riding.";
    updated.completed!.prizePool!.prizeItem!.title =
      "HJC C10 FOP Full-Face Helmet";
    updated.completed!.prizePool!.publicImage!.mediaId =
      "sample-raffle-hjc-c10-fop-photo-v1";
    updated.completed!.prizePool!.publicImage!.storageKey =
      "media/giveaway-prizes/completed-pool-id/sample-raffle-hjc-c10-fop-photo-v1.webp";
    updated.completed!.latestMechanics = {
      id: "mechanics-id-v2",
      version: 2,
      mechanics: "One eligible rider was selected from valid entries.",
      terms:
        "The winner receives one HJC C10 FOP Full-Face Helmet. The organizer will contact the winner with claiming instructions.",
      sponsorDisclosure:
        "HJC is shown as the sample prize brand. No sponsorship or endorsement is implied.",
    };

    const plan = buildSampleRaffleBrandingPlan(updated);

    expect(plan.conflicts).toEqual([]);
    expect(plan.mechanicsUpdate).toMatchObject({
      id: "mechanics-id-v2",
      fromVersion: 2,
      toVersion: 3,
      to: {
        sponsorDisclosure:
          "HJC is not affiliated with or endorsing this event.",
      },
    });
    expect(plan.imageUpdate).toBeUndefined();
  });

  it.each([
    ["winner display name", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.winner!.displayName = "Organizer Chosen Name";
    }],
    ["campaign title", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.title = "Organizer Helmet Giveaway";
    }],
    ["winner alias", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.award!.publicWinnerAlias = "Gabo";
    }],
    ["prize description", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.prizePool!.publicDescription =
        "Organizer-authored copy";
    }],
    ["managed image", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.prizePool!.publicImage!.mediaId =
        "organizer-uploaded-image";
    }],
  ])("fails closed on a third-party %s", (_label, mutate) => {
    const changed = structuredClone(legacySnapshot);
    mutate(changed);

    const plan = buildSampleRaffleBrandingPlan(changed);

    expect(plan.conflicts).toHaveLength(1);
  });

  it.each([
    ["winner", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.winner = null;
    }],
    ["completed raffle", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed = null;
    }],
    ["award", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.award = null;
    }],
    ["prize pool", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.prizePool = null;
    }],
    ["prize item", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.prizePool!.prizeItem = null;
    }],
    ["mechanics", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.latestMechanics = null;
    }],
    ["image", (snapshot: SampleRaffleBrandingSnapshot) => {
      snapshot.completed!.prizePool!.publicImage = null;
    }],
  ])("requires the exact %s record", (_label, remove) => {
    const incomplete = structuredClone(legacySnapshot);
    remove(incomplete);

    expect(
      buildSampleRaffleBrandingPlan(incomplete).conflicts,
    ).not.toHaveLength(0);
  });
});

describe("sample raffle branding guarded apply", () => {
  it("aborts when a previewed scalar row no longer matches", async () => {
    const plan = buildSampleRaffleBrandingPlan(legacySnapshot);
    const transaction = {
      user: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as SampleRaffleBrandingTransaction;

    await expect(
      applySampleRaffleBrandingPlan(transaction, plan, {
        mimeType: "image/webp",
        width: 1200,
        height: 800,
      }),
    ).rejects.toThrow("SAMPLE_RAFFLE_BRANDING_ROW_CHANGED:winner-id");
  });

  it("refuses to apply a conflicted plan before any transaction call", async () => {
    const changed = structuredClone(legacySnapshot);
    changed.completed!.title = "Organizer Helmet Giveaway";
    const plan = buildSampleRaffleBrandingPlan(changed);
    const updateMany = vi.fn();
    const transaction = {
      user: { updateMany },
    } as unknown as SampleRaffleBrandingTransaction;

    await expect(
      applySampleRaffleBrandingPlan(transaction, plan, {
        mimeType: "image/webp",
        width: 1200,
        height: 800,
      }),
    ).rejects.toThrow("SAMPLE_RAFFLE_BRANDING_CONFLICT");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("restores every immutable-history trigger when a branded row update fails", async () => {
    const plan = buildSampleRaffleBrandingPlan(legacySnapshot);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const succeeds = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $executeRawUnsafe: executeRaw,
      user: { updateMany: succeeds },
      eventGiveaway: { updateMany: succeeds },
      giveawayAward: { updateMany: succeeds },
      giveawayPrizePool: {
        updateMany: vi.fn().mockRejectedValue(new Error("database rejected")),
      },
    } as unknown as SampleRaffleBrandingTransaction;

    await expect(
      applySampleRaffleBrandingPlan(transaction, plan, {
        mimeType: "image/webp",
        width: 1200,
        height: 800,
      }),
    ).rejects.toThrow("database rejected");

    expect(executeRaw.mock.calls.map(([sql]) => sql)).toEqual([
      'ALTER TABLE "GiveawayPrizePool" DISABLE TRIGGER "GiveawayPrizePool_entrant_configuration_guard"',
      'ALTER TABLE "GiveawayPrizeItem" DISABLE TRIGGER "GiveawayPrizeItem_entrant_configuration_guard"',
      'ALTER TABLE "GiveawayPrizeImage" DISABLE TRIGGER "GiveawayPrizeImage_entrant_configuration_guard"',
      'ALTER TABLE "GiveawayMechanicsVersion" DISABLE TRIGGER "GiveawayMechanicsVersion_entrant_configuration_guard"',
      'ALTER TABLE "GiveawayMechanicsVersion" ENABLE TRIGGER "GiveawayMechanicsVersion_entrant_configuration_guard"',
      'ALTER TABLE "GiveawayPrizeImage" ENABLE TRIGGER "GiveawayPrizeImage_entrant_configuration_guard"',
      'ALTER TABLE "GiveawayPrizeItem" ENABLE TRIGGER "GiveawayPrizeItem_entrant_configuration_guard"',
      'ALTER TABLE "GiveawayPrizePool" ENABLE TRIGGER "GiveawayPrizePool_entrant_configuration_guard"',
    ]);
  });
});
