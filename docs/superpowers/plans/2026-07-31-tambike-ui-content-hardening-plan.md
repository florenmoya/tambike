# Tambike UI and Content Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Tambike page read and behave like a finished product by removing prototype language, unnecessary controls, ambiguous states, weak metadata, accessibility defects, and mobile layout failures.

**Architecture:** Keep Tambike’s established visual identity and route structure, but establish small reusable page-state, metadata, shell, and responsive-table primitives. Copy changes are attached to real user decisions and recovery actions. Server pages own metadata and record loading; client components receive focused view data and no longer infer a page from demo-only static parameters.

**Tech Stack:** Next.js 16.2.11 App Router and Metadata API; React 19.2.4; TypeScript 5; CSS Modules/Tailwind 4; Radix/shadcn UI; Vitest 4.1.9; Codex browser.

## Global Constraints

- Complete the account, event, lead, and reporting plans first so UI copy describes real behavior.
- Do not rebrand Tambike or replace its existing visual system.
- Show only what users need; keep policy implementation, internal data boundaries, and engineering language out of public UI.
- Every page has one clear `h1`, an accurate browser title, and a useful description.
- Every unavailable/error state names what happened and gives the safest relevant next action.
- Do not expose raw internal IDs, raw exception text, audit payloads, or authorization rules.
- Remove controls that do nothing, duplicate another action, or lead only to fabricated data.
- Preserve legitimate product terms such as event, registration, check-in, organizer, giveaway, raffle, and test ride.
- Public copy should be direct and natural; operational detail may remain in authenticated admin/organizer help where it affects a decision.
- Do not use `autoFocus`; move focus only after an explicit user action and only when it aids recovery.
- Interactive targets must be at least 44 CSS pixels in the compact/mobile shell.
- No page-level horizontal overflow at 320 CSS pixels.
- Preserve dirty worktree changes; never create an AI/Codex branch or worktree.
- Browser verification uses only the Codex browser surface; do not run Playwright.

---

## File Structure

### Create

- `src/lib/page-metadata.ts` — site title template, description defaults, and safe dynamic metadata helpers.
- `src/components/page-state.tsx` — semantic not-found, unavailable, forbidden, and empty states with optional action.
- `src/components/skip-link.tsx` — keyboard-visible link to the primary content.
- `src/features/tambike-demo/content.ts` — reviewed product-facing copy constants where multiple routes share text.
- `tests/server/metadata-contract.test.ts` — route metadata and dynamic title contracts.
- `tests/server/ui-copy-contract.test.ts` — banned prototype/internal phrases and required replacement copy.
- `tests/server/shell-accessibility.test.tsx` — skip link, landmarks, mobile navigation, touch targets, and focus contracts.
- `tests/server/page-state-contract.test.tsx` — semantic status headings and recovery links.
- `tests/server/responsive-surface-contract.test.ts` — wrappers and mobile alternatives for known wide surfaces.

### Modify

- `src/app/layout.tsx` — title template, site description, skip link, and stable main-content target.
- `src/features/tambike-demo/tambike-screen.tsx` — public shell, footer, page copy, event counts, social link, and state actions.
- `src/features/tambike-demo/demo-provider.tsx` — remove presentation-only fallback behavior that survives the earlier slices.
- `src/features/tambike-demo/types.ts` — remove UI-only fake concepts.
- `src/components/app-sidebar.tsx` — concise role navigation with no obsolete validation entry.
- `src/components/data-table.tsx` — safe overflow containment and responsive label hooks.
- `src/features/admin/admin-console.tsx` — concise headings/descriptions and mobile-safe data surfaces.
- `src/features/organizer/organizer-console.tsx` — task-oriented organizer copy and mobile-safe data surfaces.
- `src/features/giveaways/organizer-giveaway-workspace.tsx` — simplify internal-policy language into actionable operator guidance.
- `src/features/giveaways/giveaway-presentation-stage.tsx` — useful unavailable result action.
- `src/features/giveaways/giveaway-claim-screen.tsx` — semantic error headings and recovery links.
- `src/features/check-in/rider-self-check-in-screen.tsx` — semantic unavailable headings and recovery links.
- `src/features/member-profiles/event-attendee-preview.tsx` — one authoritative attendee count.
- `src/features/member-profiles/event-attendee-roster.tsx` — align count/privacy wording.
- `src/app/page.tsx` and every route page listed in Task 2 — page-specific metadata and removal of demo-only static params.
- `src/app/globals.css` and affected CSS modules — focus visibility, shell spacing, media bounds, and overflow fixes.
- Existing route-contract and feature tests affected by intentional copy changes.

