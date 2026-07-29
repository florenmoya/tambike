# Compact Event Briefs Implementation Plan

> **For Codex:** Execute this plan in the current checkout. Do not create a branch or worktree, do not start another dev server, and do not run a production build.

**Goal:** Replace the generic, sales-like event explanation and separate full-width rules card with one compact, event-specific brief that tells riders what happens and what they need to know.

**Architecture:** Add a small `EventBrief` presentation component with an exhaustive `EventType` heading map and a colocated CSS module. Keep `Event.whatHappens` and `Event.rules` as the source of truth, rewrite all seeded event copy, and use a guarded preview-first maintenance command to update existing database rows only when their current descriptions still match the known legacy values.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Vitest, Prisma 7/PostgreSQL.

---

## Task 1: Lock down the event brief contract

**Files:**
- Create: `src/features/tambike-demo/event-brief.tsx`
- Create: `src/features/tambike-demo/event-brief.module.css`
- Create: `tests/server/event-brief.test.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`

**Step 1: Read the installed Next.js guides**

Read these files completely before changing the Client Component or adding the CSS module:

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`

**Step 2: Write the failing component test**

Render `EventBrief` with a Tambike description and rules. Assert that it shows:

- eyebrow `The plan`
- heading `Coffee, bikes, and conversation`
- the supplied description
- quiet label `Good to know`
- every supplied rule

Assert that it does not show the retired labels `What to expect`, `A relaxed rider meetup`, `Rules`, or `Safety and venue notes`.

Add a table-driven assertion for every `EventType`:

| Event type | Heading |
| --- | --- |
| Tambike | Coffee, bikes, and conversation |
| Bike Night | An easy night with fellow riders |
| Coffee Ride | A social ride with a coffee stop |
| Club EB | Time with the club and riding community |
| Brand Event | Meet riders and see what is happening |
| Test Ride | Try the bikes and understand the process |
| Charity Ride | Ride together for a cause |
| Track Day | Track sessions and paddock time |
| Endurance Ride | A long ride with planned checkpoints |
| Moto Expo | Bikes, booths, and community |
| Race | Race-day viewing and rider support |

Run:

```powershell
npx vitest run tests/server/event-brief.test.tsx
```

Expected: FAIL because `EventBrief` does not exist.

**Step 3: Implement the smallest component**

Create an exhaustive `Record<EventType, string>` for headings and render:

```tsx
<section aria-labelledby={headingId}>
  <span>The plan</span>
  <h2 id={headingId}>{heading}</h2>
  <p>{description}</p>
  {rules.length > 0 ? (
    <div aria-label="Good to know">
      <span>Good to know</span>
      <ul>{/* compact rule chips */}</ul>
    </div>
  ) : null}
</section>
```

Use `useId()` so the reusable heading association is valid. Keep the rules visible but visually secondary: small neutral chips, wrapping naturally instead of occupying a separate card.

**Step 4: Integrate into the detail page**

Import `EventBrief` into `tambike-screen.tsx`. Replace both:

- `<InfoPanel eyebrow="What to expect" ...>`
- `<InfoPanel eyebrow="Rules" ...>`

with one `EventBrief` near the top of `.event-detail-sections`. Leave perk, venue, ride/meetup, organizer, and giveaway sections unchanged.

**Step 5: Make it responsive**

In the CSS module:

- constrain the reading width of the description
- use compact padding and gaps with `clamp()`
- allow rules to wrap
- reduce title size and chip density below 640px
- avoid fixed widths or viewport-dependent empty columns

**Step 6: Run the focused test**

```powershell
npx vitest run tests/server/event-brief.test.tsx
```

Expected: PASS.

**Step 7: Commit only this task**

Because `tambike-screen.tsx` already contains unrelated working changes, stage only the import and event-detail integration hunks plus the new files.

```powershell
git commit -m "feat: add compact event brief"
```

## Task 2: Rewrite every seeded event description

**Files:**
- Create: `tests/server/event-brief-copy.test.ts`
- Modify: `src/features/tambike-demo/data.ts`

**Step 1: Write the failing copy-quality test**

Assert that all 24 `demoEvents`:

- have one or two sentences in `whatHappens`
- remain concise enough for the compact brief
- do not contain internal or promotional wording such as `scan in`, `save ... leads`, `record ... report`, `validation`, `priority perks`, `unlock`, `exclusive`, or `don't miss`

Also assert the approved Cafe Classico copy exactly:

> Park with the group, grab a drink, and meet riders over bikes and road stories. Come by on your own or with friends; there is no ride-out or fixed program.

Run:

