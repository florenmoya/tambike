import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const screenSource = readFileSync(
  join(process.cwd(), "src/features/tambike-demo/tambike-screen.tsx"),
  "utf8",
);
const css = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function componentSource(componentName: string) {
  const start = screenSource.indexOf(`function ${componentName}(`);
  const nextComponent = screenSource.indexOf("\nfunction ", start + 1);

  expect(start).toBeGreaterThanOrEqual(0);

  return screenSource.slice(
    start,
    nextComponent === -1 ? undefined : nextComponent,
  );
}

describe("event detail decision-first UI contract", () => {
  test("puts the event brief before actions and removes poster-led decoration", () => {
    const screen = componentSource("EventDetail");

    expect(screen).toContain('className="event-detail-brief"');
    expect(screen).toContain('className="event-detail-poster-link"');
    expect(screen).toContain('target="_blank"');
    expect(screen).toContain('rel="noreferrer"');
    expect(screen).toContain(
      'placeholder={typeof poster === "string" ? "empty" : "blur"}',
    );
    expect(screen).toContain(
      'sizes="(max-width: 640px) 280px, (max-width: 1024px) 34vw, 360px"',
    );
    expect(screen).toContain("preload");
    expect(screen).toContain("View full poster");
    expect(screen).not.toContain("event-detail-poster-stack");
    expect(screen).not.toContain("event-detail-route-line");

    expect(screen.indexOf('className="event-detail-type"')).toBeLessThan(
      screen.indexOf("<h1>"),
    );
    expect(screen.indexOf("<h1>")).toBeLessThan(
      screen.indexOf("{event.shortDescription}"),
    );
    expect(screen.indexOf('className="event-detail-brief"')).toBeLessThan(
      screen.indexOf('className="event-detail-actions"'),
    );
  });

  test("keeps venue and attendance decisions ahead of rules and organizer", () => {
    const screen = componentSource("EventDetail");
    const venue = screen.indexOf('eyebrow="Venue"');
    const attendance = screen.indexOf('eyebrow="Perk and attendance"');
    const rules = screen.indexOf('eyebrow="Rules"');
    const organizer = screen.indexOf('eyebrow="Organizer"');

    expect(screen.indexOf('eyebrow="What to expect"')).toBeGreaterThanOrEqual(
      0,
    );
    expect(screen).not.toContain('className="event-detail-tags"');
    expect(venue).toBeGreaterThanOrEqual(0);
    expect(attendance).toBeGreaterThanOrEqual(0);
    expect(rules).toBeGreaterThanOrEqual(0);
    expect(organizer).toBeGreaterThanOrEqual(0);
    expect(venue).toBeLessThan(rules);
    expect(venue).toBeLessThan(organizer);
    expect(attendance).toBeLessThan(rules);
    expect(attendance).toBeLessThan(organizer);
    expect(screen).toContain("View attendee roster");
  });

  test("uses a compact responsive poster and readable title system", () => {
    expect(css).toMatch(
      /\.event-detail-stage\s*\{[\s\S]*grid-template-areas:/,
    );
    expect(css).toMatch(
      /\.event-detail-poster\s*\{[\s\S]*aspect-ratio:\s*1/,
    );
    expect(css).toMatch(
      /\.event-detail-poster img\s*\{[\s\S]*object-fit:\s*contain/,
    );
    expect(css).toMatch(
      /\.event-detail-copy h1\s*\{[\s\S]*clamp\(2rem,/,
    );
    expect(css).toContain("max-width: 280px");
    expect(css).toContain("min-height: 44px");
  });
});