## Reviewed Copy Direction

Use these outcomes as the baseline; retain more specific copy when it is already clearer:

| Current pattern | Production direction |
| --- | --- |
| “Event workspace” | “Manage event” |
| “Open workspace” | “Manage event” |
| “Fast paths for the active event workspace” | “Common event actions” |
| “Leads & validation” | “Test-ride leads” |
| “Save lead” | “Request test ride” |
| “Configure event-scoped campaign policy, lifecycle, draws, and aggregate outcomes.” | “Create giveaways, run draws, and manage winner claims.” |
| “This event is not attached to the current organizer workspace.” | “You do not have access to manage this event.” |
| empty footer “Workspaces” group | remove the group |
| raw Facebook URL | linked label “Facebook event” with safe external-link treatment |
| unavailable draw with no route forward | “Back to giveaways” or event link, according to context |

Copy review is contextual, not a blind word replacement. “Workspace” may remain in an internal component name but should not be a user-facing destination label unless users truly manage multiple workspaces.

---

### Task 1: Establish Copy and Page-State Contracts

**Files:**
- Create: `src/features/tambike-demo/content.ts`
- Create: `src/components/page-state.tsx`
- Create: `tests/server/ui-copy-contract.test.ts`
- Create: `tests/server/page-state-contract.test.tsx`

- [ ] **Step 1: Write failing copy tests**

Scan rendered source contracts rather than only one page. Fail on these user-facing remnants:

```ts
const bannedPublicCopy = [
  "prototype",
  "demo data",
  "Save lead",
  "Leads & validation",
  "Footer workspace links",
  "Fast paths for the active event workspace",
  "not attached to the current organizer workspace",
];
```

Also assert the fake upload/validation component and section names are absent after the lead plan.

Do not ban legitimate code identifiers such as `workspaceResult`; the test must inspect string literals or rendered markup, not arbitrary source substrings.

- [ ] **Step 2: Write failing semantic state tests**

For not-found, unavailable, and forbidden variants, assert:

- a visible heading;
- `role="alert"` only for an immediate blocking error, not every empty state;
- concise body copy;
- an optional destination with a descriptive label;
- no raw error code as the heading;
- no nested interactive controls.

- [ ] **Step 3: Confirm failure**

```powershell
npx vitest run tests/server/ui-copy-contract.test.ts tests/server/page-state-contract.test.tsx
```

- [ ] **Step 4: Implement the shared state component**

```ts
type PageStateProps = {
  kind: "not-found" | "unavailable" | "forbidden" | "empty";
  title: string;
  description: string;
  action?: { href: string; label: string };
};
```

Use a real heading and ordinary link action. Keep status icons decorative with `aria-hidden`.

- [ ] **Step 5: Centralize only repeated product copy**

