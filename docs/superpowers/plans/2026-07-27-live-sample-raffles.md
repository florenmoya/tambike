# Live Sample Raffles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision one completed raffle with one consented demo winner and one open raffle without a winner in the live Tambike app.

**Architecture:** Add a production-confirmed, idempotent provisioning boundary modeled after the existing sample-rider provisioner. A domain orchestrator drives only existing `PrismaTambikeBackend` lifecycle methods, while a narrow Prisma inspection adapter performs preflight, advisory locking, exact-state verification, and duplicate detection; a CLI owns runtime-only secrets and emits a safe JSON receipt.

**Tech Stack:** TypeScript, Next.js 16.2.11 repository conventions, Prisma 7.8, PostgreSQL advisory locks, Vitest, existing Tambike giveaway domain APIs, Codex in-app browser.

## Global Constraints

- Work on the existing `main` checkout; do not create a branch or worktree.
- Read the relevant installed Next.js guide under `node_modules/next/dist/docs/` before writing implementation code.
- Host both campaigns on `tambike-cafe-classico`.
- Completed title: `Cafe Classico Helmet Raffle`.
- Ongoing title: `Weekend Rider Gear Raffle`.
- The completed campaign ends in `completed` with exactly one current `fulfilled` award and one published demo-safe winner alias.
- The ongoing campaign ends in `open` with no snapshot, draw, award, or result.
- Use only the existing server-authoritative signup, registration, giveaway, draw, publication, claim, fulfilment, and completion APIs for lifecycle writes.
- Direct Prisma access is read-only except for acquiring/releasing the dedicated advisory lock.
- Do not reset, reseed, delete, replace, or clean up existing live data.
- Never enter or select `user-florenmoya-gmail-com` or another existing rider as the sample winner.
- Never print or persist passwords, session tokens, claim tokens, QR payloads, encryption keys, database URLs, password hashes, or delivery data.
- Require `--confirm-production` plus live database, direct-lock, organizer, admin, winner, and draw-key prerequisites before the first write.
- The CLI must be idempotent: exact final state returns the existing safe receipt; conflicting or partial state stops without creating duplicate campaigns.
- Use the Codex browser surface for browser verification; do not use Playwright or another browser tool.
- No UI changes and no production deployment are part of this plan.

---

## File Structure

- Create `src/server/giveaways/sample-raffles.ts`: manifests, safety error codes, orchestration, adapter interfaces, Prisma adapter, and final invariant inspection.
- Create `scripts/provision-sample-raffles.ts`: CLI parsing, environment checks, secret-safe error handling, connection lifecycle, and JSON receipt output.
- Create `tests/server/sample-raffle-provisioner.test.ts`: fast orchestration and CLI safety tests with a fake adapter.
- Create `tests/prisma-integration/sample-raffle-provisioner.integration.test.ts`: disposable PostgreSQL proof of the complete and open lifecycle states.
- Create `docs/deployment/sample-raffle-provisioning.md`: exact live preflight, execution, verification, and separately-approved cleanup policy.
- Modify `package.json`: add `provision:sample-raffles`.

---

### Task 1: Define and test the safe provisioning contract

**Files:**
- Create: `tests/server/sample-raffle-provisioner.test.ts`
- Create: `src/server/giveaways/sample-raffles.ts`

**Interfaces:**
- Produces:
  - `SAMPLE_RAFFLE_EVENT_ID`
  - `COMPLETED_SAMPLE_RAFFLE_TITLE`
  - `ONGOING_SAMPLE_RAFFLE_TITLE`
  - `SAMPLE_RAFFLE_WINNER_EMAIL`
  - `SampleRaffleManifest`
  - `productionSampleRaffleManifest`
  - `SampleRaffleProvisioningError`
  - `SampleRaffleProvisioningInput`
  - `SampleRaffleProvisioningReceipt`
  - `SampleRaffleProvisionerDependencies`
  - `provisionSampleRaffles(input, dependencies, manifest)`
