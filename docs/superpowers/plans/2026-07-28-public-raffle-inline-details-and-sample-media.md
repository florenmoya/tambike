# Public Raffle Inline Details and Sample Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public raffle cards understandable without opening basic-detail accordions and refresh the two Cafe Classico seeded raffles with normal public copy and managed prize photos.

**Architecture:** Keep the safe public giveaway DTO unchanged and reshape only its event-page renderer. Extend the narrow, production-confirmed sample-raffle provisioner so it can refresh the exact two seeded campaign graphs in place, while preserving lifecycle state and using Tambike-managed S3 media records for the downloaded Pexels photos.

**Tech Stack:** Next.js 16.2 App Router, React 19, CSS Modules, TypeScript, Prisma 7/PostgreSQL, S3 member-media store, Sharp image normalization, Vitest.

## Global Constraints

- Important ongoing and completed raffle information is visible immediately.
- Only published technical draw verification remains collapsible.
- Public seeded fields and the winner alias contain no `sample` or `demo` wording.
- Missing prize images render no empty placeholder.
- Surprise prizes never reveal a title, description, or image.
- Pexels photos are downloaded once when managed media is absent; the event page never hotlinks them.
- Existing campaign, prize-pool, draw, award, and entrant IDs remain stable.
- Existing unrelated working-tree edits in `src/app/globals.css` and `tests/tambike-demo.spec.ts` are not modified or staged.
- No new branch or worktree is created.

---

### Task 1: Render public raffle essentials inline

**Files:**
- Modify: `tests/server/public-giveaway-spotlight.test.ts`
- Modify: `src/features/giveaways/public-giveaway-panel.tsx`
- Modify: `src/features/giveaways/public-giveaway-panel.module.css`

**Interfaces:**
- Consumes: `PublicEventGiveaway`, `PublicPrizePresentation`, `PublicPrizeImage`, and the existing role-aware login action.
- Produces: `PublicRaffleInformation`, a local presentational component that renders sponsor, mechanics, and terms without disclosure; `DrawVerificationDetails`, the only remaining `<details>` control.

- [ ] **Step 1: Write the failing event-page behavior test**

Update the main spotlight test fixture so both the ongoing and completed
campaigns have prize images, descriptions, mechanics, terms, sponsor copy, and
draw dates. Assert the following literals against rendered behavior:

```ts
expect(articles[0]?.textContent).toContain("Mechanics");
expect(articles[0]?.textContent).toContain("Terms");
expect(articles[2]?.textContent).toContain("Mechanics");
expect(articles[2]?.textContent).toContain("Terms");
expect(articles[2]?.querySelector("img")?.alt).toBe("Tambike helmet");
expect(container.querySelectorAll("details")).toHaveLength(2);
expect(
  [...container.querySelectorAll("details > summary")].map(
    (summary) => summary.textContent,
  ),
).toEqual(["Draw verification", "Published draw"]);
expect(text).not.toContain("Raffle details");
expect(text).not.toContain("View result");
```

Add a separate completed-without-verification case and assert it renders no
`details` element while mechanics and terms remain visible.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts
```

Expected: FAIL because ongoing/completed basics are still inside
`Raffle details` or `View result`, the completed card has no image, and the
outer technical disclosure is not named `Draw verification`.

- [ ] **Step 3: Implement the inline information components**

In `public-giveaway-panel.tsx`:

```tsx
function PublicRaffleInformation({
  mechanics,
  terms,
  sponsorDisclosure,
}: {
  mechanics: string;
  terms: string;
  sponsorDisclosure?: string;
}) {
  const sponsor = sponsorDisclosure?.trim();
  return (
    <div className={styles.publicInfo}>
      {sponsor ? <p className={styles.sponsorDisclosure}>{sponsor}</p> : null}
      <p>{mechanics}</p>
      <p className={styles.terms}>{terms}</p>
    </div>
  );
}
```

Render `PublicRaffleInformation` directly in open, completed, and compact
cards. Render `PublicPrizeImage` in completed cards too. Include the completed
draw date in its schedule when configured.

Replace `CampaignDetails` with:

```tsx
function DrawVerificationDetails({
  drawVerifications,
}: {
  drawVerifications: PublicEventGiveaway["drawVerifications"];
}) {
  if (drawVerifications.length === 0) return null;
  return (
    <details className={styles.details}>
      <summary>
        Draw verification
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={styles.detailsBody}>
        <div className={styles.proofList}>
          {drawVerifications.map(/* existing DrawReceipt rendering */)}
        </div>
      </div>
    </details>
  );
}
```

Preserve `primaryPrizePresentation` and `toValidPublicPrizeImage` unchanged so
surprise and URL redaction remain server/client defense-in-depth.

- [ ] **Step 4: Adjust card layout and verify GREEN**

In the CSS module, add styles for a compact visible information block and
remove selectors used only by the deleted basic-details accordion:

```css
.publicInfo {
  display: grid;
  gap: 0.45rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 0.8rem;
}

