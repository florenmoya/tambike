# Public Seed Label Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove visible `Sample` and `Demo` markers from known seeded Tambike identities without deleting or broadly rewriting user data.

**Architecture:** Clean names at their provisioning sources, then use a dedicated maintenance module to inspect and update only an allowlist of exact seeded emails and legacy public raffle aliases. The CLI defaults to read-only preview and requires an explicit apply flag; the active RDS target is previewed first and remains write-blocked until the user explicitly approves that environment.

**Tech Stack:** TypeScript, Prisma, PostgreSQL, Vitest, TSX

## Global Constraints

- Preserve all rider accounts, bikes, media, RSVPs, passes, events, giveaways, awards, and audit events.
- Match users by exact known seeded email; never run a broad `Sample` or `Demo` text replacement.
- Keep internal emails, lock keys, session IDs, audit values, script/module names, and `/demo` asset paths unchanged.
- Future provisioning must keep the cleaned public names.
- The migration must be idempotent.
- Do not write to `bayankodb.cp2omu064y3w.ap-southeast-1.rds.amazonaws.com/tambike_db` without explicit environment approval after a read-only preview.
- Preserve unrelated dirty workspace changes.

---

## File Structure

- `src/server/member-profiles/sample-rider.ts`: canonical public name for the seeded Mika rider.
- `src/server/giveaways/sample-raffles.ts`: canonical public name and alias for the seeded raffle winner.
- `src/server/maintenance/public-seed-label-cleanup.ts`: exact identity allowlist, plan builder, Prisma inspection, and guarded apply operation.
- `scripts/clean-public-seed-labels.ts`: read-only-by-default CLI for previewing or applying the cleanup.
- `package.json`: exposes the maintenance CLI.
- `tests/server/sample-rider-provisioner.test.ts`: unit coverage for future sample rider provisioning.
- `tests/prisma-integration/sample-rider-provisioner.integration.test.ts`: database-backed drift repair expectation.
- `tests/server/sample-raffle-provisioner.test.ts`: future raffle winner provisioning expectation.
- `tests/prisma-integration/sample-raffle-provisioner.integration.test.ts`: database-backed raffle winner expectation.
- `tests/server/public-seed-label-cleanup.test.ts`: allowlist, plan, idempotency, and apply-guard coverage.
- `tests/server/public-seed-label-cleanup-cli.test.ts`: preview-default and explicit-apply CLI coverage.

### Task 1: Clean Future Provisioned Public Names

**Files:**
- Modify: `src/server/member-profiles/sample-rider.ts`
- Modify: `src/server/giveaways/sample-raffles.ts`
- Modify: `tests/server/sample-rider-provisioner.test.ts`
- Modify: `tests/prisma-integration/sample-rider-provisioner.integration.test.ts`
- Modify: `tests/server/sample-raffle-provisioner.test.ts`
- Modify: `tests/prisma-integration/sample-raffle-provisioner.integration.test.ts`

**Interfaces:**
- Produces: sample rider provisioning with `displayName: "Mika Santos"`.
- Produces: sample raffle winner provisioning with `name: "Raffle Winner"` and `winnerAlias: "Cafe Classico Rider"`.

- [ ] **Step 1: Write failing provisioning expectations**

Change behavior assertions to expect clean public values:

```ts
expect(result.account.displayName).toBe("Mika Santos");
expect(secondUser.displayName).toBe("Mika Santos");
expect(manifest.winnerName).toBe("Raffle Winner");
expect(manifest.winnerAlias).toBe("Cafe Classico Rider");
```

