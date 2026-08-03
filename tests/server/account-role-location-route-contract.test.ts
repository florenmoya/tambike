import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const removedPaths = [
  "src/app/venue/dashboard/page.tsx",
  "src/app/venue/requests/page.tsx",
  "src/app/venue/requests/[requestId]/page.tsx",
  "src/app/venue/events/page.tsx",
  "src/app/venue/events/[eventId]/page.tsx",
  "src/app/venue/events/[eventId]/checkin/page.tsx",
  "src/app/venue/events/[eventId]/giveaways/page.tsx",
  "src/app/venue/events/[eventId]/report/page.tsx",
  "src/app/venue/reports/page.tsx",
  "src/features/venue/venue-console.tsx",
  "src/features/giveaways/venue-giveaway-queue.tsx",
  "src/app/organizer/apply/page.tsx",
  "src/app/admin/verifications/organizers/page.tsx",
  "src/app/admin/verifications/organizers/[organizerId]/page.tsx",
] as const;

const activeSourcePaths = [
  "src/components/app-sidebar.tsx",
  "src/components/site-header.tsx",
  "src/features/admin/admin-console.tsx",
  "src/features/organizer/organizer-console.tsx",
  "src/features/tambike-demo/tambike-screen.tsx",
  "src/features/giveaways/giveaway-operator-workspace.tsx",
] as const;

const eventOperatorRoutes = [
  "src/app/admin/events/review/[reviewId]/page.tsx",
  "src/app/organizer/events/[eventId]/page.tsx",
] as const;

describe("account role and location route contract", () => {
  test("removes venue, organizer-application, and organizer-verification route modules", () => {
    for (const path of removedPaths) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false);
    }
  });

  test("removes links and imports for deleted venue and second-organizer surfaces", () => {
    const activeSource = activeSourcePaths
      .map((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
      .join("\n");

    expect(activeSource).not.toMatch(/\/venue\//);
    expect(activeSource).not.toMatch(/\/organizer\/apply/);
    expect(activeSource).not.toMatch(/\/admin\/verifications\/organizers/);
    expect(activeSource).not.toMatch(/\bVenueConsole\b/);
    expect(activeSource).not.toMatch(/\bVenueGiveawayQueue\b/);
    expect(activeSource).not.toMatch(/\borganizer-apply\b/);
    expect(activeSource).not.toMatch(/\badmin-organizers\b/);
    expect(activeSource).not.toMatch(/\bapproveVenueWithConditions\b/);
  });

  test("loads database-driven operator event pages without demo static params", () => {
    const [adminRoute, organizerRoute] = eventOperatorRoutes.map((path) =>
      readFileSync(resolve(process.cwd(), path), "utf8"),
    );

    expect(adminRoute).toContain("loadAdminEventReviewForPage");
    expect(adminRoute).toContain("await props.params");
    expect(adminRoute).toContain("eventReviewContent");
    expect(adminRoute).toContain("generateMetadata");
    expect(adminRoute).not.toContain("generateStaticParams");
    expect(adminRoute).not.toContain("adminApproval");

    expect(organizerRoute).toContain("loadOrganizerEventSubmissionForPage");
    expect(organizerRoute).toContain("await props.params");
    expect(organizerRoute).toContain("submissionContent");
    expect(organizerRoute).toContain("generateMetadata");
    expect(organizerRoute).not.toContain("generateStaticParams");
    expect(organizerRoute).not.toContain("demoEvents");
  });

  test("loads an owner-only rejected-event copy from awaited search params", () => {
    const createRoute = readFileSync(
      resolve(process.cwd(), "src/app/organizer/events/create/page.tsx"),
      "utf8",
    );

    expect(createRoute).toContain("await props.searchParams");
    expect(createRoute).toContain("loadRejectedEventCopySource");
    expect(createRoute).toContain("copyDefaults");
    expect(createRoute).not.toContain("demoEvents");
  });
});
