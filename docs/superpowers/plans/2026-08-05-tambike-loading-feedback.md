# Tambike Loading Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one branded motorcycle-wheel loading language to the `/profile` initial data request and every event navigation from `/events`.

**Architecture:** Create a focused shared client component and colocated CSS Module for the wheel, profile status panel, and pending event modal. Keep the existing profile request and Next.js links as the state sources; `EventNavigationFeedback` reads `useLinkStatus()` only as a descendant of each event `Link`, then renders the current link content and the modal from the same pending value.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript, CSS Modules, Vitest, and the Codex in-app browser.

## Global Constraints

- Preserve Road Tar `#0a0504`, Tambike Gold `#ffca5d`, Brass `#b67623`, Warm Cream `#fff4cf`, and Muted Ash `#9c9185`.
- Use **Getting your garage ready…** and **Loading your profile and motorcycle details.** on `/profile`.
- Use **Opening event…** plus the selected event title in the event modal.
- Do not add a timer, percentage, progress bar, skeleton form, dependency, route change, or persistent state.
- Keep loading surfaces as non-interactive `role="status"` regions; do not present the event status as an ARIA dialog.
- Stop wheel rotation under `prefers-reduced-motion: reduce` without hiding the status.
- Reuse an existing Tambike development server when available.
- Use only the Codex browser surface for browser verification; do not run the repository Playwright suite.
- Keep browser QA read-only because local configuration may point at a remote database.
- Preserve unrelated dirty and untracked files. Do not create a branch or worktree.
- Follow `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md` and `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`.

---

## File Structure

- Create `src/components/tambike-loading-feedback.tsx`: shared wheel markup, profile loading status, event modal, and the `useLinkStatus` bridge.
- Create `src/components/tambike-loading-feedback.module.css`: scoped wheel, profile panel, event backdrop, responsive, and reduced-motion styles.
- Create `tests/server/tambike-loading-feedback.test.tsx`: focused rendering and source-integration regressions.
- Modify `src/features/member-profiles/profile-settings.tsx`: replace the generic initial spinner row while retaining the existing error alert.
- Modify `src/features/tambike-demo/tambike-screen.tsx`: route featured and grid event link content through `EventNavigationFeedback`.
- Modify `src/app/globals.css`: remove superseded featured-poster-only loading styles.

---

### Task 1: Shared wheel and profile loading panel

**Files:**
- Create: `src/components/tambike-loading-feedback.tsx`
- Create: `src/components/tambike-loading-feedback.module.css`
- Create: `tests/server/tambike-loading-feedback.test.tsx`
- Modify: `src/features/member-profiles/profile-settings.tsx:1-20,341-351`

**Interfaces:**
- Produces: `TambikeLoadingWheel(): JSX.Element`
- Produces: `ProfileLoadingFeedback(): JSX.Element`
- Consumes: the existing `ProfileSettings` branch where `initialEditor` is `null`

- [ ] **Step 1: Write the failing profile-loading test**

Create `tests/server/tambike-loading-feedback.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  ProfileLoadingFeedback,
  TambikeLoadingWheel,
} from "../../src/components/tambike-loading-feedback";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Tambike loading feedback", () => {
  test("renders the branded wheel as decorative artwork", () => {
    const markup = renderToStaticMarkup(<TambikeLoadingWheel />);

    expect(markup).toContain('data-tambike-loading-wheel="true"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.match(/data-wheel-spoke=/g)).toHaveLength(4);
    expect(markup).toContain('data-wheel-hub="true"');
  });

  test("renders an accessible compact profile loading status", () => {
    const markup = renderToStaticMarkup(<ProfileLoadingFeedback />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Getting your garage ready…");
    expect(markup).toContain("Loading your profile and motorcycle details.");
  });

  test("uses the branded profile status without changing the error alert", () => {
    const profileSource = source("src/features/member-profiles/profile-settings.tsx");

    expect(profileSource).toContain("<ProfileLoadingFeedback />");
    expect(profileSource).not.toContain("Loading garage settings…");
    expect(profileSource).toContain(
      '<p className="profile-settings-load" role="alert">{loadError}</p>',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

```powershell
npx vitest run tests/server/tambike-loading-feedback.test.tsx
```

Expected: FAIL because `src/components/tambike-loading-feedback` does not exist.

- [ ] **Step 3: Add the minimal shared wheel and profile components**

Create `src/components/tambike-loading-feedback.tsx`. The event exports are added in Task 2 after their tests fail.

```tsx
"use client";

