# Structured Event Schedule and Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store real event schedules, let organizers choose one-time or weekly recurrence, generate public date labels, and order discovery by the current or nearest occurrence.

**Architecture:** Add one focused, framework-independent schedule module that validates organizer input, derives display labels, calculates weekly occurrences, and sorts events. Persist nullable schedule fields beside the existing labels for safe migration, then make new organizer-created events use the structured schedule as the source of truth while legacy rows remain readable.

**Tech Stack:** TypeScript 5, React 19, Next.js 16 App Router, Prisma 7/PostgreSQL, Vitest 4, native `Intl.DateTimeFormat`

## Global Constraints

- Public order is: ongoing, nearest upcoming, most recently finished, then unscheduled.
- Supported recurrence values are `NONE` and `WEEKLY`.
- Store timestamps in UTC and preserve the IANA timezone separately.
- Default organizer timezone is `Asia/Manila`.
- Do not create per-occurrence event or RSVP records.
- Preserve RSVP, attendee privacy, check-in, giveaway, and event-detail behavior.
- Keep `dateLabel` and `timeLabel` as migration fallbacks.
- Read the installed Next.js 16 forms and Server Actions guides before changing Next.js components or actions.
- Reuse `http://localhost:3000`; do not start a second dev server.
- Do not run `npm run build`.
- Do not apply a database migration to a live environment without explicit environment approval.
- Preserve unrelated dirty-worktree changes.

---

### Task 1: Schedule Domain Module

**Files:**
- Create: `src/features/tambike-demo/event-schedule.ts`
- Create: `tests/server/event-schedule.test.ts`
- Modify: `src/features/tambike-demo/types.ts:144-170`
- Modify: `src/features/tambike-demo/event-state.ts:1-84`

**Interfaces:**
- Produces:
  - `EventRecurrence = "NONE" | "WEEKLY"`
  - `EventScheduleInput`
  - `EventSchedule`
  - `parseEventScheduleInput(input): EventSchedule`
  - `getRelevantEventOccurrence(schedule, now): EventOccurrence`
  - `formatEventSchedule(schedule, now): { date: string; time: string }`
  - `compareEventsBySchedule(left, right, now): number`
- Consumes: native `Date` and `Intl.DateTimeFormat`; no new package.

- [ ] **Step 1: Extend the event types and write failing schedule tests**

Add these contracts to `types.ts`:

```ts
export type EventRecurrence = "NONE" | "WEEKLY";

export interface EventScheduleInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  recurrence: EventRecurrence;
  recurrenceEndsOn?: string;
}

export interface EventSchedule {
  startsAt: string;
  endsAt: string;
  timeZone: string;
  recurrence: EventRecurrence;
  recurrenceEndsAt?: string;
}
```

Make `CreateEventInput` extend `EventScheduleInput` and remove its `date` and `time` properties. Add the optional schedule properties to `Event` while keeping `date` and `time` as formatted compatibility fields:

```ts
export interface Event extends EventLocationInput {
  // existing properties
  date: string;
  time: string;
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
  recurrence?: EventRecurrence;
  recurrenceEndsAt?: string;
}
```

Create `event-schedule.test.ts` with fixed timestamps that prove:

```ts
const oneTimeInput: EventScheduleInput = {
  startDate: "2026-09-19",
  startTime: "18:00",
  endDate: "2026-09-19",
  endTime: "20:00",
  timeZone: "Asia/Manila",
  recurrence: "NONE",
};

expect(parseEventScheduleInput(oneTimeInput)).toEqual({
  startsAt: "2026-09-19T10:00:00.000Z",
  endsAt: "2026-09-19T12:00:00.000Z",
  timeZone: "Asia/Manila",
  recurrence: "NONE",
});
```

Also cover:

- missing/invalid calendar values throw `EventScheduleValidationError`;
- end equal to or before start throws;
- an invalid IANA timezone throws;
- recurrence end before the first occurrence throws;
- one-time labels equal `Sat · Sep 19, 2026` and `6:00 PM – 8:00 PM`;
- the Cafe Classico weekly schedule displays `Every Saturday`;
- an occurrence active at `2026-08-01T10:30:00.000Z` is `ONGOING`;
- the next occurrence after it ends starts at `2026-08-08T10:00:00.000Z`;
- an expired weekly series is `PAST`;
- sorting yields ongoing, nearest upcoming, farther upcoming, newest past, older past, unscheduled.

