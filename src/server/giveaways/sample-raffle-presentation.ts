import "server-only";

import type {
  SampleRaffleCompletedCampaignInspection,
  SampleRaffleManifest,
  SampleRaffleOngoingCampaignInspection,
} from "@/server/giveaways/sample-raffles";

export const SAMPLE_RAFFLE_PHOTO_SOURCES = {
  completed: {
    pageUrl:
      "https://www.pexels.com/photo/photo-of-a-motorcycle-helmet-15928222/",
    downloadUrl:
      "https://images.pexels.com/photos/15928222/pexels-photo-15928222.jpeg?auto=compress&cs=tinysrgb&w=1600",
    photographer: "Andrés Chirrisco",
    mediaId: "sample-raffle-helmet-photo-v1",
  },
  ongoing: {
    pageUrl:
      "https://www.pexels.com/photo/man-wearing-a-safety-helmet-15625079/",
    downloadUrl:
      "https://images.pexels.com/photos/15625079/pexels-photo-15625079.jpeg?auto=compress&cs=tinysrgb&w=1600",
    photographer: "Labskiii",
    mediaId: "sample-raffle-gear-photo-v1",
  },
} as const;

export interface PreparedSampleRaffleImage {
  mediaId: string;
  storageKey: string;
  mimeType: "image/webp";
  width: number;
  height: number;
}

export interface RefreshSampleRafflePresentationPersistenceInput {
  manifest: SampleRaffleManifest;
  completed: SampleRaffleCompletedCampaignInspection;
  ongoing: SampleRaffleOngoingCampaignInspection;
  images: {
    completed?: PreparedSampleRaffleImage;
    ongoing?: PreparedSampleRaffleImage;
  };
}

export interface RefreshSampleRafflePresentationDependencies {
  fetchPhoto(url: string): Promise<Response>;
  normalizePhoto(input: {
    body: Buffer;
    claimedMimeType: "image/jpeg" | "image/png" | "image/webp";
    purpose: "motorcycle-photo";
  }): Promise<{
    bytes: Buffer;
    mimeType: "image/webp";
    width: number;
    height: number;
  }>;
  mediaStore: {
    putObject(input: {
      key: string;
      body: Buffer;
      mimeType: "image/webp";
    }): Promise<void>;
    deleteObject(key: string): Promise<void>;
  };
  persist(input: RefreshSampleRafflePresentationPersistenceInput): Promise<void>;
}

export async function refreshSampleRafflePresentation(
  input: {
    manifest: SampleRaffleManifest;
    completed: SampleRaffleCompletedCampaignInspection;
    ongoing: SampleRaffleOngoingCampaignInspection;
  },
  dependencies: RefreshSampleRafflePresentationDependencies,
) {
  const completedPresentation = input.completed.presentation;
  const ongoingPresentation = input.ongoing.presentation;
  if (
    input.completed.title !== input.manifest.completedTitle ||
    input.ongoing.title !== input.manifest.ongoingTitle ||
    !completedPresentation ||
    !ongoingPresentation
  ) {
    throw new Error("SAMPLE_RAFFLE_PRESENTATION_TARGET_INVALID");
  }

  const pending = [
    completedPresentation.publicImageMediaId
      ? undefined
      : {
          key: "completed" as const,
          prizePoolId: completedPresentation.prizePoolId,
          source: SAMPLE_RAFFLE_PHOTO_SOURCES.completed,
        },
    ongoingPresentation.publicImageMediaId
      ? undefined
      : {
          key: "ongoing" as const,
          prizePoolId: ongoingPresentation.prizePoolId,
          source: SAMPLE_RAFFLE_PHOTO_SOURCES.ongoing,
        },
  ].filter((candidate) => candidate !== undefined);

  const prepared = await Promise.all(
    pending.map(async ({ key, prizePoolId, source }) => {
      const response = await dependencies.fetchPhoto(source.downloadUrl);
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        !response.ok ||
        (contentType !== "image/jpeg" &&
          contentType !== "image/png" &&
          contentType !== "image/webp")
      ) {
        throw new Error("SAMPLE_RAFFLE_PHOTO_INVALID");
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) {
        throw new Error("SAMPLE_RAFFLE_PHOTO_INVALID");
      }
      const normalized = await dependencies.normalizePhoto({
        body,
        claimedMimeType: contentType,
        purpose: "motorcycle-photo",
      });
      const storageKey =
        `media/giveaway-prizes/${prizePoolId}/${source.mediaId}.webp`;
      return {
        key,
        body: normalized.bytes,
        image: {
          mediaId: source.mediaId,
          storageKey,
          mimeType: normalized.mimeType,
          width: normalized.width,
          height: normalized.height,
        } satisfies PreparedSampleRaffleImage,
      };
    }),
  );

  const storedKeys: string[] = [];
  try {
    for (const photo of prepared) {
      await dependencies.mediaStore.putObject({
        key: photo.image.storageKey,
        body: photo.body,
        mimeType: photo.image.mimeType,
      });
      storedKeys.push(photo.image.storageKey);
    }

    const images: RefreshSampleRafflePresentationPersistenceInput["images"] = {};
    for (const photo of prepared) {
      images[photo.key] = photo.image;
    }
    await dependencies.persist({
      manifest: input.manifest,
      completed: input.completed,
      ongoing: input.ongoing,
      images,
    });
  } catch (error) {
    await Promise.allSettled(
      storedKeys.map((storageKey) =>
        dependencies.mediaStore.deleteObject(storageKey),
      ),
    );
    throw error;
  }
}