import styles from "./tambike-loading-feedback.module.css";

export function TambikeLoadingWheel() {
  return (
    <span className={styles.wheel} data-tambike-loading-wheel="true" aria-hidden="true">
      <span className={styles.spoke} data-wheel-spoke="horizontal" />
      <span className={`${styles.spoke} ${styles.spokeVertical}`} data-wheel-spoke="vertical" />
      <span className={`${styles.spoke} ${styles.spokeDiagonalA}`} data-wheel-spoke="diagonal-a" />
      <span className={`${styles.spoke} ${styles.spokeDiagonalB}`} data-wheel-spoke="diagonal-b" />
      <span className={styles.hub} data-wheel-hub="true" />
    </span>
  );
}

export function ProfileLoadingFeedback() {
  return (
    <div className={styles.profileStatus} role="status" aria-live="polite" aria-busy="true">
      <TambikeLoadingWheel />
      <strong>Getting your garage ready…</strong>
      <span>Loading your profile and motorcycle details.</span>
    </div>
  );
}
```

- [ ] **Step 4: Add scoped wheel and profile styles**

Create `src/components/tambike-loading-feedback.module.css` with these scoped styles:

```css
.wheel {
  position: relative;
  display: block;
  width: 58px;
  aspect-ratio: 1;
  border: 5px solid #080706;
  border-radius: 999px;
  background:
    radial-gradient(circle at center, #d7a64e 0 6px, #5c3c15 7px 10px, transparent 11px),
    radial-gradient(circle at 34% 28%, rgb(255 255 255 / 28%), transparent 16%),
    radial-gradient(circle, transparent 0 26px, rgb(255 198 91 / 40%) 27px 29px, transparent 30px),
    linear-gradient(145deg, #2e2d29, #0d0c0b 58%, #020202);
  box-shadow:
    inset 0 2px 8px rgb(255 255 255 / 14%),
    inset 0 -9px 14px rgb(0 0 0 / 62%),
    0 0 0 1px rgb(255 221 143 / 18%),
    0 14px 28px rgb(0 0 0 / 38%);
  animation: loading-wheel-spin 900ms linear infinite;
}

.wheel::before {
  position: absolute;
  inset: 5px;
  border: 2px dashed rgb(246 204 111 / 44%);
  border-radius: inherit;
  content: "";
}

.wheel::after {
  position: absolute;
  inset: 15px;
  border: 2px solid rgb(255 238 184 / 34%);
  border-radius: inherit;
  content: "";
}

.spoke {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1;
  width: 30px;
  height: 3px;
  margin: -1.5px 0 0 -15px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent 0 4px,
    rgb(255 230 160 / 76%) 4px 26px,
    transparent 26px
  );
}

.spokeVertical { transform: rotate(90deg); }
.spokeDiagonalA { transform: rotate(45deg); }
.spokeDiagonalB { transform: rotate(-45deg); }

.hub {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  width: 12px;
  aspect-ratio: 1;
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 28%, rgb(255 255 255 / 72%), transparent 22%),
    linear-gradient(145deg, #ffd079, #8b5b1d);
  box-shadow:
    0 0 0 2px rgb(10 7 4 / 85%),
    0 0 0 4px rgb(255 221 143 / 18%);
  transform: translate(-50%, -50%);
}

.profileStatus {
  grid-column: 1 / -1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.65rem;
  min-height: 280px;
  padding: 1.5rem;
  color: #fff4cf;
  text-align: center;
}

.profileStatus > strong { font-size: 1rem; }
.profileStatus > span:last-child { max-width: 32ch; color: #9c9185; font-size: 0.875rem; }

@keyframes loading-wheel-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .wheel { animation: none; }
}
```

- [ ] **Step 5: Replace the generic profile spinner**

Import `ProfileLoadingFeedback` in `profile-settings.tsx`, then replace only the unresolved-editor branch:

```tsx
if (!initialEditor) {
  return <ProfileLoadingFeedback />;
}
```

Do not alter the preceding `loadError` branch. Keep `LoaderCircle` because the save button still uses it.

- [ ] **Step 6: Run focused tests and lint to verify GREEN**

```powershell
npx vitest run tests/server/tambike-loading-feedback.test.tsx tests/server/member-profile-ui-contract.test.ts
npx eslint src/components/tambike-loading-feedback.tsx src/features/member-profiles/profile-settings.tsx tests/server/tambike-loading-feedback.test.tsx
```

Expected: both commands exit `0` with no test failures or lint errors.

- [ ] **Step 7: Commit the profile loading slice**

```powershell
git add -- src/components/tambike-loading-feedback.tsx src/components/tambike-loading-feedback.module.css tests/server/tambike-loading-feedback.test.tsx src/features/member-profiles/profile-settings.tsx
git commit -m "feat: add branded profile loading state"
```

---

### Task 2: Pending event navigation modal for featured and grid links

**Files:**
- Modify: `src/components/tambike-loading-feedback.tsx`
- Modify: `src/components/tambike-loading-feedback.module.css`
- Modify: `tests/server/tambike-loading-feedback.test.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:1000-1146`
- Modify: `src/app/globals.css:2143-2185,2879-2888`

**Interfaces:**
- Consumes: `TambikeLoadingWheel()` from Task 1
- Produces: `EventLoadingModal({ eventTitle }: { eventTitle: string }): JSX.Element`
- Produces: `EventNavigationFeedback({ eventTitle, children }: { eventTitle: string; children: (pending: boolean) => ReactNode }): JSX.Element`
- Requires: `EventNavigationFeedback` remains inside the event's `Link`, where `useLinkStatus()` has the correct link context

- [ ] **Step 1: Extend the focused test with failing event behavior**

Add `EventLoadingModal` to the imports and append:

```tsx
test("renders the selected event in a non-interactive loading modal", () => {
  const markup = renderToStaticMarkup(
    <EventLoadingModal eventTitle="CALABARZON Endurance Ride" />,
  );

  expect(markup).toContain('data-event-loading-modal="true"');
  expect(markup).toContain('role="status"');
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain('aria-busy="true"');
  expect(markup).toContain("Opening event…");
  expect(markup).toContain("CALABARZON Endurance Ride");
  expect(markup).not.toContain('role="dialog"');
});

test("connects both event link types to the shared pending modal", () => {
  const screenSource = source("src/features/tambike-demo/tambike-screen.tsx");
  const feedbackSource = source("src/components/tambike-loading-feedback.tsx");

  expect(screenSource.match(/<EventNavigationFeedback/g)).toHaveLength(2);
  expect(screenSource).toContain("eventTitle={event.title}");
  expect(screenSource.match(/aria-busy=\{pending \|\| undefined\}/g)).toHaveLength(2);
  expect(feedbackSource).toContain("const { pending } = useLinkStatus();");
  expect(feedbackSource).toContain("event.preventDefault();");
  expect(feedbackSource).toContain("event.stopPropagation();");
});
```

- [ ] **Step 2: Run the test to verify RED**

```powershell
npx vitest run tests/server/tambike-loading-feedback.test.tsx
```

Expected: FAIL because `EventLoadingModal` is not exported and neither event link uses `EventNavigationFeedback`.

- [ ] **Step 3: Add the event modal and link-status bridge**

Extend `src/components/tambike-loading-feedback.tsx`:

```tsx
import { useLinkStatus } from "next/link";
import type { MouseEvent, ReactNode } from "react";

export function EventLoadingModal({ eventTitle }: { eventTitle: string }) {
  const blockRepeatedNavigation = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className={styles.eventBackdrop}
      data-event-loading-modal="true"
      role="status"
      aria-live="polite"
      aria-busy="true"
      onClick={blockRepeatedNavigation}
    >
      <div className={styles.eventPanel}>
        <TambikeLoadingWheel />
        <strong>Opening event…</strong>
        <span>{eventTitle}</span>
      </div>
    </div>
  );
}

