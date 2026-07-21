import { randomUUID } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import type { MemberMediaStore, StoredMemberMediaObject } from "../../src/server/member-media/store";
import { closePrismaIntegrationClientPair, createPrismaIntegrationClientPair, createPrismaIntegrationClients } from "./clients";
import { createPrismaEventFixture } from "./fixtures";

describe("Prisma member media persistence", () => {
  test("atomically persists replacement, limit, reorder, deletion, and private authorization", async () => {
    const objects = new Map<string, StoredMemberMediaObject>();
    const store: MemberMediaStore = {
      createPresignedPost: vi.fn(),
      getObject: vi.fn(async (key) => {
        const value = objects.get(key);
        if (!value) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        return value;
      }),
      putObject: vi.fn(async (input) => { objects.set(input.key, { body: input.body, contentType: input.mimeType }); }),
      deleteObject: vi.fn(async (key) => { objects.delete(key); }),
    };
    let generated = 0;
    const memberMedia = {
      store,
      createUuid: () => `integration-media-${++generated}`,
      normalize: vi.fn(async () => ({
        bytes: Buffer.from("normalized-webp"),
        mimeType: "image/webp" as const,
        width: 1200,
        height: 800,
      })),
    };
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl, { memberMedia });
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix, riderCount: 2 });
      const [owner, outsider] = fixture.riders;
      if (!owner || !outsider) throw new Error("MEDIA_FIXTURE_RIDERS_MISSING");
      await backendClients.primary.backend.upsertMotorcycle(owner.sessionToken, { make: "Honda", model: "CB650R" });
      const stage = (nonce: string) => {
        const key = `tmp/users/${owner.userId}/${nonce}`;
        objects.set(key, { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() });
        return key;
      };

      await expect(backendClients.primary.backend.finalizeMemberMedia(owner.sessionToken, {
        purpose: "motorcycle-photo",
        tempKey: stage("gap-first"),
        claimedMimeType: "image/jpeg",
        motorcyclePhotoPosition: 4,
      })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(rawClients.secondary.motorcyclePhoto.count({
        where: { motorcycle: { userId: owner.userId } },
      })).resolves.toBe(0);

      const firstPhoto = await backendClients.primary.backend.finalizeMemberMedia(owner.sessionToken, {
        purpose: "motorcycle-photo",
        tempKey: stage("photo-0"),
        claimedMimeType: "image/jpeg",
        motorcyclePhotoPosition: 0,
      });
      await expect(backendClients.primary.backend.finalizeMemberMedia(owner.sessionToken, {
        purpose: "motorcycle-photo",
        tempKey: stage("gap-after-zero"),
        claimedMimeType: "image/jpeg",
        motorcyclePhotoPosition: 3,
      })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(rawClients.secondary.motorcyclePhoto.findMany({
        where: { motorcycle: { userId: owner.userId } },
        select: { mediaId: true, position: true },
      })).resolves.toEqual([{ mediaId: firstPhoto.mediaId, position: 0 }]);

      const photos = [firstPhoto];
      for (let position = 1; position < 5; position += 1) {
        photos.push(await backendClients.primary.backend.finalizeMemberMedia(owner.sessionToken, {
          purpose: "motorcycle-photo",
          tempKey: stage(`photo-${position}`),
          claimedMimeType: "image/jpeg",
          motorcyclePhotoPosition: position,
        }));
      }
      await expect(backendClients.secondary.backend.finalizeMemberMedia(owner.sessionToken, {
        purpose: "motorcycle-photo",
        tempKey: stage("sixth"),
        claimedMimeType: "image/jpeg",
      })).rejects.toMatchObject({ code: "PHOTO_LIMIT" });

      const replacement = await backendClients.primary.backend.finalizeMemberMedia(owner.sessionToken, {
        purpose: "motorcycle-photo",
        tempKey: stage("replacement"),
        claimedMimeType: "image/jpeg",
        motorcyclePhotoPosition: 0,
      });
      await backendClients.primary.backend.reorderMotorcyclePhotos(owner.sessionToken, [
        photos[4].mediaId,
        photos[3].mediaId,
        photos[2].mediaId,
        photos[1].mediaId,
        replacement.mediaId,
      ]);
      await backendClients.primary.backend.deleteMemberMedia(owner.sessionToken, photos[4].mediaId);
      await expect(rawClients.secondary.motorcyclePhoto.findMany({
        where: { motorcycle: { userId: owner.userId } },
        orderBy: { position: "asc" },
        select: { mediaId: true, position: true },
      })).resolves.toEqual([
        { mediaId: photos[3].mediaId, position: 0 },
        { mediaId: photos[2].mediaId, position: 1 },
        { mediaId: photos[1].mediaId, position: 2 },
        { mediaId: replacement.mediaId, position: 3 },
      ]);

      const avatar = await backendClients.primary.backend.finalizeMemberMedia(owner.sessionToken, {
        purpose: "avatar",
        tempKey: stage("avatar"),
        claimedMimeType: "image/jpeg",
      });
      await expect(backendClients.primary.backend.getMemberMedia(undefined, avatar.mediaId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(backendClients.primary.backend.getMemberMedia(owner.sessionToken, avatar.mediaId))
        .resolves.toMatchObject({ mimeType: "image/webp" });
      await expect(backendClients.primary.backend.getMemberMedia(fixture.adminSession, avatar.mediaId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(backendClients.primary.backend.getMemberMedia(outsider.sessionToken, avatar.mediaId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });

      await backendClients.primary.backend.updateMemberProfile(owner.sessionToken, {
        displayName: "Prisma Media Owner",
        area: "Antipolo",
        visibility: "PRIVATE",
        defaultRosterIdentity: "ANONYMOUS",
      });
      await expect(backendClients.primary.backend.getMemberMedia(fixture.adminSession, avatar.mediaId))
        .resolves.toMatchObject({ mimeType: "image/webp" });
      await rawClients.primary.session.updateMany({
        where: { userId: { in: [owner.userId, fixture.adminId] } },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await expect(backendClients.primary.backend.createMemberMediaUpload(owner.sessionToken, "image/jpeg"))
        .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      await expect(backendClients.primary.backend.getMemberMedia(owner.sessionToken, avatar.mediaId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(backendClients.primary.backend.getMemberMedia(fixture.adminSession, avatar.mediaId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("serializes concurrent same-owner append, replacement, reorder, and delete", async () => {
    const objects = new Map<string, StoredMemberMediaObject>();
    const store: MemberMediaStore = {
      createPresignedPost: vi.fn(),
      getObject: vi.fn(async (key) => {
        const value = objects.get(key);
        if (!value) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        return value;
      }),
      putObject: vi.fn(async (input) => { objects.set(input.key, { body: input.body, contentType: input.mimeType }); }),
      deleteObject: vi.fn(async (key) => { objects.delete(key); }),
    };
    let generated = 0;
    const memberMedia = {
      store,
      createUuid: () => `concurrent-media-${++generated}`,
      normalize: vi.fn(async () => ({
        bytes: Buffer.from("normalized-webp"),
        mimeType: "image/webp" as const,
        width: 1200,
        height: 800,
      })),
    };
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl, { memberMedia });
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix });
      const owner = fixture.riders[0];
      if (!owner) throw new Error("CONCURRENT_MEDIA_OWNER_MISSING");
      await backendClients.primary.backend.upsertMotorcycle(owner.sessionToken, {
        make: "Honda", model: "CB650R",
      });
      const stage = (nonce: string) => {
        const key = `tmp/users/${owner.userId}/${nonce}`;
        objects.set(key, { body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date() });
        return key;
      };
      const finalize = (backend: typeof backendClients.primary.backend, nonce: string, position?: number) =>
        backend.finalizeMemberMedia(owner.sessionToken, {
          purpose: "motorcycle-photo",
          tempKey: stage(nonce),
          claimedMimeType: "image/jpeg",
          motorcyclePhotoPosition: position,
        });

      const appended = await Promise.all([
        finalize(backendClients.primary.backend, "append-a"),
        finalize(backendClients.secondary.backend, "append-b"),
      ]);
      expect(await rawClients.primary.motorcyclePhoto.findMany({
        where: { motorcycle: { userId: owner.userId } },
        orderBy: { position: "asc" },
        select: { mediaId: true, position: true },
      })).toEqual([
        { mediaId: expect.any(String), position: 0 },
        { mediaId: expect.any(String), position: 1 },
      ]);
      expect(new Set(appended.map((photo) => photo.mediaId)).size).toBe(2);

      const replacements = await Promise.all([
        finalize(backendClients.primary.backend, "replace-a", 0),
        finalize(backendClients.secondary.backend, "replace-b", 0),
      ]);
      const afterReplacement = await rawClients.primary.motorcyclePhoto.findMany({
        where: { motorcycle: { userId: owner.userId } },
        orderBy: { position: "asc" },
        select: { mediaId: true, position: true },
      });
      expect(afterReplacement.map((photo) => photo.position)).toEqual([0, 1]);
      expect(replacements.map((photo) => photo.mediaId)).toContain(afterReplacement[0]?.mediaId);
      const survivingReplacementKeys = Array.from(objects.keys()).filter(
        (key) => replacements.some((photo) => key.includes(`${photo.mediaId}.webp`)),
      );
      expect(survivingReplacementKeys).toHaveLength(1);

      const currentIds = afterReplacement.map((photo) => photo.mediaId);
      const mutationResults = await Promise.allSettled([
        backendClients.primary.backend.reorderMotorcyclePhotos(
          owner.sessionToken,
          [...currentIds].reverse(),
        ),
        backendClients.secondary.backend.deleteMemberMedia(owner.sessionToken, currentIds[0]!),
      ]);
      expect(mutationResults.some((result) => result.status === "fulfilled")).toBe(true);
      const finalRows = await rawClients.secondary.motorcyclePhoto.findMany({
        where: { motorcycle: { userId: owner.userId } },
        orderBy: { position: "asc" },
        select: { mediaId: true, position: true },
      });
      expect(finalRows).toHaveLength(1);
      expect(finalRows[0]?.position).toBe(0);
      expect(new Set(finalRows.map((photo) => photo.mediaId)).size).toBe(finalRows.length);
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
