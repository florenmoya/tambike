# Realistic Sample Raffle Identity and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the completed sample raffle's synthetic winner and generic helmet presentation with Gabriel Cruz and an accurately branded HJC C10 FOP prize while preserving the existing giveaway history.

**Architecture:** Update the sample raffle source constants for future provisioning, then add a dedicated preview-first maintenance operation for the already-provisioned RDS data. The maintenance operation guards every database row by ID and exact old values, uploads the official HJC image to a new S3 key before the transaction, appends audit events, and removes the old object only after commit.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Prisma 7/PostgreSQL, AWS S3 member-media store, Sharp image normalization.

## Global Constraints

- Keep the completed draw, award, claim, fulfillment, and existing audit records.
- Keep the dedicated winner's stable ID and email `raffle.winner.sample@tambike.ph`.
- Use `Gabriel Cruz` for both the dedicated user's display name and the published winner alias.
- Use `HJC C10 FOP Helmet Raffle` as the completed campaign title.
- Use `HJC C10 FOP Full-Face Helmet` for the public prize title and prize item.
- Use official product source `https://hjchelmets.us/products/c10-fop`.
- Use official image `https://hjchelmets.us/cdn/shop/files/mc23___c10_fop_1.webp?v=1769468143&width=1600`.
- State `HJC is shown as the sample prize brand. No sponsorship or endorsement is implied.` in giveaway compliance data.
- Do not change the ongoing Weekend Rider Gear Raffle.
- Do not run `npm run build` or start another development server.
- Preview the active database and obtain explicit approval before applying writes.

---

### Task 1: Make the source manifest truthful and consistently branded

**Files:**
- Modify: `src/server/giveaways/sample-raffles.ts`
- Modify: `src/server/giveaways/sample-raffle-presentation.ts`
- Modify: `src/server/maintenance/public-seed-label-cleanup.ts`
- Modify: `tests/server/sample-raffle-provisioner.test.ts`
- Modify: `tests/server/sample-raffle-presentation.test.ts`
- Modify: `tests/server/public-seed-label-cleanup.test.ts`

**Interfaces:**
- Consumes: current `productionSampleRaffleManifest`, `completedSampleRaffleInput()`, and `SAMPLE_RAFFLE_PHOTO_SOURCES`.
- Produces: new constants used by provisioning and the maintenance task.

- [ ] **Step 1: Write failing identity and branding assertions**

Update focused tests to require:

```ts
expect(SAMPLE_RAFFLE_WINNER_NAME).toBe("Gabriel Cruz");
expect(SAMPLE_RAFFLE_WINNER_ALIAS).toBe("Gabriel Cruz");
expect(COMPLETED_SAMPLE_RAFFLE_TITLE).toBe("HJC C10 FOP Helmet Raffle");
expect(completed.prizePools[0]?.publicPresentation).toEqual({
  disclosure: "revealed",
  title: "HJC C10 FOP Full-Face Helmet",
  description: "A branded full-face helmet for everyday road riding.",
});
expect(completed.prizePools[0]?.items).toEqual([
  { title: "HJC C10 FOP Full-Face Helmet" },
]);
expect(completed.sponsorDisclosure).toBe(
  "HJC is shown as the sample prize brand. No sponsorship or endorsement is implied.",
);
expect(SAMPLE_RAFFLE_PHOTO_SOURCES.completed).toMatchObject({
  pageUrl: "https://hjchelmets.us/products/c10-fop",
  mediaId: "sample-raffle-hjc-c10-fop-photo-v1",
});
```

Update the public seed cleanup test to require the dedicated winner mapping to `Gabriel Cruz` and to treat `Cafe Classico Rider` as a legacy alias.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts tests/server/sample-raffle-presentation.test.ts tests/server/public-seed-label-cleanup.test.ts
```

Expected: failures on the old winner, prize, and photo constants.

- [ ] **Step 3: Update source constants and completed input**

Set:

```ts
export const COMPLETED_SAMPLE_RAFFLE_TITLE = "HJC C10 FOP Helmet Raffle";
export const SAMPLE_RAFFLE_WINNER_NAME = "Gabriel Cruz";
export const SAMPLE_RAFFLE_WINNER_ALIAS = "Gabriel Cruz";
```

Keep mechanics unchanged. Set terms and sponsor disclosure:

```ts
terms:
  "The winner receives one HJC C10 FOP Full-Face Helmet. The organizer will contact the winner with claiming instructions.",
sponsorDisclosure:
  "HJC is shown as the sample prize brand. No sponsorship or endorsement is implied.",