- [ ] **Step 2: Run the schedule test and verify the red state**

Run:

```powershell
npx vitest run tests/server/event-schedule.test.ts
```

Expected: FAIL because `event-schedule.ts` and the new schedule contracts do not exist.

- [ ] **Step 3: Implement schedule parsing, formatting, occurrence state, and comparison**

Implement these exported shapes in `event-schedule.ts`:

```ts
export type EventScheduleState = "ONGOING" | "UPCOMING" | "PAST" | "UNSCHEDULED";

export interface EventOccurrence {
  state: EventScheduleState;
  startsAt?: Date;
  endsAt?: Date;
}

export class EventScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventScheduleValidationError";
  }
}

export function parseEventScheduleInput(input: EventScheduleInput): EventSchedule;

export function getRelevantEventOccurrence(
  schedule: Partial<EventSchedule>,
  now?: Date,
): EventOccurrence;

export function formatEventSchedule(
  schedule: EventSchedule,
  now?: Date,
): { date: string; time: string };

export function compareEventsBySchedule(
  left: Pick<Event, "id" | "startsAt" | "endsAt" | "timeZone" | "recurrence" | "recurrenceEndsAt">,
  right: Pick<Event, "id" | "startsAt" | "endsAt" | "timeZone" | "recurrence" | "recurrenceEndsAt">,
  now?: Date,
): number;
```

Use `Intl.DateTimeFormat(...).formatToParts()` for timezone parts and a bounded correction loop to convert organizer wall-clock values to UTC. Reject impossible local values by formatting the result back into the selected timezone and comparing every date/time part.

For weekly recurrence, calculate whole-week candidates from the first occurrence, retain the original duration, and enforce `recurrenceEndsAt`. Comparison ranks states with:

```ts
const stateRank: Record<EventScheduleState, number> = {
  ONGOING: 0,
  UPCOMING: 1,
  PAST: 2,
  UNSCHEDULED: 3,
};
```

Within states compare ongoing by `endsAt` ascending, upcoming by `startsAt` ascending, past by `endsAt` descending, then `id` ascending.

Update `isEventPast` in `event-state.ts` to prefer `getRelevantEventOccurrence(event, now)` when structured fields exist and retain `explicitDateFromLabel` only for legacy events.

- [ ] **Step 4: Run focused domain tests**

Run:

```powershell
npx vitest run tests/server/event-schedule.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the domain unit**

```powershell
git add src/features/tambike-demo/event-schedule.ts src/features/tambike-demo/types.ts src/features/tambike-demo/event-state.ts tests/server/event-schedule.test.ts
git commit -m "feat: add structured event schedule domain"
```

---

### Task 2: Prisma Schedule Persistence

**Files:**
- Modify: `prisma/schema.prisma:365-405`
- Create: `prisma/migrations/20260730000000_structured_event_schedule/migration.sql`
- Create: `tests/server/event-schedule-prisma-contract.test.ts`

**Interfaces:**
- Consumes: `EventRecurrence` values `NONE` and `WEEKLY`.
- Produces nullable Prisma `Event` fields: `startsAt`, `endsAt`, `timeZone`, `recurrence`, and `recurrenceEndsAt`.

- [ ] **Step 1: Add a failing Prisma schema contract**

Extend the existing schema contract test, or create the named file only if no matching schema contract exists, to assert:

```ts
expect(schema).toContain("enum EventRecurrence");
expect(schema).toContain('NONE');
expect(schema).toContain('WEEKLY');
expect(eventModel).toContain("startsAt");
expect(eventModel).toContain("endsAt");
expect(eventModel).toContain("timeZone");
expect(eventModel).toContain("recurrence");
expect(eventModel).toContain("recurrenceEndsAt");
```

Also assert the migration adds nullable columns and does not drop `dateLabel` or `timeLabel`.

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```powershell
npx vitest run tests/server/event-schedule-prisma-contract.test.ts
```

Expected: FAIL because the schedule schema is absent.

- [ ] **Step 3: Add the enum, fields, and migration SQL**

Add to `schema.prisma`:

```prisma
enum EventRecurrence {
  NONE
  WEEKLY
}
```

Add to `Event`:

```prisma
startsAt         DateTime?
endsAt           DateTime?
timeZone         String?         @db.VarChar(80)
recurrence       EventRecurrence?
recurrenceEndsAt DateTime?
```

Create the migration:

```sql
CREATE TYPE "EventRecurrence" AS ENUM ('NONE', 'WEEKLY');