```powershell
npx vitest run tests/server/event-brief-copy.test.ts
```

Expected: FAIL on the current operational descriptions.

**Step 2: Replace all `whatHappens` values**

Use the following rider-facing copy:

| Event ID | New description |
| --- | --- |
| `tambike-cafe-classico` | Park with the group, grab a drink, and meet riders over bikes and road stories. Come by on your own or with friends; there is no ride-out or fixed program. |
| `motoir-national-round-5` | Watch the weekend's race heats from the spectator areas and follow paddock access signs around the circuit. Teams and riders follow the posted schedule, which may change during the day. |
| `motul-motoir-youth-cup-15-16` | Watch the final Youth Cup races from the spectator areas while teams prepare in the paddock. Access and race timing follow the circuit marshals and posted schedule. |
| `petron-sgp-round-3` | Watch the scooter race heats from the spectator areas and follow the posted race schedule. Circuit staff will share updates if timings change. |
| `calabarzon-endurance-ride` | Meet before dawn for briefing and batch release, then ride the planned CALABARZON loop with checkpoint stops. This is a long group ride, not a race. |
| `laguna-motofest-2026` | Walk through motorcycle displays and club booths at your own pace, with a two-day program happening around the venue. Check the onsite schedule for talks or activities you want to join. |
| `ngo-street-drag-final-2026` | Watch the final street-drag rounds from the marked spectator areas while teams move through staging. Follow marshal directions and the day's posted run order. |
| `ir-ph-endurance-rd3` | Registered teams check in, confirm paddock assignments, and follow the endurance schedule at Tarlac Circuit Hill. Advance registration is required; there is no onsite entry. |
| `mindanao-wide-motocross-2026-2nd-leg` | Watch the motocross heats from the assigned spectator areas while riders move through staging. Track access is limited to marshaled competitors. |
| `arai-hjc-charity-ride` | Meet at Shell Pugon, hand over any cash or in-kind donation through the organizers, then roll out by batch to Pililla. This is a group charity ride, not a race. |
| `ducati-track-day-clark` | Registered riders attend the safety briefing and gear inspection before joining their assigned track sessions. Test-ride slots and paddock support are handled onsite. |
| `long-ride-charity-zambales` | Meet before dawn, join your assigned convoy, and follow the north route with the group. This is a long charity ride at legal road speeds, not a race. |
| `mandirigma-endutour-v5` | Choose the correct route category, attend briefing, and complete the marked checkpoints before returning for validation. It is an endurance route, not a race. |
| `motoir-national-round-4` | Watch the scheduled race heats from the spectator areas and follow pit and paddock access signs. Event staff will share updates if race timing changes. |
| `makina-moto-expo-cebu` | Walk through motorcycle launches, gear displays, and brand booths at your own pace. Test-ride eligibility and queues are handled by each booth onsite. |
| `tambike-night-malabon` | Park with the group, grab food or a drink if you like, and spend the evening talking bikes. There is no ride-out or fixed program. |
| `boys-underbone-laguna-tambike` | Park with the group, meet other underbone riders, and spend the meetup talking bikes and getting to know the community. New riders can come on their own or with friends. |
| `swabz-classic-bike-tambike` | Bring your classic bike, park with the group, and meet other riders during the shop's reopening tambike. Raffle check-in is handled onsite. |
| `yloco-bandits-classic-tambike` | Park at Bro's Brew, grab a coffee, and meet classic-bike riders from the north. Come by on your own or with friends; the meetup stays at the venue. |
| `kape-mo-to-tagaytay-tambike` | Park at the motorist station, grab a drink, and meet riders passing through Tagaytay. This is a stationary tambike with no ride-out. |
| `fullprint-manila-tambike` | Park near the cafe, grab breakfast, and spend the morning with motorcycle and e-scooter riders. Partner displays are available to browse onsite. |
| `boys-garage-crossmeet-tambike` | Park with your group, meet riders from the other clubs, and support the cause while hanging out over coffee. The meetup stays at the venue with no stunts or ride-out. |
| `ccph-upper-east-tambike` | Park with the chapter, meet other riders, and spend the evening around the bikes. Raffle registration is handled onsite. |
| `ccph-cebu-official-tambike` | Park with the Cebu chapters and spend the meetup talking bikes and meeting the local community. The event stays focused on parked bikes rather than a ride-out. |

The word `validation` in `mandirigma-endutour-v5` is a real route-completion step, so the test should reject sales/internal phrases rather than this legitimate use in isolation.

**Step 3: Run the copy test**

```powershell
npx vitest run tests/server/event-brief-copy.test.ts
```

Expected: PASS for all 24 events.

