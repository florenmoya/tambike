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
const attendeePreviewSource = readFileSync(
  join(
    process.cwd(),
    "src/features/member-profiles/event-attendee-preview.tsx",
  ),
  "utf8",
);
const attendeePreviewCss = readFileSync(
  join(
    process.cwd(),
    "src/features/member-profiles/event-attendee-preview.module.css",
  ),
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

function cssRule(selector: string, fromIndex = 0, source = css) {
  const start = source.indexOf(`${selector} {`, fromIndex);

  expect(start, `CSS rule not found: ${selector}`).toBeGreaterThanOrEqual(0);

  const openingBrace = source.indexOf("{", start + selector.length);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`CSS rule is not closed: ${selector}`);
}

function sourceIndex(source: string, token: string, fromIndex = 0) {
  const index = source.indexOf(token, fromIndex);

  expect(index, `Source token not found: ${token}`).toBeGreaterThanOrEqual(0);

  return index;
}

describe("event detail decision-first UI contract", () => {
  test("renders an RSVP-first hero and an accessible supporting poster", () => {
    const screen = componentSource("EventDetail");
    const eventType = sourceIndex(screen, 'className="event-detail-type"');
    const heading = sourceIndex(screen, "<h1>");
    const description = sourceIndex(screen, "{event.shortDescription}");
    const essentials = sourceIndex(
      screen,
      'className="event-detail-essentials"',
    );
    const decision = sourceIndex(
      screen,
      'className="event-detail-decision"',
    );
    const actions = sourceIndex(screen, 'className="event-detail-actions"');
    const attendeePreview = sourceIndex(screen, "<EventAttendeePreview");
    const poster = sourceIndex(screen, 'className="event-detail-poster-wrap"');

    expect(screen).toContain("{event.type} · {event.date}");
    expect(screen).toContain('aria-label="Event essentials"');
    expect(screen).toContain('id="event-rsvp-title"');
    expect(screen).toContain("Are you joining?");
    expect(screen).toContain("I’m going");
    expect(screen).not.toContain('className="event-detail-brief"');
    expect(screen).toContain('className="event-detail-poster-link"');
    expect(screen).toContain('target="_blank"');
    expect(screen).toContain('rel="noreferrer"');
    expect(screen).toContain(
      'placeholder={typeof poster === "string" ? "empty" : "blur"}',
    );
    expect(screen).toContain(
      'sizes="(max-width: 640px) 72px, 220px"',
    );
    expect(screen).toContain("preload");
    expect(screen).toContain("View full poster");
    expect(screen).toContain(
      '<span className="sr-only">(opens in a new tab)</span>',
    );
    expect(screen).not.toContain("event-detail-poster-stack");
    expect(screen).not.toContain("event-detail-route-line");
    expect(screen.match(/<h1(?:\s|>)/g)).toHaveLength(1);

    expect(eventType).toBeLessThan(heading);
    expect(heading).toBeLessThan(description);
    expect(description).toBeLessThan(essentials);
    expect(essentials).toBeLessThan(decision);
    expect(decision).toBeLessThan(actions);
    expect(actions).toBeLessThan(attendeePreview);
    expect(attendeePreview).toBeLessThan(poster);
  });

  test("keeps social proof near the decision and treats the perk as supporting context", () => {
    const screen = componentSource("EventDetail");
    const actions = sourceIndex(screen, 'className="event-detail-actions"');
    const attendeePreview = sourceIndex(screen, "<EventAttendeePreview");
    const poster = sourceIndex(screen, 'className="event-detail-poster-wrap"');
    const whatToExpect = sourceIndex(screen, 'eyebrow="What to expect"');
    const perk = sourceIndex(screen, 'className="event-detail-perk"');
    const venue = sourceIndex(screen, 'eyebrow="Venue"');
    const rideMeetup = sourceIndex(screen, 'eyebrow="Ride / meetup"');
    const rules = sourceIndex(screen, 'eyebrow="Rules"');
    const organizer = sourceIndex(screen, 'eyebrow="Organizer"');
    const giveaways = sourceIndex(screen, "<PublicGiveawayPanel");

    expect(screen).not.toContain('className="event-detail-tags"');
    expect(actions).toBeLessThan(attendeePreview);
    expect(attendeePreview).toBeLessThan(poster);
    expect(poster).toBeLessThan(whatToExpect);
    expect(whatToExpect).toBeLessThan(perk);
    expect(perk).toBeLessThan(venue);
    expect(venue).toBeLessThan(rideMeetup);
    expect(rideMeetup).toBeLessThan(rules);
    expect(rules).toBeLessThan(organizer);
    expect(organizer).toBeLessThan(giveaways);
    expect(screen).toContain("{event.perkPreview}");
    expect(screen).not.toContain('eyebrow="Perk and attendance"');
    expect(screen).not.toContain('className="event-detail-pass-stats"');
    expect(screen).not.toContain("View attendee roster");
  });

  test("loads attendee preview data at the event route server boundary", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/events/[eventId]/page.tsx"),
      "utf8",
    );

    expect(route).toContain("loadEventAttendeePreview");
    expect(route).toContain("attendeePreview={attendeePreview}");
    expect(route).not.toContain('"use client"');
  });

  test("keeps the attendee preview to public bike grid and roster action", () => {
    expect(attendeePreviewSource).toContain("styles.bikeGrid");
    expect(attendeePreviewSource).toContain("styles.bikeTile");
    expect(attendeePreviewSource).toContain("rider.bikePhoto.url");
    expect(attendeePreviewSource).toContain('href={`/riders/${rider.slug}`}');
    expect(attendeePreviewSource).toContain("View all bikes");
    expect(attendeePreviewSource).not.toContain("See more");
    expect(attendeePreviewSource).not.toContain("styles.names");
    expect(attendeePreviewSource).not.toContain("Log in to see riders");
    expect(attendeePreviewSource).not.toContain("rider.profilePhoto");
    expect(attendeePreviewSource).not.toMatch(/email|userId|verification|make|model/);
  });

  test("treats the attendee preview as a compact footer instead of a second card", () => {
    const preview = cssRule(".preview", 0, attendeePreviewCss);
    const mobile = sourceIndex(
      attendeePreviewCss,
      "@media (max-width: 640px)",
    );
    const mobilePreview = cssRule(".preview", mobile, attendeePreviewCss);
    const mobileBikeGrid = cssRule(".bikeGrid", mobile, attendeePreviewCss);

    expect(preview).toContain(
      'grid-template-areas: "heading bikes action"',
    );
    expect(preview).toContain("border-top:");
    expect(preview).not.toContain("overflow: hidden");
    expect(preview).not.toContain("border-radius:");
    expect(preview).not.toContain("background:");
    expect(mobilePreview).toContain('"heading"');
    expect(mobilePreview).toContain('"bikes"');
    expect(mobilePreview).toContain('"action"');
    expect(mobileBikeGrid).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
    );
  });

  test("uses an RSVP-first desktop grid and compact mobile poster", () => {
    const stage = cssRule(".event-detail-stage");
    const decision = cssRule(".event-detail-decision");
    const posterWrap = cssRule(".event-detail-poster-wrap");
    const poster = cssRule(".event-detail-poster");
    const posterImage = cssRule(".event-detail-poster img");
    const heading = cssRule(".event-detail-copy h1");
    const eventDetailStyles = sourceIndex(css, ".event-detail-stage");
    const mobile = sourceIndex(
      css,
      "@media (max-width: 640px)",
      eventDetailStyles,
    );
    const mobileStage = cssRule(".event-detail-stage", mobile);
    const mobilePoster = cssRule(".event-detail-poster-wrap", mobile);

    expect(stage).toContain('"copy poster"');
    expect(stage).toContain('"decision poster"');
    expect(stage).toContain("minmax(200px, 220px)");
    expect(decision).toContain("grid-area: decision");
    expect(posterWrap).toContain("max-width: 220px");
    expect(poster).toContain("aspect-ratio: 1");
    expect(posterImage).toContain("object-fit: contain");
    expect(heading).toContain("max-width: 14ch");
    expect(heading).toContain(
      "font-size: clamp(2.15rem, 4.5vw, 3rem)",
    );
    expect(mobileStage).toContain('"copy poster"');
    expect(mobileStage).toContain('"decision decision"');
    expect(mobileStage).toContain("72px");
    expect(mobilePoster).toContain("width: 72px");
  });

  test("keeps the primary decision clear and secondary event actions flat", () => {
    const controls = cssRule(
      [
        ".event-detail-actions .primary-action,",
        ".event-detail-actions .ghost-action",
      ].join("\n"),
    );
    const primary = cssRule(".event-detail-actions .primary-action");
    const secondary = cssRule(".event-detail-actions .ghost-action");

    expect(controls).toContain("min-height: 44px");
    expect(controls).toContain("box-shadow: none");
    expect(controls).toContain("border-bottom-width: 1px");
    expect(primary).toContain("background: var(--event-accent)");
    expect(secondary).toContain("background: rgba(255, 255, 255, 0.045)");
    expect(controls).not.toContain("border-bottom: 4px");
  });

  test("keeps every event action target at least 44px tall", () => {
    const targetRule = cssRule(
      [
        ".event-detail-actions button,",
        ".event-detail-actions a,",
        ".event-detail-map-link,",
        ".event-detail-poster-link",
      ].join("\n"),
    );

    expect(targetRule).toContain("min-height: 44px");
  });

  test("provides event-detail-scoped keyboard focus outlines", () => {
    const focusRule = cssRule(
      [
        ".event-detail-actions .primary-action:focus-visible,",
        ".event-detail-actions .ghost-action:focus-visible,",
        ".event-detail-map-link:focus-visible",
      ].join("\n"),
    );

    expect(focusRule).toContain("outline: 2px solid");
    expect(focusRule).toContain("outline-offset: 2px");
  });

  test("removes event-detail and attendee-bike motion when reduced motion is requested", () => {
    const attendeeReducedMotion = sourceIndex(
      attendeePreviewCss,
      "@media (prefers-reduced-motion: reduce)",
    );
    const actionMotion = cssRule(
      [
        ":global(.event-detail-actions .primary-action),",
        ":global(.event-detail-actions .ghost-action)",
      ].join("\n  "),
      attendeeReducedMotion,
      attendeePreviewCss,
    );
    const actionHoverMotion = cssRule(
      [
        ":global(.event-detail-actions .primary-action:hover),",
        ":global(.event-detail-actions .primary-action:focus-visible),",
        ":global(.event-detail-actions .primary-action:active),",
        ":global(.event-detail-actions .ghost-action:hover),",
        ":global(.event-detail-actions .ghost-action:focus-visible),",
        ":global(.event-detail-actions .ghost-action:active)",
      ].join("\n  "),
      attendeeReducedMotion,
      attendeePreviewCss,
    );
    const bikeImageMotion = cssRule(
      ".bikeTile img",
      attendeeReducedMotion,
      attendeePreviewCss,
    );
    const bikeHoverMotion = cssRule(
      ".bikeTile:hover img",
      attendeeReducedMotion,
      attendeePreviewCss,
    );

    expect(actionMotion).toContain("transition: none");
    expect(actionHoverMotion).toContain("transform: none");
    expect(bikeImageMotion).toContain("transition: none");
    expect(bikeHoverMotion).toContain("transform: none");
  });
});