.publicInfo p {
  margin: 0;
  color: var(--raffle-muted);
  font-size: 0.82rem;
  line-height: 1.5;
}
```

Keep images at `aspect-ratio: 4 / 3` with `object-fit: cover`, natural card
heights, and the existing one-column breakpoint below 900px.

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts tests/server/rider-giveaway-entry-controls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the public UI change**

```powershell
git add -- src/features/giveaways/public-giveaway-panel.tsx src/features/giveaways/public-giveaway-panel.module.css tests/server/public-giveaway-spotlight.test.ts
git commit -m "feat: show public raffle details inline"
```

### Task 2: Replace seeded public demonstration copy

**Files:**
- Modify: `tests/server/sample-raffle-provisioner.test.ts`
- Modify: `src/server/giveaways/sample-raffles.ts`
- Modify: `tests/prisma-integration/sample-raffle-provisioner.integration.test.ts`

**Interfaces:**
- Consumes: `completedSampleRaffleInput`, `ongoingSampleRaffleInput`, and `productionSampleRaffleManifest`.
- Produces: public winner alias `Cafe Classico Rider` and exact public title, description, mechanics, and terms for both seeded raffles.

- [ ] **Step 1: Write failing seeded-copy assertions**

Extend `publishes explicit prize names without changing the sample inventory`
with literal assertions:

```ts
expect(SAMPLE_RAFFLE_WINNER_ALIAS).toBe("Cafe Classico Rider");
expect(completed.mechanics).toBe(
  "One eligible rider was selected from valid entries.",
);
expect(completed.terms).toBe(
  "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.",
);
expect(completed.prizePools[0]?.publicPresentation).toEqual({
  disclosure: "revealed",
  title: "Cafe Classico Helmet",
  description: "A full-face helmet for safer everyday rides.",
});
expect(ongoing.mechanics).toBe(
  "Registered event riders may enter once while the raffle is open.",
);
expect(ongoing.terms).toBe(
  "One winner will receive the Weekend Rider Gear Package. The organizer will announce and contact the winner after the draw.",
);
expect(ongoing.prizePools[0]?.publicPresentation).toEqual({
  disclosure: "revealed",
  title: "Weekend Rider Gear Package",
  description: "Helmet, riding gloves, and Tambike gear for your next ride.",
});
```

Update integration expectations from `Raffle Sample Rider` to
`Cafe Classico Rider`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts
```

Expected: FAIL on the old alias, mechanics, terms, and missing descriptions.

- [ ] **Step 3: Update the seed input**

Change only public-facing constants/fields in `sample-raffles.ts`. Retain the
dedicated account email/name and internal operator reasons so the production
graph remains identifiable without leaking those words to the event page.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the copy change**

```powershell
git add -- src/server/giveaways/sample-raffles.ts tests/server/sample-raffle-provisioner.test.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
git commit -m "fix: publish natural sample raffle copy"
```

### Task 3: Refresh existing seeded presentation safely

**Files:**
- Create: `src/server/giveaways/sample-raffle-presentation.ts`
- Modify: `src/server/giveaways/sample-raffles.ts`
- Modify: `tests/server/sample-raffle-provisioner.test.ts`
- Create: `tests/server/sample-raffle-presentation.test.ts`

**Interfaces:**
- Consumes: the exact campaign/prize-pool/award inspection, authenticated organizer/admin/winner sessions, Prisma client, S3 `MemberMediaStore`, `normalizeMemberImage`, and `fetch`.
- Produces:

```ts
export interface SampleRafflePresentationInspection {
  mechanics: string;
  terms: string;
  prizePoolId: string;
  publicTitle?: string;
  publicDescription?: string;
  publicImageMediaId?: string;
}

export interface RefreshSampleRafflePresentationInput {
  organizerUserId: string;
  adminUserId: string;
  completed: SampleRaffleCompletedCampaignInspection;
  ongoing: SampleRaffleOngoingCampaignInspection;
}

export async function refreshSampleRafflePresentation(
  input: RefreshSampleRafflePresentationInput,
  dependencies: RefreshSampleRafflePresentationDependencies,
): Promise<void>;
```

