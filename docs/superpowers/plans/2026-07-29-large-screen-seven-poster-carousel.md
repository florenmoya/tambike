# Large-Screen Seven-Poster Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show seven featured-event posters at 1920px and wider while preserving the existing five-poster carousel below 1920px.

**Architecture:** The client carousel observes one `matchMedia("(min-width: 1920px)")` query and passes that result into each `FeatureCard`. Card geometry remains distance-based; offsets `-3` and `+3` join the visible, interactive set only when the media query matches.

**Tech Stack:** Next.js 16 App Router, React hooks, TypeScript, CSS custom properties, Codex in-app browser verification.

## Global Constraints

- The breakpoint is exactly `1920px`.
- Below 1920px, only offsets `-2` through `+2` are visible.
- At 1920px and wider, offsets `-3` and `+3` are also visible.
- Existing drag, wheel, keyboard, caption, navigation-loading, and reduced-motion behavior must remain unchanged.
- Reuse the current checkout and dev server; do not create a branch, worktree, or second dev server.
- Do not modify unrelated raffle, attendee, or backend work already present in the checkout.

---

### Task 1: Add responsive outer carousel slots

**Files:**
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/tambike-demo.spec.ts`

**Interfaces:**
- Consumes: `FeatureCard({ event, index, activeIndex, total })`, `featureOffset(index, activeIndex, total)`, and the media query `(min-width: 1920px)`.
- Produces: `useLargeCarousel(): boolean`, `FeatureCard` prop `showWidePeek: boolean`, and class `is-wide-peek` for offsets `-3` and `+3`.

- [x] **Step 1: Confirm the large-screen regression is red**

At a 2048px viewport, inspect `.feature-card.is-wide-peek`. The existing regression in `tests/tambike-demo.spec.ts` expects two cards, computed opacity `0.28`, and both cards within the viewport; the current component produces no `is-wide-peek` cards.

- [x] **Step 2: Add a media-query subscription**

Add `useSyncExternalStore` to the React imports and define:

```tsx
const largeCarouselQuery = "(min-width: 1920px)";

function subscribeToLargeCarousel(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(largeCarouselQuery);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getLargeCarouselSnapshot() {
  return window.matchMedia(largeCarouselQuery).matches;
}

function getLargeCarouselServerSnapshot() {
  return false;
}

function useLargeCarousel() {
  return useSyncExternalStore(
    subscribeToLargeCarousel,
    getLargeCarouselSnapshot,
    getLargeCarouselServerSnapshot,
  );
}
```

- [x] **Step 3: Pass responsive visibility into each feature card**

Inside the event-discovery component, call:

```tsx
const showWideCarousel = useLargeCarousel();
```

Pass `showWidePeek={showWideCarousel}` into every `FeatureCard`.

- [x] **Step 4: Extend the distance-three geometry**

In `FeatureCard`, add `showWidePeek: boolean`, then derive:

```tsx
const isWidePeek = distance === 3;
const isVisible = distance <= 2 || (showWidePeek && isWidePeek);
```

Add `isWidePeek && "is-wide-peek"` to the class list. For distance three,
use the existing `220%` horizontal position and the following values when
`showWidePeek` is true:

```tsx
"--scale": "0.74",
"--opacity": "0.28",
"--depth": "-160px",
"--rotate-y": `${direction * 86 * -1}deg`,
```

When `showWidePeek` is false, distance-three opacity must remain `"0"` so the
card stays hidden, non-interactive, and `aria-hidden` below 1920px.

- [x] **Step 5: Mark the large-screen breakpoint explicitly**

Within `@media (min-width: 1920px)`, keep `.feature-card.is-wide-peek` inside the viewport and ensure it receives the same pointer behavior as other visible cards. Do not change card widths or geometry below the breakpoint.

- [x] **Step 6: Cover the unchanged smaller layout**

Extend `tests/tambike-demo.spec.ts` with a 1440px assertion:

```tsx
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("/events", { waitUntil: "domcontentloaded" });
await expect(page.locator(".feature-card.is-visible")).toHaveCount(5);
await expect(page.locator(".feature-card.is-wide-peek.is-visible")).toHaveCount(0);
```

- [x] **Step 7: Verify responsive behavior**

Use the Codex in-app browser at 1440×900, 2048×900, and 3840×1200. Confirm five, seven, and seven visible posters respectively; confirm the highlighted poster remains centered; click one outer poster at 2048px and confirm its event route opens with the loading overlay.

- [x] **Step 8: Run scoped quality checks**

Run:

```powershell
npm run lint
npm run build
npx vitest run tests/server/event-poster-assets-contract.test.ts
git diff --check
```

Expected: all commands exit successfully. Review only the carousel/spec/plan diffs; leave unrelated dirty files untouched and do not commit without an explicit user request.
