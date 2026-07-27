import sharp from "sharp";
import { describe, expect, test, vi } from "vitest";

import type {
  CreateGiveawayInput,
  GiveawayPrizeImageSummary,
  OrganizerGiveawayWorkspace,
} from "../../src/features/giveaways/types";
import { BackendError } from "../../src/server/backend";
import {
  GiveawayPrizeMediaLifecycleService,
  type GiveawayPrizeMediaPersistence,
} from "../../src/server/giveaway-prize-media/service";
import type {
  MemberMediaStore,
  PutMemberMediaObjectInput,
  StoredMemberMediaObject,
} from "../../src/server/member-media/store";
import { MAX_MEMBER_UPLOAD_BYTES } from "../../src/server/member-media/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import {
  createPublishedTestEvent,
  createTestActors,
} from "./support/tambike-fixtures";

function noSuchKey() {
  return Object.assign(new Error("missing"), { name: "NoSuchKey" });
}

function fakeStore(initialObjects: Record<string, StoredMemberMediaObject> = {}) {
  const objects = new Map(Object.entries(initialObjects));
  const store: MemberMediaStore = {
    createPresignedPost: vi.fn(async (input) => ({
      url: "https://uploads.example.test",
      fields: { key: input.key, "Content-Type": input.mimeType },
    })),
    getObject: vi.fn(async (key) => {
      const object = objects.get(key);
      if (!object) throw noSuchKey();
      return object;
    }),
    putObject: vi.fn(async (input: PutMemberMediaObjectInput) => {
      objects.set(input.key, {
        body: input.body,
        contentType: input.mimeType,
        contentLength: input.body.byteLength,
      });
    }),
    deleteObject: vi.fn(async (key) => {
      if (!objects.delete(key)) throw noSuchKey();
    }),
  };
  return { store, objects };
}

function persistence(overrides: Partial<GiveawayPrizeMediaPersistence> = {}) {
  return {
    authorizePool: vi.fn(async () => undefined),
    replaceFinalized: vi.fn(async (input) => ({
      mediaId: input.mediaId,
      url: `/giveaway-prize-media/${input.mediaId}`,
      width: input.width,
      height: input.height,
    } satisfies GiveawayPrizeImageSummary)),
    remove: vi.fn(async () => "media/giveaway-prizes/pool-1/old.webp"),
    registerCleanup: vi.fn(async () => undefined),
    activateCleanup: vi.fn(async () => undefined),
    ...overrides,
  } satisfies GiveawayPrizeMediaPersistence;
}

async function png(width = 8, height = 6) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 28, g: 85, b: 135 },
    },
  }).png().toBuffer();
}

type PrizeMediaBackend = Awaited<ReturnType<typeof createTambikeTestBackend>> & {
  createGiveawayPrizeImageUpload(
    sessionToken: string,
    giveawayId: string,
    prizePoolId: string,
    mimeType: string,
  ): Promise<{ key: string }>;
  finalizeGiveawayPrizeImage(
    sessionToken: string,
    input: {
      giveawayId: string;
      prizePoolId: string;
      tempKey: string;
      claimedMimeType: "image/png";
    },
  ): Promise<GiveawayPrizeImageSummary>;
  deleteGiveawayPrizeImage(
    sessionToken: string,
    giveawayId: string,
    prizePoolId: string,
    mediaId: string,
  ): Promise<void>;
  getGiveawayPrizeImageMedia(
    sessionToken: string | undefined,
    mediaId: string,
  ): Promise<{
    visibility: "event_page" | "registered_riders" | "eligible_riders";
    body: Uint8Array | AsyncIterable<Uint8Array>;
  }>;
};

function giveawayInput(
  eventId: string,
  visibility: CreateGiveawayInput["publicVisibility"] = "event_page",
): CreateGiveawayInput {
  return {
    eventId,
    title: "Prize image lifecycle raffle",
    kind: "raffle",
    entryMode: "automatic",
    maxEntriesPerRider: 1,
    mechanics: "Going riders receive one entry.",
    terms: "One prize per rider.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: visibility,
    eligibilityGroups: [
      {
        id: "going-rider",
        label: "Going rider",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "helmet-pool",
        title: "Internal helmet inventory",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        publicPresentation: {
          disclosure: "revealed",
          title: "Weekend Rider Helmet",
        },
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Internal helmet SKU" }],
        eligibilityGroupIds: ["going-rider"],
      },
    ],
  };
}

