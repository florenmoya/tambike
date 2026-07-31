# Poster Coverflow Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Tambike's existing featured-event row into the approved five-poster fan while showing a caption only for the highlighted event.

**Architecture:** Keep `DiscoveryScreen` and its active-index, timing, drag, and wrapping logic unchanged. Extend `FeatureCard`'s existing CSS custom-property contract with horizontal fan position, Y rotation, and depth values, then let the existing global carousel styles render those values with perspective.

**Tech Stack:** Next.js 16.2.11, React 19, TypeScript, global CSS, existing Playwright browser regression file, Codex in-app browser verification.

## Global Constraints

- Work in the current checkout; do not create a branch or worktree.
- Do not add a carousel dependency or copy the Shadcn block implementation.
- Preserve autoplay, wrapping, drag/swipe, keyboard navigation, focus, and tire controls.
- Browser verification must use the Codex browser surface.

---

### Task 1: Lock the poster-fan behavior

**Files:**
- Modify: `tests/tambike-demo.spec.ts`

**Interfaces:**
- Consumes: `.feature-card`, `.feature-card.is-featured`, `.feature-card.is-visible`, `.feature-caption`.
- Produces: regression coverage for one visible caption and progressively narrower projected side cards.

- [x] **Step 1: Add the failing active-caption browser assertion**

Add a test that loads `/events`, reads the computed `opacity` and `visibility` of captions inside visible feature cards, and expects only `Tambike at Cafe Classico` to be displayed.

- [x] **Step 2: Confirm the current browser state fails**

Use the Codex browser at `2048x900` to confirm all five visible cards currently expose visible captions.

- [x] **Step 3: Add the failing fan-geometry browser assertion**

Add a test that compares projected bounding widths for the highlighted card, a distance-one card, and a distance-two card. Require highlighted width > adjacent width and adjacent width > twice the outer width.

- [x] **Step 4: Confirm the current browser state fails**

Use the Codex browser to confirm the current outer card remains close to the adjacent card's projected width.

### Task 2: Render the Hero 210-inspired poster fan

**Files:**
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `featureOffset(index, activeIndex, total)` and the existing `FeatureCard` CSS custom properties.
- Produces: `--x`, `--scale`, `--opacity`, `--depth`, and `--rotate-y` values for each card.

- [x] **Step 1: Add distance-aware fan values**

In `FeatureCard`, derive horizontal percentages, scale, depth, inward Y rotation, opacity, and z-index from the signed offset. Keep five cards visible using the current `distance <= 2` rule.

- [x] **Step 2: Apply perspective rendering**

Add perspective and `preserve-3d` to `.hero-showcase`; update `.feature-card` to apply translation, Z depth, inward Y rotation, and scale through the custom properties.

- [x] **Step 3: Show only the active caption**

Hide `.feature-caption` by default with `opacity: 0` and `visibility: hidden`, then reveal it only inside `.feature-card.is-featured`.

- [x] **Step 4: Keep poster artwork readable**

Reduce the generic poster overlay to a restrained highlight/shade treatment while retaining the active poster's existing focus and shadow hierarchy.

### Task 3: Verify the complete carousel

**Files:**
- Verify: `src/features/tambike-demo/tambike-screen.tsx`
- Verify: `src/app/globals.css`
- Verify: `tests/tambike-demo.spec.ts`

**Interfaces:**
- Consumes: the completed carousel.
- Produces: desktop/mobile browser evidence and clean static checks.

- [x] **Step 1: Verify desktop initial geometry**

At `2048x900`, confirm five visible cards, one visible caption, a front-facing active card, progressively narrower side cards, and no browser console errors.

- [x] **Step 2: Verify a carousel transition**

Advance once using the next control and confirm the new highlighted card receives the only visible caption while the fan geometry follows the new active index.

- [x] **Step 3: Verify mobile behavior**

At `390x844`, confirm the active poster remains centered, neighbors peek into view, only one caption is visible, and the document has no horizontal overflow.

- [x] **Step 4: Run repository checks**

Run `npm run lint`, `npm run build`, and `git diff --check`. Review the scoped diff without altering unrelated user work.
