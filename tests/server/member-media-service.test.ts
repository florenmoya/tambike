import { describe, expect, test, vi } from "vitest";

import {
  MemberMediaLifecycleService,
  type FinalizedMemberMediaRecord,
  type MemberMediaPersistence,
} from "../../src/server/member-media/service";
import type {
  MemberMediaStore,
  PutMemberMediaObjectInput,
  StoredMemberMediaObject,
} from "../../src/server/member-media/store";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createTestActors } from "./support/tambike-fixtures";

function noSuchKey() {
  return Object.assign(new Error("missing"), { name: "NoSuchKey" });
}

function fakeStore(options: {
  object?: StoredMemberMediaObject;
  getError?: unknown;
  deleteErrorFor?: string;
} = {}) {
  const objects = new Map<string, StoredMemberMediaObject>();
  if (options.object) objects.set("tmp/users/user-1/nonce-1", options.object);
  const putObject = vi.fn(async (input: PutMemberMediaObjectInput) => {
    objects.set(input.key, { body: input.body, contentType: input.mimeType });
  });
  const deleteObject = vi.fn(async (key: string) => {
    if (key === options.deleteErrorFor) throw new Error("S3_DELETE_FAILED");
    if (!objects.delete(key)) throw noSuchKey();
  });
  const store: MemberMediaStore = {
    createPresignedPost: vi.fn(async (input) => ({
      url: "https://uploads.example.test",
      fields: { key: input.key, "Content-Type": input.mimeType },
    })),
    getObject: vi.fn(async (key) => {
      if (options.getError) throw options.getError;
      const object = objects.get(key);
      if (!object) throw noSuchKey();
      return object;
    }),
    putObject,
    deleteObject,
  };
  return { store, objects, putObject, deleteObject };
}

function persistence(overrides: Partial<MemberMediaPersistence> = {}) {
  return {
    registerCleanup: vi.fn(async () => undefined),
    activateCleanup: vi.fn(async () => undefined),
    saveFinalized: vi.fn(async (_userId: string, record: FinalizedMemberMediaRecord) => ({
      mediaId: record.mediaId,
    })),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    claimCleanup: vi.fn(async () => []),
    completeCleanup: vi.fn(async () => undefined),
    failCleanup: vi.fn(async () => undefined),
    ...overrides,
  } satisfies MemberMediaPersistence;
}

