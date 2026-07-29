import { describe, expect, test } from "vitest";

import type {
  MemberMediaStore,
  StoredMemberMediaObject,
} from "../../src/server/member-media/store";
import { createTambikeTestBackend } from "../../src/server/testing";
import {
  createPublishedTestEvent,
  createTestActors,
} from "./support/tambike-fixtures";

const visibleProfile = {
  displayName: "Visible Rider",
  area: "Quezon City",
  bio: "Weekend rider.",
  visibility: "PUBLIC" as const,
  defaultRosterIdentity: "VISIBLE" as const,
};

async function createPreviewHarness() {
  const objects = new Map<string, StoredMemberMediaObject>();
  let mediaSequence = 0;
  const store: MemberMediaStore = {
    createPresignedPost: async (input) => ({
      url: "https://uploads.example.test",
      fields: { key: input.key, "Content-Type": input.mimeType },
    }),
    getObject: async (key) => {
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return object;
    },
    putObject: async (input) => {
      objects.set(input.key, {
        body: input.body,
        contentType: input.mimeType,
      });
    },
    deleteObject: async (key) => {
      if (!objects.delete(key)) {
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      }
    },
  };
  const backend = await createTambikeTestBackend({
    memberMedia: {
      store,
      createUuid: () => `preview-bike-${++mediaSequence}`,
      normalize: async () => ({
        bytes: Buffer.from("normalized-bike"),
        mimeType: "image/webp",
        width: 1200,
        height: 800,
      }),
    },
  });

  async function addBikePhoto(
    rider: { sessionToken: string; user: { id: string } },
    label: string,
  ) {
    await backend.upsertMotorcycle(rider.sessionToken, {
      make: "Honda",
      model: "CB650R",
    });
    const tempKey = `tmp/users/${rider.user.id}/${label}`;
    objects.set(tempKey, {
      body: Buffer.from("jpeg"),
      contentType: "image/jpeg",
      lastModified: new Date(),
    });
    return backend.finalizeMemberMedia(rider.sessionToken, {
      purpose: "motorcycle-photo",
      tempKey,
      claimedMimeType: "image/jpeg",
      motorcyclePhotoPosition: 0,
    });
  }

  async function addProfilePhoto(
    rider: { sessionToken: string; user: { id: string } },
    label: string,
  ) {
    const tempKey = `tmp/users/${rider.user.id}/${label}`;
    objects.set(tempKey, {
      body: Buffer.from("jpeg"),
      contentType: "image/jpeg",
      lastModified: new Date(),
    });
    return backend.finalizeMemberMedia(rider.sessionToken, {
      purpose: "avatar",
      tempKey,
      claimedMimeType: "image/jpeg",
    });
  }

  return { backend, addBikePhoto, addProfilePhoto };
}

async function addPreviewCandidate(input: {
  backend: Awaited<ReturnType<typeof createTambikeTestBackend>>;
  eventId: string;
  label: string;
  visibility?: "PUBLIC" | "MEMBERS_ONLY" | "PRIVATE";
  identity?: "VISIBLE" | "ANONYMOUS";
  status?: "going" | "interested";
  publish?: boolean;
}) {
  const rider = await input.backend.signUpRider({
    displayName: input.label,
    email: `${input.label.toLowerCase().replace(/\s+/g, "-")}@example.test`,
    password: "password123",
    area: "Manila",
  });
  if (input.publish !== false) {
    await input.backend.updateMemberProfile(rider.sessionToken, {
      ...visibleProfile,
      displayName: input.label,
      visibility: input.visibility ?? "PUBLIC",
      defaultRosterIdentity: input.identity ?? "VISIBLE",
    });
  }
  await input.backend.registerForEvent(rider.sessionToken, input.eventId, {
    status: input.status ?? "going",
    attendanceType: "direct",
    rosterIdentity: input.identity ?? "VISIBLE",
  });
  return rider;
}