```

Set prize pool presentation and item:

```ts
publicPresentation: {
  disclosure: "revealed",
  title: "HJC C10 FOP Full-Face Helmet",
  description: "A branded full-face helmet for everyday road riding.",
},
items: [{ title: "HJC C10 FOP Full-Face Helmet" }],
```

Set completed photo source:

```ts
completed: {
  pageUrl: "https://hjchelmets.us/products/c10-fop",
  downloadUrl:
    "https://hjchelmets.us/cdn/shop/files/mc23___c10_fop_1.webp?v=1769468143&width=1600",
  photographer: "HJC Helmets",
  mediaId: "sample-raffle-hjc-c10-fop-photo-v1",
},
```

Change `PUBLIC_SEED_USER_RENAMES` for the dedicated winner to `Gabriel Cruz`, set the clean raffle alias to `Gabriel Cruz`, and include `Cafe Classico Rider` in the legacy alias list.

- [ ] **Step 4: Run the focused tests**

Run the Task 1 command again. Expected: PASS.

### Task 2: Build a pure guarded maintenance plan

**Files:**
- Create: `src/server/maintenance/sample-raffle-branding-cleanup.ts`
- Create: `tests/server/sample-raffle-branding-cleanup.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RAFFLE_PHOTO_SOURCES`, sample raffle constants, `canonicalizeJson()`, and `calculateGiveawayAuditHash()`.
- Produces:
  - `inspectSampleRaffleBranding(prisma): Promise<SampleRaffleBrandingSnapshot>`
  - `buildSampleRaffleBrandingPlan(snapshot): SampleRaffleBrandingPlan`
  - `applySampleRaffleBrandingPlan(tx, plan, image): Promise<void>`
  - `createPrismaSampleRaffleBrandingStore(databaseUrl): SampleRaffleBrandingStore`

- [ ] **Step 1: Write failing planner tests**

Cover:

1. the exact live legacy snapshot produces one complete plan
2. a fully updated snapshot is idempotent
3. an organizer-edited title, description, alias, or image produces a conflict instead of an update
4. the dedicated user, giveaway, award, prize pool, item, latest mechanics version, and image are all required
5. the ongoing giveaway is not inspected or changed

The plan must contain exact `{ id, from, to }` values for scalar updates and:

```ts
imageUpdate: {
  id: "existing-image-id",
  prizePoolId: "completed-pool-id",
  from: {
    mediaId: "sample-raffle-helmet-photo-v1",
    storageKey: "existing-stock-photo-key",
  },
  to: {
    mediaId: "sample-raffle-hjc-c10-fop-photo-v1",
    storageKey:
      "media/giveaway-prizes/completed-pool-id/sample-raffle-hjc-c10-fop-photo-v1.webp",
  },
}
```

- [ ] **Step 2: Run the planner test and confirm module-not-found failure**

```powershell
npx vitest run tests/server/sample-raffle-branding-cleanup.test.ts
```

- [ ] **Step 3: Implement snapshot and plan types**

Use a single snapshot with:

```ts
interface SampleRaffleBrandingSnapshot {
  winner: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  completed: {
    id: string;
    eventId: string;
    creatorUserId: string;
    title: string;
    status: string;
    complianceStatus: string;
    award: {
      id: string;
      winnerUserId: string;
      publicWinnerAlias: string | null;
      winnerAliasOptedInAt: Date | null;
      winnerAliasRevokedAt: Date | null;
    } | null;
    prizePool: {
      id: string;
      publicTitle: string | null;
      publicDescription: string | null;
      prizeItem: { id: string; title: string } | null;
      publicImage: {
        id: string;
        mediaId: string;
        storageKey: string;
      } | null;
    } | null;
    latestMechanics: {
      id: string;
      version: number;
      mechanics: string;
      terms: string;
      sponsorDisclosure: string | null;
    } | null;
  } | null;
}
```

`buildSampleRaffleBrandingPlan()` accepts only exact legacy or exact desired values. Any third value is added to `conflicts`. `apply` is forbidden when `conflicts.length > 0`.

- [ ] **Step 4: Implement guarded transaction helpers**

Use `updateMany` for user, giveaway, award, pool, item, and image with ID plus exact previewed old values. Require `count === 1` for every planned update.

Append a mechanics version only when the current latest version and old content still match. Append two audit events in sequence:

1. `GIVEAWAY_UPDATED` for branded presentation and official product source
2. `GIVEAWAY_WINNER_PUBLICATION_OPTED_IN` for the consistent public identity

Use the existing canonical audit hash helper for both.

- [ ] **Step 5: Run the planner and apply tests**

Expected: PASS, including stale-row aborts.

### Task 3: Add rollback-safe image preparation and CLI

**Files:**
- Create: `scripts/clean-sample-raffle-branding.ts`
- Create: `tests/server/sample-raffle-branding-cleanup-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SampleRaffleBrandingStore`, existing S3 member media store, `normalizeMemberImage()`, and the official image source.
- Produces:
  - `runSampleRaffleBrandingCleanupCli(options): Promise<SampleRaffleBrandingReceipt>`
  - package command `clean:sample-raffle-branding`

- [ ] **Step 1: Write failing CLI tests**

Assert:

- default mode is `preview`
- preview never fetches or uploads the image
- `--apply` is the only write path
- apply downloads and normalizes the official image
- transaction failure deletes the new S3 object and leaves the old one
- success deletes the old object after database commit
- credentials never appear in output
- store always closes

- [ ] **Step 2: Run the CLI test and confirm failure**

```powershell
npx vitest run tests/server/sample-raffle-branding-cleanup-cli.test.ts
```

- [ ] **Step 3: Implement the CLI**

Use the existing environment-loading pattern. The apply sequence is:

```ts
const plan = buildSampleRaffleBrandingPlan(await store.inspect());
if (plan.conflicts.length > 0) throw new Error("SAMPLE_RAFFLE_BRANDING_CONFLICT");
if (mode === "apply" && plan.imageUpdate) {
  const prepared = await prepareOfficialImage();
  await mediaStore.putObject(prepared.newObject);
  try {
    await store.apply(plan, prepared.image);
  } catch (error) {
    await mediaStore.deleteObject(prepared.newObject.key);
    throw error;
  }
  await mediaStore.deleteObject(plan.imageUpdate.from.storageKey);
} else if (mode === "apply") {
  await store.apply(plan);
}
```

Reject a failed HTTP response, unsupported content type, empty body, or mismatched normalized MIME type.

Add:

```json
"clean:sample-raffle-branding": "tsx --conditions=react-server scripts/clean-sample-raffle-branding.ts"
```

- [ ] **Step 4: Run focused tests**

```powershell
npx vitest run tests/server/sample-raffle-branding-cleanup.test.ts tests/server/sample-raffle-branding-cleanup-cli.test.ts
```

Expected: PASS.

### Task 4: Update active operational documentation

**Files:**
- Modify: `docs/deployment/sample-raffle-provisioning.md`
- Modify: current tests that assert the runbook labels

**Interfaces:**
- Consumes: final source constants.
- Produces: a current runbook with matching winner, campaign, prize, official source, and media ID.

- [ ] **Step 1: Replace active runbook expectations**

Replace operational references to:

- `Raffle Winner` → `Gabriel Cruz`
- `Cafe Classico Rider` → `Gabriel Cruz`
- `Cafe Classico Helmet Raffle` → `HJC C10 FOP Helmet Raffle`
- `Cafe Classico Helmet` → `HJC C10 FOP Full-Face Helmet`
- old Pexels helmet asset/media ID → official HJC page/image and new media ID

Keep historical specs and plans unchanged.

- [ ] **Step 2: Run affected server tests**

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts tests/server/public-seed-label-cleanup.test.ts
```