- Consumes existing `CreateGiveawayInput`, `PrismaTambikeBackend` method shapes, and giveaway DTOs from `src/features/giveaways/types.ts`.

- [ ] **Step 1: Read the relevant installed Next.js server boundary documentation**

Run:

```powershell
rg --files node_modules/next/dist/docs | rg "server-actions|server-components|server-only"
```

Read the matching server-only/server-action guide completely. Record in the implementation notes that the provisioner is a Node CLI/domain module and is never imported into a client component.

- [ ] **Step 2: Write failing contract and safety tests**

Create `tests/server/sample-raffle-provisioner.test.ts` with a fake dependency object that records calls but stores no secrets. Cover:

```ts
test("rejects execution without explicit production confirmation", async () => {
  await expect(
    provisionSampleRaffles(
      {
        confirmedProduction: false,
        organizerPassword: "runtime-only",
        adminPassword: "runtime-only",
        winnerPassword: "runtime-only",
        drawEncryptionKeyPresent: true,
      },
      fakeDependencies(),
    ),
  ).rejects.toMatchObject({ code: "PRODUCTION_CONFIRMATION_REQUIRED" });
});

test.each([
  ["organizerPassword", "ORGANIZER_CREDENTIAL_REQUIRED"],
  ["adminPassword", "ADMIN_CREDENTIAL_REQUIRED"],
  ["winnerPassword", "WINNER_CREDENTIAL_REQUIRED"],
] as const)("rejects a missing runtime credential", async (field, code) => {
  const input = validInput();
  input[field] = "";
  await expect(provisionSampleRaffles(input, fakeDependencies()))
    .rejects.toMatchObject({ code });
});

test("rejects a missing draw encryption key before acquiring the write lock", async () => {
  const dependencies = fakeDependencies();
  await expect(
    provisionSampleRaffles(
      { ...validInput(), drawEncryptionKeyPresent: false },
      dependencies,
    ),
  ).rejects.toMatchObject({ code: "DRAW_ENCRYPTION_KEY_REQUIRED" });
  expect(dependencies.calls).toEqual(["inspectTarget"]);
});

test("returns the existing receipt when both campaigns already match final invariants", async () => {
  const dependencies = fakeDependencies({ inspection: exactFinalInspection() });
  await expect(provisionSampleRaffles(validInput(), dependencies))
    .resolves.toMatchObject({
      eventId: "tambike-cafe-classico",
      completed: { state: "completed", winnerCount: 1 },
      ongoing: { state: "open", winnerCount: 0 },
      changed: false,
    });
  expect(dependencies.calls).not.toContain("createWinner");
});

test("fails closed on a conflicting or partial sample campaign", async () => {
  const dependencies = fakeDependencies({ inspection: partialInspection() });
  await expect(provisionSampleRaffles(validInput(), dependencies))
    .rejects.toMatchObject({ code: "CONFLICTING_SAMPLE_STATE" });
  expect(dependencies.calls).not.toContain("createCompletedCampaign");
});
```

Add a happy-path call-order test requiring:

