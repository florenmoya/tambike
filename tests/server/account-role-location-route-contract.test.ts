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
});