function durablePersistence(overrides: Record<string, unknown> = {}) {
  return {
    ...persistence(),
    registerCleanup: vi.fn(async () => undefined),
    activateCleanup: vi.fn(async () => undefined),
    claimCleanup: vi.fn(async () => []),
    completeCleanup: vi.fn(async () => undefined),
    failCleanup: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MemberMediaPersistence & {
    registerCleanup: ReturnType<typeof vi.fn>;
    activateCleanup: ReturnType<typeof vi.fn>;
    claimCleanup: ReturnType<typeof vi.fn>;
    completeCleanup: ReturnType<typeof vi.fn>;
    failCleanup: ReturnType<typeof vi.fn>;
  };
}

const normalized = {
  bytes: Buffer.from("normalized-webp"),
  mimeType: "image/webp" as const,
  width: 512,
  height: 512,
};

describe("member media lifecycle service", () => {
  test("creates an exact authenticated user-scoped five-minute upload", async () => {
    const { store } = fakeStore();
    const service = new MemberMediaLifecycleService(store, {
      createUuid: () => "nonce-1",
    });

    await expect(service.createUpload("user-1", "image/jpeg")).resolves.toMatchObject({
      key: "tmp/users/user-1/nonce-1",
      mimeType: "image/jpeg",
      expiresInSeconds: 300,
    });
  });

  test("rejects temp keys owned by another user before reading storage", async () => {
    const { store } = fakeStore();
    const service = new MemberMediaLifecycleService(store);

    await expect(
      service.finalize("user-1", {
        purpose: "avatar",
        tempKey: "tmp/users/user-2/nonce-1",
        claimedMimeType: "image/jpeg",
      }, persistence()),
    ).rejects.toMatchObject({ code: "UPLOAD_OWNERSHIP_MISMATCH" });
    expect(store.getObject).not.toHaveBeenCalled();
  });

  test("distinguishes missing and expired temp uploads", async () => {
    const missing = fakeStore({ getError: noSuchKey() });
    const missingService = new MemberMediaLifecycleService(missing.store);
    await expect(
      missingService.finalize("user-1", {
        purpose: "avatar",
        tempKey: "tmp/users/user-1/nonce-1",
        claimedMimeType: "image/jpeg",
      }, persistence()),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });

    const expired = fakeStore({
      object: {
        body: Buffer.from("jpeg"),
        contentType: "image/jpeg",
        lastModified: new Date("2026-07-22T00:00:00.000Z"),
      },
    });
    const expiredService = new MemberMediaLifecycleService(expired.store, {
      now: () => new Date("2026-07-22T00:06:00.000Z"),
    });
    await expect(
      expiredService.finalize("user-1", {
        purpose: "avatar",
        tempKey: "tmp/users/user-1/nonce-1",
        claimedMimeType: "image/jpeg",
      }, persistence()),
    ).rejects.toMatchObject({ code: "UPLOAD_EXPIRED" });
  });

  test("does not collapse a generic storage 404 or NoSuchBucket into NoSuchKey", async () => {
    for (const storageError of [
      Object.assign(new Error("bucket missing"), { name: "NoSuchBucket" }),
      Object.assign(new Error("generic storage 404"), { $metadata: { httpStatusCode: 404 } }),
    ]) {
      const media = fakeStore({ getError: storageError });
      const service = new MemberMediaLifecycleService(media.store);
      await expect(service.finalize("user-1", {
        purpose: "avatar",
        tempKey: "tmp/users/user-1/nonce-1",
        claimedMimeType: "image/jpeg",
      }, persistence())).rejects.toBe(storageError);
    }
  });

  test("puts normalized final object before persistence and then cleans temp and replacement", async () => {
    const { store, putObject, deleteObject } = fakeStore({
      object: { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() },
    });
    const calls: string[] = [];
    putObject.mockImplementationOnce(async () => { calls.push("put"); });
    deleteObject.mockImplementation(async (key) => { calls.push(`delete:${key}`); });
    const state = persistence({
      saveFinalized: vi.fn(async (_userId, record) => {
        calls.push("persist");
        return { mediaId: record.mediaId };
      }),
      claimCleanup: vi.fn(async () => [
        { id: "temp", storageKey: "tmp/users/user-1/nonce-1", claimToken: "claim-temp", attemptCount: 0 },
        { id: "old", storageKey: "media/users/user-1/avatar/old.webp", claimToken: "claim-old", attemptCount: 0 },
      ]),
    });
    const service = new MemberMediaLifecycleService(store, {
      createUuid: () => "media-1",
      normalize: vi.fn(async () => normalized),
    });

    const result = await service.finalize("user-1", {
      purpose: "avatar",
      tempKey: "tmp/users/user-1/nonce-1",
      claimedMimeType: "image/jpeg",
    }, state);

    expect(result).toEqual({ mediaId: "media-1", url: "/media/media-1", width: 512, height: 512 });
    expect(putObject).toHaveBeenCalledWith({
      key: "media/users/user-1/avatar/media-1.webp",
      body: normalized.bytes,
      mimeType: "image/webp",
    });
    expect(calls).toEqual([
      "put",
      "persist",
      "delete:tmp/users/user-1/nonce-1",
      "delete:media/users/user-1/avatar/old.webp",
    ]);
    expect(JSON.stringify(result)).not.toContain("media/users/");
  });

  test("durably registers the final key before S3 and atomically queues temp and replacement cleanup", async () => {
    const { store, putObject } = fakeStore({
      object: { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() },
    });
    const calls: string[] = [];
    const state = durablePersistence({
      registerCleanup: vi.fn(async () => { calls.push("register"); }),
      saveFinalized: vi.fn(async () => {
        calls.push("persist-and-queue");
        return { mediaId: "media-1" };
      }),
      claimCleanup: vi.fn(async () => []),
    });
    putObject.mockImplementationOnce(async () => { calls.push("put"); });
    const service = new MemberMediaLifecycleService(store, {
      createUuid: () => "media-1",
      normalize: vi.fn(async () => normalized),
      now: () => new Date("2026-07-22T06:00:00.000Z"),
    });

    await service.finalize("user-1", {
      purpose: "avatar",
      tempKey: "tmp/users/user-1/nonce-1",
      claimedMimeType: "image/jpeg",
    }, state);

    expect(calls).toEqual(["register", "put", "persist-and-queue"]);
    expect(state.registerCleanup).toHaveBeenCalledWith(
      "user-1",
      "media/users/user-1/avatar/media-1.webp",
      new Date("2026-07-22T06:15:00.000Z"),
    );
    expect(state.saveFinalized).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ storageKey: "media/users/user-1/avatar/media-1.webp" }),
      "tmp/users/user-1/nonce-1",
      new Date("2026-07-22T06:00:00.000Z"),
    );
  });

  test("retains and increments failed cleanup, then a later finalize retries only claimed keys", async () => {
    const first = fakeStore({
      object: { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() },
    });
    const failedFinalKey = "media/users/user-1/avatar/media-1.webp";
    const attempts = new Map([[failedFinalKey, 0]]);
    let pending = [{ id: "intent-1", storageKey: failedFinalKey, claimToken: "claim-1", attemptCount: 0 }];
    first.store.deleteObject = vi.fn(async (key) => {
      if (key === failedFinalKey && attempts.get(key) === 0) {
        attempts.set(key, 1);
        throw new Error("S3_DELETE_FAILED");
      }
      first.objects.delete(key);
    });
    const state = durablePersistence({
      saveFinalized: vi.fn(async () => { throw new Error("STATE_WRITE_FAILED"); }),
      claimCleanup: vi.fn(async () => pending.splice(0, 10)),
      failCleanup: vi.fn(async () => {
        pending = [{ id: "intent-1", storageKey: failedFinalKey, claimToken: "claim-2", attemptCount: 1 }];
      }),
      completeCleanup: vi.fn(async () => undefined),
    });
    const service = new MemberMediaLifecycleService(first.store, {
      createUuid: () => "media-1",
      normalize: vi.fn(async () => normalized),
      now: () => new Date("2026-07-22T06:00:00.000Z"),
    });

    await expect(service.finalize("user-1", {
      purpose: "avatar",
      tempKey: "tmp/users/user-1/nonce-1",
      claimedMimeType: "image/jpeg",
    }, state)).rejects.toThrow("STATE_WRITE_FAILED");
    expect(state.activateCleanup).toHaveBeenCalledWith(
      failedFinalKey,
      new Date("2026-07-22T06:00:00.000Z"),
    );
    expect(state.failCleanup).toHaveBeenCalledWith(
      "intent-1",
      "claim-1",
      new Date("2026-07-22T06:00:00.000Z"),
      new Date("2026-07-22T06:01:00.000Z"),
    );

    state.saveFinalized = vi.fn(async () => ({ mediaId: "media-2" }));
    first.objects.set("tmp/users/user-1/nonce-2", {
      body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date(),
    });
    const secondService = new MemberMediaLifecycleService(first.store, {
      createUuid: () => "media-2",
      normalize: vi.fn(async () => normalized),
      now: () => new Date("2026-07-22T06:01:00.000Z"),
    });
    await secondService.finalize("user-1", {
      purpose: "avatar",
      tempKey: "tmp/users/user-1/nonce-2",
      claimedMimeType: "image/jpeg",
    }, state);

    expect(state.completeCleanup).toHaveBeenCalledWith("intent-1", "claim-2");
    expect(first.store.deleteObject).toHaveBeenCalledWith(failedFinalKey);
  });

  test("explicit deletion persists cleanup before S3 and retains a failed attempt", async () => {
    const { store } = fakeStore();
    store.deleteObject = vi.fn(async () => { throw new Error("S3_DELETE_FAILED"); });
    const state = durablePersistence({
      remove: vi.fn(async () => undefined),
      claimCleanup: vi.fn(async () => [{
        id: "intent-delete",
        storageKey: "media/users/user-1/avatar/old.webp",
        claimToken: "claim-delete",
        attemptCount: 0,
      }]),
    });
    const service = new MemberMediaLifecycleService(store, {
      now: () => new Date("2026-07-22T06:00:00.000Z"),
    });

    await expect(service.delete("user-1", "media-1", state)).resolves.toBeUndefined();

    expect(state.remove).toHaveBeenCalledWith(
      "user-1",
      "media-1",
      new Date("2026-07-22T06:00:00.000Z"),
    );
    expect(state.failCleanup).toHaveBeenCalledWith(
      "intent-delete",
      "claim-delete",
      new Date("2026-07-22T06:00:00.000Z"),
      new Date("2026-07-22T06:01:00.000Z"),
    );
  });

  test("deletes the new finalized object when state persistence fails", async () => {
    const { store, deleteObject } = fakeStore({
      object: { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() },
    });
    const service = new MemberMediaLifecycleService(store, {
      createUuid: () => "media-1",
      normalize: vi.fn(async () => normalized),
    });
    const state = persistence({
      saveFinalized: vi.fn(async () => { throw new Error("STATE_WRITE_FAILED"); }),
      claimCleanup: vi.fn(async () => [{
        id: "final",
        storageKey: "media/users/user-1/avatar/media-1.webp",
        claimToken: "claim-final",
        attemptCount: 0,
      }]),
    });

    await expect(
      service.finalize("user-1", {
        purpose: "avatar",
        tempKey: "tmp/users/user-1/nonce-1",
        claimedMimeType: "image/jpeg",
      }, state),
    ).rejects.toThrow("STATE_WRITE_FAILED");
    expect(deleteObject).toHaveBeenCalledWith("media/users/user-1/avatar/media-1.webp");
    expect(deleteObject).not.toHaveBeenCalledWith("tmp/users/user-1/nonce-1");
  });

  test("treats NoSuchKey cleanup as idempotent and durably queues other cleanup failures", async () => {
    const idempotent = fakeStore({
      object: { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() },
    });
    idempotent.store.deleteObject = vi.fn(async () => { throw noSuchKey(); });
    const service = new MemberMediaLifecycleService(idempotent.store, {
      createUuid: () => "media-1",
      normalize: vi.fn(async () => normalized),
    });
    await expect(service.finalize("user-1", {
      purpose: "avatar",
      tempKey: "tmp/users/user-1/nonce-1",
      claimedMimeType: "image/jpeg",
    }, persistence({
      claimCleanup: vi.fn(async () => [{
        id: "temp", storageKey: "tmp/users/user-1/nonce-1", claimToken: "claim-temp", attemptCount: 0,
      }]),
    }))).resolves.toMatchObject({ mediaId: "media-1" });

    const failing = fakeStore({
      object: { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() },
      deleteErrorFor: "tmp/users/user-1/nonce-1",
    });
    const failingService = new MemberMediaLifecycleService(failing.store, {
      createUuid: () => "media-1",
      normalize: vi.fn(async () => normalized),
    });
    await expect(failingService.finalize("user-1", {
      purpose: "avatar",
      tempKey: "tmp/users/user-1/nonce-1",
      claimedMimeType: "image/jpeg",
    }, persistence({
      claimCleanup: vi.fn(async () => [{
        id: "temp", storageKey: "tmp/users/user-1/nonce-1", claimToken: "claim-temp", attemptCount: 0,
      }]),
    }))).resolves.toMatchObject({ mediaId: "media-1" });
  });

  test("deletes persisted media before its private object and delegates unique reorder", async () => {
    const { store, deleteObject } = fakeStore();
    deleteObject.mockResolvedValue(undefined);
    const state = persistence({
      claimCleanup: vi.fn(async () => [{
        id: "old", storageKey: "media/users/user-1/avatar/old.webp", claimToken: "claim-old", attemptCount: 0,
      }]),
    });
    const service = new MemberMediaLifecycleService(store);

    await service.delete("user-1", "media-1", state);
    expect(state.remove).toHaveBeenCalledWith("user-1", "media-1", expect.any(Date));
    expect(deleteObject).toHaveBeenCalledWith("media/users/user-1/avatar/old.webp");

    await service.reorder("user-1", ["photo-2", "photo-1"], state);
    expect(state.reorder).toHaveBeenCalledWith("user-1", ["photo-2", "photo-1"]);
    await expect(service.reorder("user-1", ["photo-1", "photo-1"], state))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("reads an authorized descriptor without exposing its storage key", async () => {
    const { store } = fakeStore();
    store.getObject = vi.fn(async () => ({ body: Buffer.from("webp"), contentType: "image/webp" }));
    const service = new MemberMediaLifecycleService(store);

    const delivery = await service.read({
      storageKey: "media/users/user-1/avatar/media-1.webp",
      mimeType: "image/webp",
    });
    expect(delivery).toMatchObject({ mimeType: "image/webp", body: Buffer.from("webp") });
    expect(JSON.stringify(delivery)).not.toContain("media/users/");
  });
});

