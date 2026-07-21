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

      const photos = [];
      for (let position = 0; position < 5; position += 1) {
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
        .resolves.toMatchObject({ mimeType: "image/webp" });
      await expect(backendClients.primary.backend.getMemberMedia(outsider.sessionToken, avatar.mediaId))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
