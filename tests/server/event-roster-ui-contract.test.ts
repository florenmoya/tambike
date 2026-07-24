import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, test } from "vitest";

import { EventAttendeeRoster } from "../../src/features/member-profiles/event-attendee-roster";
import { OrganizerRosterPanelSurface } from "../../src/features/member-profiles/organizer-roster-panel";
import type { EventAttendeeRosterPage } from "../../src/features/member-profiles/types";
import { BackendError } from "../../src/server/backend";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const enabledPage: EventAttendeeRosterPage = {
  summary: {
    eventId: "ride-1",
    eventTitle: "Marilaque Dawn Roll",
    rosterEnabled: true,
    goingCount: 5,
    visibleCount: 2,
    anonymousCount: 3,
  },
  attendees: [
    {
      slug: "mika-santos",
      displayName: "Mika Santos",
      area: "Quezon City",
      profilePhotoUrl: "/media/avatar-mika",
      motorcycle: {
        make: "Honda",
        model: "CB650R",
        nickname: "Ember",
        photos: [{ url: "/media/bike-mika", position: 0, width: 1600, height: 1200 }],
      },
    },
    {
      slug: "bea-rides",
      displayName: "Bea Rides",
      area: "Pasig",
    },
  ],
  nextCursor: "next-page",
  pageSize: 2,
};

describe("event attendee route and roster presentation", () => {
  test("awaits event params, loads on the server, and narrows only expected route states", () => {
    const route = source("src/app/events/[eventId]/attendees/page.tsx");

    expect(route).toMatch(/params:\s*Promise<\{\s*eventId:\s*string\s*\}>/);
    expect(route).toMatch(/await\s+params/);
    expect(route).toContain("listEventAttendeesAction");
    expect(route).toContain("BackendError");
    expect(route).toContain('error.code === "NOT_FOUND"');
    expect(route).toContain('error.code === "UNAUTHENTICATED"');
    expect(route).toContain("notFound()");
    expect(route).not.toContain('"use client"');
  });

  test("keeps guest counts but maps only not-found to the route boundary", async () => {
    const route = await import("../../src/app/events/[eventId]/attendees/page");
    const load = route.loadEventAttendeeRoster;
    const unauthenticated = new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    const summary = enabledPage.summary;

    await expect(load(
      "ride-1",
      async () => { throw unauthenticated; },
      async () => summary,
      () => { throw new Error("unexpected not-found"); },
    )).resolves.toEqual({
      signedIn: false,
      page: { summary, attendees: [], pageSize: 24 },
    });

    const marker = new Error("route-not-found");
    await expect(load(
      "missing",
      async () => { throw new BackendError("NOT_FOUND", "NOT_FOUND"); },
      async () => summary,
      () => { throw marker; },
    )).rejects.toBe(marker);

    const outage = new Error("database unavailable");
    await expect(load(
      "ride-1",
      async () => { throw outage; },
      async () => summary,
      () => { throw marker; },
    )).rejects.toBe(outage);
  });

  test("leads with exact counts before rendering sanitized garage excerpts", () => {
    const markup = renderToStaticMarkup(
      createElement(EventAttendeeRoster, { initialPage: enabledPage, signedIn: true }),
    );

    expect(markup.indexOf("5")).toBeLessThan(markup.indexOf("Mika Santos"));
    expect(markup).toContain("Visible riders");
    expect(markup).toContain("Anonymous riders");
    expect(markup).toContain("Mika Santos");
    expect(markup).toContain("Honda CB650R");
    expect(markup).toContain('href="/riders/mika-santos"');
    expect(markup).toContain('src="/media/avatar-mika"');
    expect(markup).toContain('src="/media/bike-mika"');
    expect(markup).not.toContain("/_next/image");
    expect(markup).not.toMatch(/email|userId|account id|verificationStatus/i);
  });

  test("shows disabled counts-only and enabled guest login states without member cards", () => {
    const disabledMarkup = renderToStaticMarkup(
      createElement(EventAttendeeRoster, {
        initialPage: {
          ...enabledPage,
          summary: { ...enabledPage.summary, rosterEnabled: false, visibleCount: 0, anonymousCount: 5 },
          attendees: [],
          nextCursor: undefined,
        },
        signedIn: false,
      }),
    );
    expect(disabledMarkup).toMatch(/counts only/i);
    expect(disabledMarkup).toMatch(/organizer.*turns on/i);
    expect(disabledMarkup).not.toContain("Mika Santos");

    const guestMarkup = renderToStaticMarkup(
      createElement(EventAttendeeRoster, { initialPage: enabledPage, signedIn: false }),
    );
    expect(guestMarkup).toMatch(/Log in to view riders/i);
    expect(guestMarkup).toContain('href="/login?next=%2Fevents%2Fride-1%2Fattendees"');
    expect(guestMarkup).not.toContain("Mika Santos");
  });

  test("keeps anonymous attendance in totals without a separate roster card", () => {
    const markup = renderToStaticMarkup(
      createElement(EventAttendeeRoster, { initialPage: enabledPage, signedIn: true }),
    );
    expect(markup).toContain("Anonymous riders");
    expect(markup).not.toMatch(/Privacy respected|riders chose privacy/i);
    expect(markup).toContain("Load more riders");

    const emptyMarkup = renderToStaticMarkup(
      createElement(EventAttendeeRoster, {
        initialPage: {
          ...enabledPage,
          summary: { ...enabledPage.summary, goingCount: 0, visibleCount: 0, anonymousCount: 0 },
          attendees: [],
          nextCursor: undefined,
        },
        signedIn: true,
      }),
    );
    expect(emptyMarkup).toMatch(/No one is going yet/i);
    expect(emptyMarkup).toMatch(/register.*first rider/i);

    const component = source("src/features/member-profiles/event-attendee-roster.tsx");
    expect(component).toContain("nextCursor");
    expect(component).toContain("listEventAttendeesAction");
    expect(component).toMatch(/new Map|new Set/);
    expect(component).toContain('aria-live="polite"');
  });
});