ALTER TABLE "Event"
ADD COLUMN "startsAt" TIMESTAMP(3),
ADD COLUMN "endsAt" TIMESTAMP(3),
ADD COLUMN "timeZone" VARCHAR(80),
ADD COLUMN "recurrence" "EventRecurrence",
ADD COLUMN "recurrenceEndsAt" TIMESTAMP(3);

CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");
```

Add `@@index([startsAt])` to the Prisma model.

- [ ] **Step 4: Generate the client without applying the migration**

Run:

```powershell
npm run db:generate
npx vitest run tests/server/event-schedule-prisma-contract.test.ts
```

Expected: Prisma generation succeeds and the contract test passes. Do not run `prisma migrate dev` against an unconfirmed database.

- [ ] **Step 5: Commit the persistence unit**

```powershell
git add prisma/schema.prisma prisma/migrations/20260730000000_structured_event_schedule/migration.sql tests/server/event-schedule-prisma-contract.test.ts
git commit -m "feat: persist structured event schedules"
```

---

### Task 3: Backend Validation, Formatting, and Ordering

**Files:**
- Modify: `src/server/backend.ts:1382-1435,4826-4832`
- Modify: `src/server/prisma-backend.ts:4726-4795,5495-5535,9800-9845`
- Modify: `tests/server/backend-domain.test.ts:210-315`
- Modify: `tests/server/support/tambike-fixtures.ts:50-70`
- Create: `tests/server/event-schedule-prisma-backend-contract.test.ts`

**Interfaces:**
- Consumes:
  - `parseEventScheduleInput(input): EventSchedule`
  - `formatEventSchedule(schedule): { date: string; time: string }`
  - `compareEventsBySchedule(left, right, now): number`
- Produces: identical schedule behavior from the in-memory and Prisma backends.

- [ ] **Step 1: Convert backend tests and fixtures to structured schedule input**

Replace fixture label input:

```ts
date: "July 25, 2099",
time: "6:00 PM - 9:00 PM",
```

with:

```ts
startDate: "2099-07-25",
startTime: "18:00",
endDate: "2099-07-25",
endTime: "21:00",
timeZone: "Asia/Manila",
recurrence: "NONE",
```

Add domain tests proving:

- an organizer-created event returns ISO schedule fields and formatted `date`/`time`;
- invalid timezone is `INVALID_INPUT`;
- end-before-start is `INVALID_INPUT`;
- weekly recurrence returns an `Every <weekday>` label;
- `listEvents()` sorts structured events chronologically rather than insertion order;
- a query result retains chronological order.

Use fixed event values rather than the current clock for ordering assertions.

- [ ] **Step 2: Run the backend tests and verify they fail**

Run:

```powershell
npx vitest run tests/server/backend-domain.test.ts tests/server/event-schedule-prisma-backend-contract.test.ts
```

Expected: FAIL because both backends still expect label strings and do not sort by schedule.

- [ ] **Step 3: Update the in-memory backend**

In `createEventDraft`:

```ts
let schedule: EventSchedule;
try {
  schedule = parseEventScheduleInput(input);
} catch (error) {
  if (error instanceof EventScheduleValidationError) {
    throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  }
  throw error;
}
const labels = formatEventSchedule(schedule);
```

Build the event with:

```ts
date: labels.date,
time: labels.time,
...schedule,
```

Remove the old `input.date.trim()` and `input.time.trim()` checks. In `listEvents`, apply the query filter first and then:

```ts
return filterEventsByQuery(events, query).sort((left, right) =>
  compareEventsBySchedule(left, right),
);
```

- [ ] **Step 4: Update the Prisma backend**

Write the structured values during `prisma.event.create`:

```ts
startsAt: new Date(schedule.startsAt),
endsAt: new Date(schedule.endsAt),
timeZone: schedule.timeZone,
recurrence: schedule.recurrence,
recurrenceEndsAt: schedule.recurrenceEndsAt
  ? new Date(schedule.recurrenceEndsAt)
  : null,
