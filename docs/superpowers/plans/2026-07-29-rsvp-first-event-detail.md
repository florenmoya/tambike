# RSVP-First Event Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public event-detail hero immediately understandable by putting compact event essentials, the existing RSVP actions, and eligible attendee bikes into one RSVP-first decision area.

**Architecture:** Keep the existing `EventDetail` client component, server-loaded `EventAttendeePreviewData`, registration handlers, privacy modal, and public roster filtering unchanged. Recompose only the hero markup and its scoped styles: the event introduction occupies the main grid area, the poster becomes a small supporting asset, and `EventAttendeePreview` becomes the compact footer of the RSVP decision card.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, CSS/CSS Modules, Vitest, Codex Browser

## Global Constraints

- Work in the current checkout only. Do not create a branch or worktree.
- Preserve the existing unrelated poster/carousel edits in:
  - `src/features/tambike-demo/tambike-screen.tsx`
  - `src/app/globals.css`
  - `tests/tambike-demo.spec.ts`
  - `tests/server/event-poster-assets-contract.test.ts`
- Before editing, read the installed-version Next.js guidance:
  - `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`
- Use test-driven development: change the narrow existing contract tests first, confirm the intended failure, then implement.
- Extend existing tests; do not add a new test file.
- Do not change Prisma, migrations, server queries, public DTOs, route contracts, RSVP persistence, privacy filtering, or pass/check-in/raffle behavior.
- Do not add dependencies, fonts, icons, routes, poster assets, or animation systems.
- Keep exact approved copy:
  - `I’m going`
  - `Interested`
  - `Share`
  - `Are you joining?`
  - `View all bikes`
  - Existing modal copy: `Show my name and bike in Who’s going.`
- Keep the existing public attendee eligibility rules, profile links, failed-image removal, and four-bike limit.
- Do not run `npm run build`.
- Before browser checks, confirm whether `localhost:3000` is already listening and reuse it. Do not start another dev server.
- Use the Codex Browser surface only for browser verification. Do not run Playwright or `npm run test:e2e`.
- Do not deploy or push.

## File Structure

| Path | Responsibility | Planned change |
| --- | --- | --- |
| `src/features/tambike-demo/tambike-screen.tsx` | Public event-detail composition and existing RSVP handlers | Reorder only the `EventDetail` hero into introduction, decision, and poster grid areas; update visible action copy and image sizes |
| `src/app/globals.css` | Global event-detail layout and responsive styling | Replace the boxed schedule strip with compact essentials; add decision-card styling; flatten secondary controls; shrink poster; reduce hero-to-content spacing |
| `src/features/member-profiles/event-attendee-preview.tsx` | Public attendee summary and eligible bike links | Change only the roster action copy to `View all bikes`; keep data/state behavior intact |
| `src/features/member-profiles/event-attendee-preview.module.css` | Attendee preview presentation | Remove the second card treatment and lay the preview out as a compact decision-card footer |
| `tests/server/event-attendee-preview-ui.test.tsx` | Rendered attendee-preview behavior | Update exact roster copy expectations while retaining privacy, outage, empty, failed-image, grammar, and live-count coverage |
| `tests/server/event-detail-ui-contract.test.ts` | Source/CSS contract for the event-detail hierarchy | Assert the approved DOM order, exact copy, desktop/mobile grid, compact poster, flat controls, and compact preview CSS |
| `tests/server/event-roster-ui-contract.test.ts` | Existing public roster/privacy regression | Run unchanged |
| `tests/tambike-demo.spec.ts` | Existing browser-flow selectors | Change only four exact `Going` button selectors to `I’m going`; do not run this Playwright suite |

## Interface Boundaries

No interface or data-contract change is expected:

```ts
export interface EventAttendeePreviewProps {
  eventId: string;
  fallbackGoing: number;
  interested: number;
  expected: number;
  preview?: EventAttendeePreviewData;
}
```

`EventDetail` continues to call the component with the same props:

```tsx
<EventAttendeePreview
  eventId={event.id}
  fallbackGoing={event.going}
  interested={event.interested}
  expected={event.expectedRiders}
  preview={attendeePreview}
/>
```

The existing handlers remain authoritative:

- `openRegistration` opens the Going/privacy modal.
- `registerForEvent(event.id, "direct", "interested")` handles Interested.
- `shareEvent()` handles native share/copy and inline feedback.

---

## Task 1: Convert the Attendee Preview into a Compact Decision Footer

**Files:**

- Modify: `src/features/member-profiles/event-attendee-preview.tsx`
- Modify: `src/features/member-profiles/event-attendee-preview.module.css`
- Modify: `tests/server/event-attendee-preview-ui.test.tsx`
- Modify: `tests/server/event-detail-ui-contract.test.ts`