The production changes these tests catch are reintroducing a visible sample/demo suffix or failing to repair a drifted seeded record.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run tests/server/sample-rider-provisioner.test.ts tests/server/sample-raffle-provisioner.test.ts
```

Expected: FAIL because current provisioning still emits `Mika Santos — Sample Rider` and `Raffle Winner — Sample Rider`.

- [ ] **Step 3: Make the minimal source changes**

Update only the canonical public values:

```ts
const SAMPLE_RIDER_NAME = "Mika Santos";
export const SAMPLE_RAFFLE_WINNER_NAME = "Raffle Winner";
export const SAMPLE_RAFFLE_WINNER_ALIAS = "Cafe Classico Rider";
```

Do not rename the internal constants, emails, keys, files, or provisioning types.

- [ ] **Step 4: Run unit and integration-focused tests**

Run:

```powershell
npx vitest run tests/server/sample-rider-provisioner.test.ts tests/server/sample-raffle-provisioner.test.ts
npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/sample-rider-provisioner.integration.test.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
```

Expected: all selected tests PASS. If the integration environment is unavailable, record the exact boundary and keep the unit tests as the verified source contract.

- [ ] **Step 5: Commit**

```powershell
git add -- src/server/member-profiles/sample-rider.ts src/server/giveaways/sample-raffles.ts tests/server/sample-rider-provisioner.test.ts tests/prisma-integration/sample-rider-provisioner.integration.test.ts tests/server/sample-raffle-provisioner.test.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
git commit -m "fix: clean provisioned public identities"
```

### Task 2: Build an Exact, Preview-First Cleanup Operation

**Files:**
- Create: `src/server/maintenance/public-seed-label-cleanup.ts`
- Create: `scripts/clean-public-seed-labels.ts`
- Create: `tests/server/public-seed-label-cleanup.test.ts`
- Create: `tests/server/public-seed-label-cleanup-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `PUBLIC_SEED_USER_RENAMES`, a readonly allowlist of exact `{ email, publicName }` entries.
- Produces: `buildPublicSeedLabelCleanupPlan(input): PublicSeedLabelCleanupPlan`.
- Produces: `createPrismaPublicSeedLabelCleanup(databaseUrl): PublicSeedLabelCleanupStore`.
- Produces: `runPublicSeedLabelCleanupCli(options): Promise<PublicSeedLabelCleanupReceipt>`.
- Consumes: `DATABASE_URL` and the explicit `--apply` CLI flag.

The exact allowlist is:

```ts
[
  ["mika.sample@tambike.ph", "Mika Santos"],
  ["demo.roster.20260723.01@tambike.ph", "Paolo Reyes"],
  ["demo.roster.20260723.02@tambike.ph", "Bea Navarro"],
  ["demo.roster.20260723.03@tambike.ph", "Carlo Mendoza"],
  ["demo.roster.20260723.04@tambike.ph", "Nina Garcia"],
  ["demo.roster.20260723.05@tambike.ph", "Jolo Ramos"],
  ["demo.roster.20260723.06@tambike.ph", "Sam Torres"],
  ["demo.roster.20260723.07@tambike.ph", "Mara Villanueva"],
  ["demo.roster.20260723.08@tambike.ph", "Enzo Lim"],
  ["demo.roster.20260723.09@tambike.ph", "Lia Santos"],
  ["demo.roster.20260723.10@tambike.ph", "Nico Bautista"],
  ["demo.roster.20260723.11@tambike.ph", "Aya Flores"],
  ["demo.roster.20260723.12@tambike.ph", "Anonymous Rider 01"],
  ["demo.roster.20260723.13@tambike.ph", "Anonymous Rider 02"],
  ["raffle.winner.sample@tambike.ph", "Raffle Winner"],
] as const;
```

Legacy public winner aliases eligible for exact replacement are
`Raffle Sample Rider` and `Raffle Winner — Sample Rider`; both become
`Cafe Classico Rider`, and only on awards won by
`raffle.winner.sample@tambike.ph`.

- [ ] **Step 1: Write failing cleanup behavior tests**

Cover:

```ts
test("plans only exact known seeded identity renames", () => {
  const plan = buildPublicSeedLabelCleanupPlan({
    users: [
      { id: "mika", email: "mika.sample@tambike.ph", displayName: "Mika Santos — Sample Rider" },
      { id: "real", email: "real@example.com", displayName: "Demo Sample" },
    ],
    awards: [],
  });

  expect(plan.userUpdates).toEqual([
    { id: "mika", email: "mika.sample@tambike.ph", from: "Mika Santos — Sample Rider", to: "Mika Santos" },
  ]);
});

test("is idempotent when public seed labels are already clean", () => {
  expect(buildPublicSeedLabelCleanupPlan({
    users: [{ id: "mika", email: "mika.sample@tambike.ph", displayName: "Mika Santos" }],
    awards: [],
  })).toEqual({ userUpdates: [], awardUpdates: [] });
});

test("rewrites only the seeded raffle winner legacy aliases", () => {
  const plan = buildPublicSeedLabelCleanupPlan({
    users: [],
    awards: [
      { id: "seed-award", winnerEmail: "raffle.winner.sample@tambike.ph", publicWinnerAlias: "Raffle Sample Rider" },
      { id: "real-award", winnerEmail: "real@example.com", publicWinnerAlias: "Raffle Sample Rider" },
    ],
  });

  expect(plan.awardUpdates).toEqual([
    { id: "seed-award", from: "Raffle Sample Rider", to: "Cafe Classico Rider" },
  ]);
});
```