dateLabel: labels.date,
timeLabel: labels.time,
```

In `toEvent`, prefer schedule-derived labels whenever all required schedule fields exist:

```ts
const schedule =
  event.startsAt && event.endsAt && event.timeZone && event.recurrence
    ? {
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        timeZone: event.timeZone,
        recurrence: event.recurrence,
        recurrenceEndsAt: event.recurrenceEndsAt?.toISOString(),
      }
    : undefined;
const labels = schedule
  ? formatEventSchedule(schedule)
  : { date: event.dateLabel, time: event.timeLabel };
```

Return `...schedule`, `date: labels.date`, and `time: labels.time`. Sort the mapped/filter results with `compareEventsBySchedule`; keep the database `createdAt` ordering only as a stable legacy input order.

- [ ] **Step 5: Run backend tests**

Run:

```powershell
npx vitest run tests/server/backend-domain.test.ts tests/server/event-schedule-prisma-backend-contract.test.ts tests/server/event-schedule.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the backend unit**

```powershell
git add src/server/backend.ts src/server/prisma-backend.ts tests/server/backend-domain.test.ts tests/server/event-schedule-prisma-backend-contract.test.ts tests/server/support/tambike-fixtures.ts
git commit -m "feat: validate and order event schedules"
```

---

### Task 4: Seed and Legacy Compatibility

**Files:**
- Modify: `src/features/tambike-demo/data.ts`
- Modify: `prisma/seed.ts:140-165`
- Create: `src/server/maintenance/event-schedule-backfill.ts`
- Create: `scripts/backfill-event-schedules.ts`
- Create: `tests/server/event-schedule-backfill.test.ts`

**Interfaces:**
- Consumes: schedule parsing and formatting from `event-schedule.ts`.
- Produces:
  - structured demo events;
  - `planEventScheduleBackfill(rows)` returning explicit proposed updates;
  - a dry-run-by-default maintenance script.

- [ ] **Step 1: Write failing seed/backfill tests**

Assert the Cafe Classico demo event contains:

```ts
startsAt: "2026-08-01T10:00:00.000Z",
endsAt: "2026-08-01T12:00:00.000Z",
timeZone: "Asia/Manila",
recurrence: "WEEKLY",
```

Test backfill planning with:

- Cafe Classico’s exact known schedule;
- an explicit parseable one-time date/time row;
- an unparseable `onwards` row that is returned as skipped;
- no update for a row that already has structured fields.

The script contract must prove no write occurs unless `--apply` is present.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npx vitest run tests/server/event-schedule-backfill.test.ts tests/server/event-brief-copy-cleanup.test.ts
```

Expected: FAIL because demo schedules and backfill planning are absent.

- [ ] **Step 3: Add structured schedules to demo data and seed persistence**

Add ISO schedule fields to all demo events whose date and time are unambiguous. Use 2026 for existing yearless 2026 fixture entries. Leave genuinely ambiguous `onwards` entries without structured fields so they use the documented legacy fallback.

Update `prisma/seed.ts` to pass:

```ts
startsAt: event.startsAt ? new Date(event.startsAt) : null,
endsAt: event.endsAt ? new Date(event.endsAt) : null,
timeZone: event.timeZone ?? null,
recurrence: event.recurrence ?? null,
recurrenceEndsAt: event.recurrenceEndsAt
  ? new Date(event.recurrenceEndsAt)
  : null,