describe("in-memory member media persistence and authorization", () => {
  async function setupBackend() {
    const media = fakeStore();
    let sequence = 0;
    const backend = await createTambikeTestBackend({
      memberMedia: {
        store: media.store,
        createUuid: () => `generated-${++sequence}`,
        normalize: vi.fn(async (input) => ({
          ...normalized,
          width: input.purpose === "avatar" ? 512 : 1200,
          height: input.purpose === "avatar" ? 512 : 800,
        })),
      },
    });
    const actors = await createTestActors(backend, "member-media");
    async function stage(userId: string, nonce: string) {
      const key = `tmp/users/${userId}/${nonce}`;
      media.objects.set(key, {
        body: Buffer.from("jpeg"),
        contentType: "image/jpeg",
        lastModified: new Date(),
      });
      return key;
    }
    return { backend, actors, media, stage };
  }

  test("requires authentication for upload signing and finalization", async () => {
    const { backend } = await setupBackend();
    await expect(backend.createMemberMediaUpload("", "image/jpeg"))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(backend.finalizeMemberMedia("", {
      purpose: "avatar",
      tempKey: "tmp/users/user-1/nonce",
      claimedMimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("enforces five motorcycle photos, supports replacement/deletion cleanup, and unique reorder", async () => {
    const { backend, actors, media, stage } = await setupBackend();
    await backend.upsertMotorcycle(actors.rider.sessionToken, { make: "Honda", model: "CB650R" });
    const photos: Array<{ mediaId: string; url: string; width: number; height: number }> = [];
    for (let position = 0; position < 5; position += 1) {
      photos.push(await backend.finalizeMemberMedia(actors.rider.sessionToken, {
        purpose: "motorcycle-photo",
        tempKey: await stage(actors.rider.user.id, `photo-${position}`),
        claimedMimeType: "image/jpeg",
        motorcyclePhotoPosition: position,
      }));
    }
    await expect(backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "motorcycle-photo",
      tempKey: await stage(actors.rider.user.id, "photo-six"),
      claimedMimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "PHOTO_LIMIT" });

    const oldKey = Array.from(media.objects.keys()).find((key) => key.includes(photos[0].mediaId));
    const replacement = await backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "motorcycle-photo",
      tempKey: await stage(actors.rider.user.id, "replacement"),
      claimedMimeType: "image/jpeg",
      motorcyclePhotoPosition: 0,
    });
    expect(oldKey && media.objects.has(oldKey)).toBe(false);

    await expect(backend.reorderMotorcyclePhotos(
      actors.rider.sessionToken,
      [replacement.mediaId, photos[1].mediaId, photos[1].mediaId],
    )).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await backend.reorderMotorcyclePhotos(
      actors.rider.sessionToken,
      [photos[4].mediaId, photos[3].mediaId, photos[2].mediaId, photos[1].mediaId, replacement.mediaId],
    );
    await backend.deleteMemberMedia(actors.rider.sessionToken, photos[4].mediaId);
    const editor = await backend.getMemberProfileEditor(actors.rider.sessionToken);
    expect(editor.motorcycle?.photos.map((photo) => photo.position)).toEqual([0, 1, 2, 3]);
    expect(editor.motorcycle?.photos.map((photo) => photo.url)).not.toContain(`/media/${photos[4].mediaId}`);
  });

  test("allows explicit motorcycle positions only for an occupied replacement or compact append", async () => {
    const { backend, actors, media, stage } = await setupBackend();
    await backend.upsertMotorcycle(actors.rider.sessionToken, { make: "Honda", model: "CB650R" });

    await expect(backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "motorcycle-photo",
      tempKey: await stage(actors.rider.user.id, "gap-first"),
      claimedMimeType: "image/jpeg",
      motorcyclePhotoPosition: 4,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(Array.from(media.objects.keys()).some((key) => key.includes("generated-1.webp"))).toBe(false);

    const first = await backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "motorcycle-photo",
      tempKey: await stage(actors.rider.user.id, "compact-first"),
      claimedMimeType: "image/jpeg",
      motorcyclePhotoPosition: 0,
    });
    await expect(backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "motorcycle-photo",
      tempKey: await stage(actors.rider.user.id, "gap-after-first"),
      claimedMimeType: "image/jpeg",
      motorcyclePhotoPosition: 3,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const editor = await backend.getMemberProfileEditor(actors.rider.sessionToken);
    expect(editor.motorcycle?.photos).toEqual([
      expect.objectContaining({ url: `/media/${first.mediaId}`, position: 0 }),
    ]);
    expect(Array.from(media.objects.keys()).some((key) => key.includes("generated-3.webp"))).toBe(false);
  });

  test("replaces avatar storage and applies owner/admin/public/member/private delivery rules", async () => {
    const { backend, actors, media, stage } = await setupBackend();
    const first = await backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "avatar",
      tempKey: await stage(actors.rider.user.id, "avatar-one"),
      claimedMimeType: "image/jpeg",
    });
    const oldKey = Array.from(media.objects.keys()).find((key) => key.includes(first.mediaId));
    const current = await backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "avatar",
      tempKey: await stage(actors.rider.user.id, "avatar-two"),
      claimedMimeType: "image/jpeg",
    });
    expect(oldKey && media.objects.has(oldKey)).toBe(false);

    await expect(backend.getMemberMedia(undefined, current.mediaId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.getMemberMedia(actors.rider.sessionToken, current.mediaId))
      .resolves.toMatchObject({ mimeType: "image/webp" });
    await expect(backend.getMemberMedia(actors.admin.sessionToken, current.mediaId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    await backend.updateMemberProfile(actors.rider.sessionToken, {
      displayName: actors.rider.user.displayName,
      area: actors.rider.user.area,
      visibility: "PUBLIC",
      defaultRosterIdentity: "ANONYMOUS",
    });
    await expect(backend.getMemberMedia(undefined, current.mediaId))
      .resolves.toMatchObject({ mimeType: "image/webp" });
    await expect(backend.getMemberMedia(actors.admin.sessionToken, current.mediaId))
      .resolves.toMatchObject({ mimeType: "image/webp" });

    await backend.updateMemberProfile(actors.rider.sessionToken, {
      displayName: actors.rider.user.displayName,
      area: actors.rider.user.area,
      visibility: "MEMBERS_ONLY",
      defaultRosterIdentity: "ANONYMOUS",
    });
    await expect(backend.getMemberMedia(undefined, current.mediaId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.getMemberMedia(actors.outsider.sessionToken, current.mediaId))
      .resolves.toMatchObject({ mimeType: "image/webp" });

    await backend.updateMemberProfile(actors.rider.sessionToken, {
      displayName: actors.rider.user.displayName,
      area: actors.rider.user.area,
      visibility: "PRIVATE",
      defaultRosterIdentity: "ANONYMOUS",
    });
    await expect(backend.getMemberMedia(actors.outsider.sessionToken, current.mediaId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.getMemberMedia(actors.admin.sessionToken, current.mediaId))
      .resolves.toMatchObject({ mimeType: "image/webp" });
    await expect(backend.getMemberMedia(actors.rider.sessionToken, "missing"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("keeps committed finalize/delete successful while retrying failed cleanup with backoff", async () => {
    const { backend, actors, media, stage } = await setupBackend();
    const deleteFailures = new Map<string, number>();
    media.store.deleteObject = vi.fn(async (key) => {
      const remaining = deleteFailures.get(key) ?? 0;
      if (remaining > 0) {
        deleteFailures.set(key, remaining - 1);
        throw new Error(`S3_DELETE_FAILED:${key}`);
      }
      if (!media.objects.delete(key)) throw noSuchKey();
    });
    const cleanupIntents = (backend as unknown as {
      memberMediaCleanupIntents: Map<string, {
        attemptCount: number;
        cleanupAfter: Date;
        lastAttemptAt?: Date;
      }>;
    }).memberMediaCleanupIntents;
    const worker = backend as unknown as {
      drainMemberMediaCleanup(now: Date): Promise<{
        claimed: number; deleted: number; failed: number; batches: number;
      }>;
    };

    const first = await backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "avatar",
      tempKey: await stage(actors.rider.user.id, "retry-avatar-one"),
      claimedMimeType: "image/jpeg",
    });
    const firstKey = Array.from(media.objects.keys()).find((key) => key.includes(first.mediaId));
    if (!firstKey) throw new Error("FIRST_AVATAR_KEY_MISSING");

    const replacementTemp = await stage(actors.rider.user.id, "retry-avatar-two");
    deleteFailures.set(replacementTemp, 1);
    deleteFailures.set(firstKey, 1);
    await expect(backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "avatar",
      tempKey: replacementTemp,
      claimedMimeType: "image/jpeg",
    })).resolves.toMatchObject({ mediaId: expect.any(String) });
    expect(cleanupIntents.get(replacementTemp)?.attemptCount).toBe(1);
    expect(cleanupIntents.get(firstKey)?.attemptCount).toBe(1);
    for (const key of [replacementTemp, firstKey]) {
      const intent = cleanupIntents.get(key);
      expect(intent?.lastAttemptAt).toBeInstanceOf(Date);
      expect(intent && intent.cleanupAfter.getTime()).toBeGreaterThan(
        intent?.lastAttemptAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
      );
      expect(intent && intent.cleanupAfter.getTime()).toBeLessThanOrEqual(
        (intent?.lastAttemptAt?.getTime() ?? 0) + 24 * 60 * 60 * 1_000,
      );
    }

    const retryAt = new Date(Math.max(
      cleanupIntents.get(replacementTemp)!.cleanupAfter.getTime(),
      cleanupIntents.get(firstKey)!.cleanupAfter.getTime(),
    ));
    await expect(worker.drainMemberMediaCleanup(retryAt)).resolves.toMatchObject({
      deleted: 2,
      failed: 0,
    });
    expect(cleanupIntents.has(replacementTemp)).toBe(false);
    expect(cleanupIntents.has(firstKey)).toBe(false);

    const editor = await backend.getMemberProfileEditor(actors.rider.sessionToken);
    const currentId = editor.profilePhotoUrl?.split("/").at(-1);
    const currentKey = Array.from(media.objects.keys()).find((key) => currentId && key.includes(currentId));
    if (!currentId || !currentKey) throw new Error("CURRENT_AVATAR_KEY_MISSING");
    deleteFailures.set(currentKey, 1);
    await expect(backend.deleteMemberMedia(actors.rider.sessionToken, currentId)).resolves.toBeUndefined();
    expect(cleanupIntents.get(currentKey)?.attemptCount).toBe(1);
  });

  test("autonomously reclaims expired leases and prevents poison intents from starving later work", async () => {
    const { backend, media } = await setupBackend();
    const now = new Date("2026-07-22T08:00:00.000Z");
    const cleanupIntents = (backend as unknown as {
      memberMediaCleanupIntents: Map<string, {
        id: string;
        userId: string;
        storageKey: string;
        cleanupAfter: Date;
        claimToken?: string;
        claimExpiresAt?: Date;
        attemptCount: number;
        lastAttemptAt?: Date;
        createdAt: Date;
      }>;
      drainMemberMediaCleanup(now: Date): Promise<{
        claimed: number; deleted: number; failed: number; batches: number;
      }>;
    });
    const poisonKeys = Array.from({ length: 11 }, (_, index) => `media/users/user-1/avatar/poison-${index}.webp`);
    const deletableKey = "media/users/user-1/avatar/deletable.webp";
    const abandonedKey = "media/users/user-1/avatar/abandoned.webp";
    for (const [index, storageKey] of [...poisonKeys, deletableKey, abandonedKey].entries()) {
      cleanupIntents.memberMediaCleanupIntents.set(storageKey, {
        id: `intent-${String(index).padStart(2, "0")}`,
        userId: "user-1",
        storageKey,
        cleanupAfter: index === 12 ? new Date(now.getTime() + 15 * 60 * 1_000) : now,
        ...(storageKey === deletableKey
          ? { claimToken: "expired-claim", claimExpiresAt: new Date(now.getTime() - 1) }
          : {}),
        attemptCount: storageKey === poisonKeys[0] ? 30 : 0,
        createdAt: new Date(now.getTime() + index),
      });
      media.objects.set(storageKey, { body: Buffer.from("webp"), contentType: "image/webp" });
    }
    media.store.deleteObject = vi.fn(async (key) => {
      if (poisonKeys.includes(key)) throw new Error(`S3_DELETE_FAILED:${key}`);
      if (!media.objects.delete(key)) throw noSuchKey();
    });

    await expect(cleanupIntents.drainMemberMediaCleanup(now)).resolves.toEqual({
      batches: 2,
      claimed: 12,
      deleted: 1,
      failed: 11,
    });
    expect(media.objects.has(deletableKey)).toBe(false);
    expect(cleanupIntents.memberMediaCleanupIntents.get(poisonKeys[0]!)?.cleanupAfter)
      .toEqual(new Date(now.getTime() + 24 * 60 * 60 * 1_000));
    expect(media.objects.has(abandonedKey)).toBe(true);

    await expect(cleanupIntents.drainMemberMediaCleanup(
      new Date(now.getTime() + 15 * 60 * 1_000),
    )).resolves.toMatchObject({ deleted: 1 });
    expect(media.objects.has(abandonedKey)).toBe(false);
  });

  test("rejects expired rider, owner, and admin sessions on every media auth path", async () => {
    const { backend, actors, stage } = await setupBackend();
    const sessions = (backend as unknown as {
      sessions: Map<string, { expiresAt: Date }>;
    }).sessions;
    const expire = (token: string) => {
      const session = sessions.get(token);
      if (!session) throw new Error("TEST_SESSION_MISSING");
      session.expiresAt = new Date(Date.now() - 1);
    };

    expire(actors.outsider.sessionToken);
    await expect(backend.createMemberMediaUpload(actors.outsider.sessionToken, "image/jpeg"))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(backend.finalizeMemberMedia(actors.outsider.sessionToken, {
      purpose: "avatar",
      tempKey: await stage(actors.outsider.user.id, "expired-finalize"),
      claimedMimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const avatar = await backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "avatar",
      tempKey: await stage(actors.rider.user.id, "active-avatar"),
      claimedMimeType: "image/jpeg",
    });
    await backend.updateMemberProfile(actors.rider.sessionToken, {
      displayName: actors.rider.user.displayName,
      area: actors.rider.user.area,
      visibility: "PRIVATE",
      defaultRosterIdentity: "ANONYMOUS",
    });
    expire(actors.rider.sessionToken);
    expire(actors.admin.sessionToken);
    await expect(backend.getMemberMedia(actors.rider.sessionToken, avatar.mediaId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.getMemberMedia(actors.admin.sessionToken, avatar.mediaId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