export function EventNavigationFeedback({
  eventTitle,
  children,
}: {
  eventTitle: string;
  children: (pending: boolean) => ReactNode;
}) {
  const { pending } = useLinkStatus();

  return (
    <>
      {children(pending)}
      {pending ? <EventLoadingModal eventTitle={eventTitle} /> : null}
    </>
  );
}
```

- [ ] **Step 4: Add fixed event-modal styles**

Append to the CSS Module:

```css
.eventBackdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding:
    max(1.5rem, env(safe-area-inset-top))
    max(1.25rem, env(safe-area-inset-right))
    max(1.5rem, env(safe-area-inset-bottom))
    max(1.25rem, env(safe-area-inset-left));
  background:
    radial-gradient(circle at center, rgb(182 118 35 / 20%), transparent 42%),
    rgb(10 5 4 / 78%);
  backdrop-filter: blur(8px);
  cursor: wait;
}

.eventPanel {
  display: grid;
  width: min(100%, 23rem);
  justify-items: center;
  gap: 0.7rem;
  padding: clamp(1.35rem, 5vw, 2rem);
  border: 1px solid rgb(255 202 93 / 32%);
  border-radius: 1rem;
  background: rgb(10 5 4 / 88%);
  box-shadow: 0 24px 72px rgb(0 0 0 / 55%);
  color: #fff4cf;
  text-align: center;
}