function configurationPools(
  workspace: OrganizerGiveawayWorkspace,
  disclosure: "revealed" | "surprise" = "revealed",
) {
  return workspace.prizePools.map((pool) => {
    const clientPool = { ...pool };
    delete clientPool.publicImage;
    return {
      ...clientPool,
      publicPresentation: disclosure === "surprise"
        ? { disclosure: "surprise" as const }
        : pool.publicPresentation,
    };
  });
}

async function createBackendContext(
  visibility: CreateGiveawayInput["publicVisibility"] = "event_page",
) {
  const media = fakeStore();
  let mediaSequence = 0;
  const backend = await createTambikeTestBackend({
    memberMedia: { store: media.store },
    giveawayPrizeMedia: {
      store: media.store,
      createUuid: () => `prize-media-${++mediaSequence}`,
    },
  } as never) as PrizeMediaBackend;
  const actors = await createTestActors(
    backend,
    `giveaway-prize-media-${visibility}-${Date.now()}-${Math.random()}`,
  );
  const event = await createPublishedTestEvent(
    backend,
    actors,
    { title: `Prize media ${visibility}` },
  );
  const giveaway = await backend.createGiveaway(
    actors.organizer.sessionToken,
    event.id,
    giveawayInput(event.id, visibility),
  );
  const workspace = await backend.getOrganizerGiveawayWorkspace(
    actors.organizer.sessionToken,
    giveaway.id,
  );
  const prizePoolId = workspace.prizePools[0]!.id;
  return { backend, media, actors, event, giveaway, workspace, prizePoolId };
}

async function attachPrizeImage(
  context: Awaited<ReturnType<typeof createBackendContext>>,
) {
  const upload = await context.backend.createGiveawayPrizeImageUpload(
    context.actors.organizer.sessionToken,
    context.giveaway.id,
    context.prizePoolId,
    "image/png",
  );
  const bytes = await png();
  context.media.objects.set(upload.key, {
    body: bytes,
    contentType: "image/png",
    contentLength: bytes.byteLength,
    lastModified: new Date(),
  });
  return context.backend.finalizeGiveawayPrizeImage(
    context.actors.organizer.sessionToken,
    {
      giveawayId: context.giveaway.id,
      prizePoolId: context.prizePoolId,
      tempKey: upload.key,
      claimedMimeType: "image/png",
    },
  );
}

