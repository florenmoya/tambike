import { describe, expect, test } from "vitest";

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
  });
}

describe("public event attendee preview", () => {
  test("returns only public visible Going riders in the anonymous preview", async () => {
    const backend = await createTambikeTestBackend();
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
    });

    await backend.updateMemberProfile(actors.outsider.sessionToken, {
      ...visibleProfile,
      displayName: "Members Rider",
      visibility: "MEMBERS_ONLY",
    });
    await backend.registerForEvent(actors.outsider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
    });

    const preview = await backend.getPublicEventAttendeePreview(event.id);

    expect(preview.summary).toMatchObject({
      rosterEnabled: true,
      goingCount: 2,
    });
    expect(preview.attendees).toEqual([
      expect.objectContaining({
        slug: "public-rider",
        displayName: "Public Rider",
      }),
    ]);
    expect(JSON.stringify(preview)).not.toMatch(
      /Members Rider|email|userId|rsvpId|verification|storageKey|motorcycle/i,
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

  test("limits public Going riders to the first four registrations", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "public-preview-limit");
    const event = await createPublishedTestEvent(backend, actors, {
      date: "Fri · December 31, 2099",
    });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
      enabled: true,
    });

    for (let index = 0; index < 5; index += 1) {
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
      });
    }

    const preview = await backend.getPublicEventAttendeePreview(event.id);
    expect(preview.attendees).toHaveLength(4);
    expect(preview.attendees.map(({ displayName }) => displayName)).toEqual([
      "Public Preview Rider 0",
      "Public Preview Rider 1",
      "Public Preview Rider 2",
      "Public Preview Rider 3",
    ]);
  });

  test("excludes anonymous, private, unpublished, and interested riders", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "public-preview-exclusions");
    const event = await createPublishedTestEvent(backend, actors, {
      date: "Fri · December 31, 2099",
    });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
      enabled: true,
    });

    await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Anonymous Going",
      identity: "ANONYMOUS",
    });
    await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Private Going",
      visibility: "PRIVATE",
    });
    await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Unpublished Going",
      publish: false,
    });
    await addPreviewCandidate({
      backend,
      eventId: event.id,
      label: "Public Interested",
      status: "interested",
    });

    const preview = await backend.getPublicEventAttendeePreview(event.id);
    expect(preview.attendees).toEqual([]);
    expect(JSON.stringify(preview.attendees)).not.toMatch(
      /Anonymous Going|Private Going|Unpublished Going|Public Interested/,
    );
  });
});
