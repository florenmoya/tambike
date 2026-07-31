# Tambike Record-Backed Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace synthetic admin and organizer analytics with trustworthy 7-, 30-, and 90-day reports derived from stored Tambike records.

**Architecture:** A shared reporting contract and date-bucket module define every metric once. The memory and Prisma backends return the same serializable `OperationsReport`; server pages pass it to focused dashboards, while CSV Route Handlers serialize that same report object. Scope authorization remains in the backend, timestamps are bucketed in the event timezone with `Asia/Manila` fallback, and genuinely empty ranges render honest empty states.

**Tech Stack:** Next.js 16.2.11 App Router, Server Components, Server Actions, and Route Handlers; React 19.2.4; TypeScript 5; Prisma 7.8.0; PostgreSQL; Vitest 4.1.9; Recharts through the existing shadcn chart primitives.

## Global Constraints

- Complete the account-access, event-review, and lead-management plans first.
- Use stored events, approvals, RSVPs, check-ins, perk redemptions, and leads only.
- Never manufacture activity from demo events or hard-coded dates when a range is empty.
- Support exactly 7, 30, and 90 days; reject every other value.
- Use the event timezone when a report contains one event; otherwise use `Asia/Manila`.
- Define date ranges as calendar dates in the selected timezone, inclusive of today.
- Admins may see all events; organizers may see only events they own.
- Cards, charts, event rows, detail views, and CSVs must consume the same report contract.
- Count only confirmed check-ins in the confirmed metric; expose pending check-ins separately.
- Make no-show rate explicit: eligible registrations minus confirmed check-ins, divided by eligible registrations; zero registrations yields zero percent.
- Retained anonymized leads still count because their event, status, and `createdAt` remain.
- Treat Route Handlers and Server Actions as untrusted entry points.
- Preserve dirty worktree changes; never create an AI/Codex branch or worktree.
- Never run reporting fixtures against a remote/live database without separate explicit approval.
- Browser verification uses only the Codex browser surface; do not run Playwright.

---

## File Structure

### Create

- `src/features/reports/types.ts` — serializable ranges, metric points, summaries, and event rows.
- `src/features/reports/validation.ts` — strict range/scope parsing.
- `src/server/reporting/date-buckets.ts` — timezone-aware range and empty-bucket construction.
- `src/server/reporting/report-actions.ts` — authorized page loaders and safe action state.
- `src/server/reporting/report-csv.ts` — CSV rows generated from `OperationsReport`.
- `src/features/reports/operations-chart.tsx` — presentational chart with no synthetic fallback.
- `src/features/reports/report-range-picker.tsx` — URL-backed 7/30/90-day control.
- `src/features/reports/admin-report-dashboard.tsx` — admin summary, trend, event table, and export link.
- `src/features/reports/organizer-report-dashboard.tsx` — owner-scoped summary, trend, and event table.
- `src/features/reports/event-report-detail.tsx` — shared event detail report.
- `src/app/api/admin/exports/reports/route.ts` — admin report CSV.
- `src/app/api/organizer/exports/reports/route.ts` — owner-scoped report CSV.
- `tests/server/reporting-date-buckets.test.ts` — range/timezone boundary tests.
- `tests/server/reporting-domain.test.ts` — memory report metric tests.
- `tests/server/reporting-actions.test.ts` — loader authorization and input tests.
- `tests/server/reporting-routes.test.ts` — CSV scope and content tests.
- `tests/server/reporting-ui.test.tsx` — empty, populated, range, and accessibility contracts.
- `tests/prisma-integration/reporting.integration.test.ts` — timestamped database aggregation and scope tests.
- `prisma/migrations/20260731180000_reporting_indexes/migration.sql` — indexes supporting report filters.

### Modify

- `prisma/schema.prisma` — add only missing timestamp/scope indexes.
- `src/server/backend.ts` — implement memory report queries against recorded actions.
- `src/server/prisma-backend.ts` — implement scoped database report queries.
- `src/features/admin/admin-console.tsx` — receive and render real report content; delete synthetic helpers.
- `src/features/organizer/organizer-console.tsx` — receive and render real report content; delete synthetic helpers.
- `src/app/admin/page.tsx` — load the current admin summary.
- `src/app/admin/reports/page.tsx` — load the selected admin range.
- `src/app/admin/reports/[eventId]/page.tsx` — load real event detail and dynamic metadata.
- `src/app/organizer/dashboard/page.tsx` — load the current owner summary.
- `src/app/organizer/reports/page.tsx` — load the selected owner range.
- `src/app/organizer/events/[eventId]/report/page.tsx` — load an authorized event detail.
- `src/components/app-sidebar.tsx` — preserve report destinations while removing misleading badges/copy.
- `src/components/chart-area-interactive.tsx` — delete after all imports move to `operations-chart.tsx`.