- [ ] **Step 2: Run cleanup tests and verify RED**

Run:

```powershell
npx vitest run tests/server/public-seed-label-cleanup.test.ts tests/server/public-seed-label-cleanup-cli.test.ts
```

Expected: FAIL because the maintenance module and CLI do not exist.

- [ ] **Step 3: Implement the pure plan and guarded store**

`buildPublicSeedLabelCleanupPlan` must:

- index the exact allowlist by normalized email;
- emit a user update only when that exact email exists and its name differs;
- emit an award update only for the exact raffle winner email and exact legacy alias;
- return no updates when data is already clean.

The Prisma store must inspect only allowlisted emails and awards related to the
seeded raffle winner. Apply updates in one transaction using `updateMany` guards
that include each row ID and its previewed old value. If any guarded update
count is not exactly `1`, abort the transaction.

- [ ] **Step 4: Implement the preview-first CLI**

`runPublicSeedLabelCleanupCli` must:

- load `DATABASE_URL`;
- inspect and print only host/database plus the planned public label changes;
- default to preview mode;
- apply only when `--apply` is present;
- return a receipt with `{ mode, target, userUpdates, awardUpdates }`;
- never print credentials or full connection URLs;
- always close the Prisma store.

Add:

```json
"clean:public-seed-labels": "tsx --conditions=react-server scripts/clean-public-seed-labels.ts"
```

- [ ] **Step 5: Run focused tests and lint**

Run:

```powershell
npx vitest run tests/server/public-seed-label-cleanup.test.ts tests/server/public-seed-label-cleanup-cli.test.ts
npx eslint src/server/maintenance/public-seed-label-cleanup.ts scripts/clean-public-seed-labels.ts tests/server/public-seed-label-cleanup.test.ts tests/server/public-seed-label-cleanup-cli.test.ts
```

Expected: all selected tests PASS and ESLint exits `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- src/server/maintenance/public-seed-label-cleanup.ts scripts/clean-public-seed-labels.ts tests/server/public-seed-label-cleanup.test.ts tests/server/public-seed-label-cleanup-cli.test.ts package.json
git commit -m "feat: add guarded public seed label cleanup"
```

### Task 3: Preview, Approve, Apply, and Verify the Active Data

**Files:**
- No source files unless verification exposes a scoped defect.

**Interfaces:**
- Consumes: `npm run clean:public-seed-labels --` for preview.
- Consumes after explicit environment approval only: `npm run clean:public-seed-labels -- --apply`.

- [ ] **Step 1: Run a read-only preview**

Run:

```powershell
npm run clean:public-seed-labels --
```

Expected: target output identifies
`bayankodb.cp2omu064y3w.ap-southeast-1.rds.amazonaws.com/tambike_db` without
credentials and lists only exact known seed user/award changes.

- [ ] **Step 2: Stop for explicit RDS environment approval**

Report the exact count and public values from the preview. Do not run `--apply`
until the user explicitly authorizes writes to that named RDS database.

- [ ] **Step 3: Apply after approval**

Run only after approval:

```powershell
npm run clean:public-seed-labels -- --apply
```

Expected: guarded transaction updates exactly the rows shown in preview.

- [ ] **Step 4: Verify idempotency and public UI**

Run:

```powershell
npm run clean:public-seed-labels --
npx vitest run tests/server/sample-rider-provisioner.test.ts tests/server/sample-raffle-provisioner.test.ts tests/server/public-seed-label-cleanup.test.ts tests/server/public-seed-label-cleanup-cli.test.ts
```

Expected: second preview reports zero changes and focused tests pass.

Use the Codex Browser on the existing localhost server to verify:

- event attendee bike cards show natural rider names;
- attendee roster and rider profile pages contain no visible `Sample` or `Demo`;
- public raffle winner presentation contains no visible `Sample` or `Demo`;
- desktop and mobile widths have no horizontal overflow.

- [ ] **Step 5: Run full server verification**

Run without restarting the dev server or building:

```powershell
npx vitest run tests/server --maxWorkers=1
```

Expected: all server tests PASS.
