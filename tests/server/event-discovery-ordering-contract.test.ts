import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/features/tambike-demo/tambike-screen.tsx",
  ),
  "utf8",
);

describe("public event discovery ordering contract", () => {
  test("sorts public events by their relevant schedule before filtering and featuring", () => {
    expect(source).toContain(
      'import { sortEventsBySchedule } from "./event-schedule"',
    );
    expect(source).toMatch(
      /const publicEvents = sortEventsBySchedule\(\s*events\.filter\([\s\S]*?\),\s*\)/,
    );

    const publicEventsIndex = source.indexOf(
      "const publicEvents = sortEventsBySchedule",
    );
    const visibleEventsIndex = source.indexOf(
      "const visibleEvents = filterEventsByQuery",
      publicEventsIndex,
    );
    const featuredEventsIndex = source.indexOf(
      "const featuredEvents = getFeaturedEvents(publicEvents)",
      publicEventsIndex,
    );
    expect(publicEventsIndex).toBeGreaterThan(-1);
    expect(visibleEventsIndex).toBeGreaterThan(publicEventsIndex);
    expect(featuredEventsIndex).toBeGreaterThan(publicEventsIndex);
  });
});
