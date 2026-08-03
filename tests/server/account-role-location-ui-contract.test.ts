import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  eventPublicSummary,
  filterEventsByQuery,
  getEventCtaState,
} from "../../src/features/tambike-demo/event-state";
import type { Event } from "../../src/features/tambike-demo/types";

const eventEditorSource = readFileSync(
  resolve(process.cwd(), "src/features/organizer/event-editor-fields.tsx"),
  "utf8",
);
const adminSource = readFileSync(resolve(process.cwd(), "src/features/admin/admin-console.tsx"), "utf8");
const adminReviewSource = readFileSync(
  resolve(process.cwd(), "src/features/admin/event-review-controls.tsx"),
  "utf8",
);
const screenSource = readFileSync(
  resolve(process.cwd(), "src/features/tambike-demo/tambike-screen.tsx"),
  "utf8",
);
const stylesSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

const locationEvent = {
  id: "location-search",
  title: "Night Ride",
  type: "Bike Night",
  status: "PENDING_ADMIN_REVIEW",
  organizerId: "user-marco-organizer-profile",
  locationName: "Shell Pugon",
  locationAddress: "Ortigas Avenue Extension, Antipolo",
  locationMapLink: "https://maps.example.test/shell-pugon",
  area: "Antipolo",
  poster: "/event.jpg",
  date: "December 31, 2099",
  time: "7:00 PM",
  shortDescription: "A night ride.",
  whatHappens: "Meet and ride.",
  going: 0,
  interested: 0,
  expectedRiders: 20,
  perkPreview: "Sticker",
  tags: ["night"],
  riskFlags: [],
  rules: [],
  perks: [],
} as Event;

describe("account and event-location UI contracts", () => {
  test("does not keep pending-review copy after an event is published", async () => {
    const adminConsole = await import(
      "../../src/features/admin/admin-console"
    ) as unknown as {
      adminEventReviewSummary?: (
        event: Event,
        state: { isDisabled: boolean; isPublished: boolean },
      ) => string;
    };

    expect(adminConsole.adminEventReviewSummary).toBeTypeOf("function");
    expect(adminConsole.adminEventReviewSummary!(
      {
        ...locationEvent,
        status: "PUBLISHED",
        shortDescription: "Night Ride is awaiting admin review.",
      },
      { isDisabled: false, isPublished: true },
    )).toBe("Night Ride is published and visible to riders.");
  });

  test("does not show pending-review copy on a published public event page", () => {
    expect(eventPublicSummary({
      ...locationEvent,
      status: "PUBLISHED",
      shortDescription: "Night Ride is awaiting admin review.",
    })).toBe("Night Ride is published and open for rider registration.");
  });

  test("uses direct organizer-to-admin review copy and searches frozen location fields", () => {
    expect(getEventCtaState(locationEvent, new Date("2026-07-15T00:00:00.000Z"))).toMatchObject({
      label: "Under review",
      body: "This event is still moving through organizer and admin review.",
    });
    expect(filterEventsByQuery([locationEvent], { q: "Shell Pugon" })).toEqual([locationEvent]);
    expect(filterEventsByQuery([locationEvent], { q: "Ortigas Avenue" })).toEqual([locationEvent]);
  });

  test("uses organizer-defined location inputs and the event-detail Venue and perk structure", () => {
    expect(eventEditorSource).toContain('inputProps("locationName")');
    expect(eventEditorSource).toContain('inputProps("locationAddress")');
    expect(eventEditorSource).toContain('inputProps("locationMapLink")');
    expect(eventEditorSource).toContain('inputProps("area")');
    expect(eventEditorSource).toContain("EVENT_LOCATION_LIMITS");
    expect(eventEditorSource).not.toContain('inputProps("venueId")');
    expect(adminSource).toContain("event.locationName");
    expect(adminReviewSource).toContain("view.event.locationAddress");
    expect(screenSource).toContain('className="event-detail-perk"');
    expect(screenSource).toContain('eyebrow="Venue"');
    expect(screenSource).toContain("event-detail-essentials");
    expect(stylesSource).toContain(".event-detail-perk");
    expect(stylesSource).toContain(".event-detail-essentials");
    expect(stylesSource).not.toContain(".event-detail-venue-card");
  });

  test("keeps authentication actions available inside the mobile navigation menu", () => {
    expect(screenSource).toContain('className="mobile-nav-session"');
    expect(screenSource).toContain('aria-label="Mobile log out"');
    expect(screenSource).toContain('href="/login"');
    expect(screenSource).toContain('href="/signup"');
    expect(stylesSource).toContain(".mobile-nav-session");
  });

  test("wires the header search control to the event query route", () => {
    expect(screenSource).toContain('role="search"');
    expect(screenSource).toContain('aria-label="Search events"');
    expect(screenSource).toContain('router.push(normalizedQuery');
    expect(stylesSource).toContain(".header-search-popover");
  });

  test("keeps the legacy screen renderer to public and rider-only variants", () => {
    const tambikeViewDefinition = screenSource.match(/export type TambikeView =([\s\S]*?);/);
    const renderedVariants = tambikeViewDefinition?.[1]
      .match(/"[^"]+"/g)
      ?.map((variant) => variant.slice(1, -1));

    expect(renderedVariants).toEqual([
      "discovery",
      "events",
      "event-detail",
      "passes",
      "pass-detail",
      "login",
      "signup",
      "profile",
      "profile-preview",
      "event-register",
      "event-test-ride",
    ]);
    for (const dormantSurface of [
      "ScannerScreen",
      "AdminEventReview",
      "ReportScreen",
      "ReportsIndexScreen",
      "OrganizerEventStatus",
      "OrganizerDashboard",
      "AdminDashboard",
      "OrganizerEventsScreen",
      "AdminLeadsScreen",
      "AdminModerationScreen",
      "AdminUsersScreen",
      "CreateEventScreen",
      "AttendeesScreen",
      "OrganizerApplyScreen",
      "RoleGuard",
      "AdminQueue",
      "AdminEventReviews",
      "FormPrototype",
      "organizer-apply",
      "Host an Event",
      "Apply to host events later.",
    ]) {
      expect(screenSource).not.toContain(dormantSurface);
    }
    expect(stylesSource).not.toContain(".order-venue");
  });
});