describe("giveaway prize media lifecycle service", () => {
  test("authorizes the persisted pool before creating an organizer-scoped upload", async () => {
    const { store } = fakeStore();
    const state = persistence();
    const service = new GiveawayPrizeMediaLifecycleService(store, {
      createUuid: () => "upload-1",
    });

    await expect(
      service.createUpload(
        "organizer-a",
        "giveaway-1",
        "pool-1",
        "image/png",
        state,
      ),
    ).resolves.toMatchObject({
      key: "tmp/giveaway-prizes/organizer-a/upload-1",
      mimeType: "image/png",
      expiresInSeconds: 300,
    });
    expect(state.authorizePool).toHaveBeenCalledWith({
      userId: "organizer-a",
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
    });
    expect(store.createPresignedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "tmp/giveaway-prizes/organizer-a/upload-1",
        minimumBytes: 1,
        maximumBytes: MAX_MEMBER_UPLOAD_BYTES,
      }),
    );
  });

  test("rejects a temp key owned by another organizer", async () => {
    const { store } = fakeStore();
    const state = persistence();
    const service = new GiveawayPrizeMediaLifecycleService(store);

    await expect(
      service.finalize("organizer-a", {
        giveawayId: "giveaway-1",
        prizePoolId: "pool-1",
        tempKey: "tmp/giveaway-prizes/organizer-b/upload-1",
        claimedMimeType: "image/png",
      }, state),
    ).rejects.toMatchObject({
      code: "UPLOAD_OWNERSHIP_MISMATCH",
    });
    expect(state.authorizePool).not.toHaveBeenCalled();
    expect(store.getObject).not.toHaveBeenCalled();
  });

  test("rejects a non-presign temp suffix before reading storage", async () => {
    const { store } = fakeStore();
    const state = persistence();
    const service = new GiveawayPrizeMediaLifecycleService(store);

    await expect(
      service.finalize("organizer-a", {
        giveawayId: "giveaway-1",
        prizePoolId: "pool-1",
        tempKey: "tmp/giveaway-prizes/organizer-a/.forged",
        claimedMimeType: "image/png",
      }, state),
    ).rejects.toMatchObject({
      code: "UPLOAD_OWNERSHIP_MISMATCH",
    });
    expect(state.authorizePool).not.toHaveBeenCalled();
    expect(store.getObject).not.toHaveBeenCalled();
  });

  test("normalizes and stores one 4:3-safe public image", async () => {
    const tempKey = "tmp/giveaway-prizes/organizer-a/upload-1";
    const source = await png();
    const { store, objects } = fakeStore({
      [tempKey]: {
        body: source,
        contentType: "image/png",
        contentLength: source.byteLength,
        lastModified: new Date("2026-07-28T04:55:00.000Z"),
      },
    });
    const state = persistence();
    const service = new GiveawayPrizeMediaLifecycleService(store, {
      createUuid: () => "media-1",
      now: () => new Date("2026-07-28T05:00:00.000Z"),
    });

    const image = await service.finalize("organizer-a", {
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      tempKey,
      claimedMimeType: "image/png",
    }, state);

    expect(image).toEqual({
      mediaId: "media-1",
      url: "/giveaway-prize-media/media-1",
      width: 8,
      height: 6,
    });
    const finalized = objects.get("media/giveaway-prizes/pool-1/media-1.webp");
    expect(finalized?.contentType).toBe("image/webp");
    expect(Buffer.from(finalized?.body as Uint8Array).subarray(8, 12).toString()).toBe("WEBP");
    expect(JSON.stringify(image)).not.toContain("media/giveaway-prizes");
  });

  test("rejects invalid MIME, empty content, and oversized content", async () => {
    const invalidMimeService = new GiveawayPrizeMediaLifecycleService(fakeStore().store);
    await expect(
      invalidMimeService.createUpload(
        "organizer-a",
        "giveaway-1",
        "pool-1",
        "image/gif",
        persistence(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });

    for (const [label, body] of [
      ["empty", new Uint8Array()],
      ["oversized", new Uint8Array(MAX_MEMBER_UPLOAD_BYTES + 1)],
    ] as const) {
      const tempKey = `tmp/giveaway-prizes/organizer-a/${label}`;
      const service = new GiveawayPrizeMediaLifecycleService(fakeStore({
        [tempKey]: {
          body,
          contentType: "image/png",
          contentLength: body.byteLength,
          lastModified: new Date(),
        },
      }).store);
      await expect(
        service.finalize("organizer-a", {
          giveawayId: "giveaway-1",
          prizePoolId: "pool-1",
          tempKey,
          claimedMimeType: "image/png",
        }, persistence()),
      ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    }
  });

  test.each([
    ["a nonexistent pool", new BackendError("NOT_FOUND")],
    ["a non-owner organizer", new BackendError("FORBIDDEN")],
  ])("propagates authorization failure for %s before reading storage", async (_label, error) => {
    const { store } = fakeStore();
    const service = new GiveawayPrizeMediaLifecycleService(store);
    const state = persistence({
      authorizePool: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(
      service.finalize("organizer-a", {
        giveawayId: "giveaway-1",
        prizePoolId: "pool-1",
        tempKey: "tmp/giveaway-prizes/organizer-a/upload-1",
        claimedMimeType: "image/png",
      }, state),
    ).rejects.toBe(error);
    expect(store.getObject).not.toHaveBeenCalled();
  });

  test("registers recoverable final and temp cleanup around persistence", async () => {
    const tempKey = "tmp/giveaway-prizes/organizer-a/upload-1";
    const calls: string[] = [];
    const { store } = fakeStore({
      [tempKey]: {
        body: await png(),
        contentType: "image/png",
        lastModified: new Date("2026-07-28T04:59:00.000Z"),
      },
    });
    vi.mocked(store.putObject).mockImplementation(async () => {
      calls.push("put");
    });
    const state = persistence({
      registerCleanup: vi.fn(async ({ storageKey }) => {
        calls.push(`register:${storageKey}`);
      }),
      replaceFinalized: vi.fn(async (input) => {
        calls.push("persist");
        return {
          mediaId: input.mediaId,
          url: `/giveaway-prize-media/${input.mediaId}`,
          width: input.width,
          height: input.height,
        };
      }),
    });
    const service = new GiveawayPrizeMediaLifecycleService(store, {
      createUuid: () => "media-1",
      now: () => new Date("2026-07-28T05:00:00.000Z"),
    });

    await service.finalize("organizer-a", {
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      tempKey,
      claimedMimeType: "image/png",
    }, state);

    expect(calls).toEqual([
      "register:media/giveaway-prizes/pool-1/media-1.webp",
      "put",
      `register:${tempKey}`,
      "persist",
    ]);
    expect(state.registerCleanup).toHaveBeenNthCalledWith(1, {
      userId: "organizer-a",
      storageKey: "media/giveaway-prizes/pool-1/media-1.webp",
      cleanupAfter: new Date("2026-07-28T05:15:00.000Z"),
    });
    expect(state.registerCleanup).toHaveBeenNthCalledWith(2, {
      userId: "organizer-a",
      storageKey: tempKey,
      cleanupAfter: new Date("2026-07-28T05:00:00.000Z"),
    });
  });

  test("does not delete a finalized object when persistence committed before reporting failure", async () => {
    const tempKey = "tmp/giveaway-prizes/organizer-a/upload-1";
    const finalKey = "media/giveaway-prizes/pool-1/media-1.webp";
    const cleanupIntents = new Set<string>();
    let persistedStorageKey: string | undefined;
    const lostAcknowledgement = new Error("connection lost after commit");
    const { store, objects } = fakeStore({
      [tempKey]: {
        body: await png(),
        contentType: "image/png",
        lastModified: new Date("2026-07-28T04:59:00.000Z"),
      },
    });
    const state = persistence({
      registerCleanup: vi.fn(async ({ storageKey }) => {
        cleanupIntents.add(storageKey);
      }),
      replaceFinalized: vi.fn(async (input) => {
        persistedStorageKey = input.storageKey;
        cleanupIntents.delete(input.storageKey);
        throw lostAcknowledgement;
      }),
      activateCleanup: vi.fn(async ({ storageKey }) => {
        if (!cleanupIntents.has(storageKey)) {
          throw new Error("cleanup intent no longer exists");
        }
      }),
    });
    const service = new GiveawayPrizeMediaLifecycleService(store, {
      createUuid: () => "media-1",
      now: () => new Date("2026-07-28T05:00:00.000Z"),
    });

    await expect(
      service.finalize("organizer-a", {
        giveawayId: "giveaway-1",
        prizePoolId: "pool-1",
        tempKey,
        claimedMimeType: "image/png",
      }, state),
    ).rejects.toBe(lostAcknowledgement);

    expect(persistedStorageKey).toBe(finalKey);
    expect(objects.has(finalKey)).toBe(true);
    expect(store.deleteObject).not.toHaveBeenCalledWith(finalKey);
  });

  test("keeps deletion ownership server-side", async () => {
    const { store } = fakeStore();
    const state = persistence({
      authorizePool: vi.fn(async () => {
        throw new BackendError("FORBIDDEN");
      }),
    });
    const service = new GiveawayPrizeMediaLifecycleService(store);

    await expect(
      service.delete("organizer-b", {
        giveawayId: "giveaway-1",
        prizePoolId: "pool-1",
        mediaId: "media-1",
      }, state),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.remove).not.toHaveBeenCalled();
    expect(store.deleteObject).not.toHaveBeenCalled();
  });
});

describe("giveaway prize media backend lifecycle", () => {
  test("preserves an attached image across configuration save, cleans replacement, and removes it in surprise mode", async () => {
    const context = await createBackendContext();
    const first = await attachPrizeImage(context);
    const firstStorageKey =
      `media/giveaway-prizes/${context.prizePoolId}/${first.mediaId}.webp`;

    const attached = await context.backend.getOrganizerGiveawayWorkspace(
      context.actors.organizer.sessionToken,
      context.giveaway.id,
    );
    await context.backend.updateGiveaway(context.actors.organizer.sessionToken, {
      id: context.giveaway.id,
      eligibilityGroups: attached.eligibilityGroups,
      prizePools: configurationPools(attached),
    });
    const afterSave = await context.backend.getOrganizerGiveawayWorkspace(
      context.actors.organizer.sessionToken,
      context.giveaway.id,
    );
    expect(afterSave.prizePools[0]).toMatchObject({
      id: context.prizePoolId,
      publicImage: first,
    });

    const second = await attachPrizeImage(context);
    const secondStorageKey =
      `media/giveaway-prizes/${context.prizePoolId}/${second.mediaId}.webp`;
    await context.backend.drainMemberMediaCleanup(new Date());
    expect(context.media.objects.has(firstStorageKey)).toBe(false);
    expect(context.media.objects.has(secondStorageKey)).toBe(true);

    const replaced = await context.backend.getOrganizerGiveawayWorkspace(
      context.actors.organizer.sessionToken,
      context.giveaway.id,
    );
    await context.backend.updateGiveaway(context.actors.organizer.sessionToken, {
      id: context.giveaway.id,
      eligibilityGroups: replaced.eligibilityGroups,
      prizePools: configurationPools(replaced, "surprise"),
    });
    await context.backend.drainMemberMediaCleanup(new Date());
    const surprise = await context.backend.getOrganizerGiveawayWorkspace(
      context.actors.organizer.sessionToken,
      context.giveaway.id,
    );
    expect(surprise.prizePools[0]?.id).toBe(context.prizePoolId);
    expect(surprise.prizePools[0]?.publicPresentation).toEqual({
      disclosure: "surprise",
    });
    expect(surprise.prizePools[0]).not.toHaveProperty("publicImage");
    expect(context.media.objects.has(secondStorageKey)).toBe(false);
  });

  test("rejects deletion by a non-owner before removing the managed object", async () => {
    const context = await createBackendContext();
    const image = await attachPrizeImage(context);
    const storageKey =
      `media/giveaway-prizes/${context.prizePoolId}/${image.mediaId}.webp`;

    await expect(
      context.backend.deleteGiveawayPrizeImage(
        context.actors.outsider.sessionToken,
        context.giveaway.id,
        context.prizePoolId,
        image.mediaId,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(context.media.objects.has(storageKey)).toBe(true);

    await context.backend.deleteGiveawayPrizeImage(
      context.actors.organizer.sessionToken,
      context.giveaway.id,
      context.prizePoolId,
      image.mediaId,
    );
    expect(context.media.objects.has(storageKey)).toBe(false);
  });

  test.each([
    "event_page",
    "registered_riders",
    "eligible_riders",
  ] as const)(
    "enforces %s campaign visibility when reading image bytes",
    async (visibility) => {
      const context = await createBackendContext(visibility);
      const image = await attachPrizeImage(context);
      await context.backend.submitGiveawayForReview(
        context.actors.organizer.sessionToken,
        context.giveaway.id,
      );
      await context.backend.reviewGiveawayCompliance(
        context.actors.admin.sessionToken,
        context.giveaway.id,
        { decision: "approved" },
      );
      await context.backend.openGiveaway(
        context.actors.organizer.sessionToken,
        context.giveaway.id,
      );
      if (visibility !== "event_page") {
        await context.backend.registerForEvent(
          context.actors.rider.sessionToken,
          context.event.id,
          { status: "going", attendanceType: "direct" },
        );
      }

      if (visibility === "event_page") {
        await expect(
          context.backend.getGiveawayPrizeImageMedia(undefined, image.mediaId),
        ).resolves.toMatchObject({ visibility: "event_page" });
      } else {
        await expect(
          context.backend.getGiveawayPrizeImageMedia(undefined, image.mediaId),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          context.backend.getGiveawayPrizeImageMedia(
            context.actors.outsider.sessionToken,
            image.mediaId,
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          context.backend.getGiveawayPrizeImageMedia(
            context.actors.rider.sessionToken,
            image.mediaId,
          ),
        ).resolves.toMatchObject({ visibility });
      }
    },
  );
});