## Core Contracts

```ts
export const REPORT_RANGE_DAYS = [7, 30, 90] as const;
export type ReportRangeDays = (typeof REPORT_RANGE_DAYS)[number];

export type ReportTrendPoint = {
  date: string; // YYYY-MM-DD in report timezone
  publishedEvents: number;
  registrations: number;
  confirmedCheckIns: number;
  perkRedemptions: number;
  leads: number;
};

export type ReportSummary = {
  publishedEvents: number;
  registrations: number;
  confirmedCheckIns: number;
  pendingCheckIns: number;
  perkRedemptions: number;
  leads: number;
  noShowRate: number;
};

export type EventReportRow = {
  eventId: string;
  title: string;
  startsAt: string;
  timezone: string;
  publishedAt?: string;
  registrations: number;
  confirmedCheckIns: number;
  pendingCheckIns: number;
  perkRedemptions: number;
  leads: number;
  noShowRate: number;
};

export type OperationsReport = {
  scope:
    | { kind: "admin" }
    | { kind: "organizer"; organizerId: string }
    | { kind: "event"; eventId: string };
  rangeDays: ReportRangeDays;
  timeZone: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  summary: ReportSummary;
  trend: ReportTrendPoint[];
  events: EventReportRow[];
};
```

The backend public surface becomes:

```ts
getAdminOperationsReport(
  sessionToken: string,
  rangeDays: ReportRangeDays,
): Promise<OperationsReport>;

getOrganizerOperationsReport(
  sessionToken: string,
  rangeDays: ReportRangeDays,
): Promise<OperationsReport>;

getEventOperationsReport(
  sessionToken: string,
  eventId: string,
  rangeDays: ReportRangeDays,
): Promise<OperationsReport>;
```

---

### Task 1: Define Range and Bucket Semantics

**Files:**
- Create: `src/features/reports/types.ts`
- Create: `src/features/reports/validation.ts`
- Create: `src/server/reporting/date-buckets.ts`
- Test: `tests/server/reporting-date-buckets.test.ts`

- [ ] **Step 1: Write failing range and timezone tests**

Cover:

- absent range defaults to 30;
- `"7"`, `"30"`, and `"90"` parse;
- `"0"`, `"31"`, arrays, and free text fail safely;
- a 7-day range contains exactly seven calendar labels including today;
- a UTC instant near midnight is assigned according to `Asia/Manila`;
- an event timezone such as `America/Los_Angeles` produces the expected label;
- invalid timezone values resolve to `Asia/Manila`;
- every empty point starts at zero.

Use a fixed `now` argument. Never read wall-clock time inside assertions.

- [ ] **Step 2: Confirm the tests fail**

```powershell
npx vitest run tests/server/reporting-date-buckets.test.ts
```

Expected: fail because the reporting modules do not exist.

- [ ] **Step 3: Implement strict parsing and calendar labels**

```ts
export function parseReportRange(value: unknown): ReportRangeDays {
  const parsed = Number(Array.isArray(value) ? value[0] : value ?? 30);
  if (parsed === 7 || parsed === 30 || parsed === 90) return parsed;
  return 30;
}

export function formatReportDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeReportTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
```

Build dates from a UTC noon cursor so daylight-saving changes cannot skip or duplicate calendar labels. Return a dense array for the entire requested range.

- [ ] **Step 4: Run focused tests**

```powershell
npx vitest run tests/server/reporting-date-buckets.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit the contract**

```powershell
git add -- src/features/reports/types.ts src/features/reports/validation.ts src/server/reporting/date-buckets.ts tests/server/reporting-date-buckets.test.ts
git commit -m "test: define reporting date semantics"
```

---

### Task 2: Implement Memory Reporting Without Demo Fallbacks

**Files:**
- Modify: `src/server/backend.ts`
- Create: `tests/server/reporting-domain.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create fixed-time fixtures covering:

- admin receives activity across every owned event;
- organizer receives only owned events;
- event scope rejects a non-owner;
- registrations use RSVP creation time;
- check-ins use their recorded timestamp and status;
- perk redemptions use `redeemedAt`;
- leads use `createdAt`, including purged leads;
- event publication uses approval decision time;
- out-of-range activity is excluded;
- no activity returns dense zero buckets and no invented event row;
- card totals equal the sum of chart points for additive metrics.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/server/reporting-domain.test.ts
```

Expected: fail because report methods are missing.

- [ ] **Step 3: Add recorded timestamps to memory actions where missing**

When an in-memory operation creates or changes a reportable record, save the operation timestamp in the same mutation. Do not derive activity from the event start date or from current time during report reads.

- [ ] **Step 4: Implement one memory aggregation path**

Use one private method:

```ts
private buildOperationsReport(input: {
  scope: OperationsReport["scope"];
  rangeDays: ReportRangeDays;
  eventIds: Set<string>;
  timeZone: string;
  now?: Date;
}): OperationsReport
```

Initialize dense buckets first, scan only authorized records, and increment summary, bucket, and event counters from the same accepted record. Compute `noShowRate` once through a shared helper.

- [ ] **Step 5: Run tests**

```powershell
npx vitest run tests/server/reporting-domain.test.ts tests/server/backend-domain.test.ts
```

Expected: pass without changing unrelated backend behavior.

- [ ] **Step 6: Commit memory reporting**

```powershell
git add -- src/server/backend.ts tests/server/reporting-domain.test.ts
git commit -m "feat: report recorded memory activity"
```

---

### Task 3: Implement Scoped Prisma Aggregation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260731180000_reporting_indexes/migration.sql`
- Modify: `src/server/prisma-backend.ts`
- Create: `tests/prisma-integration/reporting.integration.test.ts`

- [ ] **Step 1: Inspect current indexes before editing**

```powershell
rg -n "@@index|model EventApproval|model RSVP|model CheckIn|model PerkRedemption|model Lead" prisma/schema.prisma
```

Add only missing indexes used by range and ownership predicates. The intended shapes are:

```prisma
@@index([decision, decidedAt])
@@index([eventId, createdAt])
@@index([eventId, status, timestamp])
@@index([perkId, status, redeemedAt])
@@index([eventId, createdAt])
```

Match each index to the correct model and do not duplicate an equivalent existing index.

- [ ] **Step 2: Write failing integration tests**

Use the disposable Prisma harness and fixed timestamps. Assert:

- exact 7/30/90 inclusion boundaries;
- organizer ownership;
- admin totals;
- event detail;
- pending versus confirmed check-ins;
- anonymized lead count retention;
- empty range behavior;
- totals equal row and trend values.

- [ ] **Step 3: Confirm failure against a disposable database**

```powershell
npm run test:prisma -- tests/prisma-integration/reporting.integration.test.ts
```

Expected: fail because the methods/schema are absent. Do not run if the configured database is remote/live.

- [ ] **Step 4: Implement authorized queries**

Resolve the authenticated actor and authorized event IDs first. Fetch each reportable record with explicit timestamp bounds. Aggregate in TypeScript through the same pure accumulator used by memory where practical, avoiding database-vendor-specific date truncation and timezone drift.

For event detail, load the event, authorize owner/admin, and use its timezone. For multi-event reports, use `Asia/Manila`.

- [ ] **Step 5: Apply the disposable migration and run integration**

```powershell
npm run db:generate
npm run test:prisma:prepare
npm run test:prisma -- tests/prisma-integration/reporting.integration.test.ts
```

Expected: pass against the disposable database.

- [ ] **Step 6: Commit Prisma reporting**

```powershell
git add -- prisma/schema.prisma prisma/migrations/20260731180000_reporting_indexes/migration.sql src/server/prisma-backend.ts tests/prisma-integration/reporting.integration.test.ts
git commit -m "feat: aggregate production reporting records"
```

---

### Task 4: Expose Safe Report Loaders and CSVs

**Files:**
- Create: `src/server/reporting/report-actions.ts`
- Create: `src/server/reporting/report-csv.ts`
- Create: `src/app/api/admin/exports/reports/route.ts`
- Create: `src/app/api/organizer/exports/reports/route.ts`
- Test: `tests/server/reporting-actions.test.ts`
- Test: `tests/server/reporting-routes.test.ts`

- [ ] **Step 1: Write failing loader and route tests**

