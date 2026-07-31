import { describe, expect, test } from "vitest";

import {
  SAMPLE_RAFFLE_PHOTO_SOURCES,
  refreshSampleRafflePresentation,
  type RefreshSampleRafflePresentationDependencies,
} from "@/server/giveaways/sample-raffle-presentation";
import {
  productionSampleRaffleManifest,
  type SampleRaffleCompletedCampaignInspection,
  type SampleRaffleOngoingCampaignInspection,
} from "@/server/giveaways/sample-raffles";

function completedInspection(
  publicImageMediaId?: string,
): SampleRaffleCompletedCampaignInspection {
  return {
    giveawayId: "completed-sample-raffle",
    title: productionSampleRaffleManifest.completedTitle,
    state: "completed",
    complianceStatus: "approved",
    winnerCount: 1,
    winnerAlias: productionSampleRaffleManifest.winnerAlias,
    drawCount: 1,
    publishedDrawCount: 1,
    currentAwardCount: 1,
    fulfilledAwardCount: 1,
    publicWinnerAliases: [productionSampleRaffleManifest.winnerAlias],
    winnerUserId: "sample-winner",
    currentAwards: [
      {
        awardId: "completed-award",
        status: "fulfilled",
        winnerAlias: productionSampleRaffleManifest.winnerAlias,
        winnerAliasPublished: true,
      },
    ],
    presentation: {
      mechanics: "Old completed mechanics",
      terms: "Old completed terms",
      prizePoolId: "completed-prize-pool",
      publicTitle: "HJC C10 FOP Full-Face Helmet",
      publicImageMediaId,
    },
  };
}

function ongoingInspection(
  publicImageMediaId?: string,
): SampleRaffleOngoingCampaignInspection {
  return {
    giveawayId: "ongoing-sample-raffle",
    title: productionSampleRaffleManifest.ongoingTitle,
    state: "open",
    complianceStatus: "approved",
    winnerCount: 0,
    snapshotCount: 0,
    drawCount: 0,
    awardCount: 0,
    resultCount: 0,
    presentation: {
      mechanics: "Old ongoing mechanics",
      terms: "Old ongoing terms",
      prizePoolId: "ongoing-prize-pool",
      publicTitle: "Weekend Rider Gear Package",
      publicImageMediaId,
    },
  };
}

function dependencies(
  options: {
    contentType?: string;
    persistError?: Error;
  } = {},
) {
  const fetched: string[] = [];
  const stored: string[] = [];
  const deleted: string[] = [];
  const persisted: unknown[] = [];
  const deps: RefreshSampleRafflePresentationDependencies = {
    async fetchPhoto(url) {
      fetched.push(url);
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": options.contentType ?? "image/jpeg" },
      });
    },
    async normalizePhoto() {
      return {
        bytes: Buffer.from("normalized-webp"),
        mimeType: "image/webp",
        width: 1200,
        height: 900,
      };
    },
    mediaStore: {
      async putObject(input) {
        stored.push(input.key);
      },
      async deleteObject(key) {
        deleted.push(key);
      },
    },
    async persist(input) {
      persisted.push(input);
      if (options.persistError) throw options.persistError;
    },
  };
  return Object.assign(deps, { fetched, stored, deleted, persisted });
}

describe("sample raffle public presentation refresh", () => {
  test("downloads and stores one managed image for each image-less seeded prize", async () => {
    const deps = dependencies();

    await refreshSampleRafflePresentation(
      {
        manifest: productionSampleRaffleManifest,
        completed: completedInspection(),
        ongoing: ongoingInspection(),
      },
      deps,
    );

    expect(deps.fetched).toEqual([
      SAMPLE_RAFFLE_PHOTO_SOURCES.completed.downloadUrl,
      SAMPLE_RAFFLE_PHOTO_SOURCES.ongoing.downloadUrl,
    ]);
    expect(deps.stored).toEqual([
      "media/giveaway-prizes/completed-prize-pool/sample-raffle-hjc-c10-fop-photo-v1.webp",
      "media/giveaway-prizes/ongoing-prize-pool/sample-raffle-gear-photo-v1.webp",
    ]);
    expect(deps.persisted).toEqual([
      expect.objectContaining({
        images: {
          completed: expect.objectContaining({
            mediaId: "sample-raffle-hjc-c10-fop-photo-v1",
            width: 1200,
            height: 900,
          }),
          ongoing: expect.objectContaining({
            mediaId: "sample-raffle-gear-photo-v1",
            width: 1200,
            height: 900,
          }),
        },
      }),
    ]);
    expect(deps.deleted).toEqual([]);
  });

  test("preserves an existing managed image and downloads only the missing one", async () => {
    const deps = dependencies();

    await refreshSampleRafflePresentation(
      {
        manifest: productionSampleRaffleManifest,
        completed: completedInspection("organizer-selected-image"),
        ongoing: ongoingInspection(),
      },
      deps,
    );

    expect(deps.fetched).toEqual([
      SAMPLE_RAFFLE_PHOTO_SOURCES.ongoing.downloadUrl,
    ]);
    expect(deps.stored).toEqual([
      "media/giveaway-prizes/ongoing-prize-pool/sample-raffle-gear-photo-v1.webp",
    ]);
    expect(deps.persisted).toEqual([
      expect.objectContaining({
        images: {
          completed: undefined,
          ongoing: expect.objectContaining({
            mediaId: "sample-raffle-gear-photo-v1",
          }),
        },
      }),
    ]);
  });

  test("rejects a non-image response before media or database writes", async () => {
    const deps = dependencies({ contentType: "text/html" });

    await expect(
      refreshSampleRafflePresentation(
        {
          manifest: productionSampleRaffleManifest,
          completed: completedInspection(),
          ongoing: ongoingInspection(),
        },
        deps,
      ),
    ).rejects.toThrow("SAMPLE_RAFFLE_PHOTO_INVALID");

    expect(deps.stored).toEqual([]);
    expect(deps.persisted).toEqual([]);
  });

  test("removes only newly uploaded objects when persistence fails", async () => {
    const deps = dependencies({ persistError: new Error("database failed") });

    await expect(
      refreshSampleRafflePresentation(
        {
          manifest: productionSampleRaffleManifest,
          completed: completedInspection(),
          ongoing: ongoingInspection(),
        },
        deps,
      ),
    ).rejects.toThrow("database failed");

    expect(deps.deleted).toEqual([
      "media/giveaway-prizes/completed-prize-pool/sample-raffle-hjc-c10-fop-photo-v1.webp",
      "media/giveaway-prizes/ongoing-prize-pool/sample-raffle-gear-photo-v1.webp",
    ]);
  });
});
