/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { EventAttendeePreview } from "../../src/features/member-profiles/event-attendee-preview";
import type { EventAttendeePreviewData } from "../../src/features/member-profiles/types";

const memberPreview: EventAttendeePreviewData = {
  summary: {
    eventId: "ride-1",
    eventTitle: "Marilaque Dawn Roll",
    rosterEnabled: true,
    goingCount: 15,
    visibleCount: 4,
    anonymousCount: 11,
  },
  attendees: [
    {
      slug: "mika-santos",
      displayName: "Mika Santos",
      area: "Davao City",
      bikePhoto: {
        url: "/media/bike-mika",
        width: 1200,
        height: 800,
      },
    },
    {
      slug: "paolo-reyes",
      displayName: "Paolo Reyes",
      area: "Quezon City",
      bikePhoto: {
        url: "/media/bike-paolo",
        width: 1200,
        height: 800,
      },
    },
  ],
  unavailable: false,
};

function render(
  preview: EventAttendeePreviewData | undefined,
  fallbackGoing = 12,
) {
  return renderToStaticMarkup(
    createElement(EventAttendeePreview, {
      eventId: "ride-1",
      fallbackGoing,
      interested: 15,
      expected: 55,
      preview,
    }),
  );
}

describe("event attendee preview", () => {
  test("shows public bike links without a login gate or long name list", () => {
    const markup = render(memberPreview);

    expect(markup).toContain('href="/riders/mika-santos"');
    expect(markup).toContain('href="/riders/paolo-reyes"');
    expect(markup).toContain("15 riders");
    expect(markup).toContain("15 interested · ~55 expected");
    expect(markup).toContain("View all bikes");
    expect(markup).not.toContain("15 riders are going");
    expect(markup).not.toContain("See who’s going");
    expect(markup).not.toContain("Around 55 expected");
    expect(markup).not.toContain("Log in to see riders");
    expect(markup).not.toContain("Mika Santos, Paolo Reyes");
    expect(markup).toContain('src="/media/bike-mika"');
    expect(markup).toContain('src="/media/bike-paolo"');
    expect(markup).toContain("View Mika Santos’s bike and rider profile");
    expect(markup).not.toContain("/media/mika");
    expect(markup).not.toMatch(
      /anonymous riders|visible riders|profilePhoto|email|userId|verification|make|model/i,
    );
  });

  test("does not expose roster navigation when the organizer disabled it", () => {
    const markup = render({
      ...memberPreview,
      summary: {
        ...memberPreview.summary!,
        rosterEnabled: false,
      },
      attendees: [],
    });

    expect(markup).toContain("15 riders");
    expect(markup).not.toContain("View all bikes");
    expect(markup).not.toMatch(/organizer|privacy|disabled/i);
  });

  test("uses event counts and keeps the roster path during a preview outage", () => {
    const markup = render({
      summary: null,
      attendees: [],
      unavailable: true,
    });

    expect(markup).toContain("12 riders");
    expect(markup).toContain("View all bikes");
    expect(markup).toContain('href="/events/ride-1/attendees"');
  });

  test("guides riders when no visible profiles are available", () => {
    const markup = render({
      ...memberPreview,
      attendees: [],
    });

    expect(markup).toContain("Rider profiles will appear here as they join");
    expect(markup).toContain("View all bikes");
  });

  test("removes a failed bike tile without substituting an initial", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(EventAttendeePreview, {
            eventId: "ride-1",
            fallbackGoing: 15,
            interested: 15,
            expected: 55,
            preview: memberPreview,
          }),
        );
      });
      const failedImage = container.querySelector(
        'img[src$="/media/bike-mika"]',
      );
      expect(failedImage).not.toBeNull();

      await act(async () => {
        failedImage!.dispatchEvent(new Event("error"));
      });

      expect(
        container.querySelector('a[href="/riders/mika-santos"]'),
      ).toBeNull();
      expect(
        container.querySelector('a[href="/riders/paolo-reyes"]'),
      ).not.toBeNull();
      expect(container.textContent).not.toContain(">M<");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  test.each([
    [0, "0 riders"],
    [1, "1 rider"],
    [2, "2 riders"],
  ])("uses correct turnout grammar for %i attendees", (going, copy) => {
    expect(render(undefined, going)).toContain(copy);
  });

  test("updates the turnout headline when the current Going count changes", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const preview = {
      ...memberPreview,
      attendees: [],
    };

    try {
      await act(async () => {
        root.render(
          createElement(EventAttendeePreview, {
            eventId: "ride-1",
            fallbackGoing: 12,
            interested: 15,
            expected: 55,
            preview,
          }),
        );
      });
      expect(container.textContent).toContain("15 riders");

      await act(async () => {
        root.render(
          createElement(EventAttendeePreview, {
            eventId: "ride-1",
            fallbackGoing: 13,
            interested: 15,
            expected: 55,
            preview,
          }),
        );
      });
      expect(container.textContent).toContain("13 riders");
      expect(container.textContent).not.toContain("15 riders");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