```ts
expect(dependencies.calls).toEqual([
  "inspectTarget",
  "acquireLock",
  "inspectTarget",
  "authenticateOrganizer",
  "authenticateAdmin",
  "ensureWinner",
  "ensureWinnerRegistration",
  "createCompletedCampaign",
  "submitCompletedCampaign",
  "approveCompletedCampaign",
  "openCompletedCampaign",
  "grantCompletedEntry",
  "lockCompletedCampaign",
  "selectCompletedWinner",
  "publishCompletedDraw",
  "publishWinnerAlias",
  "issueClaim",
  "verifyClaim",
  "fulfillAward",
  "completeClaims",
  "createOngoingCampaign",
  "submitOngoingCampaign",
  "approveOngoingCampaign",
  "openOngoingCampaign",
  "inspectTarget",
  "releaseLock",
  "finish",
]);
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```powershell
npm run test:server -- tests/server/sample-raffle-provisioner.test.ts
```

Expected: FAIL because `@/server/giveaways/sample-raffles` does not exist.

- [ ] **Step 4: Implement the minimal contract and manifests**

Create `src/server/giveaways/sample-raffles.ts` beginning with these stable public values:

```ts
export const SAMPLE_RAFFLE_EVENT_ID = "tambike-cafe-classico";
export const COMPLETED_SAMPLE_RAFFLE_TITLE = "Cafe Classico Helmet Raffle";
export const ONGOING_SAMPLE_RAFFLE_TITLE = "Weekend Rider Gear Raffle";
export const SAMPLE_RAFFLE_WINNER_EMAIL = "raffle.winner.sample@tambike.ph";
export const SAMPLE_RAFFLE_WINNER_NAME = "Raffle Winner — Sample Rider";
export const SAMPLE_RAFFLE_WINNER_ALIAS = "Raffle Sample Rider";

export interface SampleRaffleManifest {
  eventId: string;
  completedTitle: string;
  ongoingTitle: string;
  winnerEmail: string;
  winnerName: string;
  winnerAlias: string;
}

export const productionSampleRaffleManifest: SampleRaffleManifest = {
  eventId: SAMPLE_RAFFLE_EVENT_ID,
  completedTitle: COMPLETED_SAMPLE_RAFFLE_TITLE,
  ongoingTitle: ONGOING_SAMPLE_RAFFLE_TITLE,
  winnerEmail: SAMPLE_RAFFLE_WINNER_EMAIL,
  winnerName: SAMPLE_RAFFLE_WINNER_NAME,
  winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
};

export type SampleRaffleProvisioningErrorCode =
  | "PRODUCTION_CONFIRMATION_REQUIRED"
  | "DATABASE_TARGET_REQUIRED"
  | "DIRECT_LOCK_REQUIRED"
  | "ORGANIZER_CREDENTIAL_REQUIRED"
  | "ADMIN_CREDENTIAL_REQUIRED"
  | "WINNER_CREDENTIAL_REQUIRED"
  | "DRAW_ENCRYPTION_KEY_REQUIRED"
  | "HOST_EVENT_INVALID"
  | "AUTHENTICATION_FAILED"
  | "CONFLICTING_SAMPLE_STATE"
  | "FINAL_INVARIANT_FAILED";

export class SampleRaffleProvisioningError extends Error {
  constructor(readonly code: SampleRaffleProvisioningErrorCode) {
    super(code);
    this.name = "SampleRaffleProvisioningError";
  }
}
```

Define the two exact campaign manifests:

```ts
export function completedSampleRaffleInput(
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): CreateGiveawayInput {
  return {
    eventId: manifest.eventId,
    title: manifest.completedTitle,
    kind: "raffle",
    entryMode: "manual_only",
    maxEntriesPerRider: 1,
    mechanics: "One designated demo rider entry is selected for this sample raffle.",
    terms: "Sample raffle for demonstrating a completed Tambike winner flow.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "event_page",
    presenceVerificationRequired: false,
    eligibilityGroups: [
      { id: "sample-manual-entry", label: "Designated sample entry", weight: 1, conditions: [{ source: "manual" }] },
    ],
    prizePools: [
      {
        id: "sample-helmet-pool",
        title: "Helmet",
        awardMode: "manual_selection",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Cafe Classico Helmet" }],
      },
    ],
  };
}