Cover anonymous, rider, organizer, non-owner organizer, suspended account, and admin sessions. Assert invalid ranges normalize to 30, event IDs are validated, CSV formulas are escaped, filenames are safe, and exported totals equal the same fixture’s dashboard totals.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/server/reporting-actions.test.ts tests/server/reporting-routes.test.ts
```

- [ ] **Step 3: Implement focused loaders**

```ts
export async function loadAdminOperationsReport(
  rawRange: unknown,
): Promise<ActionState<OperationsReport>>

export async function loadOrganizerOperationsReport(
  rawRange: unknown,
): Promise<ActionState<OperationsReport>>

export async function loadEventOperationsReport(
  eventId: string,
  rawRange: unknown,
): Promise<ActionState<OperationsReport>>
```

Read the session through the existing server session helper, call backend authorization for every request, and map expected failures to the shared `ActionState` contract. Never return stack traces or raw database errors.

- [ ] **Step 4: Serialize the existing report object**

`operationsReportToCsv(report)` must not query the database. Include a report metadata section and event rows with stable headers. Use `src/server/csv.ts` from the lead plan for formula protection and quoting.

- [ ] **Step 5: Implement Route Handlers**

Parse `range` and optional `eventId` from `request.nextUrl.searchParams`. Call the same authorized backend loader and return:

- `200 text/csv` for success;
- `401` for unauthenticated;
- `403` for wrong role/ownership/suspension;
- `404` for missing event;
- `400` for structurally invalid event IDs.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/server/reporting-actions.test.ts tests/server/reporting-routes.test.ts
npx eslint src/server/reporting/report-actions.ts src/server/reporting/report-csv.ts src/app/api/admin/exports/reports/route.ts src/app/api/organizer/exports/reports/route.ts
git add -- src/server/reporting/report-actions.ts src/server/reporting/report-csv.ts src/app/api/admin/exports/reports/route.ts src/app/api/organizer/exports/reports/route.ts tests/server/reporting-actions.test.ts tests/server/reporting-routes.test.ts
git commit -m "feat: expose authorized report exports"
```

Expected: tests and lint pass.

---

### Task 5: Replace Synthetic Admin Reporting

**Files:**
- Create: `src/features/reports/operations-chart.tsx`
- Create: `src/features/reports/report-range-picker.tsx`
- Create: `src/features/reports/admin-report-dashboard.tsx`
- Create: `src/features/reports/event-report-detail.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/reports/page.tsx`
- Modify: `src/app/admin/reports/[eventId]/page.tsx`
- Test: `tests/server/reporting-ui.test.tsx`

- [ ] **Step 1: Write failing component contract tests**

Assert:

- each range link preserves the reports path and marks the current selection;
- six summary labels are explicit;
- chart points come verbatim from `report.trend`;
- empty data displays “No activity in this period” and no fabricated chart;
- event rows link to authorized details;
- CSV link carries the selected range;
- the detail page names the event and selected period;
- no July 2025/2026 literals or `getChartData` fallback remain.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/server/reporting-ui.test.tsx
```

- [ ] **Step 3: Build presentational report components**

`OperationsChart` accepts `ReportTrendPoint[]` only. It must not call `new Date()` to select data and must not generate points. If all additive values are zero, the parent renders the empty state instead.

`ReportRangePicker` uses ordinary links such as `?range=7`; this keeps selection shareable, reload-safe, and server-rendered.

- [ ] **Step 4: Load reports in Server Components**

Next.js 16 page parameters are promises:

```ts
type ReportsPageProps = {
  searchParams: Promise<{ range?: string | string[] }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const query = await searchParams;
  const state = await loadAdminOperationsReport(query.range);
  // render authorized success or the established safe error surface
}
```

The dynamic detail page must `await params`, load the real event report, and export `generateMetadata` from the server page.

- [ ] **Step 5: Delete admin synthetic helpers**

Remove `getChartData`, computed fake rows, hard-coded date literals, placeholder report notes, and the old `ChartAreaInteractive` import from `admin-console.tsx`. Keep unrelated admin sections unchanged.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/server/reporting-ui.test.tsx tests/server/reporting-actions.test.ts
npx eslint src/features/reports/operations-chart.tsx src/features/reports/report-range-picker.tsx src/features/reports/admin-report-dashboard.tsx src/features/reports/event-report-detail.tsx src/features/admin/admin-console.tsx src/app/admin/page.tsx src/app/admin/reports/page.tsx src/app/admin/reports/[eventId]/page.tsx
git add -- src/features/reports/operations-chart.tsx src/features/reports/report-range-picker.tsx src/features/reports/admin-report-dashboard.tsx src/features/reports/event-report-detail.tsx src/features/admin/admin-console.tsx src/app/admin/page.tsx src/app/admin/reports/page.tsx src/app/admin/reports/[eventId]/page.tsx tests/server/reporting-ui.test.tsx
git commit -m "fix: render real admin reports"
```