- [ ] **Step 1: Read the installed Next.js component, CSS, and Image guidance**

Run:

```powershell
Get-Content node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
Get-Content node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
Get-Content node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md
```

Expected: all three files exist and confirm that the current client component, CSS Module import, and `next/image` usage remain valid for the installed Next.js version.

- [ ] **Step 2: Update the rendered-copy tests first**

In `tests/server/event-attendee-preview-ui.test.tsx`, replace only the roster-action expectations:

```ts
expect(markup).toContain("View all bikes");
```

```ts
expect(markup).not.toContain("View all bikes");
```

Keep all existing assertions for:

- public rider profile links;
- `15 riders`;
- `15 interested · ~55 expected`;
- roster-disabled behavior;
- outage navigation;
- empty preview guidance;
- failed-image tile removal;
- singular/plural grammar;
- live turnout updates.

- [ ] **Step 3: Add compact-preview CSS expectations to the existing UI contract**

In `tests/server/event-detail-ui-contract.test.ts`, load the CSS Module next to the existing source fixtures:

```ts
const attendeePreviewCss = readFileSync(
  join(
    process.cwd(),
    "src/features/member-profiles/event-attendee-preview.module.css",
  ),
  "utf8",
);
```

Generalize the rule helper so it can inspect either stylesheet:

```ts
function cssRule(
  selector: string,
  fromIndex = 0,
  source = css,
) {
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
```

Update the source-copy assertion and add a focused layout test:

```ts
expect(attendeePreviewSource).toContain("View all bikes");
expect(attendeePreviewSource).not.toContain("See more");
```

```ts
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
  expect(preview).not.toContain("border-radius:");
  expect(preview).not.toContain("background:");
  expect(mobilePreview).toContain('"heading"');
  expect(mobilePreview).toContain('"bikes"');
  expect(mobilePreview).toContain('"action"');
  expect(mobileBikeGrid).toContain(
    "grid-template-columns: repeat(2, minmax(0, 1fr))",
  );
});
```

- [ ] **Step 4: Run the focused tests and confirm the intended red state**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts
```

Expected: failures mention missing `View all bikes` and missing compact preview grid/CSS. Existing privacy and behavior assertions should not fail for unrelated reasons.

- [ ] **Step 5: Change only the roster action copy**

In `src/features/member-profiles/event-attendee-preview.tsx`:

```tsx
<Link className={styles.action} href={`/events/${eventId}/attendees`}>
  View all bikes