export function ongoingSampleRaffleInput(
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): CreateGiveawayInput {
  return {
    eventId: manifest.eventId,
    title: manifest.ongoingTitle,
    kind: "raffle",
    entryMode: "opt_in",
    maxEntriesPerRider: 1,
    mechanics: "Registered event riders may enter once while this sample raffle is open.",
    terms: "Sample ongoing raffle. No winner has been selected.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "event_page",
    presenceVerificationRequired: false,
    eligibilityGroups: [
      { id: "active-rsvp-pass", label: "Active RSVP and pass", weight: 1, conditions: [{ source: "active_rsvp_pass" }] },
    ],
    prizePools: [
      {
        id: "sample-rider-gear-pool",
        title: "Rider gear package",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Weekend Rider Gear Package" }],
      },
    ],
  };
}
```

Implement `provisionSampleRaffles(input, dependencies, manifest)` with validation
before locking, exact-final no-op behavior, a second inspection after acquiring
the lock, fail-closed conflict handling, the ordered lifecycle calls, final
invariant checking, and `finally` cleanup that releases the lock and closes
clients. Production callers pass `productionSampleRaffleManifest`; tests pass an
explicit disposable manifest. The returned receipt must contain only:

```ts
export interface SampleRaffleProvisioningReceipt {
  eventId: string;
  completed: {
    giveawayId: string;
    state: "completed";
    winnerCount: 1;
    winnerAlias: typeof SAMPLE_RAFFLE_WINNER_ALIAS;
  };
  ongoing: {
    giveawayId: string;
    state: "open";
    winnerCount: 0;
  };
  changed: boolean;
}
```

- [ ] **Step 5: Run the focused tests and confirm GREEN**

Run:

```powershell
npm run test:server -- tests/server/sample-raffle-provisioner.test.ts
```

Expected: PASS; the fake receives no password, token, QR, seed, or database URL in its safe receipt.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/server/giveaways/sample-raffles.ts tests/server/sample-raffle-provisioner.test.ts
git commit -m "feat: add safe sample raffle provisioner"
```

---

### Task 2: Add the Prisma adapter, production CLI, and runbook

**Files:**
- Modify: `src/server/giveaways/sample-raffles.ts`
- Create: `scripts/provision-sample-raffles.ts`
- Modify: `tests/server/sample-raffle-provisioner.test.ts`
- Modify: `package.json`
- Create: `docs/deployment/sample-raffle-provisioning.md`

**Interfaces:**
- Consumes `PrismaTambikeBackend.create(databaseUrl)`.
- Produces:
  - `createPrismaSampleRaffleProvisioner(runtimeDatabaseUrl, directDatabaseUrl)`
  - `validateDirectSampleRaffleLockUrl(directDatabaseUrl)`
  - `runSampleRaffleCli(options?)`
  - npm script `provision:sample-raffles`.

- [ ] **Step 1: Add failing CLI and adapter safety tests**

Extend `tests/server/sample-raffle-provisioner.test.ts` with:

```ts
test("CLI requires --confirm-production before constructing a provisioner", async () => {
  const createProvisioner = vi.fn();
  await expect(runSampleRaffleCli({ argv: [], environment: {}, createProvisioner }))
    .rejects.toMatchObject({ code: "PRODUCTION_CONFIRMATION_REQUIRED" });
  expect(createProvisioner).not.toHaveBeenCalled();
});

test("CLI rejects a non-direct or non-Postgres lock URL", () => {
  expect(() => validateDirectSampleRaffleLockUrl("https://example.com"))
    .toThrow("DIRECT_LOCK_REQUIRED");
});

test("CLI output is a safe receipt only", async () => {
  const lines: string[] = [];
  await runSampleRaffleCli({
    argv: ["--confirm-production"],
    environment: completeEnvironment(),
    createProvisioner: async () => fakePrismaProvisioner(exactReceipt()),
    write: (line) => lines.push(line),
  });
  const output = lines.join("\n");
  expect(output).toContain("Cafe Classico Helmet Raffle");
  for (const forbidden of [
    "organizer-secret",
    "admin-secret",
    "winner-secret",
    "postgresql://",
    "sessionToken",
    "qrPayload",
    "GIVEAWAY_DRAW_ENCRYPTION_KEY",
  ]) {
    expect(output).not.toContain(forbidden);
  }
});
```

