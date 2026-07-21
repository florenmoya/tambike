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
    saveFinalized: vi.fn(async (_userId: string, record: FinalizedMemberMediaRecord) => ({
      mediaId: record.mediaId,
      replacedStorageKeys: [],
    })),
    remove: vi.fn(async () => ({ storageKey: "media/users/user-1/avatar/old.webp" })),
    reorder: vi.fn(async () => undefined),
    ...overrides,
  } satisfies MemberMediaPersistence;
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
        return { mediaId: record.mediaId, replacedStorageKeys: ["media/users/user-1/avatar/old.webp"] };
      }),
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

  test("treats NoSuchKey cleanup as idempotent but surfaces other cleanup failures", async () => {
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
    }, persistence())).resolves.toMatchObject({ mediaId: "media-1" });

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
    }, persistence())).rejects.toThrow("S3_DELETE_FAILED");
  });

  test("deletes persisted media before its private object and delegates unique reorder", async () => {
    const { store, deleteObject } = fakeStore();
    deleteObject.mockResolvedValue(undefined);
    const state = persistence();
    const service = new MemberMediaLifecycleService(store);

    await service.delete("user-1", "media-1", state);
    expect(state.remove).toHaveBeenCalledWith("user-1", "media-1");
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
      .resolves.toMatchObject({ mimeType: "image/webp" });

    await backend.updateMemberProfile(actors.rider.sessionToken, {
      displayName: actors.rider.user.displayName,
      area: actors.rider.user.area,
      visibility: "PUBLIC",
      defaultRosterIdentity: "ANONYMOUS",
    });
    await expect(backend.getMemberMedia(undefined, current.mediaId))
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
    await expect(backend.getMemberMedia(actors.rider.sessionToken, "missing"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
