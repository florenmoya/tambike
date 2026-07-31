# Event Poster Navigation Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show immediate inline loading feedback on the featured-event poster a rider clicks while preserving carousel drag behavior.

**Architecture:** Keep the current Next.js links and carousel gesture handlers. Render a small descendant component inside each `Link` that reads the route transition through Next.js 16.2.11's `useLinkStatus`, then shows a poster-local status overlay only while that specific link is pending.

**Tech Stack:** Next.js 16.2.11, React 19, TypeScript, global CSS, existing Playwright regression file, Codex in-app browser verification.

## Global Constraints

- Work in the current checkout; do not create a branch or worktree.
- Preserve direct links, visible side-poster clicks, autoplay, wrapping, drag/swipe, keyboard navigation, and tire controls.
- Use the exact loading copy `Opening event…`.
- Do not add a carousel, progress-bar, or spinner dependency.
- Browser verification must use the Codex browser surface.

---

### Task 1: Lock the navigation feedback contract

**Files:**
- Modify: `tests/tambike-demo.spec.ts`

**Interfaces:**
- Consumes: `.feature-card`, `.feature-opening`, event-detail routes.
- Produces: a regression proving poster-local feedback appears before delayed navigation completes.

- [x] **Step 1: Add the failing loading-state regression**

Add a browser test that loads `/events`, delays the Cafe Classico event request, clicks the highlighted poster, and expects a visible status named `Opening event…` with the clicked poster surface marked `aria-busy="true"`.

```ts
test("featured poster shows feedback while its event page opens", async ({ page }) => {
  let releaseNavigation = () => {};
  const navigationGate = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });

  await page.route("**/events/tambike-cafe-classico*", async (route) => {
    await navigationGate;
    await route.continue();
  });
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const featuredCard = page.locator(".feature-card.is-featured");
  await featuredCard.click();

  await expect(featuredCard.locator(".feature-cover")).toHaveAttribute("aria-busy", "true");
  await expect(featuredCard.getByRole("status")).toHaveText("Opening event…");

  releaseNavigation();
  await expect(page).toHaveURL(/\/events\/tambike-cafe-classico$/);
});
```

- [x] **Step 2: Confirm the regression fails**

Use the Codex browser to click the real poster coordinates and confirm there is no loading status in the current UI before the event route finishes.

Expected: `.feature-opening` count remains `0` and the clicked poster surface has no `aria-busy` attribute.

### Task 2: Render the selected link's pending state

**Files:**
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `useLinkStatus()` from `next/link` inside a descendant of each event `Link`.
- Produces: `FeaturePoster` and `.feature-opening` status overlay.

- [x] **Step 1: Add a link-status-aware poster component**

Extract the poster cover into a `FeaturePoster` component rendered inside the existing `Link`. Call `useLinkStatus()` there so it reads that link's real pending state.

```tsx
function FeaturePoster({
  event,
  poster,
  isFeatured,
}: {
  event: Event;
  poster: ReturnType<typeof resolveEventPoster>;
  isFeatured: boolean;
}) {
  const { pending } = useLinkStatus();

  return (
    <div className={clsx("feature-cover", pending && "is-opening")} aria-busy={pending || undefined}>
      <Image
        src={poster}
        alt={`${event.title} poster`}
        fill
        placeholder={typeof poster === "string" ? "empty" : "blur"}
        draggable={false}
        loading={isFeatured ? "eager" : "lazy"}
        fetchPriority={isFeatured ? "high" : "auto"}
        sizes="(max-width: 760px) 68vw, (min-width: 2400px) 460px, (min-width: 1600px) 400px, 300px"
      />
      {pending ? <FeatureOpeningStatus /> : null}
    </div>
  );
}
```

- [x] **Step 2: Preserve the existing link contract**

Keep `FeatureCard` as the direct `Link` owner and replace only its existing `.feature-cover` markup with `FeaturePoster`. Do not replace Link navigation with `router.push` or disable prefetching.

```tsx
<Link href={`/events/${event.id}`} {...existingInteractionProps}>
  <FeaturePoster event={event} poster={poster} isFeatured={isFeatured} />
  <div className="feature-caption">{/* existing caption */}</div>
</Link>
```

- [x] **Step 3: Render the inline status**

Inside `.feature-cover`, render a `role="status"` overlay containing a decorative ring and `Opening event…` only when `pending` is true.

```tsx
{isOpening ? (
  <span className="feature-opening" role="status">
    <span className="feature-opening-ring" aria-hidden="true" />
    <span>Opening event…</span>
  </span>
) : null}
```

- [x] **Step 4: Style the Tambike loading treatment**

Add a compact charcoal veil, gold ring spinner, centered utility copy, waiting cursor, and reduced-motion fallback without changing poster geometry.

```css
.feature-opening {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  background: rgba(10, 5, 4, 0.72);
}

.feature-opening-ring {
  width: 38px;
  aspect-ratio: 1;
  border: 3px solid rgba(255, 202, 93, 0.28);
  border-top-color: var(--signal);
  border-radius: 50%;
  animation: feature-opening-spin 700ms linear infinite;
}

@keyframes feature-opening-spin {
  to {
    transform: rotate(360deg);
  }
}
```
### Task 3: Verify complete click and drag behavior

**Files:**
- Verify: `src/features/tambike-demo/tambike-screen.tsx`
- Verify: `src/app/globals.css`
- Verify: `tests/tambike-demo.spec.ts`

**Interfaces:**
- Consumes: completed inline loading state.
- Produces: desktop/mobile interaction evidence and static-check results.

- [x] **Step 1: Verify desktop coordinate clicks**

At `2048x900`, click center and visible side posters by coordinates. Confirm immediate loading feedback and the correct event destination.

Expected: the clicked link becomes busy before its URL changes, and the final pathname matches its `href`.

- [x] **Step 2: Verify drag isolation**

Drag the active poster and confirm the carousel advances without showing `Opening event…` or navigating.

Expected: the active title changes, the URL stays `/events`, and `.feature-opening` count is `0`.

- [x] **Step 3: Verify mobile and reduced motion**

At `390x844`, click an exposed side poster and confirm the overlay remains legible. Confirm the spinner animation is disabled under reduced motion.

Expected: the status fits inside the exposed poster treatment without horizontal overflow; under reduced motion the ring's computed `animation-name` is `none`.

- [x] **Step 4: Run repository checks**

Run `npm run lint`, `npm run build`, and `git diff --check`. If the existing attendee-preview type error still blocks the build, report it separately without changing that unrelated feature.

Expected: lint and diff checks exit `0`; build either exits `0` or reports only the already identified attendee-preview `profilePhotoUrl` type mismatch.