Add failure cleanup tests proving advisory unlock/client close runs after authentication, draw, or verification failures.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
npm run test:server -- tests/server/sample-raffle-provisioner.test.ts
```

Expected: FAIL because the Prisma factory and CLI do not exist.

- [ ] **Step 3: Implement the Prisma adapter**

In `src/server/giveaways/sample-raffles.ts`, create one raw Prisma client for inspection/locking and one `PrismaTambikeBackend` for authorized lifecycle calls.

The adapter must:

- parse and require `postgres:` or `postgresql:` URLs;
- require the runtime and direct URLs to identify the same database name;
- acquire `pg_advisory_lock(hashtextextended('tambike:production-sample-raffles:v1', 0))`;
- verify the host event exists, is `PUBLISHED`, and belongs to the authenticated organizer;
- inspect campaigns only by exact event ID and exact sample titles;
- authenticate organizer and admin using runtime-only passwords;
- login the dedicated sample winner when present, or use `signUpRider` when absent;
- register the dedicated winner as `going` with `attendanceType: "direct"`;
- create and progress campaigns using backend methods only;
- manually grant the completed entry only to the dedicated sample winner;
- after locking, require exactly one manual-selection candidate;
- select with idempotency key `sample-completed-manual-selection-v1`;
- publish the completed draw;
- call `setGiveawayWinnerPublication` as the winner with alias `Raffle Sample Rider`;
- issue a claim token, verify it with method `manual` and idempotency key `sample-completed-claim-verification-v1`;
- fulfil with idempotency key `sample-completed-fulfilment-v1` and reference `sample-display`;
- complete claims;
- leave the ongoing campaign immediately after `openGiveaway`;
- verify exact relational invariants with narrow Prisma selects;
- release the advisory lock and disconnect both clients in `finally`.

The final inspection must assert:

```ts
{
  completed: {
    status: "completed",
    complianceStatus: "approved",
    drawCount: 1,
    publishedDrawCount: 1,
    currentAwardCount: 1,
    fulfilledAwardCount: 1,
    publicWinnerAliases: ["Raffle Sample Rider"],
    winnerUserId: dedicatedWinnerId,
  },
  ongoing: {
    status: "open",
    complianceStatus: "approved",
    snapshotCount: 0,
    drawCount: 0,
    awardCount: 0,
  },
}
```

- [ ] **Step 4: Implement the secret-safe CLI**

Create `scripts/provision-sample-raffles.ts` using `loadEnvConfig(process.cwd())`. Require:

```text
--confirm-production
DATABASE_URL or SUPABASE_DATABASE_URL
DIRECT_URL
GIVEAWAY_DRAW_ENCRYPTION_KEY
TAMBIKE_SAMPLE_RAFFLE_ORGANIZER_PASSWORD
TAMBIKE_SAMPLE_RAFFLE_ADMIN_PASSWORD
TAMBIKE_SAMPLE_RAFFLE_WINNER_PASSWORD
```

Pass passwords directly to `provisionSampleRaffles` and never include them in errors or output. Map all known failures to stable error codes and print only `JSON.stringify(receipt)` on success.

Add to `package.json`:

```json
"provision:sample-raffles": "tsx --conditions=react-server scripts/provision-sample-raffles.ts"
```

- [ ] **Step 5: Write the production runbook**

Create `docs/deployment/sample-raffle-provisioning.md` with:

- the two exact campaign titles and host event;
- read-only database preflight commands;
- required environment variable names without values;
- `npm i -g vercel` and `vercel --version`;
- `vercel env pull .env.production.local --environment=production`, only after asserting that file does not already exist;
- exact CLI command:

```powershell
npm run provision:sample-raffles -- -- --confirm-production
```

- safe receipt and postflight examples without live IDs;
- immediate removal of the temporary `.env.production.local` after execution;
- explicit statement that cleanup/deletion requires separate user approval and is not part of this runbook.

- [ ] **Step 6: Run tests and static checks**

Run:

```powershell
npm run test:server -- tests/server/sample-raffle-provisioner.test.ts
npm run lint
git diff --check
```

Expected: all PASS with no secret value in snapshots, fixtures, docs, or output.

- [ ] **Step 7: Commit Task 2**

```powershell
git add package.json scripts/provision-sample-raffles.ts src/server/giveaways/sample-raffles.ts tests/server/sample-raffle-provisioner.test.ts docs/deployment/sample-raffle-provisioning.md
git commit -m "feat: add live sample raffle command"
```

---

### Task 3: Prove the complete lifecycle on disposable PostgreSQL

**Files:**
- Create: `tests/prisma-integration/sample-raffle-provisioner.integration.test.ts`

**Interfaces:**
- Consumes `createPrismaSampleRaffleProvisioner` and `provisionSampleRaffles`.
- Produces full database-backed evidence that the exact final invariants are achievable without direct lifecycle table writes.

- [ ] **Step 1: Write the failing disposable integration test**

Use `tests/prisma-integration/fixtures.ts` to create a published event, organizer, admin, and isolated users in a loopback `tambike_test_*` database. Pass a `SampleRaffleManifest` through the dependency factory for the disposable event; `runSampleRaffleCli` must always pass `productionSampleRaffleManifest`.

The test must:

```ts
test("provisions one completed winner and one open raffle idempotently", async () => {
  const first = await provisionSampleRaffles(validIntegrationInput(), dependencies);
  expect(first).toMatchObject({
    completed: { state: "completed", winnerCount: 1, winnerAlias: "Raffle Sample Rider" },
    ongoing: { state: "open", winnerCount: 0 },
    changed: true,
  });

  const second = await provisionSampleRaffles(validIntegrationInput(), dependencies);
  expect(second).toMatchObject({
    completed: { giveawayId: first.completed.giveawayId },
    ongoing: { giveawayId: first.ongoing.giveawayId },
    changed: false,
  });

  expect(await prisma.eventGiveaway.count({
    where: {
      eventId,
      title: { in: ["Cafe Classico Helmet Raffle", "Weekend Rider Gear Raffle"] },
    },
  })).toBe(2);
});
```

Also assert the completed winner is the dedicated demo user, no existing fixture rider is awarded, all lifecycle audit actions exist, and the ongoing raffle has no snapshot/draw/award rows.

- [ ] **Step 2: Run the integration test and confirm RED**

Run:

```powershell
npm run test:prisma:prepare
npm run test:prisma -- tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
```

Expected: FAIL until the adapter accepts the explicit `SampleRaffleManifest` dependency and implements exact disposable lock behavior.

- [ ] **Step 3: Make the minimum adapter changes**

Add only the `SampleRaffleManifest` parameter required by the disposable test. Keep `runSampleRaffleCli` fixed to `productionSampleRaffleManifest`; do not parse CLI flags or environment variables that override the host event, titles, winner email, or winner alias.

- [ ] **Step 4: Run the integration and focused server suites**

Run:

```powershell
npm run test:prisma -- tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
npm run test:server -- tests/server/sample-raffle-provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/server/giveaways/sample-raffles.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
git commit -m "test: verify sample raffle provisioning"
```

---

### Task 4: Run the complete local verification gate

**Files:**
- No expected file changes.

**Interfaces:**
- Consumes the committed provisioner and tests.
- Produces fresh evidence before any live write.

- [ ] **Step 1: Run focused safety tests**

```powershell
npm run test:server -- tests/server/sample-raffle-provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run disposable database proof**