```

Preserve `dateLabel: event.date` and `timeLabel: event.time`.

- [ ] **Step 4: Implement safe backfill planning and script gating**

`planEventScheduleBackfill` must return:

```ts
interface EventScheduleBackfillPlan {
  updates: Array<{ id: string; schedule: EventSchedule; dateLabel: string; timeLabel: string }>;
  skipped: Array<{ id: string; reason: string }>;
}
```

The script prints the proposed IDs and skipped reasons. It calls Prisma updates only when `process.argv.includes("--apply")`. Even with `--apply`, require an explicit environment name argument and print it before the first write.

- [ ] **Step 5: Run the compatibility tests**

Run:

```powershell
npx vitest run tests/server/event-schedule-backfill.test.ts tests/server/event-brief-copy-cleanup.test.ts tests/server/public-seed-label-cleanup.test.ts
```

Expected: PASS. Do not run the backfill with `--apply`.

- [ ] **Step 6: Commit the compatibility unit**

```powershell
git add src/features/tambike-demo/data.ts prisma/seed.ts src/server/maintenance/event-schedule-backfill.ts scripts/backfill-event-schedules.ts tests/server/event-schedule-backfill.test.ts
git commit -m "feat: migrate known event schedules safely"
```

---

### Task 5: Organizer Schedule Controls

**Files:**
- Modify: `src/features/organizer/organizer-console.tsx:610-710`
- Modify: `tests/tambike-demo.spec.ts:1035-1080`
- Create: `tests/server/event-schedule-organizer-ui-contract.test.ts`

**Interfaces:**
- Consumes: `CreateEventInput` schedule fields.
- Produces: accessible native date/time controls and weekly recurrence selection.

- [ ] **Step 1: Read the installed Next.js 16 guides**

Read completely:

```powershell
Get-Content node_modules\next\dist\docs\01-app\02-guides\forms.md -Raw
Get-Content node_modules\next\dist\docs\01-app\02-guides\server-actions.md -Raw
```

Confirm the existing client-side submit/action pattern remains supported. Do not change it solely for style.

- [ ] **Step 2: Write failing organizer UI assertions**

Replace `Date label` and `Time label` expectations with:

```ts
expect(screen.getByLabelText("Start date")).toHaveAttribute("type", "date");
expect(screen.getByLabelText("Start time")).toHaveAttribute("type", "time");
expect(screen.getByLabelText("End date")).toHaveAttribute("type", "date");
expect(screen.getByLabelText("End time")).toHaveAttribute("type", "time");
expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Manila");
expect(screen.getByLabelText("Repeat")).toHaveValue("NONE");
expect(screen.queryByLabelText("Repeat until")).not.toBeInTheDocument();
```

Also prove selecting `WEEKLY` reveals `Repeat until`, and submitted form data contains the schedule fields without `date` or `time`.

- [ ] **Step 3: Run the organizer test and verify it fails**

Run the exact existing organizer contract test file plus:

```powershell
npx vitest run tests/server/event-schedule-organizer-ui-contract.test.ts tests/server/backend-domain.test.ts
```

Expected: FAIL on missing native schedule controls.

- [ ] **Step 4: Implement the compact responsive schedule form**

Add local recurrence state:

```ts
const [recurrence, setRecurrence] = useState<EventRecurrence>("NONE");
```

Submit:

```ts
startDate: String(formData.get("startDate") ?? ""),
startTime: String(formData.get("startTime") ?? ""),
endDate: String(formData.get("endDate") ?? ""),
endTime: String(formData.get("endTime") ?? ""),
timeZone: String(formData.get("timeZone") ?? "Asia/Manila"),
recurrence,
recurrenceEndsOn:
  recurrence === "WEEKLY"
    ? String(formData.get("recurrenceEndsOn") ?? "")
    : undefined,
```

Use native inputs:

```tsx
<Field label="Start date">
  <Input name="startDate" type="date" required />
</Field>
<Field label="Start time">
  <Input name="startTime" type="time" required />
</Field>
<Field label="End date">
  <Input name="endDate" type="date" required />
</Field>
<Field label="End time">
  <Input name="endTime" type="time" required />
</Field>
```

Add a timezone select with `Asia/Manila` as the current supported choice and a repeat select with `NONE`/`WEEKLY`. Render the optional recurrence end date only for weekly events. Keep backend validation authoritative and retain the existing concise form error area.

- [ ] **Step 5: Run organizer tests**

Run the focused organizer contract test and:

```powershell
npx vitest run tests/server/event-schedule-organizer-ui-contract.test.ts tests/server/backend-domain.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the organizer unit**

```powershell
git add src/features/organizer/organizer-console.tsx tests/tambike-demo.spec.ts tests/server/event-schedule-organizer-ui-contract.test.ts
git commit -m "feat: add organizer event schedule controls"
```

---

### Task 6: Discovery Ordering and Final Verification

**Files:**
- Modify: `src/features/tambike-demo/tambike-screen.tsx:560-570`
- Create: `tests/server/event-discovery-ordering-contract.test.ts`
- Modify: `tests/tambike-demo.spec.ts:35-70`

