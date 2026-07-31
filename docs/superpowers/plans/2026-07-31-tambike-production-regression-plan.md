# Tambike Production Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce auditable proof that Tambike’s full UI and its production workflows are safe, responsive, truthful, and ready for a separately authorized release.

**Architecture:** A read-only artifact audit, deterministic automated gates, and a manual Codex-browser matrix cover different failure classes. Disposable local fixtures prove mutations and reload behavior without touching live records. Results are captured in one dated QA report with evidence, residual risks, and an explicit distinction between local readiness, database readiness, deployment, and production promotion.

**Tech Stack:** PowerShell; Next.js 16.2.11; TypeScript 5; Prisma 7.8.0; PostgreSQL disposable integration database; Vitest 4.1.9; ESLint; Next production build; Codex browser.

## Global Constraints

- Execute only after all five subsystem plans pass their slice gates.
- Do not run Playwright, `npm run test:e2e`, or another browser driver; use the Codex browser surface only.
- Before starting or restarting a dev server, prove whether one is already listening and reuse it when healthy.
- Default every production-artifact command to read-only.
- Do not delete, anonymize, migrate, seed, or mutate remote/live data without separate explicit environment approval.
- A browser mutation is allowed only against a proven disposable local database.
- Never use a fallback memory backend as production-readiness evidence.
- Do not claim deployment, production promotion, remote migration, or live-data cleanup unless each was separately authorized and verified.
- Preserve dirty worktree changes; never create an AI/Codex branch or worktree.
- A clean build is necessary but not sufficient: role boundaries, second-session revocation, reload persistence, responsive layout, metadata, empty states, and console output all require evidence.

---

## File Structure

### Create

- `scripts/audit-production-test-artifacts.ts` — default read-only candidate inventory with tightly gated apply mode.
- `tests/server/production-artifact-audit.test.ts` — classification, allowlist, environment, and dry-run tests.
- `docs/qa/2026-07-31-tambike-production-ui-qa.md` — final route/workflow evidence and release boundary.

### Modify

- `package.json` — add `audit:test-artifacts` read-only script only.
- `.env.example` — document the explicit local/disposable marker used by mutation fixtures, if not added by earlier plans.
- `prisma/seed.ts` — remove test-named records from canonical production seed while retaining useful neutral development fixtures.
- `tests/server/prisma-seed-policy.test.ts` — reject test/smoke/fabricated lead records in the production seed.
- Any application/test file required to fix defects found by the gates; keep fixes scoped and commit them separately from the QA report.

## Evidence Levels

The final report must use these exact labels:

| Level | Meaning |
| --- | --- |
| Local code | Unit/server checks, type-check, lint, and production build passed in this checkout. |
| Disposable database | Migrations and workflow tests passed against a proven disposable database. |
| Browser | Named routes, roles, viewports, reloads, and browser console were checked through Codex browser. |
| Deployment | A deployed build was checked. Only include when separately authorized and actually performed. |
| Production | Live environment and live database were checked. Only include when separately authorized and actually performed. |

“Production-ready locally” may be concluded from the first three levels. It must not be shortened to “production is verified.”

---

### Task 1: Audit and Remove Test Artifacts Safely

**Files:**
- Create: `scripts/audit-production-test-artifacts.ts`
- Create: `tests/server/production-artifact-audit.test.ts`
- Modify: `package.json`
- Modify: `prisma/seed.ts`
- Modify: `tests/server/prisma-seed-policy.test.ts`

- [ ] **Step 1: Write failing classifier tests**

Classify candidates by explicit evidence:

- title/name includes `Codex Smoke`, `Playwright`, `E2E`, or a repository-owned fixture marker;
- email uses a documented fixture-only domain;
- record ID is listed in a caller-supplied ID file;
- production seed contains a forbidden test marker.

Do not classify a record solely because its title contains a broad word such as “test”; “Test Ride” is a real event type.

- [ ] **Step 2: Write failing safety tests**

Assert:

- no arguments performs a dry run;
- dry run cannot delete;
- `--apply` without `--ids-file` fails;
- `--apply` without `TAMBIKE_ALLOW_ARTIFACT_CLEANUP=confirmed` fails;
- `--apply` against an unrecognized environment fails;
- supplied IDs are intersected with classified candidates;
- output never includes phone numbers, tokens, secrets, or full lead payloads;
- the script reports record type, ID, non-sensitive label, reason, and proposed action.

- [ ] **Step 3: Confirm failure**

```powershell
npx vitest run tests/server/production-artifact-audit.test.ts tests/server/prisma-seed-policy.test.ts
```

- [ ] **Step 4: Implement read-only default**