```powershell
npm run test:prisma:prepare
npm run test:prisma -- tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
```

Expected: PASS against a loopback `tambike_test_*` database only.

- [ ] **Step 3: Run repository gates**

```powershell
npm run lint
npm run build
git diff --check
git status --short --branch
```

Expected: lint/build/diff checks PASS and the worktree is clean on `main`.

---

### Task 5: Provision and verify the two live samples

**Files:**
- No source changes expected.
- Temporary ignored file: `.env.production.local`, created only if absent and removed immediately after use.

**Interfaces:**
- Consumes the verified CLI, current Vercel production environment, and live RDS database.
- Produces two live campaigns plus a safe receipt containing their IDs and final public states.

- [ ] **Step 1: Install and verify the Vercel CLI**

The Vercel CLI is currently unavailable. Install it:

```powershell
npm i -g vercel
vercel --version
```

Expected: a current Vercel CLI version prints successfully.

- [ ] **Step 2: Perform a fresh read-only live preflight**

Confirm:

- live runtime target is `tambike_db` on the configured RDS host, without printing credentials;
- host event exists and is published;
- exact sample-title count is zero, or both campaigns already satisfy the exact final invariant;
- organizer/admin authentication succeeds;
- `.env.production.local` does not already exist;
- Git worktree is clean.

