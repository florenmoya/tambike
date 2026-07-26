# Attendee Page User-Needs Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/events/[eventId]/attendees` feel like a clear continuation of the Tambike event journey by showing only the event context, one Going total, and useful visible-rider cards.

**Architecture:** Keep the existing server route, roster DTO, privacy checks, pagination, and CloudFront-backed `/media/{mediaId}` delivery unchanged. Reshape only the public `EventAttendeeRoster` markup and its scoped global CSS: replace the oversized policy-heavy hero with a compact back link, “Who’s going” heading, and aggregate turnout; simplify public state copy; retain the separate organizer totals rendered by `OrganizerRosterPanelSurface`.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Lucide icons, shadcn-style Card/Button components, global CSS, Vitest server-rendered UI contract tests, Codex in-app browser.

## Global Constraints

- Work directly on `main`; never create an AI/Codex branch or worktree.
- Before editing, read `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`; this repository’s installed Next.js documentation is authoritative.
- Keep this presentation-only: no schema, DTO, action, authorization, privacy, pagination, or media-delivery changes.
- Show only what riders need on the public page; do not expose roster policy, hidden-profile accounting, or organizer implementation details.
- Preserve organizer-only Going, Visible, and Anonymous totals.
- Keep member-media images on their existing opaque `/media/{mediaId}` URLs with `unoptimized`; do not bypass the authorized CloudFront redirect flow.
- Keep all images bounded by their cards and viewport, with no horizontal overflow at 390×844.
- Reuse an existing dev server when available. For browser checks, use only the Codex in-app browser.
- Preserve unrelated local changes and do not “fix” unrelated time-sensitive test fixtures as part of this redesign.

## File Responsibility Map

- `tests/server/event-roster-ui-contract.test.ts` — executable public-copy, public-data, state, organizer-total, and CSS selector contracts.
- `src/features/member-profiles/event-attendee-roster.tsx` — public header, rider-list states, cards, and pagination presentation.
- `src/features/member-profiles/organizer-roster-panel.tsx` — organizer-only totals; expected to remain functionally unchanged.
- `src/app/globals.css` — attendee-page layout, compact header, responsive containment, rider-card focus, and image sizing.
- `src/app/events/[eventId]/attendees/page.tsx` — server loading and route boundary; verify unchanged.
- `docs/superpowers/specs/2026-07-26-attendee-page-user-needs-design.md` — approved product and content source of truth.

---

### Task 1: Lock the rider-facing content contract

**Files:**
- Modify: `tests/server/event-roster-ui-contract.test.ts:96-171`
- Modify: `src/features/member-profiles/event-attendee-roster.tsx:1-220`
- Verify unchanged: `src/features/member-profiles/organizer-roster-panel.tsx:74-128`

**Interfaces:**
- Preserves: `EventAttendeeRoster({ initialPage, signedIn, loadPage? })`
- Preserves: `EventAttendeeRosterPage` and every summary count
- Public output adds: event back link, “Who’s going”, and `{goingCount} going`
- Public output removes: policy copy and Visible/Anonymous breakdowns

- [ ] **Step 1: Replace the old public-header assertions with the approved contract**

Update the rendered-markup test so it proves:

```ts
expect(markup).toContain('href="/events/ride-1"');
expect(markup).toContain("Marilaque Dawn Roll");
expect(markup).toContain("Who’s going");
expect(markup).toContain("5 going");
expect(markup.indexOf("5 going")).toBeLessThan(markup.indexOf("Mika Santos"));

expect(markup).not.toContain("Ride roll-call");
expect(markup).not.toContain(
  "Attendance choices belong to each rider. Private and unpublished profiles stay anonymous.",
);
expect(markup).not.toContain("Visible riders");
expect(markup).not.toContain("Anonymous riders");
```

Keep the existing assertions for Mika’s profile link, avatar URL, motorcycle URL, make/model, direct `/media` rendering, and the absence of private identifiers.