Expected: PASS.

### Task 5: Verify, preview, obtain approval, apply, and verify live

**Files:**
- Verify all changed files and the active database.

**Interfaces:**
- Consumes: completed implementation.
- Produces: test, database, and browser evidence.

- [ ] **Step 1: Run focused tests**

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts tests/server/sample-raffle-presentation.test.ts tests/server/public-seed-label-cleanup.test.ts tests/server/sample-raffle-branding-cleanup.test.ts tests/server/sample-raffle-branding-cleanup-cli.test.ts
```

- [ ] **Step 2: Run the full server suite**

```powershell
npm run test:server -- --maxWorkers=4
```

Do not run a production build.

- [ ] **Step 3: Run read-only preview**

```powershell
npm run clean:sample-raffle-branding
```

Report the exact host/database, guarded row IDs, metadata changes, and image replacement. Obtain explicit approval before `--apply`.

- [ ] **Step 4: Apply after approval**

Use the direct invocation so the flag is guaranteed to reach the script:

```powershell
npx tsx --conditions=react-server scripts/clean-sample-raffle-branding.ts --apply
```

- [ ] **Step 5: Prove idempotency**

```powershell
npm run clean:sample-raffle-branding
```

Expected: no updates, no conflicts, and no image replacement.

- [ ] **Step 6: Verify the live result**

Reuse the Codex browser on:

```text
http://localhost:3000/events/tambike-cafe-classico
```

At 1440px and 390px confirm:

- `Winner: Gabriel Cruz`
- `Prize won: HJC C10 FOP Full-Face Helmet`
- official branded helmet image is visible
- no old winner/prize labels
- no horizontal overflow

- [ ] **Step 7: Final audit**

Report focused/full test counts, database apply plus zero-update preview, S3 old/new object handling, and responsive browser evidence. Preserve unrelated working-tree changes.
