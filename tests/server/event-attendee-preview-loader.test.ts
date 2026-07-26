import { describe, expect, test } from "vitest";

import type {
  EventAttendeeRosterPage,
  EventAttendeeSummary,
} from "../../src/features/member-profiles/types";
import { BackendError } from "../../src/server/backend";

const summary: EventAttendeeSummary = {
  eventId: "ride-1",
  eventTitle: "Marilaque Dawn Roll",
  rosterEnabled: true,
  goingCount: 8,
  visibleCount: 5,
  anonymousCount: 3,
};

const rosterPage: EventAttendeeRosterPage = {
  summary,
  attendees: Array.from({ length: 5 }, (_, index) => ({
    slug: `rider-${index + 1}`,
    displayName: `Rider ${index + 1}`,
    area: "Davao City",
    profilePhotoUrl: `/media/rider-${index + 1}`,
    motorcycle: {
      make: "Honda",
      model: "CB400",
      photos: [],
    },
  })),
  pageSize: 5,
};

describe("event attendee preview loader", () => {
  test("requests four riders and returns only preview-safe fields", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );
    const calls: unknown[] = [];

    const result = await loadEventAttendeePreview(
      "ride-1",
      async (eventId, options) => {
        calls.push([eventId, options]);
        return rosterPage;
      },
      async () => summary,
      () => {
        throw new Error("unexpected not-found");
      },
    );

    expect(calls).toEqual([["ride-1", { limit: 4 }]]);
    expect(result).toEqual({
      summary,
      signedIn: true,
      unavailable: false,
      attendees: [
        {
          slug: "rider-1",
          displayName: "Rider 1",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-1",
        },
        {
          slug: "rider-2",
          displayName: "Rider 2",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-2",
        },
        {
          slug: "rider-3",
          displayName: "Rider 3",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-3",
        },
        {
          slug: "rider-4",
          displayName: "Rider 4",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-4",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /motorcycle|email|userId|verification|storageKey/i,
    );
  });

  test("returns public summary data without identities for a guest", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );

    await expect(
      loadEventAttendeePreview(
        "ride-1",
        async () => {
          throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
        },
        async () => summary,
        () => {
          throw new Error("unexpected not-found");
        },
      ),
    ).resolves.toEqual({
      summary,
      attendees: [],
      signedIn: false,
      unavailable: false,
    });
  });

  test("maps not-found to the route boundary", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );
    const marker = new Error("route-not-found");

    await expect(
      loadEventAttendeePreview(
        "missing",
        async () => {
          throw new BackendError("NOT_FOUND", "NOT_FOUND");
        },
        async () => summary,
        () => {
          throw marker;
        },
      ),
    ).rejects.toBe(marker);
  });

  test("keeps the event route usable when preview data is unavailable", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );

    await expect(
      loadEventAttendeePreview(
        "ride-1",
        async () => {
          throw new Error("database unavailable");
        },
        async () => {
          throw new Error("database unavailable");
        },
        () => {
          throw new Error("unexpected not-found");
        },
      ),
    ).resolves.toEqual({
      summary: null,
      attendees: [],
      signedIn: false,
      unavailable: true,
    });
  });
});