</Link>
```

Do not change count selection, `rosterEnabled`, `slice(0, 4)`, failure state, accessible labels, or rider-profile URLs.

- [ ] **Step 6: Replace the outer card with a compact responsive footer**

In `src/features/member-profiles/event-attendee-preview.module.css`, reshape the existing selectors:

```css
.preview {
  display: grid;
  grid-template-areas: "heading bikes action";
  grid-template-columns: minmax(7rem, 0.7fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: 0.85rem;
  margin-top: 1rem;
  padding-top: 1rem;
  overflow: hidden;
  border-top: 1px solid #303237;
}

.heading {
  grid-area: heading;
  display: grid;
  gap: 0.25rem;
}

.riderSummary,
.state {
  grid-area: bikes;
  min-width: 0;
}

.footer {
  grid-area: action;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
```

Retain the existing heading, image, focus, hover, and 44px action styles. Add the mobile layout at 640px so the link remains after the bikes in visual and DOM order:

```css
@media (max-width: 640px) {
  .preview {
    grid-template-areas:
      "heading"
      "bikes"
      "action";
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .bikeGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .footer {
    justify-content: flex-start;
  }
}
```

Remove the old outer `max-width`, padding, full border, radius, and layered background. Remove the now-redundant 430px preview-padding rule, while keeping a two-column bike grid at mobile widths.

- [ ] **Step 7: Run the focused tests again**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts
```

Expected: both files pass.

- [ ] **Step 8: Review and commit only the clean attendee-preview task**

Run:

```powershell
git diff -- src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-preview.module.css tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts
git add src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-preview.module.css tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts
git diff --cached --check
git diff --cached
git commit -m "refactor: compact event attendee preview"
```

Expected: the commit contains only the attendee-preview copy, layout, and matching tests.

---

## Task 2: Recompose the Event Hero Around the RSVP Decision

**Files:**

- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/server/event-detail-ui-contract.test.ts`
- Modify: `tests/tambike-demo.spec.ts`

- [ ] **Step 1: Record the unrelated dirty-file baseline**

Run:

```powershell
git diff -- src/features/tambike-demo/tambike-screen.tsx
git diff -- src/app/globals.css
git diff -- tests/tambike-demo.spec.ts
```

Expected before this task:

- `tambike-screen.tsx` has unrelated carousel/import changes outside `EventDetail`.
- `globals.css` has unrelated carousel styles outside the event-detail block.
- `tests/tambike-demo.spec.ts` has unrelated carousel test changes.

Do not stage or rewrite those baseline hunks.

- [ ] **Step 2: Rewrite the event-detail hierarchy test first**

In `tests/server/event-detail-ui-contract.test.ts`, replace the old brief/poster assumptions with the approved hierarchy:

```ts
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
  expect(screen).toContain('sizes="(max-width: 640px) 72px, 220px"');
  expect(screen).toContain("View full poster");
  expect(screen.match(/<h1(?:\s|>)/g)).toHaveLength(1);

  expect(eventType).toBeLessThan(heading);
  expect(heading).toBeLessThan(description);
  expect(description).toBeLessThan(essentials);
  expect(essentials).toBeLessThan(decision);
  expect(decision).toBeLessThan(actions);
  expect(actions).toBeLessThan(attendeePreview);
  expect(attendeePreview).toBeLessThan(poster);
});
```

Keep the existing poster link assertions for `target="_blank"`, `rel="noreferrer"`, placeholder behavior, preload, and screen-reader copy.

- [ ] **Step 3: Rewrite the scoped CSS contract**

Replace the old poster-first assertions with:

```ts
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
```

Add a flat-control assertion:

```ts
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
```

Retain the existing 44px target and `:focus-visible` tests.

- [ ] **Step 4: Update only the browser-flow selectors affected by visible copy**

In `tests/tambike-demo.spec.ts`, change exactly these four existing selectors:

```ts
page.getByRole("button", { name: /^I’m going$/i })
```

Do not edit the test flow and do not run Playwright.

- [ ] **Step 5: Run the focused contract tests and confirm the intended red state**

Run:

```powershell
npx vitest run tests/server/event-detail-ui-contract.test.ts tests/server/event-attendee-preview-ui.test.tsx
```

Expected: the event-detail contract fails on the missing essentials/decision markup, old poster-first grid, old image sizes, and raised action styling. The attendee-preview tests remain green.

- [ ] **Step 6: Recompose only the `EventDetail` hero markup**

In `src/features/tambike-demo/tambike-screen.tsx`, replace the contents of `.event-detail-stage` with this structure while preserving the existing handlers and feedback:

```tsx
<section className="event-detail-stage">
  <div className="event-detail-copy">
    <span className="event-detail-type">
      {event.type} · {event.date}
    </span>
    <h1>{event.title}</h1>
    <p>{event.shortDescription}</p>

    <div className="event-detail-essentials" aria-label="Event essentials">
      <span>{event.time}</span>
      <span>{event.locationName}</span>
      <span>{event.area}</span>
    </div>
  </div>

  <section
    className="event-detail-decision"
    aria-labelledby="event-rsvp-title"
  >
    <div className="event-detail-decision-heading">
      <span>RSVP</span>
      <h2 id="event-rsvp-title">Are you joining?</h2>
    </div>

    <div className="event-detail-actions">
      {cta.canRegister ? (
        <>
          <button
            className="primary-action"
            type="button"
            onClick={openRegistration}
          >
            I’m going
          </button>
          <button
            className="ghost-action"
            type="button"
            onClick={async () => {
              setActionError("");
              if (requireLogin("Log in to save this event")) {
                try {
                  await registerForEvent(
                    event.id,
                    "direct",
                    "interested",
                  );
                } catch (error) {
                  setActionError(actionErrorMessage(error));
                }
              }
            }}
          >
            Interested
          </button>
        </>
      ) : (
        <span className="status-pill">{cta.label}</span>
      )}
      <button
        className="ghost-action"
        type="button"
        onClick={() => void shareEvent()}
      >
        <Share2 aria-hidden="true" />
        Share
      </button>
    </div>

    {shareFeedback ? (
      <p className="inline-feedback" aria-live="polite">
        {shareFeedback}
      </p>
    ) : null}
    {actionError ? (
      <p className="inline-error" aria-live="polite">
        {actionError}
      </p>
    ) : null}

    <EventAttendeePreview
      eventId={event.id}
      fallbackGoing={event.going}
      interested={event.interested}
      expected={event.expectedRiders}
      preview={attendeePreview}
    />
  </section>

  <div className="event-detail-poster-wrap">
    <figure className="event-detail-poster">
      <Image
        src={poster}
        alt={`${event.title} poster`}
        fill
        placeholder={typeof poster === "string" ? "empty" : "blur"}
        sizes="(max-width: 640px) 72px, 220px"
        preload
      />
    </figure>
    <a
      className="event-detail-poster-link"
      href={event.poster}
      target="_blank"
      rel="noreferrer"
    >
      View full poster{" "}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  </div>
</section>
```

Do not edit the lower `event-detail-sections`, modal, registration methods, or unrelated carousel code.

- [ ] **Step 7: Replace only the event-detail hero styles**

In `src/app/globals.css`, update the event-detail block, leaving unrelated carousel rules untouched.

Use the approved desktop grid:

```css
.event-detail-stage {
  display: grid;
  grid-template-areas:
    "copy poster"
    "decision poster";
  grid-template-columns: minmax(0, 1fr) minmax(200px, 220px);
  align-items: start;
  gap: 1rem clamp(1.5rem, 4vw, 3rem);
}

.event-detail-copy {
  grid-area: copy;
  min-width: 0;
}

.event-detail-decision {
  grid-area: decision;
  min-width: 0;
  padding: clamp(1rem, 2vw, 1.35rem);
  border: 1px solid color-mix(in srgb, var(--event-accent) 52%, #303237);
  border-radius: 0.9rem;
  background: #151417;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.24);
}

.event-detail-poster-wrap {
  grid-area: poster;
  width: 100%;
  max-width: 220px;
  display: grid;
  justify-items: center;
  gap: 0.5rem;
}
```

Turn the event type/date into a utility eyebrow and replace `.event-detail-brief` with:

```css
.event-detail-type {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  color: color-mix(in srgb, var(--event-accent) 82%, #fff);
  font-family: var(--font-geist-mono), monospace;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}

.event-detail-copy h1 {
  max-width: 14ch;
  margin: 0.75rem 0 0.65rem;
  color: #f7f7f5;
  font-family: var(--font-geist-sans), Arial, Helvetica, sans-serif;
  font-size: clamp(2.15rem, 4.5vw, 3rem);
  line-height: 1.02;
  font-weight: 880;
  letter-spacing: -0.035em;
  text-wrap: balance;
}

.event-detail-essentials {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.75rem;
  margin-top: 1rem;
  color: rgba(255, 255, 255, 0.82);
  font-family: var(--font-geist-mono), monospace;
  font-size: 0.78rem;
  line-height: 1.4;
}

.event-detail-essentials span + span::before {
  content: "·";
  margin-right: 0.75rem;
  color: var(--event-accent);
}
```

Add the decision heading:

```css
.event-detail-decision-heading {
  display: grid;
  gap: 0.3rem;
}

.event-detail-decision-heading > span {
  color: var(--event-accent);
  font-family: var(--font-geist-mono), monospace;
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.event-detail-decision-heading h2 {
  margin: 0;
  color: #f7f7f5;
  font-size: clamp(1.25rem, 2.4vw, 1.65rem);
  line-height: 1.15;
}
```

Override the global raised-button treatment only inside the event-detail decision:

```css
.event-detail-actions .primary-action,
.event-detail-actions .ghost-action {
  min-height: 44px;
  border-bottom-width: 1px;
  box-shadow: none;
  transform-style: flat;
  transition:
    transform 150ms ease,
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.event-detail-actions .primary-action {
  border-color: color-mix(in srgb, var(--event-accent) 78%, #fff);
  background: var(--event-accent);
  color: #130d07;
}

.event-detail-actions .ghost-action {
  border-color: #303237;
  background: rgba(255, 255, 255, 0.045);
  color: #f7f7f5;
}

.event-detail-actions .primary-action:hover,
.event-detail-actions .primary-action:focus-visible,
.event-detail-actions .ghost-action:hover,
.event-detail-actions .ghost-action:focus-visible {
  transform: translateY(-1px);
  filter: none;
}

.event-detail-actions .primary-action:active,
.event-detail-actions .ghost-action:active {
  transform: translateY(0);
  box-shadow: none;
}
```

Reduce the poster’s decorative weight and the gap before lower content:

```css
.event-detail-poster {
  border-color: #303237;
  border-radius: 0.75rem;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24);
}

.event-detail-sections {
  margin: clamp(1.75rem, 3vw, 2.75rem) auto 0;
}
```

- [ ] **Step 8: Add the approved mobile grid and action wrapping**

Inside the existing event-detail `@media (max-width: 640px)` block:

```css
.event-detail-stage {
  grid-template-areas:
    "copy poster"
    "decision decision";
  grid-template-columns: minmax(0, 1fr) 72px;
  gap: 1rem 0.75rem;
}

.event-detail-poster-wrap {
  width: 72px;
  max-width: 72px;
}

.event-detail-poster-link {
  min-height: 44px;
  padding: 0;
  font-size: 0.68rem;
  line-height: 1.25;
  text-align: center;
}

.event-detail-essentials {
  display: grid;
  gap: 0.25rem;
}

.event-detail-essentials span + span::before {
  content: none;
}

.event-detail-sections {
  margin-top: 1.75rem;
}
```

Keep the existing 430px action wrapping, which gives the first two controls half width and Share full width. Confirm all three remain at least 44px tall.

- [ ] **Step 9: Run focused automated verification**

Run:

```powershell
npx vitest run tests/server/event-detail-ui-contract.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-roster-ui-contract.test.ts
npx eslint src/features/tambike-demo/tambike-screen.tsx src/features/member-profiles/event-attendee-preview.tsx tests/server/event-detail-ui-contract.test.ts tests/server/event-attendee-preview-ui.test.tsx
npx tsc --noEmit
```

Expected:

- Focused event-detail, attendee-preview, and roster/privacy tests pass.
- Touched files pass lint.
- TypeScript passes, or an unrelated pre-existing failure is recorded with its exact path and diagnostic. Do not edit an unrelated file merely to clear a baseline failure.

- [ ] **Step 10: Run the complete server test suite**

Run:

```powershell
npm run test:server
```

Expected: all server tests pass. If an unrelated concurrent test fails, record the exact test and prove the focused event tests still pass.

- [ ] **Step 11: Verify the live page with Codex Browser**

First check for the existing server without starting one:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

Expected: an existing listener is present. Reuse `http://localhost:3000/events/tambike-cafe-classico`.

With Codex Browser, verify at approximately `1440 × 900` and `430 × 932`:

- event title, time, venue, area, and `I’m going` are visible in the first screen;
- title stays within two lines;
- poster is a 200–220px supporting asset on desktop and about 72px on mobile;
- desktop uses four bike thumbnails in one row when four eligible bikes exist;
- mobile uses two bike columns;
- `View all bikes` opens `/events/tambike-cafe-classico/attendees`;
- `I’m going` opens the existing modal;
- the modal still contains `Show my name and bike in Who’s going.`;
- Interested retains its current behavior;
- Share retains its current feedback;
- Tab focus is visible on all actions and bike/profile links;
- `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
- browser console contains no new errors.

Do not use Playwright as a browser fallback.

- [ ] **Step 12: Review the dirty files and stage only RSVP-first hunks**

Run:

```powershell
git diff --check
git diff -- src/features/tambike-demo/tambike-screen.tsx src/app/globals.css tests/server/event-detail-ui-contract.test.ts tests/tambike-demo.spec.ts
```

Use partial staging for the three files that already contained unrelated work:

```powershell
git add -p src/features/tambike-demo/tambike-screen.tsx
git add -p src/app/globals.css
git add tests/server/event-detail-ui-contract.test.ts
git add -p tests/tambike-demo.spec.ts
git diff --cached --check
git diff --cached
```

Accept only:

- the `EventDetail` markup hunk;
- event-detail CSS hunks;
- the four `I’m going` selector changes;
- the event-detail contract-test changes.

Reject every carousel/poster/import hunk.

- [ ] **Step 13: Commit the scoped hero redesign**

Run:

```powershell
git commit -m "refactor: make event detail RSVP-first"
git status --short
```

Expected: the RSVP-first change is committed, while the user’s unrelated poster/carousel work remains in the working tree unchanged.

## Final Acceptance Checklist

- [ ] The first screen makes the event, time, place, and RSVP choice obvious.
- [ ] `I’m going` is the only strongly emphasized action.
- [ ] `Interested` and `Share` are flat neutral controls.
- [ ] The poster supports the event identity without dominating the decision.
- [ ] The boxed Date/Time/Location strip is gone.
- [ ] Attendee turnout and up to four eligible uploaded bikes sit inside the decision card.
- [ ] The roster action reads `View all bikes`.
- [ ] No portrait or initials fallback appears.
- [ ] Roster-disabled, unavailable, empty, and image-failure states do not leave an empty inner card.
- [ ] The Going modal’s per-event privacy option is unchanged.
- [ ] Desktop and mobile have no horizontal overflow.
- [ ] Focus-visible and 44px control requirements hold.
- [ ] Existing RSVP, Interested, Share, roster, privacy, pass, check-in, and raffle behavior is unchanged.
- [ ] No build, Playwright run, dev-server duplication, deploy, or push occurred.