Keep route-specific copy near the route. Put genuinely shared labels/descriptions in `content.ts`; do not create a giant string registry.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/server/ui-copy-contract.test.ts tests/server/page-state-contract.test.tsx
npx eslint src/features/tambike-demo/content.ts src/components/page-state.tsx
git add -- src/features/tambike-demo/content.ts src/components/page-state.tsx tests/server/ui-copy-contract.test.ts tests/server/page-state-contract.test.tsx
git commit -m "test: define production UI content contracts"
```

Expected: tests pass for the new primitive; route-level banned strings may remain as explicit pending assertions until Tasks 3–6.

---

### Task 2: Give All 41 Route Patterns Accurate Metadata

**Files:**
- Create: `src/lib/page-metadata.ts`
- Create: `tests/server/metadata-contract.test.ts`
- Modify: `src/app/layout.tsx`
- Modify: all page files listed below.

- [ ] **Step 1: Inventory the route manifest in the test**

The metadata contract covers exactly these 41 patterns:

```text
/
/home
/events
/events/[eventId]
/events/[eventId]/attendees
/events/[eventId]/register
/events/[eventId]/test-ride
/passes
/passes/[passId]
/passes/past/[eventId]
/login
/signup
/profile
/profile/preview
/riders/[slug]
/check-in/[token]
/giveaway-claims/[awardId]
/dashboard
/create
/onboarding
/organizer/dashboard
/organizer/events
/organizer/events/create
/organizer/events/[eventId]
/organizer/events/[eventId]/attendees
/organizer/events/[eventId]/scanner
/organizer/events/[eventId]/giveaways
/organizer/events/[eventId]/giveaways/[giveawayId]/present
/organizer/events/[eventId]/report
/organizer/reports
/giveaway-ops/[eventId]
/admin
/admin/events/review
/admin/events/review/[reviewId]
/admin/giveaways
/admin/giveaways/[giveawayId]
/admin/reports
/admin/reports/[eventId]
/admin/users
/admin/leads
/admin/moderation
```

The test fails when a route is added without an explicit metadata decision.

- [ ] **Step 2: Write failing metadata assertions**

Assert:

- root template is `%s | Tambike`, default is `Tambike`;
- static pages export a specific `metadata`;
- record-backed dynamic pages export `generateMetadata`;
- titles are concise and unique in the manifest;
- descriptions state the user outcome, not implementation detail;
- missing/private records use a neutral fallback and do not leak title data;
- dynamic page functions `await params`;
- no dynamic page depends on `demoEvents` through `generateStaticParams`.

- [ ] **Step 3: Confirm failure**

```powershell
npx vitest run tests/server/metadata-contract.test.ts
```

- [ ] **Step 4: Implement the helper and root metadata**

```ts
export const siteMetadata: Metadata = {
  title: {
    default: "Tambike",
    template: "%s | Tambike",
  },
  description: "Discover motorcycle events, register, and keep your Tambike passes in one place.",
};

export function pageMetadata(title: string, description: string): Metadata {
  return { title, description };
}
```

Do not duplicate `| Tambike` in child titles.

- [ ] **Step 5: Add static metadata**

Examples:

- `/events`: “Motorcycle events”
- `/passes`: “My passes”
- `/profile`: “Profile”
- `/organizer/events/create`: “Create event”
- `/admin/events/review`: “Event review”
- `/admin/leads`: “Test-ride leads”

Descriptions must explain the actual available action.

- [ ] **Step 6: Add record-backed dynamic metadata**

For event, rider, report, pass, check-in, and giveaway pages, call the narrow read model already used by the page. Do not expose private names on forbidden routes. Avoid duplicate database reads by sharing a cached server loader only if the existing backend boundary makes that safe.

- [ ] **Step 7: Remove demo-only static params**

```powershell
rg -n "generateStaticParams|demoEvents|adminApproval" src/app
```

Remove `generateStaticParams` implementations that enumerate demo records. Keep a static generation function only if it has a production record source and a documented build-time need; none is required for authenticated/detail routes in this plan.

- [ ] **Step 8: Run tests and commit**

```powershell
npx vitest run tests/server/metadata-contract.test.ts
npx eslint src/lib/page-metadata.ts src/app
git add -- src/lib/page-metadata.ts src/app tests/server/metadata-contract.test.ts
git commit -m "fix: add production route metadata"
```

Expected: all 41 route patterns satisfy the contract.

---

### Task 3: Simplify the Public Shell and Navigation

**Files:**
- Create: `src/components/skip-link.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/server/shell-accessibility.test.tsx`

- [ ] **Step 1: Write failing shell tests**

Assert:

- the first focusable control is “Skip to main content”;
- exactly one `main` target uses `id="main-content"`;
- desktop and mobile navigation expose the same essential destinations for the active role;
- the mobile header does not repeat identity text already available in the account menu;
- the footer has no empty group;
- external links use a human label and safe `rel`;
- active destinations use `aria-current="page"`;
- no `autoFocus` attribute exists in application components;
- compact buttons/links meet the 44px target contract.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/server/shell-accessibility.test.tsx
```

- [ ] **Step 3: Add the skip link and landmark**

The skip link is visually hidden until keyboard focus and targets the single page-level main landmark. If nested feature components currently render additional `main` elements, change them to `section` or `div` with an appropriate label.