- [ ] **Step 2: Update the state and organizer assertions**

For public states, assert:

```ts
expect(disabledMarkup).toContain("The rider list isn’t available for this event.");
expect(disabledMarkup).not.toMatch(/counts only|organizer|privacy/i);

expect(guestMarkup).toContain("Log in to see who’s going");
expect(guestMarkup).toContain('href="/login?next=%2Fevents%2Fride-1%2Fattendees"');

expect(emptyMarkup).toContain("No riders yet");
expect(emptyMarkup).toContain('href="/events/ride-1/register"');
```

In the organizer-surface test, replace bare-number checks with contextual checks:

```ts
expect(markup).toMatch(/<strong>5<\/strong> Going/);
expect(markup).toMatch(/<strong>2<\/strong> Visible/);
expect(markup).toMatch(/<strong>3<\/strong> Anonymous/);
```

This proves the public breakdown is removed without deleting the organizer’s operational totals.

- [ ] **Step 3: Run the targeted test and verify RED**

Run:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts
```

Expected: FAIL because the component still renders the old hero, policy sentence, public metrics, and old state copy.

- [ ] **Step 4: Replace the public hero with the minimal social header**

In `event-attendee-roster.tsx`:

1. Add `ArrowLeft` to the Lucide import.
2. Delete `RosterMetric`.
3. Replace the header with:

```tsx
<header className="event-roster__header">
  <Link className="event-roster__back-link" href={`/events/${summary.eventId}`}>
    <ArrowLeft aria-hidden="true" />
    <span>{summary.eventTitle}</span>
  </Link>
  <div className="event-roster__heading-row">
    <h1 id="event-roster-title">Who’s going</h1>
    <span
      className="event-roster__count"
      aria-label={`${summary.goingCount} riders going`}
    >
      <strong>{summary.goingCount}</strong> going
    </span>
  </div>
</header>
```

Do not render `visibleCount`, `anonymousCount`, or explanatory policy text anywhere in the public component. Do not remove those values from `rosterResetKey`; changes from the server must still reset the client roster consistently.

- [ ] **Step 5: Simplify only the public state copy**

Use these exact rider-facing states:

```tsx
<CardTitle>The rider list isn’t available for this event.</CardTitle>
```

```tsx
<CardTitle>Log in to see who’s going</CardTitle>
```

```tsx
<CardTitle>No riders yet</CardTitle>
```

For the empty state, keep `/events/${summary.eventId}/register` and label the action `Join this event`. Remove descriptions about organizer configuration, member-sharing policy, and becoming the “first rider.” Keep the load-more label, progress announcements, deduplication, and error handling unchanged.

- [ ] **Step 6: Run the contract test and commit**

Run:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts
git diff --check
git add src/features/member-profiles/event-attendee-roster.tsx tests/server/event-roster-ui-contract.test.ts
git commit -m "refactor: simplify public attendee roster"
```

Expected: PASS with a focused markup/copy commit. `organizer-roster-panel.tsx` remains unchanged.

---

### Task 2: Integrate the roster visually with a compact responsive layout

**Files:**
- Modify: `tests/server/event-roster-ui-contract.test.ts`
- Modify: `src/app/globals.css:2805-3016`
- Modify: `src/app/globals.css:3103-3124`

**Interfaces:**
- Adds CSS hooks: `.event-roster__back-link`, `.event-roster__heading-row`, `.event-roster__count`
- Removes CSS hooks: `.event-roster__eyebrow`, `.event-roster__metrics`, `.roster-metric`
- Preserves: `.event-roster__grid`, rider-card, state, pagination, and organizer selectors

- [ ] **Step 1: Add a focused stylesheet regression contract**

Add a test that loads `src/app/globals.css` and proves the new hooks exist while the deleted public-metric hooks do not:

```ts
const css = source("src/app/globals.css");

expect(css).toContain(".event-roster__back-link");
expect(css).toContain(".event-roster__heading-row");
expect(css).toContain(".event-roster__count");
expect(css).not.toContain(".event-roster__eyebrow");
expect(css).not.toContain(".event-roster__metrics");
expect(css).not.toContain(".roster-metric");
```

Also keep a source assertion for `max-width: 100%` on the attendee card/image group so later styling cannot let images escape the viewport.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts
```

Expected: FAIL because the stylesheet still contains the old dark hero and three-metric grid and lacks the new hooks.

- [ ] **Step 3: Replace only the roster-header CSS**

Delete the old `.event-roster__header::after`, `.event-roster__eyebrow`, `.event-roster__metrics`, and `.roster-metric*` rules. Replace the header styling with a compact light treatment:

```css
.event-roster__header {
  display: grid;
  gap: clamp(18px, 3vw, 28px);
  padding-bottom: clamp(18px, 3vw, 28px);
  border-bottom: 1px solid rgba(23, 19, 15, 0.16);
}

.event-roster__back-link {
  width: fit-content;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #625c54;
  font-size: 0.9rem;
  font-weight: 750;
  line-height: 1.35;
  text-decoration: none;
}

.event-roster__back-link span {
  overflow-wrap: anywhere;
}

.event-roster__back-link svg {
  width: 17px;
  flex: 0 0 auto;
}

.event-roster__back-link:hover,
.event-roster__back-link:focus-visible {
  color: #17130f;
  text-decoration: underline;
  text-decoration-color: #e63b2e;
  text-underline-offset: 4px;
}

.event-roster__heading-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 12px 24px;
}

.event-roster__header h1 {
  margin: 0;
  color: #17130f;
  font-size: clamp(2rem, 5vw, 3.5rem);
  line-height: 1;
  letter-spacing: -0.05em;
}

.event-roster__count {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  color: #625c54;
  white-space: nowrap;
}

.event-roster__count strong {
  color: #17130f;
  font: 800 1.35rem/1 var(--font-geist-mono), monospace;
}
```

Keep the existing light page shell and existing rider-card palette. Remove the obsolete organizer header-size override and mobile metric-stack rules; leave the organizer heading’s one-column mobile rule in place.

- [ ] **Step 4: Harden the card and image containment**

Add or retain:

```css
.roster-rider-card {
  min-width: 0;
  max-width: 100%;
}

.roster-rider-card__identity > div {
  min-width: 0;
}

.roster-rider-card__identity h3,
.roster-rider-card__identity p,
.roster-rider-card__motorcycle strong {
  overflow-wrap: anywhere;
}

.roster-rider-avatar img,
.roster-rider-card__motorcycle img {
  max-width: 100%;
}
```

Do not enlarge the existing 60px avatar or 138px motorcycle-photo region. Preserve `object-fit: cover`, the responsive grid’s `min(100%, 280px)`, and visible focus styling.

- [ ] **Step 5: Run targeted tests and commit**

Run:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts
git diff --check
git add src/app/globals.css tests/server/event-roster-ui-contract.test.ts
git commit -m "style: align attendee roster with event journey"
```

Expected: PASS with no obsolete public roster selector left behind.

---

### Task 3: Verify the complete rider journey and publish the approved result

**Files:**
- Verify: `src/app/events/[eventId]/attendees/page.tsx`
- Verify: `src/features/member-profiles/event-attendee-roster.tsx`
- Verify: `src/features/member-profiles/organizer-roster-panel.tsx`
- Verify: `src/app/globals.css`
- Verify: `tests/server/event-roster-ui-contract.test.ts`

**Interfaces:**
- Public route: `/events/tambike-cafe-classico/attendees`
- Event context route: `/events/tambike-cafe-classico`
- Rider profile links: `/riders/{slug}`
- Authorized media boundary: `/media/{mediaId}` → signed CloudFront URL

- [ ] **Step 1: Run focused and repository gates**