**Interfaces:**
- Consumes: `compareEventsBySchedule`.
- Produces: the same chronological order for server-backed and static public event collections.

- [ ] **Step 1: Write a failing discovery-order test**

Build a test collection in deliberately incorrect source order:

```ts
[
  makeEvent({ id: "unscheduled" }),
  makeEvent({ id: "farther", startsAt: "2026-08-08T10:00:00.000Z" }),
  makeEvent({ id: "recent-past", startsAt: "2026-07-29T10:00:00.000Z", endsAt: "2026-07-29T12:00:00.000Z" }),
  makeEvent({ id: "nearest", startsAt: "2026-08-01T10:00:00.000Z" }),
]
```

At a fixed `now`, assert visible card IDs are:

```ts
["nearest", "farther", "recent-past", "unscheduled"]
```

Apply a query/category filter and assert the remaining cards keep the same relative schedule order.

- [ ] **Step 2: Run the discovery test and verify it fails**

Run the exact event discovery UI contract test file.

```powershell
npx vitest run tests/server/event-discovery-ordering-contract.test.ts
```

Expected: FAIL because `tambike-screen.tsx` still preserves source order.

- [ ] **Step 3: Sort public events before feature selection and filtering**

In the discovery view:

```ts
const publicEvents = events
  .filter((event) => event.status === "PUBLISHED" || event.status === "ONGOING")
  .sort((left, right) => compareEventsBySchedule(left, right));
```

Keep `filterEventsByQuery` and the active category filter order-preserving. Ensure featured-event selection receives the chronologically sorted array so it does not reintroduce creation order.

- [ ] **Step 4: Run focused and full server verification**

Run:

```powershell
npx vitest run tests/server/event-schedule.test.ts tests/server/backend-domain.test.ts tests/server/event-schedule-backfill.test.ts
npm run test:server
npx tsc --noEmit
npm run lint
```

Expected: all feature tests and the existing server suite pass. Record any pre-existing type/lint failures separately; do not run a production build.

- [ ] **Step 5: Inspect the pending migration target without writing**

Read the configured backend/runtime mode without printing secrets. If the localhost app points to a database that lacks the migration, do not apply it. Report that browser verification of persisted schedule fields requires explicit approval for that named environment.

- [ ] **Step 6: Verify the live localhost UI with Codex Browser**

Reuse the existing `http://localhost:3000` process. Verify:

- public cards show ongoing/nearest upcoming first;
- Cafe Classico displays generated `Every Saturday`;
- organizer form uses native date/time fields;
- weekly selection reveals recurrence end;
- desktop and mobile layouts do not overflow;
- no new browser console errors.

If the connected database has not been approved/migrated, verify the non-writing UI and compatibility paths only and state the exact remaining migration gate.

- [ ] **Step 7: Review the final diff and commit**

Run:

```powershell
git diff --check
git status --short
```

Confirm every changed file belongs to this feature and that unrelated existing modifications remain untouched.

```powershell
git add prisma/schema.prisma prisma/migrations/20260730000000_structured_event_schedule src/features/tambike-demo/event-schedule.ts src/features/tambike-demo/event-state.ts src/features/tambike-demo/types.ts src/features/tambike-demo/data.ts src/features/tambike-demo/tambike-screen.tsx src/features/organizer/organizer-console.tsx src/server/backend.ts src/server/prisma-backend.ts src/server/maintenance/event-schedule-backfill.ts scripts/backfill-event-schedules.ts prisma/seed.ts tests/server/event-schedule.test.ts tests/server/event-schedule-backfill.test.ts tests/server/backend-domain.test.ts tests/server/event-schedule-prisma-contract.test.ts tests/server/event-schedule-prisma-backend-contract.test.ts tests/server/event-schedule-organizer-ui-contract.test.ts tests/server/event-discovery-ordering-contract.test.ts tests/server/support/tambike-fixtures.ts tests/tambike-demo.spec.ts docs/superpowers/specs/2026-07-30-structured-event-schedule-and-ordering-design.md docs/superpowers/plans/2026-07-30-structured-event-schedule-and-ordering.md
git commit -m "feat: add structured recurring event schedules"
```

Expected: only the enumerated feature files are staged.