- [ ] **Step 1: Write failing provisioner refresh-path tests**

Create an inspection fixture with the exact lifecycle shape but old public
copy, old winner alias, and no media. Assert that provisioning:

```ts
expect(dependencies.calls).toContain("refreshExistingPresentation");
expect(dependencies.calls).not.toContain("createCompletedCampaign");
expect(dependencies.calls).not.toContain("createOngoingCampaign");
expect(receipt.changed).toBe(true);
```

Add an already-refreshed fixture and assert no authentication, lock, refresh,
or create calls occur and `changed` is false.

- [ ] **Step 2: Run the provisioner test and verify RED**

Run:

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts
```

Expected: FAIL because `finalReceipt` does not inspect copy/media and the
provisioner returns before refreshing an existing lifecycle-complete graph.

- [ ] **Step 3: Extend inspection and the refresh branch**

Add `presentation: SampleRafflePresentationInspection` to both campaign
inspection types and `awardId` to the completed award inspection. Split
lifecycle validation from final presentation validation:

```ts
function hasExpectedSampleLifecycle(
  inspection: SampleRaffleTargetInspection,
  manifest: SampleRaffleManifest,
): boolean;

function hasExpectedSamplePresentation(
  inspection: SampleRaffleTargetInspection,
  manifest: SampleRaffleManifest,
): boolean;
```

Under the existing advisory lock:

```ts
if (hasExpectedSampleLifecycle(lockedInspection, manifest)) {
  const organizer = await dependencies.authenticateOrganizer(...);
  const admin = await dependencies.authenticateAdmin(...);
  const winner = await dependencies.ensureWinner(...);
  await dependencies.refreshExistingPresentation({
    organizer,
    admin,
    winner,
    inspection: lockedInspection,
    manifest,
  });
  const refreshed = await dependencies.inspectTarget(manifest);
  const receipt = finalReceipt(refreshed, manifest, true);
  if (!receipt) {
    throw new SampleRaffleProvisioningError("FINAL_INVARIANT_FAILED");
  }
  return receipt;
}
```

Call the same refresh dependency after creating both campaigns and before the
final inspection, so first-time and existing provisioning converge on one
final state.

- [ ] **Step 4: Write failing media preparation tests**

In `sample-raffle-presentation.test.ts`, inject a fake fetcher, normalizer,
media store, and persistence adapter. Assert:

- both official image URLs are fetched only when their pool lacks an image;
- non-200 or non-image responses throw before database writes;
- normalized WebP bytes are stored under each exact prize-pool namespace;
- existing images are preserved and not downloaded or overwritten;
- a database failure deletes only newly uploaded objects;
- rerunning an exact state performs no writes.

Use these exact sources:

```ts
export const SAMPLE_RAFFLE_PHOTO_SOURCES = {
  completed: {
    pageUrl: "https://www.pexels.com/photo/photo-of-a-motorcycle-helmet-15928222/",
    downloadUrl:
      "https://images.pexels.com/photos/15928222/pexels-photo-15928222.jpeg?auto=compress&cs=tinysrgb&w=1600",
  },
  ongoing: {
    pageUrl: "https://www.pexels.com/photo/man-wearing-a-safety-helmet-15625079/",
    downloadUrl:
      "https://images.pexels.com/photos/15625079/pexels-photo-15625079.jpeg?auto=compress&cs=tinysrgb&w=1600",
  },
} as const;
```

- [ ] **Step 5: Run the media tests and verify RED**

Run:

```powershell
npx vitest run tests/server/sample-raffle-presentation.test.ts
```

Expected: FAIL because the presentation refresh module does not exist.

- [ ] **Step 6: Implement managed presentation refresh**

The new module must:

1. validate the exact two campaign titles, states, prize-pool IDs, and public
   disclosure before downloading;
2. download only absent images and reject non-OK/non-`image/*` responses;
3. normalize with `purpose: "motorcycle-photo"` and write WebP to:

```ts
`media/giveaway-prizes/${prizePoolId}/${mediaId}.webp`
```

4. inside one Prisma transaction, lock both campaign and pool rows, revalidate
   their identity, update `publicTitle`/`publicDescription`, create a new
   approved mechanics version only when copy differs, and create managed
   `GiveawayPrizeImage` rows only when still absent;
5. append a hash-chained `GIVEAWAY_UPDATED` audit event using
   `canonicalizeJson` and `calculateGiveawayAuditHash`;
6. delete newly uploaded objects if the transaction fails;
7. call the existing winner publication backend method after the database
   transaction to replace the old public alias with `Cafe Classico Rider`.

The Prisma adapter supplies the real S3 store from
`createS3MemberMediaStore(loadMemberMediaConfig())`, real image normalization,
and global `fetch`. Tests inject fakes.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/server/sample-raffle-presentation.test.ts tests/server/sample-raffle-provisioner.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the refresh workflow**

```powershell
git add -- src/server/giveaways/sample-raffles.ts src/server/giveaways/sample-raffle-presentation.ts tests/server/sample-raffle-provisioner.test.ts tests/server/sample-raffle-presentation.test.ts
git commit -m "feat: refresh seeded raffle presentation"
```

### Task 4: Document and verify production provisioning

**Files:**
- Modify: `docs/deployment/sample-raffle-provisioning.md`
- Modify: `tests/server/sample-raffle-provisioner.test.ts`

**Interfaces:**
- Consumes: `npm run provision:sample-raffles -- -- --confirm-production`.
- Produces: operator evidence for source licensing, preflight, exact postflight copy/media checks, and secret cleanup.

- [ ] **Step 1: Write failing runbook assertions**

Extend the existing runbook test with:

```ts
for (const invariant of [
  "Cafe Classico Rider",
  "A full-face helmet for safer everyday rides.",
  "Helmet, riding gloves, and Tambike gear for your next ride.",
  "GiveawayPrizeImage",
  "15928222",
  "15625079",
]) {
  expect(runbook).toContain(invariant);
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts
```

Expected: FAIL because the runbook still verifies the old alias and does not
prove managed images/public descriptions.

- [ ] **Step 3: Update the runbook**

Document the two Pexels page URLs and photographers, then update preflight and
postflight SQL to return the current mechanics, terms, public title,
description, winner alias, and non-null managed `GiveawayPrizeImage` for each
exact target pool. Preserve all existing secret handling and exact database
identity checks.

- [ ] **Step 4: Run focused and broad automated verification**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts tests/server/rider-giveaway-entry-controls.test.ts tests/server/sample-raffle-presentation.test.ts tests/server/sample-raffle-provisioner.test.ts
npm run lint
npm run build
```

Expected: all commands exit 0 without warnings introduced by this change.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- docs/deployment/sample-raffle-provisioning.md tests/server/sample-raffle-provisioner.test.ts
git commit -m "docs: verify seeded raffle prize media"
```

### Task 5: Production refresh and responsive browser proof

**Files:**
- No source-file edits expected.

**Interfaces:**
- Consumes: the production-confirmed provisioner, current `main`, and Codex in-app browser.
- Produces: exact database receipt, deployed commit, desktop/mobile visual proof, and a clean runtime error check.

- [ ] **Step 1: Confirm source and deployment readiness**

Run:

```powershell
git status --short
git diff --check
git log -1 --oneline
```

Confirm only the two pre-existing user-owned dirty files remain outside the
committed change.

- [ ] **Step 2: Run the production-confirmed refresh**

Use the existing deployment runbook to load production environment values
without printing them, run:

```powershell
npm run provision:sample-raffles -- -- --confirm-production
```

and execute the exact postflight query. Expected receipt:

```json
{
  "eventId": "tambike-cafe-classico",
  "completed": {
    "title": "Cafe Classico Helmet Raffle",
    "state": "completed",
    "winnerCount": 1,
    "winnerAlias": "Cafe Classico Rider"
  },
  "ongoing": {
    "title": "Weekend Rider Gear Raffle",
    "state": "open",
    "winnerCount": 0
  },
  "changed": true
}
```

Postflight must additionally prove both descriptions, public-safe mechanics
and terms, and one managed image per exact prize pool.

- [ ] **Step 3: Push and deploy the exact commit**

Push `main` only after tests/build pass. Use the repository's existing Vercel
Git integration and verify the production deployment resolves to that exact
commit before reporting success.

- [ ] **Step 4: Verify with the Codex browser**

Open:

```text
https://tambike.vercel.app/events/tambike-cafe-classico
```

At desktop and mobile widths verify:

- both selected photos render with a restrained 4:3 crop;
- prize, mechanics, terms, dates, winner, and prize won are visible without a
  click;
- no `sample`, `demo`, `Raffle details`, or `View result` text is visible;
- only `Draw verification` is collapsible and it expands correctly;
- no horizontal overflow occurs.

- [ ] **Step 5: Check production runtime evidence**

Confirm the public event URL returns HTTP 200 and inspect recent deployment
logs for errors introduced by the released commit.