describe("public event attendee preview", () => {
  test("returns only public visible Going riders in the anonymous preview", async () => {
    const {
      backend,
      addBikePhoto,
      addProfilePhoto,
    } = await createPreviewHarness();
    const actors = await createTestActors(backend, "public-preview");
    const event = await createPublishedTestEvent(backend, actors, {
      date: "Fri · December 31, 2099",
    });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
      enabled: true,
    });

    await backend.updateMemberProfile(actors.rider.sessionToken, {
      ...visibleProfile,
      displayName: "Public Rider",
      visibility: "PUBLIC",
    });
    await backend.registerForEvent(actors.rider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
      rosterIdentity: "VISIBLE",
    });
    await addBikePhoto(actors.rider, "public-rider");
    await addProfilePhoto(actors.rider, "public-rider-avatar");

    await backend.updateMemberProfile(actors.outsider.sessionToken, {
      ...visibleProfile,
      displayName: "Members Rider",
      visibility: "MEMBERS_ONLY",
    });
    await backend.registerForEvent(actors.outsider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
      rosterIdentity: "VISIBLE",
    });
    await addBikePhoto(actors.outsider, "members-rider");

    const preview = await backend.getPublicEventAttendeePreview(event.id);

    expect(preview.summary).toMatchObject({
      rosterEnabled: true,
      goingCount: 2,
    });
    expect(preview.attendees).toEqual([
      {
        slug: "public-rider",
        displayName: "Public Rider",
        area: "Quezon City",
        profilePhotoUrl: "/media/preview-bike-2",
        bikePhoto: {
          url: "/media/preview-bike-1",
          width: 1200,
          height: 800,
        },
      },
    ]);
    expect(JSON.stringify(preview)).not.toMatch(
      /Members Rider|email|userId|rsvpId|verification|storageKey|make|model/i,
    );

    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
      enabled: false,
    });
    await expect(
      backend.getPublicEventAttendeePreview(event.id),
    ).resolves.toMatchObject({
      summary: { rosterEnabled: false, goingCount: 2 },
      attendees: [],
    });
  });

  test("filters riders without bike photos before limiting public Going riders", async () => {
    const { backend, addBikePhoto } = await createPreviewHarness();
    const actors = await createTestActors(backend, "public-preview-limit");
    const event = await createPublishedTestEvent(backend, actors, {
      date: "Fri · December 31, 2099",
    });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
      enabled: true,
    });

    for (let index = 0; index < 6; index += 1) {
      const rider = await backend.signUpRider({
        displayName: `Public Preview Rider ${index}`,
        email: `public-preview-${index}@example.test`,
        password: "password123",
        area: "Manila",
      });
      await backend.updateMemberProfile(rider.sessionToken, {
        ...visibleProfile,
        displayName: `Public Preview Rider ${index}`,
        visibility: "PUBLIC",
      });
      await backend.registerForEvent(rider.sessionToken, event.id, {
        status: "going",
        attendanceType: "direct",
        rosterIdentity: "VISIBLE",
      });
      if (index > 0) {
        await addBikePhoto(rider, `public-preview-${index}`);
      }
    }

    const preview = await backend.getPublicEventAttendeePreview(event.id);
    expect(preview.attendees).toHaveLength(4);
    expect(preview.attendees.map(({ displayName }) => displayName)).toEqual([
      "Public Preview Rider 1",
      "Public Preview Rider 2",
      "Public Preview Rider 3",
      "Public Preview Rider 4",
    ]);
  });

  test("uses the RSVP identity to prioritize visible riders in the four-bike preview", async () => {
    const { backend, addBikePhoto } = await createPreviewHarness();
    const actors = await createTestActors(backend, "per-event-preview");
    const event = await createPublishedTestEvent(backend, actors, {
      date: "Fri · December 31, 2099",
    });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
      enabled: true,
    });

    const riders = [];
    for (let index = 0; index < 7; index += 1) {
      const rider = await backend.signUpRider({
        displayName:
          index === 0 ? "Anonymous Rider" :
          index === 1 ? "Photo-less Rider" :
          `Visible Rider ${index - 1}`,
        email: `per-event-preview-${index}@example.test`,
        password: "password123",
        area: "Manila",
      });
      riders.push(rider);
      await backend.updateMemberProfile(rider.sessionToken, {
        ...visibleProfile,
        displayName:
          index === 0 ? "Anonymous Rider" :
          index === 1 ? "Photo-less Rider" :
          `Visible Rider ${index - 1}`,
        visibility: "PUBLIC",
      });
      await backend.registerForEvent(rider.sessionToken, event.id, {
        status: "going",
        attendanceType: "direct",
        rosterIdentity: index === 0 ? "ANONYMOUS" : "VISIBLE",
      });
      if (index !== 1) {
        await addBikePhoto(rider, `per-event-preview-${index}`);
      }
    }

    const initialPreview = await backend.getPublicEventAttendeePreview(event.id);
    expect(initialPreview.attendees.map(({ displayName }) => displayName)).toEqual([
      "Visible Rider 1",
      "Visible Rider 2",
      "Visible Rider 3",
      "Visible Rider 4",
    ]);

    await backend.updateMemberProfile(riders[2]!.sessionToken, {
      ...visibleProfile,
      displayName: "Visible Rider 1",
      visibility: "PUBLIC",
      defaultRosterIdentity: "ANONYMOUS",
    });
    const profileDefaultChangedPreview = await backend.getPublicEventAttendeePreview(event.id);
    expect(profileDefaultChangedPreview.attendees.map(({ displayName }) => displayName)).toContain(
      "Visible Rider 1",
    );

    await backend.registerForEvent(riders[2]!.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
      rosterIdentity: "ANONYMOUS",
    });
    const rsvpChangedPreview = await backend.getPublicEventAttendeePreview(event.id);
    expect(rsvpChangedPreview.attendees.map(({ displayName }) => displayName)).toEqual([
      "Visible Rider 2",
      "Visible Rider 3",
      "Visible Rider 4",
      "Visible Rider 5",
    ]);
  });

  test("excludes anonymous, private, unpublished, and interested riders", async () => {
    const { backend, addBikePhoto } = await createPreviewHarness();
    const actors = await createTestActors(backend, "public-preview-exclusions");
    const event = await createPublishedTestEvent(backend, actors, {
      date: "Fri · December 31, 2099",
    });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
      enabled: true,
    });

    const anonymous = await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Anonymous Going",
      identity: "ANONYMOUS",
    });
    await addBikePhoto(anonymous, "anonymous-going");
    const privateRider = await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Private Going",
      visibility: "PRIVATE",
    });
    await addBikePhoto(privateRider, "private-going");
    const unpublished = await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Unpublished Going",
      publish: false,
    });
    await addBikePhoto(unpublished, "unpublished-going");
    const interested = await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Public Interested",
      status: "interested",
    });
    await addBikePhoto(interested, "public-interested");

    const preview = await backend.getPublicEventAttendeePreview(event.id);
    expect(preview.attendees).toEqual([]);
    expect(JSON.stringify(preview.attendees)).not.toMatch(
      /Anonymous Going|Private Going|Unpublished Going|Public Interested/,
    );
  });
});
