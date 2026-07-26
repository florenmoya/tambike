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
      profilePhotoUrl: "/media/mika",
    },
    {
      slug: "paolo-reyes",
      displayName: "Paolo Reyes",
      area: "Quezon City",
    },
  ],
  signedIn: true,
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
  test("leads with turnout and authorized rider identities", () => {
    const markup = render(memberPreview);

    expect(markup).toContain("Who’s going");
    expect(markup).toContain("15 riders are going");
    expect(markup).toContain("15 interested");
    expect(markup).toContain("Around 55 expected");
    expect(markup).toContain("Mika Santos");
    expect(markup).toContain("Paolo Reyes");
    expect(markup).toContain('href="/riders/mika-santos"');
    expect(markup).toContain('src="/media/mika"');
    expect(markup).toContain('href="/events/ride-1/attendees"');
    expect(markup).toContain("See who’s going");
    expect(markup).not.toMatch(
      /anonymous riders|visible riders|email|userId|verification|motorcycle/i,
    );
  });

  test("shows a count and login action without identities for guests", () => {
    const markup = render({
      ...memberPreview,
      attendees: [],
      signedIn: false,
    });

    expect(markup).toContain("15 riders are going");
    expect(markup).toContain("Log in to see riders");
    expect(markup).toContain('href="/login?next=%2Fevents%2Fride-1"');
    expect(markup).not.toContain("Mika Santos");
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

    expect(markup).toContain("15 riders are going");
    expect(markup).not.toContain("See who’s going");
    expect(markup).not.toContain("Log in to see riders");
    expect(markup).not.toMatch(/organizer|privacy|disabled/i);
  });

  test("uses event counts and keeps the roster path during a preview outage", () => {
    const markup = render({
      summary: null,
      attendees: [],
      signedIn: false,
      unavailable: true,
    });

    expect(markup).toContain("12 riders are going");
    expect(markup).toContain("See who’s going");
    expect(markup).toContain('href="/events/ride-1/attendees"');
    expect(markup).not.toContain("Log in to see riders");
  });

  test("guides signed-in riders when no visible profiles are available", () => {
    const markup = render({
      ...memberPreview,
      attendees: [],
    });

    expect(markup).toContain("Rider profiles will appear here as they join");
    expect(markup).toContain("See who’s going");
  });

  test.each([
    [0, "0 riders are going"],
    [1, "1 rider is going"],
    [2, "2 riders are going"],
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
      expect(container.textContent).toContain("15 riders are going");

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
      expect(container.textContent).toContain("13 riders are going");
      expect(container.textContent).not.toContain("15 riders are going");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