- [ ] **Step 4: Reduce the signed-in mobile header**

Keep logo, primary browse destination, and one account/menu trigger. Put role-specific secondary destinations inside the menu rather than squeezing full desktop navigation into 320px.

- [ ] **Step 5: Clean the footer**

Remove the empty “Workspaces” column and its misleading aria label. Keep only working product/support/legal destinations; if a destination does not exist, omit it instead of rendering `#`.

- [ ] **Step 6: Remove automatic focus**

```powershell
rg -n "autoFocus" src
```

Remove every passive page-load autofocus. For validation errors, focus the error summary only after a submitted action fails.

- [ ] **Step 7: Run tests and commit**

```powershell
npx vitest run tests/server/shell-accessibility.test.tsx
npx eslint src/components/skip-link.tsx src/app/layout.tsx src/features/tambike-demo/tambike-screen.tsx src/components/app-sidebar.tsx
git add -- src/components/skip-link.tsx src/app/layout.tsx src/features/tambike-demo/tambike-screen.tsx src/components/app-sidebar.tsx src/app/globals.css tests/server/shell-accessibility.test.tsx
git commit -m "fix: simplify Tambike navigation"
```

Expected: pass.

---

### Task 4: Make Public Event, Pass, and Rider Pages Trustworthy

**Files:**
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/member-profiles/event-attendee-preview.tsx`
- Modify: `src/features/member-profiles/event-attendee-roster.tsx`
- Modify: `src/features/member-profiles/profile-preview.tsx`
- Modify: related public route pages and CSS modules.
- Modify: `tests/server/ui-copy-contract.test.ts`
- Create: `tests/server/public-page-semantics.test.tsx`

- [ ] **Step 1: Write failing public-page tests**

Cover:

- one authoritative public attendee count;
- the preview and roster count agree for visible plus anonymous attendees;
- privacy wording explains the member choice without exposing hidden identities;
- Facebook is a labeled external link, not raw URL text;
- test-ride submit label is “Request test ride”;
- unavailable test rides link back to the event;
- pass-not-found state links to “My passes”;
- profile preview has one clear edit action;
- no duplicated page title inside nested hero/card regions.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/server/public-page-semantics.test.tsx tests/server/ui-copy-contract.test.ts
```

- [ ] **Step 3: Establish count semantics**

The count shown beside “Who’s going” is the total confirmed attendance exposed by the backend. Visible profile cards are a subset. Copy example:

```text
15 going
12 riders shared their profile
```

Never compute the headline from only the visible roster array.

- [ ] **Step 4: Replace raw or weak actions**

- “Save lead” → “Request test ride”
- raw `facebook.com/...` → “Facebook event”
- unavailable test ride → “Back to event”
- missing pass → “View my passes”
- profile preview → one primary “Edit profile”

Use `target="_blank"` only when leaving Tambike and pair it with `rel="noreferrer"`.

- [ ] **Step 5: Constrain public media**

Images must use an aspect-ratio container, `object-fit: cover`, and a viewport-aware maximum height. At 320px, no event, profile, motorcycle, or prize image may exceed the viewport width or force horizontal scroll.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/server/public-page-semantics.test.tsx tests/server/ui-copy-contract.test.ts
npx eslint src/features/tambike-demo/tambike-screen.tsx src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-roster.tsx src/features/member-profiles/profile-preview.tsx
git add -- src/features/tambike-demo/tambike-screen.tsx src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-roster.tsx src/features/member-profiles/profile-preview.tsx tests/server/public-page-semantics.test.tsx tests/server/ui-copy-contract.test.ts
git commit -m "fix: clarify public event experiences"
```

Expected: pass.

---

### Task 5: Replace Robotic Admin and Organizer Copy

**Files:**
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/features/giveaways/organizer-giveaway-workspace.tsx`
- Modify: `tests/server/ui-copy-contract.test.ts`

- [ ] **Step 1: Extend failing copy assertions**

Flag user-facing sentences that explain implementation instead of the task, including:

- “event-scoped campaign policy”;
- “aggregate outcomes”;
- “active event workspace”;
- “organizer-only configuration”;
- “source facts stay outside this workspace”;
- “schema, duplicate, owner, and event checks”;
- “one entry-point policy for this release”.

