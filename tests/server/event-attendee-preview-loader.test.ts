import { describe, expect, test } from "vitest";

import type {
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

const rosterPage = {
  summary,
  attendees: Array.from({ length: 5 }, (_, index) => ({
    slug: `rider-${index + 1}`,
    displayName: `Rider ${index + 1}`,
    area: "Davao City",
    bikePhoto: {
      url: `/media/bike-${index + 1}`,
      width: 1200,
      height: 800,
    },
  })),
};

describe("event attendee preview loader", () => {
  test("returns four public preview riders without session state", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );
    const calls: string[] = [];

    const result = await loadEventAttendeePreview(
      "ride-1",
      async (eventId) => {
        calls.push(eventId);
        return {
          summary,
          attendees: rosterPage.attendees.slice(0, 4).map(
            ({ slug, displayName, area, bikePhoto }) => ({
              slug,
              displayName,
              area,
              bikePhoto,
            }),
          ),
        };
      },
      () => {
        throw new Error("unexpected not-found");
      },
    );

    expect(calls).toEqual(["ride-1"]);
    expect(result).toMatchObject({ summary, unavailable: false });
    expect(result.attendees[0]).toEqual({
      slug: "rider-1",
      displayName: "Rider 1",
      area: "Davao City",
      bikePhoto: {
        url: "/media/bike-1",
        width: 1200,
        height: 800,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /signedIn|profilePhoto|motorcycle|email|userId|verification|storageKey|make|model/i,
    );
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
        () => {
          throw new Error("unexpected not-found");
        },
      ),
    ).resolves.toEqual({
      summary: null,
      attendees: [],
      unavailable: true,
    });
  });
});
