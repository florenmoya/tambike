import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { filterEventsByQuery, getEventCtaState } from "../../src/features/tambike-demo/event-state";
import type { Event } from "../../src/features/tambike-demo/types";

const organizerSource = readFileSync(
  resolve(process.cwd(), "src/features/organizer/organizer-console.tsx"),
  "utf8",
);
const adminSource = readFileSync(resolve(process.cwd(), "src/features/admin/admin-console.tsx"), "utf8");
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
  test("uses direct organizer-to-admin review copy and searches frozen location fields", () => {
    expect(getEventCtaState(locationEvent, new Date("2026-07-15T00:00:00.000Z"))).toMatchObject({
      label: "Under review",
      body: "This event is still moving through organizer and admin review.",
    });
    expect(filterEventsByQuery([locationEvent], { q: "Shell Pugon" })).toEqual([locationEvent]);
    expect(filterEventsByQuery([locationEvent], { q: "Ortigas Avenue" })).toEqual([locationEvent]);
  });

  test("uses organizer-defined location inputs and event-detail essentials styling", () => {
    expect(organizerSource).toContain('name="locationName"');
    expect(organizerSource).toContain('name="locationAddress"');
    expect(organizerSource).toContain('name="locationMapLink"');
    expect(organizerSource).toContain('name="area"');
    expect(organizerSource).toContain("EVENT_LOCATION_LIMITS");
    expect(organizerSource).not.toContain('name="venueId"');
    expect(adminSource).toContain("event.locationName");
    expect(adminSource).toContain("event.locationAddress");
    expect(screenSource).toContain("event-detail-essentials");
    expect(stylesSource).toContain(".event-detail-essentials");
    expect(stylesSource).not.toContain(".event-detail-venue-card");
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