If one campaign exists in a non-final state, stop with `CONFLICTING_SAMPLE_STATE`.

- [ ] **Step 3: Pull the existing production environment without deploying**

```powershell
vercel env pull .env.production.local --environment=production
```

Confirm the required key names are present without printing their values. If `GIVEAWAY_DRAW_ENCRYPTION_KEY` is absent, stop before any write and report the blocker; do not create or rotate a production key in this task.

- [ ] **Step 4: Set runtime-only sample credentials**

Set the organizer/admin credentials only in the current PowerShell process. Generate a strong runtime-only password for the dedicated sample winner in that same process. Do not echo any of the values and do not write them to a file or documentation.

- [ ] **Step 5: Execute the production-confirmed command once**

```powershell
npm run provision:sample-raffles -- -- --confirm-production
```

Expected: the CLI exits `0` and prints one JSON object. Its `eventId` is
`tambike-cafe-classico`; each `giveawayId` is a non-empty runtime-generated
opaque string; the completed object reports title `Cafe Classico Helmet
Raffle`, state `completed`, winner count `1`, and alias `Raffle Sample Rider`;
the ongoing object reports title `Weekend Rider Gear Raffle`, state `open`,
and winner count `0`; `changed` is `true`.

- [ ] **Step 6: Remove the temporary production environment file**

Resolve and verify that `.env.production.local` is inside `D:\Github\personal\tambike`, then remove that exact file with `Remove-Item -LiteralPath`. Clear the three runtime password environment variables from the current process.

- [ ] **Step 7: Run a read-only database postflight**

Confirm:

- exactly two exact-title campaigns;
- completed campaign is `completed`, one published draw, one current fulfilled award, one public alias;
- winner is the dedicated sample winner account;
- ongoing campaign is `open` with zero snapshots, draws, and awards;
- no real rider received a sample award.

- [ ] **Step 8: Verify the public event page in the Codex browser**

Open:

```text
https://tambike.vercel.app/events/tambike-cafe-classico
```

At a mobile viewport, confirm:

- `Cafe Classico Helmet Raffle` shows the completed state and `Raffle Sample Rider`;
- `Weekend Rider Gear Raffle` shows the open/ongoing state;
- no email, claim token, delivery details, seed, or internal policy copy appears.

- [ ] **Step 9: Verify the organizer workspace in the Codex browser**

Using the normal login flow, open:

```text
https://tambike.vercel.app/organizer/events/tambike-cafe-classico/giveaways
```

Confirm the campaign rail shows one `Completed` campaign and one `Open` campaign, and the completed detail presents the published winner safely.

- [ ] **Step 10: Final verification and handoff**

Run:

```powershell
git status --short --branch
```

Report the two opaque campaign IDs, public and organizer URLs, read-only invariant summary, mobile browser outcome, temporary-file removal, and any separately-approved cleanup requirement. Do not report any credential, token, QR payload, seed, or database URL.