```json
{
  "scripts": {
    "audit:test-artifacts": "tsx scripts/audit-production-test-artifacts.ts"
  }
}
```

The ordinary command:

```powershell
npm run audit:test-artifacts
```

must print candidates and a summary, make zero writes, and exit nonzero only for configuration/query failure—not because candidates exist.

- [ ] **Step 5: Gate apply mode**

Apply mode is a capability for a separately approved cleanup, not part of this regression run:

```powershell
$env:TAMBIKE_ALLOW_ARTIFACT_CLEANUP='confirmed'
npm run audit:test-artifacts -- --apply --ids-file .\approved-artifact-ids.txt
```

Even with those arguments, do not execute the command during this plan without the user explicitly approving the exact environment and candidate IDs.

- [ ] **Step 6: Remove fabricated production seed records**

Remove `Codex Smoke Ride` and any fake lead/contact records from `prisma/seed.ts`. Keep canonical neutral events only when the seed uses them for local navigation and they are clearly non-production data.

- [ ] **Step 7: Run tests and commit**

```powershell
npx vitest run tests/server/production-artifact-audit.test.ts tests/server/prisma-seed-policy.test.ts
npm run audit:test-artifacts
npx eslint scripts/audit-production-test-artifacts.ts
git add -- scripts/audit-production-test-artifacts.ts tests/server/production-artifact-audit.test.ts package.json prisma/seed.ts tests/server/prisma-seed-policy.test.ts
git commit -m "chore: gate production artifact cleanup"
```

Expected: tests pass; audit is read-only; no cleanup is executed.

---

### Task 2: Prove Runtime and Database Isolation

**Files:**
- Evidence only in `docs/qa/2026-07-31-tambike-production-ui-qa.md`

- [ ] **Step 1: Record repository state without changing it**

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git diff --stat
```

Record the branch, commit, and that unrelated dirty files were preserved.

- [ ] **Step 2: Check for an existing dev server**

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3000,3001,3002,3003 } | Select-Object LocalAddress,LocalPort,OwningProcess
```