Do not remove necessary legal terms, giveaway eligibility conditions, consent, or safety instructions.

- [ ] **Step 2: Rewrite navigation and headings**

Use task-oriented labels:

- “Manage event”
- “Event attendees”
- “Check in riders”
- “Giveaways”
- “Event report”
- “Review events”
- “Test-ride leads”

Keep one-line descriptions only where they clarify the next action.

- [ ] **Step 3: Simplify giveaway guidance**

Examples:

- “Define the policy, prize inventory, and terms as one configuration…” → “Add the prizes, entry rules, and claim deadline.”
- “Counts only — entrant identities and source facts stay outside this workspace.” → “Entrant details are hidden here.”
- configuration unavailable → state that details could not load and offer Refresh/Back.

Keep the consequences of irreversible draw/publish actions explicit.

- [ ] **Step 4: Remove obsolete UI**

After earlier plans, confirm the following are absent:

- batch upload;
- validation rows;
- local-only status override buttons;
- synthetic report notes;
- duplicate event creation entry points;
- disabled controls with no explanation;
- empty dashboard cards rendered only to fill layout.

- [ ] **Step 5: Run tests and commit**

```powershell
npx vitest run tests/server/ui-copy-contract.test.ts tests/server/page-state-contract.test.tsx
npx eslint src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/components/app-sidebar.tsx src/features/giveaways/organizer-giveaway-workspace.tsx
git add -- src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/components/app-sidebar.tsx src/features/giveaways/organizer-giveaway-workspace.tsx tests/server/ui-copy-contract.test.ts
git commit -m "fix: make operator copy task focused"
```

Expected: pass.

---

### Task 6: Repair Error, Check-In, Claim, and Draw States

**Files:**
- Modify: `src/features/check-in/rider-self-check-in-screen.tsx`
- Modify: `src/features/giveaways/giveaway-claim-screen.tsx`
- Modify: `src/features/giveaways/giveaway-claim-scanner-panel.tsx`
- Modify: `src/features/giveaways/giveaway-presentation-stage.tsx`
- Modify: `src/features/giveaways/giveaway-operator-workspace.tsx`
- Modify: relevant route pages.
- Modify: `tests/server/page-state-contract.test.tsx`

- [ ] **Step 1: Write failing state-matrix tests**

For each route surface, assert a stable heading/action matrix:

| Context | Heading | Recovery |
| --- | --- | --- |
| invalid check-in link | “Check-in link is invalid” | “View events” |
| expired check-in link | “Check-in link has expired” | “View event” when known |
| already checked in | “You’re already checked in” | “View pass” |
| unavailable award | “This prize can’t be claimed” | “View my passes” |
| operator forbidden | “Claim desk unavailable” | “Back to giveaways” |
| draw unavailable | “Draw unavailable” | “Back to giveaways” |
| missing event/report/pass | specific not-found title | parent collection |

Expected status detail remains in body text; never use an error code as the visible title.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/server/page-state-contract.test.tsx
```

- [ ] **Step 3: Adopt the shared state component**

Replace visually styled generic cards where they represent a full-page terminal state. Preserve specialized successful claim/check-in presentations.

- [ ] **Step 4: Add useful unavailable actions**

Every terminal state gets the nearest safe route. Never link a forbidden user back into the forbidden detail. Encode dynamic route segments.

- [ ] **Step 5: Check announcements**

Mutation results use a nearby `aria-live="polite"` region. A destructive or blocking failure may use `role="alert"`. Do not announce static explanatory text on first render.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/server/page-state-contract.test.tsx
npx eslint src/features/check-in/rider-self-check-in-screen.tsx src/features/giveaways/giveaway-claim-screen.tsx src/features/giveaways/giveaway-claim-scanner-panel.tsx src/features/giveaways/giveaway-presentation-stage.tsx src/features/giveaways/giveaway-operator-workspace.tsx
git add -- src/features/check-in/rider-self-check-in-screen.tsx src/features/giveaways/giveaway-claim-screen.tsx src/features/giveaways/giveaway-claim-scanner-panel.tsx src/features/giveaways/giveaway-presentation-stage.tsx src/features/giveaways/giveaway-operator-workspace.tsx tests/server/page-state-contract.test.tsx
git commit -m "fix: add useful terminal page states"
```

