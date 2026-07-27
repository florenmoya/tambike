# Raffle Spotlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public event page's plain and technical giveaway stack with an open-raffle spotlight and a compact recent-winner panel.

**Architecture:** Keep `PublicGiveawayPanel` as the existing client-side data-loading boundary and add one pure presentation-state module for deterministic campaign grouping. Replace inline generic card utilities with a colocated CSS Module so the pit-pass motif, responsive two-column layout, and collapsed secondary evidence stay scoped to this component. Do not change server actions, DTOs, raffle lifecycle behavior, or production data.

**Tech Stack:** Next.js 16.2 App Router, React 19 client components, TypeScript, CSS Modules, Lucide icons, Vitest, Codex Browser

## Global Constraints

- Work in the existing `main` checkout; repository instructions prohibit creating AI/Codex branches or worktrees.
- Read the installed Next.js 16 guidance before code changes: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`.
- The section heading is exactly **Raffles & prizes**; **Prize route** must not render.
- Open campaigns precede completed campaigns while preserving existing order within each state group.
- Preserve `listPublicGiveawaysForEventAction`, `PublicEventGiveaway`, `giveawayEntryLoginHref`, and `canOfferPublicGiveawayEntryLogin`.
- Do not add entry actions for riders, organizers, or admins; retain the existing guest/open/opt-in-or-code predicate.
- Public winner output remains alias-only. Never expose user IDs, emails, entrant lists, claim credentials, entry sources, or private identities.
- Technical proof remains available under **Verify the draw** but collapsed by default.
- Use the existing font family; winner aliases must not use monospace.
- Do not add dependencies, animation, a carousel, tabs, pagination, new campaign ranking, or backend changes.
- At 390px, target approximately 340px or less for the open fixture card, 220px or less for the completed fixture card, and materially less than the measured 1,030px total collapsed section.
- All touch actions are at least 44px high, focus states are visible, status is not color-only, and reduced-motion users receive no added motion.
- Use only the Codex Browser surface for browser verification; never use standalone Playwright.
- Before starting `npm run dev`, prove whether a dev server is already running and reuse it when present.
- Do not deploy or push unless the user separately asks.

---

### Task 1: Deterministic spotlight grouping

**Files:**
- Create: `src/features/giveaways/public-giveaway-spotlight-state.ts`
- Create: `tests/server/public-giveaway-spotlight.test.ts`

**Interfaces:**
- Consumes: `PublicEventGiveaway` from `src/features/giveaways/types.ts`
- Produces:

```ts
export interface PublicGiveawaySpotlightGroups {
  primaryOpen?: PublicEventGiveaway;
  completed: PublicEventGiveaway[];
  additional: PublicEventGiveaway[];
}

export function groupPublicGiveawaysForSpotlight(
  campaigns: PublicEventGiveaway[],
): PublicGiveawaySpotlightGroups;
```

The grouping contract is:

- `primaryOpen`: the first campaign whose state is `open`;
- `completed`: all campaigns whose state is `completed`, in input order;
- `additional`: remaining open campaigns followed by every other public state,
  preserving input order inside those two groups.

- [ ] **Step 1: Write the failing grouping tests**

Create `tests/server/public-giveaway-spotlight.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import type { GiveawayState, PublicEventGiveaway } from "../../src/features/giveaways/types";
import { groupPublicGiveawaysForSpotlight } from "../../src/features/giveaways/public-giveaway-spotlight-state";

function campaign(id: string, state: GiveawayState): PublicEventGiveaway {
  return {
    giveaway: {
      id,
      eventId: "event-1",
      title: id,
      kind: "raffle",
      state,
      complianceStatus: "approved",
      entryMode: "opt_in",
      mechanics: "Mechanics",
      terms: "Terms",
      timeZone: "Asia/Manila",
      publicVisibility: "event_page",
      prizePools: [],
    },
    results: [],
    drawVerifications: [],
  };
}