For each candidate PID:

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = <PID>" | Select-Object ProcessId,ExecutablePath,CommandLine
```

Reuse a healthy process only when its command line and served application identify this checkout. Do not stop an unrelated process.

- [ ] **Step 3: Prove the backend mode**

Inspect only non-secret indicators:

- `TAMBIKE_BACKEND`;
- database hostname category (`localhost`/loopback versus remote), with credentials redacted;
- database name;
- the disposable test marker required by the Prisma harness.

The production build must fail closed without its required database configuration, as established by the account-access plan.

- [ ] **Step 4: Start only if needed**

If no healthy Tambike server exists, start the repository’s documented development command in a hidden background process and capture its PID/log path. Do not start a second instance.

- [ ] **Step 5: Verify identity and health**

Open `/` through Codex browser and verify Tambike branding plus a known build-visible feature. Record the exact base URL. A port listener alone is not identity proof.

- [ ] **Step 6: Record the evidence boundary**

Before any mutation, the QA report must explicitly state either:

- “Disposable local database proven; mutation QA authorized by this plan,” or
- “Remote/live database detected; browser QA remains read-only.”

If the second applies, skip mutation cases and mark them blocked pending explicit approval rather than faking success.

---

### Task 3: Run the Complete Automated Gate

**Files:**
- Fix scoped defects as discovered.
- Record commands/results in `docs/qa/2026-07-31-tambike-production-ui-qa.md`.

- [ ] **Step 1: Generate the Prisma client**

```powershell
npm run db:generate
```

Expected: exit 0.

- [ ] **Step 2: Run the complete server suite**

```powershell
npm run test:server
```

Expected: all tests pass.

- [ ] **Step 3: Prepare and run disposable Prisma integration**

```powershell
npm run test:prisma:prepare
npm run test:prisma
```

Expected: all integration tests pass against the proven disposable database. Stop before these commands if the harness cannot prove isolation.

- [ ] **Step 4: Run type-check and lint**

```powershell
npx tsc --noEmit
npm run lint
```

Expected: both exit 0 with no new warnings.

- [ ] **Step 5: Build the production bundle**

```powershell
npm run build
```

Expected: exit 0; all intended routes compile.

- [ ] **Step 6: Scan for production blockers**

```powershell
rg -n "Codex Smoke|lead@example\\.com|Seeded Tambike Lead|setSaved\\(true\\)|userStatusOverrides|eventStatusOverrides|ValidationSection|FileUpload06|getChartData|ChartAreaInteractive|generateStaticParams|autoFocus" src prisma
```

Expected: no obsolete fake/local-only UI behavior. If a term exists only in a test that proves its absence, document that distinction.

- [ ] **Step 7: Commit gate fixes separately**

For each coherent defect found, rerun the narrow failing test, stage only related files, and commit with a defect-specific message. Never bundle unrelated dirty files into a QA commit.

---

### Task 4: Create Disposable Browser Personas and Records

**Files:**
- Use the existing fixture/support surface; extend only when an existing fixture cannot represent the required state.
- Record non-secret fixture IDs in the QA report.

- [ ] **Step 1: Prepare four personas**

Create or reset disposable:

- verified rider;
- owning organizer;
- unrelated organizer;
- admin.

Also retain a guest browser context. Do not include passwords or session tokens in the report.

- [ ] **Step 2: Prepare workflow records**

Create disposable records for:

- public event with registration, attendee roster, test ride, and giveaway;
- draft event;
- submitted event;
- needs-changes event;
- rejected event;
- disabled event;
- event owned by the unrelated organizer;
- confirmed and pending check-ins;
- active and expired leads;
- available and unavailable claim;
- populated and empty reporting ranges.

- [ ] **Step 3: Verify fixture isolation**

Every fixture label uses the repository’s explicit QA marker and every fixture ID is captured for local cleanup. Confirm the database host remains disposable before proceeding.

- [ ] **Step 4: Use separate browser sessions**

Open distinct Codex browser contexts for rider, owner, unrelated organizer, and admin where the browser surface supports it. If contexts are unavailable, log out between roles and verify the visible account identity after every login.

---

### Task 5: Verify the 41-Route UI Matrix

**Files:**
- Record outcomes in `docs/qa/2026-07-31-tambike-production-ui-qa.md`.

- [ ] **Step 1: Use the route checklist**

For every pattern, test the named role and state:

| Route pattern | Minimum role/state evidence |
| --- | --- |
| `/`, `/home` | guest and rider; primary navigation and no duplicate hero |
| `/events` | guest; populated and empty/filter state |
| `/events/[eventId]` | guest; published and missing |
| `/events/[eventId]/attendees` | guest/rider; visible plus anonymous count |
| `/events/[eventId]/register` | guest redirect and rider eligible/ineligible |
| `/events/[eventId]/test-ride` | guest submission state and non-test-ride unavailable state |
| `/passes`, `/passes/[passId]`, `/passes/past/[eventId]` | rider populated, empty, missing |
| `/login`, `/signup` | guest valid layout, error summary, safe next destination |
| `/profile`, `/profile/preview`, `/riders/[slug]` | rider saved profile, privacy, missing public profile |
| `/check-in/[token]` | valid, invalid, expired, already-used |
| `/giveaway-claims/[awardId]` | available, unavailable, forbidden |
| `/dashboard`, `/create`, `/onboarding` | intended redirect or canonical page with no duplicate product surface |
| `/organizer/dashboard` | owner summary |
| `/organizer/events`, `/organizer/events/create` | owner list/create and validation errors |
| `/organizer/events/[eventId]` | owner, unrelated organizer forbidden, needs changes |
| `/organizer/events/[eventId]/attendees` | owner populated/empty |
| `/organizer/events/[eventId]/scanner` | owner valid/invalid credential state |
| `/organizer/events/[eventId]/giveaways` | owner empty/configured campaign |
| `/organizer/events/[eventId]/giveaways/[giveawayId]/present` | owner draw ready/unavailable |
| `/organizer/events/[eventId]/report`, `/organizer/reports` | owner 7/30/90 and empty |
| `/giveaway-ops/[eventId]` | assigned operator and forbidden |
| `/admin` | admin real dashboard |
| `/admin/events/review`, `/admin/events/review/[reviewId]` | queue, detail, missing |
| `/admin/giveaways`, `/admin/giveaways/[giveawayId]` | list/detail and unavailable |
| `/admin/reports`, `/admin/reports/[eventId]` | 7/30/90, detail, empty |
| `/admin/users` | active/suspended actions and guard states |
| `/admin/leads` | masked list, filters, reveal and empty |
| `/admin/moderation` | populated/empty and useful actions |

- [ ] **Step 2: Check every page contract**

For each route/state record:

- HTTP/navigation success or intended redirect;
- accurate document title and meta description;
- exactly one page-level `h1`;
- current navigation state;
- no placeholder or internal-policy copy;
- no inert/duplicate control;
- useful empty/error action;
- image contained within viewport;
- no browser console error;
- no failed application request;
- keyboard-visible focus;
- no page-level horizontal overflow.

- [ ] **Step 3: Test four viewport classes**

Use:

- 320 × 568;
- 390 × 844;
- 768 × 1024;
- 1440 × 900.

Every route must be checked at 390 and 1440. Check all known dense/detail routes at 320 and 768.

- [ ] **Step 4: Capture evidence**

For each unique shell and each previously failing page, save a screenshot. At minimum capture:

- public home;
- event detail with attendee proof;
- test-ride form;
- profile;
- organizer event management;
- organizer giveaway;
- organizer report;
- admin users;
- admin event review;
- admin leads;
- admin report;
- representative terminal state.

Use descriptive filenames under `docs/qa/assets/2026-07-31/` only if screenshots are intended to be committed. Otherwise record the Codex browser observation in the report without adding binary files.

---

### Task 6: Verify Mutation, Reload, Concurrency, and Revocation

**Files:**
- Record outcomes in `docs/qa/2026-07-31-tambike-production-ui-qa.md`.

- [ ] **Step 1: Account suspension flow**

1. Open an active user as admin.
2. Submit suspension with a reason.
3. Confirm success and reload admin users.
4. In the user’s existing second session, navigate to an authenticated route.
5. Verify the session is revoked and sign-in is required.
6. Restore the user and verify prior verification returns.
7. Attempt self-suspension and last-admin suspension; verify both are blocked.

- [ ] **Step 2: Event review flow**

1. Organizer submits a draft.
2. Admin requests changes with a required reason.
3. Organizer sees the reason, edits, and resubmits.
4. Admin publishes the event.
5. Confirm public visibility.
6. Admin disables it with a reason; verify public hide and RSVP block while records remain.
7. Restore it; verify it returns to review rather than public.
8. Open stale admin detail in a second session and attempt a competing transition; verify a conflict response and refreshed state.
9. Reject another submission and verify “Duplicate as draft” creates a new organizer draft without reopening the rejected submission.

- [ ] **Step 3: Lead flow**

1. Guest submits a test-ride request.
2. Reload and confirm a committed success state.
3. Submit the same normalized phone with a changed time; verify one updated record.
4. Owner lists masked contact, reveals it, changes status, and exports.
5. Unrelated organizer is denied list/reveal/export.
6. Admin can perform authorized operations.
7. Verify reveal and export create audit entries without raw phone in audit metadata.
8. Run retention only through the disposable fixture path and verify the same row is anonymized while aggregate reporting remains.

- [ ] **Step 4: Reporting consistency flow**

For one known fixture and each selected range:

- compare summary cards;
- sum chart points;
- sum event rows;
- inspect CSV totals.

Expected: all additive totals agree.

- [ ] **Step 5: Profile and giveaway regressions**

- edit profile and motorcycle fields, use the one “Save profile” action, reload, and verify both;
- verify photo upload remains automatic;
- complete a disposable RSVP and confirm attendee count/privacy;
- run one disposable giveaway draw/claim flow already covered by existing domain behavior;
- verify old claim/check-in credentials fail after replacement/revocation where applicable.

- [ ] **Step 6: Clean disposable fixtures**

Use the existing disposable test harness cleanup, restricted to captured fixture IDs. Do not repurpose the production artifact audit apply mode for ordinary local test cleanup.

---

### Task 7: Write and Review the QA Report

**Files:**
- Create: `docs/qa/2026-07-31-tambike-production-ui-qa.md`

- [ ] **Step 1: Use this report structure**

```markdown
# Tambike Production UI QA — 2026-07-31