Run:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts tests/server/event-roster-ui-rerender.test.ts tests/server/event-roster-domain.test.ts
npm run lint
npm run build
npm run test:server
git diff --check
git status --short --branch
```

Expected: targeted roster tests, lint, and build pass. If the full server suite reports the known date-sensitive July 25 fixture failures, capture the exact failing names and distinguish them from this change; do not expand this task into unrelated fixture repair.

- [ ] **Step 2: Reuse or start the local dev server**

First inspect active processes/listeners and the current thread terminal. If the Tambike dev server is already serving this checkout, reuse it. Only when no matching server exists, run:

```powershell
npm run dev
```

Keep the server available for browser verification and do not start a duplicate.

- [ ] **Step 3: Verify desktop and mobile through the Codex browser**

Use the Codex in-app browser only.

At desktop (approximately 1440×900), compare:

- `/events/tambike-cafe-classico`
- `/events/tambike-cafe-classico/attendees`

Confirm the attendee page has the Tambike shell, compact event-title back link, “Who’s going,” one Going total, visible rider cards, and no public policy or anonymous/visible breakdown.

At 390×844, confirm:

- no horizontal overflow;
- the back link wraps safely;
- the heading and count remain readable;
- every card stays inside the viewport;
- avatar and motorcycle images stay inside their card;
- focusable back link, rider cards, login/join action when applicable, and load-more action remain usable.

- [ ] **Step 4: Verify existing media delivery without changing it**

For at least one avatar and one motorcycle image:

1. Confirm the page initially requests an opaque same-origin `/media/{mediaId}` URL.
2. Confirm the authorized response redirects and the final image returns `200`.
3. Confirm the final response is CloudFront-backed and the decoded image renders in the card.
4. Confirm there is no repeated redirect/request loop and no oversized intrinsic image escaping the card.

- [ ] **Step 5: Review the final diff against the approved scope**

Run:

```powershell
git diff origin/main...HEAD -- src/features/member-profiles/event-attendee-roster.tsx src/features/member-profiles/organizer-roster-panel.tsx src/app/globals.css tests/server/event-roster-ui-contract.test.ts
git log --oneline --decorate -5
git status --short --branch
```

Confirm:

- no data, auth, privacy, schema, media, or route-loader changes;
- organizer totals still show Going, Visible, and Anonymous;
- public UI contains no internal roster-policy explanation;
- only focused commits are ahead of `origin/main`.

- [ ] **Step 6: Push `main` and verify production**

After every required gate passes or any unrelated failure is explicitly recorded:

```powershell
git push origin main
```

Because the Vercel CLI is not currently installed, rely on the repository’s Git-linked deployment and live browser verification for this rollout. Poll the production attendee page until the pushed commit is visible, then repeat the desktop/mobile content and media checks against:

```text
https://tambike.bayanko.ph/events/tambike-cafe-classico/attendees
```

If command-line deployment inspection is desired later, install the official CLI separately with `npm i -g vercel`; it is not required for this presentation-only change.

Expected: production shows the approved compact roster, images load through the existing CloudFront path, and the checkout ends clean on `main`.

---

## Final Acceptance Checklist

- [ ] Public header shows event back link, “Who’s going,” and one aggregate Going total.
- [ ] Public page omits “Ride roll-call,” the privacy explanation, Visible riders, and Anonymous riders.
- [ ] Organizer panel still exposes Going, Visible, and Anonymous totals.
- [ ] Signed-out, unavailable, empty, and pagination states use rider-facing copy and preserve behavior.
- [ ] Rider cards retain name, area, profile link, avatar, motorcycle photo, nickname/make/model.
- [ ] No attendee image or card exceeds the 390px viewport.
- [ ] Authorized avatar and motorcycle images render through the existing CloudFront redirect.
- [ ] Targeted tests, lint, build, and diff checks pass.
- [ ] Any unrelated full-suite date fixture failures are reported separately, not hidden or repaired out of scope.
- [ ] Production deployment is verified at desktop and mobile widths.