describe("roster identity controls", () => {
  test("removes event-specific privacy APIs and controls while preserving roster access", () => {
    const screen = source("src/features/tambike-demo/tambike-screen.tsx");
    const provider = source("src/features/tambike-demo/demo-provider.tsx");
    const actions = source("src/server/actions.ts");

    expect(screen).not.toContain("ExistingRsvpIdentityEditor");
    expect(screen).not.toContain("RosterIdentityField");
    expect(screen).not.toContain("Change for this event");
    expect(screen).not.toContain("Profile default");
    expect(screen).not.toContain("Event roster privacy");
    expect(screen).toMatch(
      /registerForEvent\(event\.id,\s*attendance,\s*"going"\)/,
    );

    expect(provider).not.toContain("updateEventRosterIdentityAction");
    expect(provider).not.toContain("getEventRosterIdentityAction");
    expect(actions).not.toContain("updateEventRosterIdentityAction");
    expect(actions).not.toContain("getEventRosterIdentityAction");

    expect(screen).toContain("View attendee roster");
    expect(provider).toContain("configureEventRoster");
    expect(provider).toContain("listEventAttendees");
  });
});

describe("organizer roster ownership controls", () => {
  test("shows the owned-event switch, live save status, totals, and sanitized page", () => {
    const markup = renderToStaticMarkup(
      createElement(OrganizerRosterPanelSurface, {
        page: enabledPage,
        status: "",
        pending: false,
        onToggle: () => undefined,
      }),
    );

    expect(markup).toMatch(/You control whether signed-in members can see/i);
    expect(markup).toContain("Show rider roster");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("5");
    expect(markup).toContain("2");
    expect(markup).toContain("3");
    expect(markup).toContain("Mika Santos");
    expect(markup).not.toMatch(/email|userId|account id|verificationStatus/i);
  });

  test("replaces the organizer placeholder and keeps controls keyboard native", () => {
    const organizer = source("src/features/organizer/organizer-console.tsx");
    expect(organizer).toContain("OrganizerRosterPanel");
    expect(organizer).not.toContain("rider-level attendee directory can be added");
    expect(source("src/features/member-profiles/organizer-roster-panel.tsx")).not.toMatch(
      /<div[^>]+onClick=/,
    );
  });
});