**Step 4: Commit**

```powershell
git add src/features/tambike-demo/data.ts tests/server/event-brief-copy.test.ts
git commit -m "content: make event plans rider focused"
```

## Task 3: Add guarded database maintenance

**Files:**
- Create: `src/server/maintenance/event-brief-copy-cleanup.ts`
- Create: `scripts/clean-event-brief-copy.ts`
- Create: `tests/server/event-brief-copy-cleanup.test.ts`
- Create: `tests/server/event-brief-copy-cleanup-cli.test.ts`
- Modify: `package.json`

**Step 1: Write failing planner and guard tests**

Cover:

1. known legacy descriptions produce `{ id, from, to }` updates
2. already-clean rows produce no updates
3. organizer-edited or unknown descriptions produce no updates
4. every seeded event ID has exactly one legacy description guard
5. apply uses `updateMany({ where: { id, whatHappens: from } })`
6. apply aborts if any guarded update count is not exactly one

Run:

```powershell
npx vitest run tests/server/event-brief-copy-cleanup.test.ts
```

Expected: FAIL because the maintenance module does not exist.

**Step 2: Implement the pure plan and guarded transaction**

Define the 24 exact legacy descriptions in an immutable map. Inspect only those event IDs. Build updates only when:

- the current database text equals that event's exact legacy text
- the new source text differs

Do not touch organizer-edited rows. During apply, update by both `id` and previewed `whatHappens`; abort and roll back if the row changed after preview.

**Step 3: Write the failing CLI test**

Use an injected fake store to assert:

- default mode is `preview`
- `--apply` is the only write path
- output includes target host/database and exact updates
- store always closes

**Step 4: Implement the CLI**

Follow the established `clean-public-seed-labels.ts` pattern:

- load existing Next environment
- require `DATABASE_URL`
- parse and print only host/database, never credentials
- preview unless `--apply` is explicitly present
- emit a JSON receipt

Add:

```json
"clean:event-brief-copy": "tsx --conditions=react-server scripts/clean-event-brief-copy.ts"
```

**Step 5: Run focused tests**

```powershell
npx vitest run tests/server/event-brief-copy-cleanup.test.ts tests/server/event-brief-copy-cleanup-cli.test.ts
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add package.json scripts/clean-event-brief-copy.ts src/server/maintenance/event-brief-copy-cleanup.ts tests/server/event-brief-copy-cleanup.test.ts tests/server/event-brief-copy-cleanup-cli.test.ts
git commit -m "feat: guard event brief copy cleanup"
```

## Task 4: Verify before any database write

**Files:**
- Verify: all files changed above

**Step 1: Run focused tests together**

```powershell
npx vitest run tests/server/event-brief.test.tsx tests/server/event-brief-copy.test.ts tests/server/event-brief-copy-cleanup.test.ts tests/server/event-brief-copy-cleanup-cli.test.ts
```

Expected: PASS.

**Step 2: Run the complete server suite**

```powershell
npm run test:server
```

Expected: PASS. Do not run `npm run build`.

**Step 3: Preview the active database**

```powershell
npm run clean:event-brief-copy
```

Expected: JSON receipt with mode `preview`, target host/database, and only exact legacy rows eligible for update.

Report the target and update count. Obtain explicit user approval for this database write before running `--apply`.

## Task 5: Apply only after approval and verify the live UI

**Files:**
- Verify: localhost event routes and active database rows

**Step 1: Apply the approved guarded plan**

```powershell
npm run clean:event-brief-copy -- --apply
```

Expected: mode `apply`; every eligible update is guarded by event ID and old text.

**Step 2: Re-run preview**

```powershell
npm run clean:event-brief-copy
```

Expected: zero updates. Query the 24 event IDs read-only and confirm the intended text.

**Step 3: Verify through the existing Codex browser**

Reuse the existing localhost server and inspect:

- `/events/tambike-cafe-classico`
- `/events/motoir-national-round-5`
- `/events/ducati-track-day-clark`

Check at representative widths:

- 3840px desktop: centered content, no oversized empty card or isolated rules row
- 1440px desktop: concise hierarchy and wrapped rules
- 390px mobile: no horizontal overflow, readable description, chips wrap without clipping

Confirm the pages show `The plan`, the correct type-aware heading, the rider-facing copy, and inline `Good to know`; confirm the retired generic panel and separate Rules card are absent.

**Step 4: Final status**

Report:

- the UI and copy outcome
- focused and full server test results
- the database target and guarded apply/zero-update verification
- desktop/mobile browser evidence
- any unrelated pre-existing worktree changes that were deliberately left untouched