Expected: pass.

---

### Task 7: Make Wide Surfaces Work at 320 Pixels

**Files:**
- Modify: `src/components/data-table.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/features/leads/lead-management-table.tsx`
- Modify: `src/features/reports/admin-report-dashboard.tsx`
- Modify: `src/features/reports/organizer-report-dashboard.tsx`
- Modify: affected CSS modules and `src/app/globals.css`.
- Create: `tests/server/responsive-surface-contract.test.ts`

- [ ] **Step 1: Write failing responsive contracts**

Require:

- each data table is inside a local `overflow-x-auto` region, never widening the page;
- critical admin users/leads/event-review actions have a stacked mobile card or labeled row alternative;
- filters wrap and remain usable;
- chart containers use `min-width: 0`;
- long titles, URLs, and attendee names wrap;
- dialogs fit the viewport with scrollable bodies;
- fixed/sticky controls account for safe-area insets;
- images use `max-width: 100%`.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/server/responsive-surface-contract.test.ts
```

- [ ] **Step 3: Harden the shared table**

The page remains `overflow-x: clip` only as a last guard; the table’s own wrapper owns horizontal scrolling. Add an accessible label to the region. Do not hide required columns solely with CSS if that removes information.

- [ ] **Step 4: Add mobile record layouts for decision-heavy tables**

For admin users, admin leads, event review, and organizer event rows, render stacked key/value content with the primary action visible. Use CSS breakpoints to show either the cards or the table, not both to assistive technology.

- [ ] **Step 5: Fix chart, dialog, and media sizing**

Use `min-w-0`, bounded chart height, `max-h-[calc(100dvh-...)]`, and local scrolling. Avoid hard-coded content widths greater than 320px.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/server/responsive-surface-contract.test.ts
npx eslint src/components/data-table.tsx src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/features/leads/lead-management-table.tsx src/features/reports/admin-report-dashboard.tsx src/features/reports/organizer-report-dashboard.tsx
git add -- src/components/data-table.tsx src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/features/leads/lead-management-table.tsx src/features/reports/admin-report-dashboard.tsx src/features/reports/organizer-report-dashboard.tsx src/app/globals.css tests/server/responsive-surface-contract.test.ts
git commit -m "fix: harden narrow UI surfaces"
```

Expected: pass.

---

### Task 8: Run the UI and Content Slice Gate

**Files:**
- Verify only; fix only UI/content defects discovered by these gates.

- [ ] **Step 1: Run focused contract tests**

```powershell
npx vitest run tests/server/metadata-contract.test.ts tests/server/ui-copy-contract.test.ts tests/server/shell-accessibility.test.tsx tests/server/page-state-contract.test.tsx tests/server/public-page-semantics.test.tsx tests/server/responsive-surface-contract.test.ts
```

Expected: pass.

- [ ] **Step 2: Scan for known remnants**

```powershell
rg -n -i "\"[^\"]*(prototype|demo data|Save lead|Leads & validation|Footer workspace links|Fast paths for the active event workspace|one entry-point policy for this release)[^\"]*\"" src --glob '*.tsx' --glob '*.ts'
rg -n "generateStaticParams|autoFocus|href=[\"']#[\"']" src/app src/components src/features
```

Expected: no user-facing banned copy, demo-only static params, passive autofocus, or placeholder links.

- [ ] **Step 3: Check route metadata and headings in Codex browser**

Open all 41 route patterns with suitable disposable records/roles. For each, record:

- document title;
- meta description;
- visible `h1`;
- terminal-state action when applicable.

Expected: accurate, specific, and no private record leakage.

- [ ] **Step 4: Check responsive shell and known problem pages**

At 320px and 390x844, verify:

- global header/menu;
- `/events/[eventId]`;
- `/profile`;
- `/admin/users`;
- `/admin/leads`;
- `/admin/events/review`;
- `/organizer/events`;
- organizer giveaway editor;
- admin and organizer reports.

For every page:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

Expected: `true`. Locally scrollable tables may have internal overflow.

- [ ] **Step 5: Run static/build gates**

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all exit 0.