Expected: pass.

---

### Task 6: Replace Synthetic Organizer Reporting

**Files:**
- Create: `src/features/reports/organizer-report-dashboard.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/app/organizer/dashboard/page.tsx`
- Modify: `src/app/organizer/reports/page.tsx`
- Modify: `src/app/organizer/events/[eventId]/report/page.tsx`
- Modify: `tests/server/reporting-ui.test.tsx`

- [ ] **Step 1: Extend failing UI tests**

Assert organizer pages render only owned report rows, preserve selected ranges, generate owner export URLs, provide real event detail, and show honest empty states.

- [ ] **Step 2: Implement organizer dashboard**

Reuse the summary cards, range picker, chart, and event-detail component. Owner wording should describe event operations, not imply access to platform-wide totals.

- [ ] **Step 3: Replace page loaders**

Load organizer reports on the server. For event detail, authorize ownership through `loadEventOperationsReport`; never select a demo event client-side.

- [ ] **Step 4: Delete organizer synthetic helpers**

Remove `getChartData`, computed placeholder `ReportRow` data, hard-coded date literals, and the old chart import from `organizer-console.tsx`.

- [ ] **Step 5: Delete the obsolete chart component**

```powershell
rg -n "ChartAreaInteractive|AdminChartPoint|chart-area-interactive" src tests
```

Expected before deletion: no remaining imports. Then delete `src/components/chart-area-interactive.tsx`.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/server/reporting-ui.test.tsx tests/server/reporting-domain.test.ts tests/server/reporting-actions.test.ts
npx eslint src/features/reports/organizer-report-dashboard.tsx src/features/organizer/organizer-console.tsx src/app/organizer/dashboard/page.tsx src/app/organizer/reports/page.tsx src/app/organizer/events/[eventId]/report/page.tsx
git add -- src/features/reports/organizer-report-dashboard.tsx src/features/organizer/organizer-console.tsx src/app/organizer/dashboard/page.tsx src/app/organizer/reports/page.tsx src/app/organizer/events/[eventId]/report/page.tsx tests/server/reporting-ui.test.tsx
git rm -- src/components/chart-area-interactive.tsx
git commit -m "fix: render real organizer reports"
```

Expected: pass.

---

### Task 7: Run the Reporting Slice Gate

**Files:**
- Verify only; fix only reporting-related defects discovered by these gates.

- [ ] **Step 1: Run focused unit and server tests**

```powershell
npx vitest run tests/server/reporting-date-buckets.test.ts tests/server/reporting-domain.test.ts tests/server/reporting-actions.test.ts tests/server/reporting-routes.test.ts tests/server/reporting-ui.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run disposable Prisma integration**

```powershell
npm run test:prisma -- tests/prisma-integration/reporting.integration.test.ts
```

Expected: pass against the approved disposable database.

- [ ] **Step 3: Prove synthetic reporting is gone**

```powershell
rg -n "getChartData|ChartAreaInteractive|AdminChartPoint|2025-07|2026-07|Report notes" src/features/admin src/features/organizer src/features/reports src/app/admin src/app/organizer
```

Expected: no synthetic-report matches.

- [ ] **Step 4: Cross-check one fixture**

Using one fixed fixture, record the values for:

- dashboard summary;
- sum of daily trend points;
- sum of event rows;
- CSV event totals.

Expected: values agree for published events, registrations, confirmed check-ins, perk redemptions, and leads. Pending check-ins and no-show rate follow their documented formulas.

- [ ] **Step 5: Verify with Codex browser**

With disposable local data:

1. Open admin and organizer reports at 7, 30, and 90 days.
2. Reload each selected range and confirm it persists.
3. Open one event detail from both authorized roles.
4. Confirm an unrelated organizer cannot open that event report or export.
5. Confirm an empty period states that no activity occurred.
6. Download both CSVs and compare visible totals.
7. Check 320px, 390x844, tablet, and desktop layouts for overflow.
8. Confirm no browser console errors.

- [ ] **Step 6: Run static/build gates**

```powershell
npm run db:generate
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all exit 0.
