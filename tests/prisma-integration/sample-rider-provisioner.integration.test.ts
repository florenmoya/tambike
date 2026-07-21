import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, test, vi } from "vitest";

import {
  createPrismaSampleRiderProvisioner,
  provisionSampleRider,
  type SampleRiderManifest,
} from "../../src/server/member-profiles/sample-rider";
import type {
  MemberMediaStore,
  StoredMemberMediaObject,
} from "../../src/server/member-media/store";
import { createPrismaIntegrationClients, closePrismaIntegrationClientPair } from "./clients";
import { requirePrismaIntegrationTestDatabaseUrl } from "./environment";

describe("guarded Prisma sample rider provisioner", () => {
  test("uses real services twice while preserving identity, media, RSVP, and pass cardinality", async () => {
    const databaseUrl = requirePrismaIntegrationTestDatabaseUrl(process.env);
    const clients = createPrismaIntegrationClients();
    const objects = new Map<string, StoredMemberMediaObject>();
    const store: MemberMediaStore = {
      createPresignedPost: vi.fn(),
      getObject: vi.fn(async (key) => {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        return object;
      }),
      putObject: vi.fn(async ({ key, body, mimeType }) => {
        objects.set(key, {
          body: Buffer.from(body),
          contentType: mimeType,
          contentLength: body.byteLength,
          lastModified: new Date(),
        });
      }),
      deleteObject: vi.fn(async (key) => {
        objects.delete(key);
      }),
    };
    const provisioner = createPrismaSampleRiderProvisioner(databaseUrl, { store });
    const directory = await mkdtemp(join(tmpdir(), "tambike-sample-rider-integration-"));
    const avatar = join(directory, "avatar.png");
    const motorcyclePhotos = Array.from({ length: 5 }, (_, index) =>
      join(directory, `motorcycle-${index}.png`),
    );
    const manifest: SampleRiderManifest = {
      eventId: "tambike-cafe-classico",
      avatar,
      motorcyclePhotos,
    };

    try {
      await Promise.all([
        writeFile(avatar, await sharp({ create: { width: 640, height: 640, channels: 3, background: "#64748b" } }).png().toBuffer()),
        ...motorcyclePhotos.map(async (path, index) => {
          await writeFile(path, await sharp({
            create: {
              width: 900 + index,
              height: 600,
              channels: 3,
              background: { r: 30 + index * 20, g: 70, b: 110 },
            },
          }).png().toBuffer());
        }),
      ]);

      await clients.primary.user.upsert({
        where: { email: "sample-provisioner-organizer@example.test" },
        create: {
          id: "sample-provisioner-organizer-user",
          email: "sample-provisioner-organizer@example.test",
          passwordHash: "integration-only",
          displayName: "Sample Provisioner Organizer",
          area: "Davao City",
          role: "organizer",
          verificationStatus: "APPROVED",
          organizerProfile: {
            create: {
              id: "sample-provisioner-organizer",
              organizerType: "Integration test organizer",
              displayName: "Sample Provisioner Organizer",
              realName: "Sample Provisioner Organizer",
              contactNumber: "09000000000",
              fbLink: "https://example.test/sample-provisioner",
              reason: "Guarded sample provisioner integration test.",
              pastEventLinks: [],
              verificationStatus: "APPROVED",
            },
          },
        },
        update: {},
      });
      await clients.primary.event.upsert({
        where: { id: "tambike-cafe-classico" },
        create: {
          id: "tambike-cafe-classico",
          slug: "tambike-cafe-classico",
          title: "Tambike at Cafe Classico",
          type: "TAMBIKE",
          status: "PUBLISHED",
          organizerId: "sample-provisioner-organizer",
          locationName: "Casa Classico",
          locationAddress: "Manga St., Tugbok, Davao City",
          dateLabel: "Every Saturday",
          timeLabel: "6:00 PM - 8:00 PM",
          area: "Davao City",
          expectedRiders: 55,
          description: "Disposable provisioner integration event.",
          whatHappens: "Riders meet for coffee.",
          poster: "/integration-sample-rider.png",
          perkPreview: "Coffee discount",
          tags: [],
          riskFlags: [],
          safetyRules: [],
        },
        update: { status: "PUBLISHED" },
      });

      const input = {
        confirmedProduction: true,
        password: "integration-runtime-password",
        manifest,
      };
      const first = await provisionSampleRider(input, provisioner.dependencies);
      const firstUser = await clients.primary.user.findUniqueOrThrow({
        where: { profileSlug: first.slug },
        select: {
          id: true,
          profileSlug: true,
          role: true,
          profileVisibility: true,
          defaultRosterIdentity: true,
          profilePhotoMediaId: true,
          motorcycle: {
            include: { photos: { orderBy: { position: "asc" } } },
          },
          rsvps: { where: { eventId: "tambike-cafe-classico" }, include: { pass: true } },
        },
      });
      const firstMediaIds = [
        firstUser.profilePhotoMediaId,
        ...(firstUser.motorcycle?.photos.map((photo) => photo.mediaId) ?? []),
      ];
      const putCallsAfterFirst = vi.mocked(store.putObject).mock.calls.length;

      await clients.primary.user.update({
        where: { id: firstUser.id },
        data: {
          displayName: "Drifted Sample",
          role: "admin",
          profileVisibility: "PRIVATE",
          defaultRosterIdentity: "ANONYMOUS",
        },
      });
      await clients.primary.motorcycle.update({
        where: { userId: firstUser.id },
        data: { make: "Drifted", model: "Drifted" },
      });
      await clients.primary.pass.updateMany({
        where: { userId: firstUser.id, eventId: "tambike-cafe-classico" },
        data: { status: "cancelled" },
      });

      const second = await provisionSampleRider(input, provisioner.dependencies);
      const secondUser = await clients.secondary.user.findUniqueOrThrow({
        where: { id: firstUser.id },
        select: {
          displayName: true,
          role: true,
          profileSlug: true,
          profileVisibility: true,
          defaultRosterIdentity: true,
          profilePhotoMediaId: true,
          motorcycle: { include: { photos: { orderBy: { position: "asc" } } } },
          rsvps: { where: { eventId: "tambike-cafe-classico" }, include: { pass: true } },
        },
      });

      expect(second).toEqual(first);
      expect(secondUser).toMatchObject({
        displayName: "Mika Santos — Sample Rider",
        role: "rider",
        profileVisibility: "PUBLIC",
        defaultRosterIdentity: "VISIBLE",
        motorcycle: { make: "Honda", model: "CB400 Super Four" },
        rsvps: [{ status: "going", rosterIdentity: "VISIBLE", pass: { status: "active" } }],
      });
      expect(secondUser.profileSlug).toBe(firstUser.profileSlug);
      expect([
        secondUser.profilePhotoMediaId,
        ...(secondUser.motorcycle?.photos.map((photo) => photo.mediaId) ?? []),
      ]).toEqual(firstMediaIds);
      expect(vi.mocked(store.putObject).mock.calls).toHaveLength(putCallsAfterFirst);
      expect(firstUser).toMatchObject({
        role: "rider",
        profileVisibility: "PUBLIC",
        defaultRosterIdentity: "VISIBLE",
        motorcycle: {
          make: "Honda",
          model: "CB400 Super Four",
          photos: [
            { position: 0 },
            { position: 1 },
            { position: 2 },
            { position: 3 },
            { position: 4 },
          ],
        },
        rsvps: [{ status: "going", rosterIdentity: "VISIBLE", pass: { status: "active" } }],
      });
      expect(second).toEqual({
        slug: first.slug,
        eventId: "tambike-cafe-classico",
        riders: 1,
        motorcycles: 1,
        avatars: 1,
        motorcyclePhotos: 5,
        rsvps: 1,
        passes: 1,
      });
    } finally {
      await provisioner.close();
      await closePrismaIntegrationClientPair(clients);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
