import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, test } from "vitest";

import { EventAttendeeRoster } from "../../src/features/member-profiles/event-attendee-roster";
import { OrganizerRosterPanelSurface } from "../../src/features/member-profiles/organizer-roster-panel";
import {
  RosterIdentityField,
  registrationRosterIdentity,
} from "../../src/features/member-profiles/roster-identity-field";
import type {
  EventAttendeeRosterPage,
  MemberProfileEditorView,
} from "../../src/features/member-profiles/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import { BackendError } from "../../src/server/backend";
import {
  createPublishedTestEvent,
  createTestActors,
} from "./support/tambike-fixtures";

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

  test("renders one anonymous aggregate, an honest empty direction, and cursor loading", () => {
    const markup = renderToStaticMarkup(
      createElement(EventAttendeeRoster, { initialPage: enabledPage, signedIn: true }),
    );
    expect(markup.match(/3 riders chose privacy/g)).toHaveLength(1);
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
  test("reads only the signed-in rider's stored per-event identity", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "roster-self-read");
    const event = await createPublishedTestEvent(backend, actors);

    await backend.registerForEvent(actors.rider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
      rosterIdentity: "VISIBLE",
    });
    await backend.configureEventRoster(actors.organizer.sessionToken, event.id, { enabled: true });

    await expect(backend.getEventAttendeeSummary(event.id)).resolves.toMatchObject({
      eventId: event.id,
      rosterEnabled: true,
      goingCount: 1,
      visibleCount: 0,
      anonymousCount: 1,
    });

    await expect(backend.getEventRosterIdentity(actors.rider.sessionToken, event.id)).resolves.toEqual({
      rosterIdentity: "VISIBLE",
    });
    await expect(backend.getEventRosterIdentity(actors.outsider.sessionToken, event.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("initializes a new registration from the saved default and forces hidden profiles anonymous", () => {
    const editor = {
      defaultRosterIdentity: "VISIBLE",
      visibility: "PUBLIC",
      isPublished: true,
    } as Pick<MemberProfileEditorView, "defaultRosterIdentity" | "visibility" | "isPublished">;

    expect(registrationRosterIdentity(editor)).toBe("VISIBLE");
    expect(registrationRosterIdentity({ ...editor, visibility: "PRIVATE" })).toBe("ANONYMOUS");
    expect(registrationRosterIdentity({ ...editor, isPublished: false })).toBe("ANONYMOUS");
  });

  test("uses required labeled native radios with saved-default and forced-anonymous guidance", () => {
    const publicMarkup = renderToStaticMarkup(
      createElement(RosterIdentityField, {
        idPrefix: "registration",
        value: "VISIBLE",
        onChange: () => undefined,
        defaultIdentity: "VISIBLE",
        visibility: "PUBLIC",
        isPublished: true,
        context: "registration",
      }),
    );
    expect(publicMarkup).toContain("How should you appear on this event roster?");
    expect(publicMarkup).toContain('type="radio"');
    expect(publicMarkup).toContain('name="registration-roster-identity"');
    expect(publicMarkup).toContain("required");
    expect(publicMarkup).toMatch(/saved default.*future registration/i);
    expect(publicMarkup).toMatch(/Visible[\s\S]*Anonymous/);

    const privateMarkup = renderToStaticMarkup(
      createElement(RosterIdentityField, {
        idPrefix: "existing-rsvp",
        value: "ANONYMOUS",
        onChange: () => undefined,
        defaultIdentity: "VISIBLE",
        visibility: "PRIVATE",
        isPublished: true,
        context: "existing-rsvp",
      }),
    );
    expect(privateMarkup).toMatch(/private profile.*always anonymous/i);
    expect(privateMarkup).toMatch(/<input[^>]*(?:value="VISIBLE"[^>]*disabled|disabled[^>]*value="VISIBLE")/);
    expect(privateMarkup).toMatch(/existing RSVP.*separate/i);
  });

  test("wires registration and the existing RSVP editor as separate mutations", () => {
    const screen = source("src/features/tambike-demo/tambike-screen.tsx");
    const provider = source("src/features/tambike-demo/demo-provider.tsx");

    expect(screen).toContain("RosterIdentityField");
    expect(screen).toMatch(/registerForEvent\(event\.id,\s*attendance,\s*"going",\s*rosterIdentity\)/);
    expect(screen).toContain("ExistingRsvpIdentityEditor");
    expect(provider).toContain("updateEventRosterIdentityAction");
    expect(provider).toContain("getEventRosterIdentityAction");
    expect(provider).toContain("getMemberProfileEditorAction");
    expect(provider).not.toMatch(/updateMemberProfileAction\([\s\S]{0,120}updateEventRosterIdentityAction/);
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