.eventPanel > strong {
  font-size: 0.8rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.eventPanel > span:last-child {
  max-width: 26ch;
  color: #9c9185;
  font-size: 0.875rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Connect both event link types**

In `tambike-screen.tsx`:

1. Import `EventNavigationFeedback` from `@/components/tambike-loading-feedback`.
2. Change `import Link, { useLinkStatus } from "next/link"` to `import Link from "next/link"`.
3. Give `FeaturePoster` a `pending: boolean` prop, remove its local hook call and old `.feature-opening` markup, and retain `aria-busy={pending || undefined}`.
4. Inside `FeatureCard`'s existing `Link`, wrap the poster and unchanged caption:

```tsx
<EventNavigationFeedback eventTitle={event.title}>
  {(pending) => (
    <>
      <FeaturePoster
        event={event}
        poster={poster}
        isFeatured={isFeatured}
        pending={pending}
      />
      <div className="feature-caption">
        <h2 className={event.title.length > 24 ? "feature-title-compact" : undefined}>
          {titleParts ? (
            <>
              {titleParts.prefix ? `${titleParts.prefix} ` : null}
              <span className="feature-title-keep">{titleParts.keepTogether}</span>
            </>
          ) : (
            event.title
          )}
        </h2>
        <p>
          {event.date} · {event.area}
        </p>
      </div>
    </>
  )}
</EventNavigationFeedback>
```

5. Inside `EventCard`'s existing `Link`, wrap all current card content:

```tsx
<EventNavigationFeedback eventTitle={event.title}>
  {(pending) => (
    <>
      <div className="poster" aria-busy={pending || undefined}>
        <Image
          src={poster}
          alt={`${event.title} poster`}
          fill
          placeholder={typeof poster === "string" ? "empty" : "blur"}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          sizes="(max-width: 560px) calc(100vw - 40px), 260px"
        />
        <span className="special-offer">{event.perkPreview}</span>
        <span className="bookmark" aria-hidden="true" />
      </div>
      <h3>{event.title}</h3>
      <p className="event-card__meta">
        {event.date} · {event.area}
      </p>
      <div className="event-card__footer">
        <div className="price">
          <strong>{event.going} Going</strong>
        </div>
        <span className="event-card__action">{cta.label}</span>
      </div>
    </>
  )}
</EventNavigationFeedback>
```

Do not change either `href`, poster priority, CTA copy, or carousel gesture behavior.

- [ ] **Step 6: Remove superseded featured-only CSS**

Delete only `.feature-cover.is-opening`, `.feature-opening`, `.feature-opening-ring`, `@keyframes feature-opening-spin`, and the `.feature-opening-ring` reduced-motion declaration from `src/app/globals.css`. Keep the carousel wheel controls and their keyframes unchanged.

- [ ] **Step 7: Run focused tests and lint to verify GREEN**

```powershell
npx vitest run tests/server/tambike-loading-feedback.test.tsx tests/server/member-profile-ui-contract.test.ts tests/server/event-poster-assets-contract.test.ts
npx eslint src/components/tambike-loading-feedback.tsx src/features/member-profiles/profile-settings.tsx src/features/tambike-demo/tambike-screen.tsx tests/server/tambike-loading-feedback.test.tsx
```

Expected: both commands exit `0`; existing poster and profile contracts remain green.

- [ ] **Step 8: Commit the event navigation slice**

```powershell
git add -- src/components/tambike-loading-feedback.tsx src/components/tambike-loading-feedback.module.css tests/server/tambike-loading-feedback.test.tsx src/features/tambike-demo/tambike-screen.tsx src/app/globals.css
git commit -m "feat: show loading modal when opening events"
```

---

### Task 3: Full verification and responsive browser audit

**Files:**
- Verify only; no planned source changes

**Interfaces:**
- Consumes: both completed loading slices
- Produces: fresh automated, build, and browser evidence for completion

- [ ] **Step 1: Run the full server test suite**

```powershell
npm run test:server
```

Expected: exit `0` with zero failed tests.

- [ ] **Step 2: Run full lint**

```powershell
npm run lint
```

Expected: exit `0` with no ESLint errors.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: exit `0`; Next.js completes compilation and route generation.

- [ ] **Step 4: Reuse or start the Tambike development server**

Check port 3000 and the existing logs first:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
Get-Content -Tail 40 -LiteralPath .codex-dev-server.out.log -ErrorAction SilentlyContinue
```

If a healthy Tambike process listens, reuse it. Only when no server is running, start `npm run dev` in a hidden background process and wait for `http://localhost:3000/events` to return HTTP `200`.

- [ ] **Step 5: Verify event navigation with the Codex browser**

Use the Codex in-app browser, not the repository Playwright suite:

1. Open `http://localhost:3000/events` at desktop width.
2. Delay one featured-event destination request, activate the featured poster, and confirm the fixed modal shows the wheel, **Opening event…**, and the selected title before navigation completes.
3. Return to `/events`, delay one grid-event destination request, activate the card, and confirm the same modal and correct title.
4. While pending, click the backdrop and confirm no second navigation starts.
5. Release each request and confirm the intended event detail route loads.
6. Confirm no current-page console errors.

- [ ] **Step 6: Verify profile and mobile layout with the Codex browser**

1. At `/profile`, reload while signed in and confirm the compact wheel status appears before Garage Studio replaces it.
2. Do not submit or save profile data.
3. Repeat the event-grid and profile checks at a 390-pixel viewport.
4. Confirm the modal panel and profile copy wrap cleanly, the wheel remains visible, and `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
5. Emulate reduced motion and confirm the wheel is static while both status messages remain visible.

- [ ] **Step 7: Confirm the final diff remains scoped**

```powershell
git status --short
git diff --check HEAD~2..HEAD
git diff --stat HEAD~2..HEAD
```

Expected: the two implementation commits contain only planned loading files; pre-existing unrelated dirty and untracked files remain untouched.