## Verdict
## Evidence boundary
## Runtime and database identity
## Automated gates
## Route matrix
## Workflow matrix
## Responsive and accessibility checks
## Console and network checks
## Artifact audit
## Defects found and fixed
## Remaining risks
## Deployment and production status
```

- [ ] **Step 2: Record exact evidence**

For commands, record command, exit code, and concise result. For browser cases, record route, role, viewport, state, result, and evidence note. Never write only “looks good.”

- [ ] **Step 3: Separate defects by severity**

- P0: security/data-loss/release-stop;
- P1: broken primary workflow or unauthorized access;
- P2: significant usability, mobile, accessibility, or truthful-content failure;
- P3: minor polish.

All P0/P1/P2 findings must be fixed and reverified before a production-ready-local verdict. P3 items must be fixed or explicitly accepted.

- [ ] **Step 4: State the release boundary**

If deployment/live checks were not authorized, write:

```text
Local code, disposable-database, and Codex-browser gates passed. Deployment,
remote migration, live-data cleanup, and production promotion were not performed
and are not claimed by this report.
```

- [ ] **Step 5: Review for unsupported claims**

Every verdict sentence must point to a command result, browser row, or named limitation. Remove claims such as “all good” that lack evidence.

- [ ] **Step 6: Commit the report only after all evidence is current**

```powershell
git add -- docs/qa/2026-07-31-tambike-production-ui-qa.md
git diff --cached --check
git commit -m "docs: record Tambike production UI QA"
```

Expected: only the QA report is staged for this commit.