describe("public giveaway spotlight", () => {
  test("leads with the first open raffle and preserves state-group order", () => {
    const groups = groupPublicGiveawaysForSpotlight([
      campaign("completed-1", "completed"),
      campaign("paused-1", "paused"),
      campaign("open-1", "open"),
      campaign("completed-2", "completed"),
      campaign("open-2", "open"),
      campaign("locked-1", "locked"),
    ]);

    expect(groups.primaryOpen?.giveaway.id).toBe("open-1");
    expect(groups.completed.map(({ giveaway }) => giveaway.id)).toEqual([
      "completed-1",
      "completed-2",
    ]);
    expect(groups.additional.map(({ giveaway }) => giveaway.id)).toEqual([
      "open-2",
      "paused-1",
      "locked-1",
    ]);
  });

  test("returns no spotlight when no open campaign exists", () => {
    const groups = groupPublicGiveawaysForSpotlight([
      campaign("completed-1", "completed"),
      campaign("scheduled-1", "scheduled"),
    ]);

    expect(groups.primaryOpen).toBeUndefined();
    expect(groups.completed.map(({ giveaway }) => giveaway.id)).toEqual(["completed-1"]);
    expect(groups.additional.map(({ giveaway }) => giveaway.id)).toEqual(["scheduled-1"]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts
```

Expected: FAIL because `public-giveaway-spotlight-state.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure grouping module**

Create `src/features/giveaways/public-giveaway-spotlight-state.ts`:

```ts
import type { PublicEventGiveaway } from "@/features/giveaways/types";

export interface PublicGiveawaySpotlightGroups {
  primaryOpen?: PublicEventGiveaway;
  completed: PublicEventGiveaway[];
  additional: PublicEventGiveaway[];
}

export function groupPublicGiveawaysForSpotlight(
  campaigns: PublicEventGiveaway[],
): PublicGiveawaySpotlightGroups {
  const open: PublicEventGiveaway[] = [];
  const completed: PublicEventGiveaway[] = [];
  const other: PublicEventGiveaway[] = [];

  for (const campaign of campaigns) {
    if (campaign.giveaway.state === "open") {
      open.push(campaign);
    } else if (campaign.giveaway.state === "completed") {
      completed.push(campaign);
    } else {
      other.push(campaign);
    }
  }

  return {
    primaryOpen: open[0],
    completed,
    additional: [...open.slice(1), ...other],
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts
```

Expected: 1 file and 2 tests pass.

- [ ] **Step 5: Commit the grouping contract**

```powershell
git add -- 'src/features/giveaways/public-giveaway-spotlight-state.ts' 'tests/server/public-giveaway-spotlight.test.ts'
git commit -m "test: define public raffle spotlight order"
```

---

### Task 2: Raffle Spotlight markup, copy, and scoped visual system

**Files:**
- Modify: `src/features/giveaways/public-giveaway-panel.tsx`
- Create: `src/features/giveaways/public-giveaway-panel.module.css`
- Modify: `tests/server/public-giveaway-spotlight.test.ts`
- Modify: `tests/server/giveaway-ui-data-contract.test.ts`

**Interfaces:**
- Consumes: `groupPublicGiveawaysForSpotlight(campaigns)`
- Preserves: `PublicGiveawayPanel`, `giveawayEntryLoginHref`, `canOfferPublicGiveawayEntryLogin`
- Produces internal presentation units in `public-giveaway-panel.tsx`:

```ts
function OpenGiveawaySpotlight(props: CampaignPresentationProps): React.JSX.Element;
function CompletedGiveawayResult(props: CampaignPresentationProps): React.JSX.Element;
function CompactGiveawayCard(props: CampaignPresentationProps): React.JSX.Element;
```

where:

```ts
type CampaignPresentationProps = {
  campaign: PublicEventGiveaway;
  eventId: string;
  viewerRole: PublicGiveawayViewerRole;
};
```

- [ ] **Step 1: Add failing source and styling contracts**

Extend `tests/server/public-giveaway-spotlight.test.ts`:

```ts
import { readFile } from "node:fs/promises";

test("uses rider-facing spotlight copy and keeps proof secondary", async () => {
  const source = await readFile(
    new URL("../../src/features/giveaways/public-giveaway-panel.tsx", import.meta.url),
    "utf8",
  );

  expect(source).toContain("Raffles & prizes");
  expect(source).toContain("See what is open and who won recently.");
  expect(source).toContain("Open now");
  expect(source).toContain("Recent winner");
  expect(source).toContain("How it works");
  expect(source).toContain("Verify the draw");
  expect(source).toContain("Winner chose to share this alias.");
  expect(source).not.toContain(">Prize route<");
  expect(source).not.toContain("Published winner aliases");
  expect(source).not.toContain("Draw receipts");
  expect(source).not.toContain("font-mono text-xs text-[#b9f1ce]");
});

test("defines the scoped pit-pass layout and mobile collapse targets", async () => {
  const css = await readFile(
    new URL("../../src/features/giveaways/public-giveaway-panel.module.css", import.meta.url),
    "utf8",
  );

  expect(css).toContain(".spotlightGrid");
  expect(css).toContain("grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr)");
  expect(css).toContain(".openCard");
  expect(css).toContain("clip-path:");
  expect(css).toContain(".winnerAlias");
  expect(css).toContain("@media (max-width: 899px)");
  expect(css).toContain("grid-template-columns: 1fr");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});
```

Update the existing contract in
`tests/server/giveaway-ui-data-contract.test.ts`:

```ts
expect(publicPanel).toContain("Verify the draw");
expect(publicPanel).not.toContain("Draw receipts");
expect(publicPanel).toContain("drawVerifications");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts tests/server/giveaway-ui-data-contract.test.ts
```

Expected: FAIL on the old copy and missing CSS Module.

- [ ] **Step 3: Replace the panel orchestration**

In `public-giveaway-panel.tsx`:

1. Import `TicketCheck`, `ChevronDown`, and `CircleCheckBig` only if used;
   remove unused icons.
2. Import `groupPublicGiveawaysForSpotlight`.
3. Import `styles` from `./public-giveaway-panel.module.css`.
4. Keep the existing `useEffect`, unavailable/empty behavior, entry predicate,
   and login route unchanged.
5. Replace the current ready-state campaign map with:

```tsx
const groups = groupPublicGiveawaysForSpotlight(campaigns);
const featuredCompleted = groups.completed[0];
const compactCampaigns = [
  ...groups.additional,
  ...groups.completed.slice(featuredCompleted ? 1 : 0),
];
```

Render:

```tsx
<section
  className={styles.section}
  aria-busy={loadState === "loading"}
  aria-labelledby={`event-giveaways-${eventId}`}
>
  <header className={styles.heading}>
    <span>Raffles & prizes</span>
    <h2 id={`event-giveaways-${eventId}`}>See what is open and who won recently.</h2>
  </header>

  {loadState === "loading" ? (
    <div className={styles.loadingSpotlight} role="status">
      <LoaderCircle aria-hidden="true" />
      Loading raffles…
    </div>
  ) : (
    <>
      <div className={styles.spotlightGrid}>
        {groups.primaryOpen ? (
          <OpenGiveawaySpotlight
            campaign={groups.primaryOpen}
            eventId={eventId}
            viewerRole={viewerRole}
          />
        ) : null}
        {featuredCompleted ? (
          <CompletedGiveawayResult
            campaign={featuredCompleted}
            eventId={eventId}
            viewerRole={viewerRole}
          />
        ) : null}
      </div>
      {compactCampaigns.length > 0 ? (
        <div className={styles.compactGrid}>
          {compactCampaigns.map((campaign) => (
            <CompactGiveawayCard
              key={campaign.giveaway.id}
              campaign={campaign}
              eventId={eventId}
              viewerRole={viewerRole}
            />
          ))}
        </div>
      ) : null}
    </>
  )}
</section>
```

If no open campaign exists, let the completed panel occupy the available
spotlight width. Do not create an empty “no active raffle” card.

- [ ] **Step 4: Implement the open spotlight**

`OpenGiveawaySpotlight` must render:

- the exact text **Open now**;
- raffle title;
- `primaryPrizeSummary(campaign)` using the first prize pool's first item,
  falling back to the pool title and then `prizePoolSummary`;
- existing entry-mode label;
- only non-empty schedule moments;
- the existing guest login action with minimum 44px height;
- one native `<details>` labelled **How it works** containing mechanics and
  terms.

Use this fallback helper:

```ts
function primaryPrizeSummary(campaign: PublicEventGiveaway) {
  const pool = campaign.giveaway.prizePools[0];
  if (!pool) return "Prize details coming soon";
  return pool.items[0]?.title ?? pool.title ?? prizePoolSummary(pool);
}
```

Do not render draw proof or winner results inside the open spotlight.

- [ ] **Step 5: Implement the completed winner panel**

`CompletedGiveawayResult` must render:

- exact label **Recent winner**;
- completed raffle title;
- first prize summary;
- each public alias with `styles.winnerAlias`, never monospace;
- **Winner chose to share this alias.** when at least one alias exists;
- **Winner not publicly listed** when `results` is empty;
- native `<details>` labelled **How it worked** for mechanics and terms;
- native `<details>` labelled **Verify the draw** only when
  `drawVerifications.length > 0`.

Reuse `DrawReceipt` inside **Verify the draw**, but remove its outer primary
panel and old explanatory paragraph. Keep digest values breakable and monospace.

- [ ] **Step 6: Implement compact additional campaign cards**

`CompactGiveawayCard` must render only:

- state label;
- title;
- primary prize;
- entry-mode label;
- **How it works** details.

If a compact completed campaign has public results, show the first alias with
the same privacy-safe copy. Do not render full draw verification in compact
cards.

- [ ] **Step 7: Add the scoped CSS Module**

Create `public-giveaway-panel.module.css` with component-scoped tokens:

```css
.section {
  --raffle-asphalt: #08090b;
  --raffle-panel: #141318;
  --raffle-amber: #ffbe45;
  --raffle-green: #5bdd91;
  --raffle-chrome: #e7e8ea;
  display: grid;
  gap: 1rem;
  padding: clamp(1.1rem, 2vw, 1.5rem);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.9rem;
  background: rgba(18, 17, 19, 0.76);
}

.spotlightGrid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
  gap: 0.85rem;
  align-items: stretch;
}

.openCard {
  position: relative;
  min-width: 0;
  overflow: hidden;
  clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
  border: 1px solid color-mix(in srgb, var(--raffle-amber) 38%, transparent);
  background: var(--raffle-asphalt);
}

.winnerCard {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--raffle-green) 30%, transparent);
  border-top: 3px solid var(--raffle-green);
  background: var(--raffle-panel);
}

.winnerAlias {
  overflow-wrap: anywhere;
  color: var(--raffle-chrome);
  font-family: var(--font-geist-sans), Arial, Helvetica, sans-serif;
  font-size: clamp(1.25rem, 2.2vw, 1.5rem);
  line-height: 1.1;
  font-weight: 900;
}

@media (max-width: 899px) {
  .spotlightGrid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .section *,
  .section *::before,
  .section *::after {
    scroll-behavior: auto;
    transition-duration: 0.01ms;
  }
}
```

Add the remaining named classes needed by the JSX:

- `.heading`, `.heading > span`, `.heading h2`;
- `.openStatus`, `.cardBody`, `.campaignTitle`, `.prizeLabel`,
  `.prizeTitle`, `.metadata`;
- `.entryAction` with `min-height: 44px` and visible `:focus-visible`;
- `.winnerHeader`, `.winnerPrize`, `.winnerPrivacy`;
- `.details`, `.details summary`, `.proofList`;
- `.compactGrid`, `.compactCard`;
- `.loadingSpotlight`.

Keep shadows restrained, use no animated gradient, and do not add global CSS.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts tests/server/giveaway-ui-data-contract.test.ts tests/server/rider-giveaway-entry-controls.test.ts tests/server/event-detail-ui-contract.test.ts
```

Expected: all focused files pass.

- [ ] **Step 9: Commit the public presentation**

```powershell
git add -- 'src/features/giveaways/public-giveaway-panel.tsx' 'src/features/giveaways/public-giveaway-panel.module.css' 'tests/server/public-giveaway-spotlight.test.ts' 'tests/server/giveaway-ui-data-contract.test.ts'
git commit -m "feat: add public raffle spotlight"
```

---

### Task 3: Full verification and responsive browser critique

**Files:**
- Modify only if a verified issue requires a narrow correction:
  - `src/features/giveaways/public-giveaway-panel.tsx`
  - `src/features/giveaways/public-giveaway-panel.module.css`
  - `tests/server/public-giveaway-spotlight.test.ts`

**Interfaces:**
- Consumes the completed Task 2 UI.
- Produces no new public API.

- [ ] **Step 1: Run the complete automated gates**

Run serially:

```powershell
npm run test:server
npm run lint
npm run build
git diff --check
```

Expected:

- all server tests pass;
- ESLint exits `0`;
- Next.js 16 production build exits `0`;
- `git diff --check` has no output.

- [ ] **Step 2: Reuse or start the local application safely**

First inspect whether the repository's dev server is already listening. Reuse
the existing process when present. Only when absent, run:

```powershell
npm run dev
```

Do not start a second dev server.

- [ ] **Step 3: Verify desktop through Codex Browser**

Open the local Cafe Classico event page in Codex Browser at the normal desktop
viewport. Confirm:

- **Raffles & prizes** is present and **Prize route** is absent;
- open raffle is first and visibly stronger;
- `Weekend Rider Gear Package` is readable without opening details;
- recent winner `Raffle Sample Rider` is prominent and non-monospace;
- **How it works** and **Verify the draw** are collapsed;
- organizer view shows no invalid entry CTA;
- no horizontal overflow or new console error exists.

- [ ] **Step 4: Verify 390×844 mobile through Codex Browser**

Use the Browser viewport capability at `390 × 844`. Measure the collapsed
section and both fixture cards. Confirm:

- section is materially shorter than the pre-change `1,030px`;
- target card heights are approximately `<= 340px` open and `<= 220px`
  completed for the current fixture;
- no clipped text or horizontal overflow;
- touch action height is at least `44px`;
- primary prize and winner alias are readable before expanding details.

Reset the viewport override after verification.

- [ ] **Step 5: Verify guest and privacy behavior**

Use a guest browser session or logged-out local state without inspecting browser
storage. Confirm:

- guest sees **Log in to enter** only for the open opt-in campaign;
- completed winner shows only `Raffle Sample Rider`;
- no entrant identity, email, raw ID, claim credential, or private winner
  information is visible;
- **Verify the draw** expands and contains the existing public proof.

- [ ] **Step 6: Fix only evidence-backed visual issues**

If browser evidence finds a specific problem, first add or tighten the relevant
contract in `public-giveaway-spotlight.test.ts`, verify RED, make the smallest
CSS/markup correction, and rerun the focused test plus the affected browser
check.

- [ ] **Step 7: Commit any verification correction**

Only if Step 6 changed tracked files:

```powershell
git add -- 'src/features/giveaways/public-giveaway-panel.tsx' 'src/features/giveaways/public-giveaway-panel.module.css' 'tests/server/public-giveaway-spotlight.test.ts'
git commit -m "fix: refine raffle spotlight layout"
```

- [ ] **Step 8: Final integrity check**

Run:

```powershell
git status --short
git log -3 --oneline
git diff --check HEAD~2..HEAD
```

Expected: no uncommitted tracked files and no whitespace errors.

Report local verification separately from production. Do not claim the redesign
is live and do not deploy or push unless the user separately authorizes it.
