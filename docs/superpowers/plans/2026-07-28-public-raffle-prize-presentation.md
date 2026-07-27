# Public Raffle Prize Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each flexible raffle prize pool an organizer-controlled revealed or surprise public presentation, securely redact hidden prizes, support an optional uploaded prize image, and replace the confusing public cards with a familiar Philippine raffle layout.

**Architecture:** Keep actual prize inventory separate from public presentation at the prize-pool boundary. Persist disclosure and public copy on `GiveawayPrizePool`, store an optional organizer-owned `GiveawayPrizeImage`, and project a redacted `PublicPrizePresentation` on the server before serialization. Preserve the existing giveaway lifecycle and scoped operational DTOs while updating only the organizer editor and public event-page presentation.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript 5, Prisma 7.8/PostgreSQL, Zod 4.4, Vitest 4.1/jsdom, S3-compatible object storage, Sharp 0.35.

## Global Constraints

- Work in the existing `main` checkout; do not create a branch or worktree.
- Follow red-green-refactor for every behavior change and commit after each independently testable task.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`, `12-images.md`, `15-route-handlers.md`, and `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` before editing Next.js routes, actions, or image components.
- Keep internal pool/item titles out of public event-page DTOs for surprise prizes.
- Existing pools migrate to `revealed`; their public title is the first finite item title, falling back to the pool title.
- A revealed public title is required after trimming; a surprise prize serializes exactly `Surprise prize`.
- Accept only JPEG, PNG, and WebP prize images up to 8 MiB; normalize to WebP; do not accept arbitrary remote URLs.
- Public cards use `Ongoing`, `Win:`, `Entries close:`, `Draw date:`, `Winner:`, and `Prize won:`; remove `Featured prize`, `Opt-in entry`, `Recent winner`, `How it worked`, and `Verify the draw` from the primary surface.
- Do not change eligibility, randomness, winner selection, claiming, fulfilment, or public winner-alias privacy.
- Use the Codex Browser surface for browser checks; do not run Playwright.

---

## File Map

### Create

- `prisma/migrations/20260728000000_public_raffle_prize_presentation/migration.sql` — disclosure fields, prize-image table, existing-row backfill, and entrant-history guards.
- `src/server/giveaway-prize-media/service.ts` — presign, finalize, delete, normalized storage, and ownership validation for prize images.
- `src/app/api/giveaway-prize-media/uploads/route.ts` — authenticated organizer upload-presign endpoint.
- `src/app/api/giveaway-prize-media/[mediaId]/route.ts` — safe public image delivery endpoint.
- `src/features/giveaways/public-prize-presentation.ts` — one shared server-safe redaction helper.
- `src/features/giveaways/giveaway-prize-image-uploader.tsx` — organizer upload control for persisted prize pools.
- `tests/server/giveaway-prize-presentation.test.ts` — focused validation and redaction contract.
- `tests/server/giveaway-prize-media-service.test.ts` — media lifecycle and ownership tests.
- `tests/server/giveaway-prize-media-route.test.ts` — route status and payload tests.

### Modify

- `prisma/schema.prisma` — `GiveawayPrizeDisclosure`, pool presentation fields, `GiveawayPrizeImage`, uploader relation.
- `src/features/giveaways/types.ts` — organizer input, workspace, public presentation, result, and image types.
- `src/features/giveaways/validation.ts` — revealed/surprise validation and public-copy limits.
- `src/server/backend.ts` — in-memory persistence, redacted public projection, prize image methods.
- `src/server/prisma-backend.ts` — Prisma persistence, safe projection, image ownership/persistence.
- `src/server/giveaway-actions.ts` — finalize/delete organizer prize-image actions.
- `src/features/giveaways/organizer-giveaway-workspace.tsx` — public display controls, preview, saved-pool uploader.
- `src/features/giveaways/public-giveaway-panel.tsx` — Philippine-style ongoing/completed cards and plain details labels.
- `src/features/giveaways/public-giveaway-panel.module.css` — natural-height responsive cards and optional 4:3 image.
- `src/server/giveaways/sample-raffles.ts` — explicit revealed public names for both samples.
- `tests/server/giveaway-schema-contract.test.ts` — schema/migration/backfill/guard contract.
- `tests/server/giveaway-draw-engine.test.ts` — create/update validation cases.
- `tests/server/giveaway-ui-data-contract.test.ts` — public versus organizer/claim data boundaries.
- `tests/server/organizer-giveaway-workspace.test.ts` — draft mapping, disclosure controls, preview, uploader state.
- `tests/server/public-giveaway-spotlight.test.ts` — new copy, hierarchy, dates, results, and removed jargon.
- `tests/server/sample-raffle-provisioner.test.ts` — explicit sample public presentation.
- `tests/prisma-integration/giveaway-live-presentation.integration.test.ts` — persisted revealed/surprise projection.
- `docs/deployment/sample-raffle-provisioning.md` — new sample fields and production verification.

---

### Task 1: Persist Prize Disclosure and Public Copy

**Files:**
- Create: `prisma/migrations/20260728000000_public_raffle_prize_presentation/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/features/giveaways/types.ts`
- Modify: `src/features/giveaways/validation.ts`
- Test: `tests/server/giveaway-schema-contract.test.ts`
- Test: `tests/server/giveaway-draw-engine.test.ts`

**Interfaces:**
- Produces:

```ts
export type GiveawayPrizeDisclosure = "revealed" | "surprise";

export interface GiveawayPrizePublicPresentationInput {
  disclosure: GiveawayPrizeDisclosure;
  title?: string;
  description?: string;
}

export interface GiveawayPrizeImageSummary {
  mediaId: string;
  url: string;
  width: number;
  height: number;
}
```

- Extends `GiveawayPrizePoolBaseInput` with:

```ts
publicPresentation: GiveawayPrizePublicPresentationInput;
publicImage?: GiveawayPrizeImageSummary;
```

- [ ] **Step 1: Write failing schema and migration tests**

Add assertions to `tests/server/giveaway-schema-contract.test.ts`:

```ts
expect(schema).toContain("enum GiveawayPrizeDisclosure");
expect(schema).toContain("publicDisclosure");
expect(schema).toContain("publicTitle");
expect(schema).toContain("publicDescription");
expect(schema).toContain("model GiveawayPrizeImage");
expect(presentationMigrationSql).toContain(
  'COALESCE((SELECT item."title"',
);
expect(presentationMigrationSql).toContain(
  'CREATE OR REPLACE FUNCTION "validate_giveaway_prize_pool_entrant_configuration"()',
);
expect(presentationMigrationSql).toContain(
  'CREATE TRIGGER "GiveawayPrizeImage_entrant_configuration_guard"',
);
```

Add validation cases to `tests/server/giveaway-draw-engine.test.ts`:

```ts
test("requires a public title only when a prize is revealed", () => {
  const revealed = createGiveawayInputWithPrizePool({
    ...randomPool,
    publicPresentation: { disclosure: "revealed", title: "  " },
  });
  const surprise = createGiveawayInputWithPrizePool({
    ...randomPool,
    publicPresentation: { disclosure: "surprise" },
  });

  expect(createGiveawaySchema.safeParse(revealed).success).toBe(false);
  expect(createGiveawaySchema.safeParse(surprise).success).toBe(true);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/server/giveaway-schema-contract.test.ts tests/server/giveaway-draw-engine.test.ts
```

Expected: FAIL because the enum, fields, migration, and `publicPresentation` schema do not exist.

- [ ] **Step 3: Add the Prisma model and additive migration**

Add:

```prisma
enum GiveawayPrizeDisclosure {
  revealed
  surprise
}

model GiveawayPrizeImage {
  id               String   @id @default(cuid())
  prizePoolId      String   @unique
  uploadedByUserId String
  mediaId          String   @unique
  storageKey       String   @unique
  mimeType         String
  width            Int
  height           Int
  finalizedAt      DateTime
  createdAt        DateTime @default(now())

  prizePool  GiveawayPrizePool @relation(fields: [prizePoolId], references: [id], onDelete: Restrict)
  uploadedBy User                @relation("GiveawayPrizeImageUploader", fields: [uploadedByUserId], references: [id], onDelete: Restrict)

  @@index([uploadedByUserId])
}
```

Add to `GiveawayPrizePool`:

```prisma
publicDisclosure  GiveawayPrizeDisclosure @default(revealed)
publicTitle       String?
publicDescription String?
publicImage       GiveawayPrizeImage?
```

Add to `User`:

```prisma
uploadedGiveawayPrizeImages GiveawayPrizeImage[] @relation("GiveawayPrizeImageUploader")
```

The SQL migration must:

1. create the enum and image table;
2. add nullable public copy plus `publicDisclosure DEFAULT 'revealed'`;
3. backfill `publicTitle` from first item title, then pool title;
4. replace the pool entrant-history guard so disclosure/copy changes are guarded;
5. add an image-table guard that resolves the owning giveaway and blocks insert/update/delete after entrant history.

- [ ] **Step 4: Add TypeScript and Zod contracts**

Define a reusable presentation schema:

```ts
const publicPrizePresentationSchema = z
  .object({
    disclosure: z.enum(["revealed", "surprise"]),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .superRefine((presentation, context) => {
    if (presentation.disclosure === "revealed" && !presentation.title) {
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: "Public prize name is required when the prize is shown.",
      });
    }
  })
  .transform((presentation) =>
    presentation.disclosure === "surprise"
      ? { disclosure: "surprise" as const }
      : presentation,
  );
```

Attach it as required `publicPresentation` data on every prize pool input.

- [ ] **Step 5: Generate Prisma and verify GREEN**

Run:

```powershell
npm run db:generate
npx prisma validate
npx vitest run tests/server/giveaway-schema-contract.test.ts tests/server/giveaway-draw-engine.test.ts
```

Expected: Prisma generation/validation succeeds and both test files pass.

- [ ] **Step 6: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/20260728000000_public_raffle_prize_presentation/migration.sql src/features/giveaways/types.ts src/features/giveaways/validation.ts tests/server/giveaway-schema-contract.test.ts tests/server/giveaway-draw-engine.test.ts
git commit -m "feat: model public raffle prize presentation"
```

---

### Task 2: Redact Surprise Prizes in Every Public Projection

**Files:**
- Create: `tests/server/giveaway-prize-presentation.test.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/features/giveaways/types.ts`
- Modify: `tests/server/giveaway-ui-data-contract.test.ts`
- Test: `tests/prisma-integration/giveaway-live-presentation.integration.test.ts`

**Interfaces:**
- Consumes: `GiveawayPrizePublicPresentationInput`, persisted disclosure/copy fields.
- Produces:

```ts
export interface PublicPrizePresentation {
  disclosure: GiveawayPrizeDisclosure;
  title: string;
  description?: string;
  image?: GiveawayPrizeImageSummary;
}

export interface PublicGiveawayPrizePoolSummary {
  id: string;
  awardMode: GiveawayAwardMode;
  inventoryKind: GiveawayPrizeInventoryInput["kind"];
  itemQuantity?: number;
  presenceVerificationRequired: boolean;
  presentation: PublicPrizePresentation;
}

export interface PublicGiveawayResult {
  prizeTitle: string;
  winnerAlias: string;
}
```

- Produces pure helper:

```ts
export function toPublicPrizePresentation(input: {
  disclosure: GiveawayPrizeDisclosure;
  publicTitle?: string;
  publicDescription?: string;
  publicImage?: GiveawayPrizeImageSummary;
}): PublicPrizePresentation;
```

- Preserves persisted prize-pool IDs across configuration updates so media
  ownership remains stable.

- [ ] **Step 1: Write failing redaction tests**

In `tests/server/giveaway-prize-presentation.test.ts`:

```ts
test("serializes revealed copy without operational inventory", () => {
  expect(toPublicPrizePresentation({
    disclosure: "revealed",
    publicTitle: "Weekend Rider Gear Package",
    publicDescription: "Helmet, gloves, and Tambike gear.",
  })).toEqual({
    disclosure: "revealed",
    title: "Weekend Rider Gear Package",
    description: "Helmet, gloves, and Tambike gear.",
  });
});

test("redacts every hidden public field for a surprise prize", () => {
  const serialized = JSON.stringify(toPublicPrizePresentation({
    disclosure: "surprise",
    publicTitle: "Private Ducati Helmet",
    publicDescription: "Private sponsor inventory",
    publicImage: {
      mediaId: "private-image",
      url: "/giveaway-prize-media/private-image",
      width: 1200,
      height: 900,
    },
  }));

  expect(serialized).toBe(
    JSON.stringify({ disclosure: "surprise", title: "Surprise prize" }),
  );
  expect(serialized).not.toContain("Ducati");
  expect(serialized).not.toContain("private-image");
});
```

Extend `giveaway-ui-data-contract.test.ts` with a public surprise pool and assert
the returned JSON does not contain either its internal pool title or item title,
while `getOrganizerGiveawayWorkspace` still contains both.

Add a persistence regression test:

```ts
test("keeps persisted prize-pool identity across configuration saves", async () => {
  const before = await backend.getOrganizerGiveawayWorkspace(
    organizer.sessionToken,
    giveaway.id,
  );
  await backend.updateGiveaway(organizer.sessionToken, {
    id: giveaway.id,
    eligibilityGroups: before.eligibilityGroups,
    prizePools: before.prizePools,
  });
  const after = await backend.getOrganizerGiveawayWorkspace(
    organizer.sessionToken,
    giveaway.id,
  );

  expect(after.prizePools[0]?.id).toBe(before.prizePools[0]?.id);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx vitest run tests/server/giveaway-prize-presentation.test.ts tests/server/giveaway-ui-data-contract.test.ts
```

Expected: FAIL because public DTOs still expose `title` and `items`.

- [ ] **Step 3: Implement one shared redaction helper**

Create the pure helper in
`src/features/giveaways/public-prize-presentation.ts`. Both in-memory and
Prisma backends must call the same helper.

For surprise mode return the literal object:

```ts
return {
  disclosure: "surprise",
  title: "Surprise prize",
};
```

For revealed mode, trim the public title and fail closed:

```ts
return {
  disclosure: "revealed",
  title: input.publicTitle?.trim() || "Prize details unavailable",
  ...(input.publicDescription?.trim()
    ? { description: input.publicDescription.trim() }
    : {}),
  ...(input.publicImage ? { image: input.publicImage } : {}),
};
```

- [ ] **Step 4: Update in-memory and Prisma configuration persistence**

Map organizer input to operational pool records:

```ts
publicDisclosure: pool.publicPresentation.disclosure,
publicTitle:
  pool.publicPresentation.disclosure === "revealed"
    ? pool.publicPresentation.title?.trim()
    : undefined,
publicDescription:
  pool.publicPresentation.disclosure === "revealed"
    ? pool.publicPresentation.description?.trim()
    : undefined,
```

Map organizer workspaces back to `publicPresentation` without changing actual
pool/item titles.

- [ ] **Step 5: Preserve persisted pool identity**

For configuration updates, synchronize by input pool ID:

1. load pool IDs already owned by the giveaway;
2. update a matching owned pool in place;
3. create a new server ID for an input ID that is not persisted;
4. remove only persisted pools absent from the new input;
5. reject an input ID owned by another giveaway;
6. keep the same behavior in the in-memory backend.

Perform the same owned-ID mapping for eligibility groups. Rebuild dependent
item/group links inside the transaction without deleting a retained pool row.
This keeps `GiveawayPrizeImage.prizePoolId` valid through organizer saves.

- [ ] **Step 6: Replace public pool and result projections**

Remove public `title`, `items`, and `fulfilmentMode`. Return only
`presentation`, non-sensitive award method, inventory kind/count, and presence
requirement.

Map public results with:

```ts
{
  prizeTitle: toPublicPrizePresentation(pool).title,
  winnerAlias: award.publicWinnerAlias!,
}
```

Do not change claim, operator, organizer, admin, presentation-stage, or award
DTOs that require actual prize identity.

- [ ] **Step 7: Verify both backends and Prisma persistence**

```powershell
npx vitest run tests/server/giveaway-prize-presentation.test.ts tests/server/giveaway-ui-data-contract.test.ts tests/server/giveaway-domain.test.ts
npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/giveaway-live-presentation.integration.test.ts
```

Expected: public redaction and internal operational identity tests pass for both
backends.

- [ ] **Step 8: Commit**

```powershell
git add src/features/giveaways/types.ts src/features/giveaways/public-prize-presentation.ts src/server/backend.ts src/server/prisma-backend.ts tests/server/giveaway-prize-presentation.test.ts tests/server/giveaway-ui-data-contract.test.ts tests/server/giveaway-domain.test.ts tests/prisma-integration/giveaway-live-presentation.integration.test.ts
git commit -m "feat: redact surprise raffle prizes"
```

---

### Task 3: Add Secure Organizer Prize-Image Lifecycle

**Files:**
- Create: `src/server/giveaway-prize-media/service.ts`
- Create: `src/app/api/giveaway-prize-media/uploads/route.ts`
- Create: `src/app/api/giveaway-prize-media/[mediaId]/route.ts`
- Create: `tests/server/giveaway-prize-media-service.test.ts`
- Create: `tests/server/giveaway-prize-media-route.test.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/giveaway-actions.ts`
- Modify: `tests/server/giveaway-schema-contract.test.ts`

**Interfaces:**
- Produces:

```ts
export interface FinalizeGiveawayPrizeImageInput {
  giveawayId: string;
  prizePoolId: string;
  tempKey: string;
  claimedMimeType: "image/jpeg" | "image/png" | "image/webp";
}

export interface GiveawayPrizeMediaPersistence {
  authorizePool(input: {
    userId: string;
    giveawayId: string;
    prizePoolId: string;
  }): Promise<void>;
  replaceFinalized(input: {
    userId: string;
    giveawayId: string;
    prizePoolId: string;
    mediaId: string;
    storageKey: string;
    mimeType: "image/webp";
    width: number;
    height: number;
    finalizedAt: Date;
  }): Promise<GiveawayPrizeImageSummary>;
  remove(input: {
    userId: string;
    giveawayId: string;
    prizePoolId: string;
    mediaId: string;
  }): Promise<string>;
  registerCleanup(input: {
    userId: string;
    storageKey: string;
    cleanupAfter: Date;
  }): Promise<void>;
  activateCleanup(input: {
    storageKey: string;
    cleanupAfter: Date;
  }): Promise<void>;
}
```

- Backend methods:

```ts
createGiveawayPrizeImageUpload(
  sessionToken: string,
  giveawayId: string,
  prizePoolId: string,
  mimeType: string,
): Promise<PresignedUpload>;

finalizeGiveawayPrizeImage(
  sessionToken: string,
  input: FinalizeGiveawayPrizeImageInput,
): Promise<GiveawayPrizeImageSummary>;

deleteGiveawayPrizeImage(
  sessionToken: string,
  giveawayId: string,
  prizePoolId: string,
  mediaId: string,
): Promise<void>;
```

- [ ] **Step 1: Write failing service ownership and normalization tests**

Test these concrete cases:

```ts
test("rejects a temp key owned by another organizer", async () => {
  await expect(service.finalize("organizer-a", {
    giveawayId: "giveaway-1",
    prizePoolId: "pool-1",
    tempKey: "tmp/giveaway-prizes/organizer-b/upload-1",
    claimedMimeType: "image/png",
  }, persistence)).rejects.toMatchObject({
    code: "UPLOAD_OWNERSHIP_MISMATCH",
  });
});

test("normalizes and stores one 4:3-safe public image", async () => {
  const image = await service.finalize("organizer-a", {
    giveawayId: "giveaway-1",
    prizePoolId: "pool-1",
    tempKey: "tmp/giveaway-prizes/organizer-a/upload-1",
    claimedMimeType: "image/png",
  }, persistence);

  expect(image.url).toBe(`/giveaway-prize-media/${image.mediaId}`);
  expect(image.width).toBeGreaterThan(0);
  expect(image.height).toBeGreaterThan(0);
});
```

Also test invalid MIME, empty/oversized content, nonexistent pool, non-owner
organizer, replacement cleanup, deletion ownership, and surprise-mode image
removal. Verify a configuration save preserves the pool ID and attached image.

- [ ] **Step 2: Run service tests and verify RED**

```powershell
npx vitest run tests/server/giveaway-prize-media-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement upload policy and finalize service**

Reuse:

- `MemberMediaStore` and `createS3MemberMediaStore`;
- `normalizeMemberImage`;
- the existing JPEG/PNG/WebP constants and 8 MiB ceiling.

Use keys:

```text
tmp/giveaway-prizes/{userId}/{nonce}
media/giveaway-prizes/{prizePoolId}/{mediaId}.webp
```

Call `authorizePool` before presigning and again before finalizing. Normalize
with the existing image pipeline, persist the finalized record before returning
the public media route, and queue old/replacement objects through the same
recoverable cleanup pattern used by member media.

- [ ] **Step 4: Write failing route tests**

Test the presign route:

```ts
expect(await handler(unauthenticatedRequest)).toMatchObject({ status: 401 });
expect(await handler(invalidMimeRequest)).toMatchObject({ status: 400 });
expect(await handler(nonOwnerRequest)).toMatchObject({ status: 403 });
expect(await handler(validOwnerRequest)).toMatchObject({ status: 200 });
```

Test event-page media delivery returns normalized bytes with:

```ts
expect(response.headers.get("Content-Type")).toBe("image/webp");
expect(response.headers.get("Cache-Control")).toContain("public");
```

Also assert registered/eligible media returns `Cache-Control: private, no-store`
to an authorized rider and 404 to an unauthorized request.

- [ ] **Step 5: Implement routes, actions, and both backend persistence adapters**

The presign request body is:

```ts
{
  giveawayId: string;
  prizePoolId: string;
  mimeType: string;
}
```

Export server actions:

```ts
export async function finalizeGiveawayPrizeImageAction(
  input: FinalizeGiveawayPrizeImageInput,
): Promise<ActionResult<GiveawayPrizeImageSummary>>;

export async function deleteGiveawayPrizeImageAction(input: {
  giveawayId: string;
  prizePoolId: string;
  mediaId: string;
}): Promise<ActionResult<void>>;
```

Map authentication failures to 401, organizer ownership failures to 403,
invalid input/image to 400, missing media to 404, and storage failures to 503.
The media GET route reads the session cookie and applies the same
campaign-visibility rule as `listPublicGiveawaysForEvent`; use 404 for denied
reads so the route does not confirm a private image exists.

- [ ] **Step 6: Verify image lifecycle GREEN**

```powershell
npx vitest run tests/server/giveaway-prize-media-service.test.ts tests/server/giveaway-prize-media-route.test.ts tests/server/member-media-service.test.ts tests/server/member-media-route-contract.test.ts
```

Expected: prize-image and existing member-media tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/server/giveaway-prize-media src/app/api/giveaway-prize-media src/server/backend.ts src/server/prisma-backend.ts src/server/giveaway-actions.ts tests/server/giveaway-prize-media-service.test.ts tests/server/giveaway-prize-media-route.test.ts tests/server/giveaway-schema-contract.test.ts
git commit -m "feat: add raffle prize image lifecycle"
```

---

### Task 4: Add Organizer Disclosure Controls and Public Preview

**Files:**
- Create: `src/features/giveaways/giveaway-prize-image-uploader.tsx`
- Modify: `src/features/giveaways/organizer-giveaway-workspace.tsx`
- Modify: `tests/server/organizer-giveaway-workspace.test.ts`

**Interfaces:**
- Consumes: `GiveawayPrizePublicPresentationInput`,
  `GiveawayPrizeImageSummary`, finalize/delete actions from Task 3.
- Produces:

```ts
export function toPublicPrizePreview(input: {
  disclosure: GiveawayPrizeDisclosure;
  title?: string;
}): string;
```

```ts
export function GiveawayPrizeImageUploader(props: {
  giveawayId: string;
  prizePoolId: string;
  image?: GiveawayPrizeImageSummary;
  disabled: boolean;
  onChanged: () => Promise<void> | void;
}): React.JSX.Element;
```

- [ ] **Step 1: Read the installed Next.js guides**

Read completely:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/12-images.md
Get-Content -Raw node_modules/next/dist/docs/01-app/02-guides/server-actions.md
```

- [ ] **Step 2: Write failing organizer UI tests**

Add:

```ts
test("maps persisted public presentation into the editable pool draft", () => {
  const draft = toOrganizerGiveawayEditorDraft(workspaceWith({
    publicPresentation: {
      disclosure: "revealed",
      title: "Weekend Rider Gear Package",
      description: "Helmet, gloves, and Tambike gear.",
    },
  }));

  expect(draft.prizePools[0]?.publicPresentation).toEqual({
    disclosure: "revealed",
    title: "Weekend Rider Gear Package",
    description: "Helmet, gloves, and Tambike gear.",
  });
});

test("surprise preview never renders the actual inventory title", () => {
  expect(toPublicPrizePreview({
    disclosure: "surprise",
    title: "Private Ducati Helmet",
  })).toBe("Surprise prize");
});
```

Render the campaign editor and assert it contains:

- `Internal prize group`;
- `Actual prizes and inventory`;
- `Public prize display`;
- `Show the prize`;
- `Keep it a surprise`;
- `Public prize name`;
- `Short description (optional)`;
- `Public preview`.

- [ ] **Step 3: Run organizer tests and verify RED**

```powershell
npx vitest run tests/server/organizer-giveaway-workspace.test.ts
```

Expected: FAIL on missing mappings, labels, and preview helper.

- [ ] **Step 4: Implement disclosure controls and deterministic preview**

In each pool card:

1. keep actual inventory controls intact;
2. add the two disclosure radio choices;
3. show public title/description inputs only in revealed mode;
4. show `Win: {previewTitle}` plus entry-close/draw dates;
5. immediately remove image UI and public copy from the outgoing draft when
   switching to surprise.

Use sentence-case labels. Do not expose `publicImage.storageKey`.

- [ ] **Step 5: Implement the persisted-pool image uploader**

The uploader:

1. validates JPEG/PNG/WebP and 8 MiB client-side;
2. requests a presigned upload;
3. posts the file to storage;
4. finalizes through the server action;
5. calls `onChanged` to reload the scoped organizer workspace;
6. supports replacing and removing the current image.

For an unsaved pool, render:

```text
Save this prize pool before uploading its public image.
```

This avoids binding an uploaded object to a client-only draft ID.

- [ ] **Step 6: Verify organizer tests GREEN**

```powershell
npx vitest run tests/server/organizer-giveaway-workspace.test.ts tests/server/giveaway-prize-media-service.test.ts tests/server/giveaway-prize-media-route.test.ts
```

Expected: disclosure, preview, upload, replacement, and removal tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/features/giveaways/organizer-giveaway-workspace.tsx src/features/giveaways/giveaway-prize-image-uploader.tsx tests/server/organizer-giveaway-workspace.test.ts
git commit -m "feat: add organizer prize display controls"
```

---

### Task 5: Replace Public Cards with a Familiar Raffle Layout

**Files:**
- Modify: `src/features/giveaways/public-giveaway-panel.tsx`
- Modify: `src/features/giveaways/public-giveaway-panel.module.css`
- Modify: `tests/server/public-giveaway-spotlight.test.ts`
- Modify: `tests/server/rider-giveaway-entry-controls.test.ts`

**Interfaces:**
- Consumes: `PublicPrizePresentation`, new `PublicGiveawayResult.prizeTitle`,
  existing role/state-aware entry action.
- Produces no new data API.

- [ ] **Step 1: Read installed Next.js image guidance**

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/12-images.md
```

- [ ] **Step 2: Replace the old UI assertions with failing plain-language assertions**

Use revealed ongoing and completed fixtures and assert:

```ts
expect(container.querySelector("header span")?.textContent).toBe("Raffles");
expect(text).toContain("Join the current raffle or see the latest result.");
expect(text).toContain("Ongoing");
expect(text).toContain("Win:");
expect(text).toContain("Weekend Rider Gear Package");
expect(text).toContain("Entries close:");
expect(text).toContain("Draw date:");
expect(text).toContain("Completed");
expect(text).toContain("Winner:");
expect(text).toContain("Raffle Sample Rider");
expect(text).toContain("Prize won:");

for (const removed of [
  "Featured prize",
  "Opt-in entry",
  "Recent winner",
  "How it worked",
  "Verify the draw",
]) {
  expect(text).not.toContain(removed);
}
```

Add a surprise fixture and assert the card contains `Surprise prize` but not the
actual inventory title. Add an image fixture and assert the image alt is the
public prize name.

- [ ] **Step 3: Run public UI tests and verify RED**

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts tests/server/rider-giveaway-entry-controls.test.ts
```

Expected: FAIL because the old hierarchy and jargon remain.

- [ ] **Step 4: Implement the new ongoing card**

Render in this order:

```text
Ongoing
[optional 4:3 prize image]
Win: {presentation.title}
{campaign title}
Entries close: {localized entryClosesAt}
Draw date: {localized drawAt}
[existing valid entry action]
Raffle details
```

Keep mechanics, terms, and sponsor disclosure under `Raffle details`. If draw
verification must remain available, label it `Draw details` inside that
secondary disclosure rather than rendering it as a peer control.

- [ ] **Step 5: Implement the completed card**

Render:

```text
Completed
{campaign title}
Winner: {winnerAlias or "Winner not publicly listed"}
Prize won: {result.prizeTitle or presentation.title}
View result
```

Repeated aliases must continue to use stable unique React keys.

- [ ] **Step 6: Correct the responsive layout**

In the CSS module:

- use `align-items: start`;
- remove forced equal/minimum card heights;
- constrain images with `aspect-ratio: 4 / 3`, `object-fit: cover`, and
  `max-height`;
- keep action height at least 44 px;
- stack at 390 px without horizontal overflow;
- keep the existing amber ongoing and green completed accents without large
  clipped corners.

- [ ] **Step 7: Verify public UI GREEN**

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts tests/server/rider-giveaway-entry-controls.test.ts tests/server/event-detail-ui-contract.test.ts
```

Expected: all public presentation and entry-action tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/features/giveaways/public-giveaway-panel.tsx src/features/giveaways/public-giveaway-panel.module.css tests/server/public-giveaway-spotlight.test.ts tests/server/rider-giveaway-entry-controls.test.ts tests/server/event-detail-ui-contract.test.ts
git commit -m "feat: simplify public raffle cards"
```

---

### Task 6: Preserve Samples and Prove Migration Compatibility

**Files:**
- Modify: `src/server/giveaways/sample-raffles.ts`
- Modify: `tests/server/sample-raffle-provisioner.test.ts`
- Modify: `tests/prisma-integration/sample-raffle-provisioner.integration.test.ts`
- Modify: `docs/deployment/sample-raffle-provisioning.md`

**Interfaces:**
- Consumes: `GiveawayPrizePublicPresentationInput`.
- Produces explicit sample manifests:

```ts
publicPresentation: {
  disclosure: "revealed",
  title: "Cafe Classico Helmet",
}
```

and:

```ts
publicPresentation: {
  disclosure: "revealed",
  title: "Weekend Rider Gear Package",
}
```

- [ ] **Step 1: Write failing sample contract tests**

Assert both sample create inputs use `revealed`, contain the exact public title,
and produce public DTOs without internal pool/item arrays.

- [ ] **Step 2: Run sample tests and verify RED**

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts
npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
```

Expected: FAIL because sample manifests do not yet define
`publicPresentation`.

- [ ] **Step 3: Update idempotent sample inputs and documentation**

Keep the actual pool/item names unchanged. Add explicit revealed public names
and document the new read-only verification:

```text
completed public prize: Cafe Classico Helmet
ongoing public prize: Weekend Rider Gear Package
surprise redaction check: internal title absent from serialized public DTO
```

Do not run the production provisioner in this task.

- [ ] **Step 4: Verify sample compatibility GREEN**

```powershell
npx vitest run tests/server/sample-raffle-provisioner.test.ts
npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
```

Expected: unit and Prisma sample tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/server/giveaways/sample-raffles.ts tests/server/sample-raffle-provisioner.test.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts docs/deployment/sample-raffle-provisioning.md
git commit -m "feat: publish sample raffle prizes explicitly"
```

---

### Task 7: Full Verification and Browser Review

**Files:**
- Modify only files required by verified failures.

**Interfaces:**
- Consumes the complete feature.
- Produces release evidence; does not deploy unless the user separately requests deployment.

- [ ] **Step 1: Run all focused giveaway tests serially**

```powershell
npx vitest run tests/server/giveaway-schema-contract.test.ts tests/server/giveaway-draw-engine.test.ts tests/server/giveaway-prize-presentation.test.ts tests/server/giveaway-ui-data-contract.test.ts tests/server/giveaway-prize-media-service.test.ts tests/server/giveaway-prize-media-route.test.ts tests/server/organizer-giveaway-workspace.test.ts tests/server/public-giveaway-spotlight.test.ts tests/server/rider-giveaway-entry-controls.test.ts tests/server/sample-raffle-provisioner.test.ts --maxWorkers=1
```

Expected: all focused files pass with zero failures.

- [ ] **Step 2: Run Prisma integration coverage**

```powershell
npm run test:prisma:prepare
npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/giveaway-live-presentation.integration.test.ts tests/prisma-integration/sample-raffle-provisioner.integration.test.ts
```

Expected: migration, persistence, redaction, and sample tests pass.

- [ ] **Step 3: Run complete static and automated gates**

```powershell
npx vitest run tests/server --maxWorkers=1
npm run lint
npm run build
git diff --check
```

Expected: full server suite, lint, Next production build, and whitespace check
all exit 0.

- [ ] **Step 4: Reuse or start the local development server**

Check first:

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -In 3000,3001,3002
```

Reuse the existing Tambike process if present. Only if none is running, start
`npm run dev` with a hidden background window and capture its output:

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory "D:\Github\personal\tambike" -WindowStyle Hidden -RedirectStandardOutput "D:\Github\personal\tambike\.codex-dev-server.out.log" -RedirectStandardError "D:\Github\personal\tambike\.codex-dev-server.err.log"
```

- [ ] **Step 5: Verify organizer behavior in Codex Browser**

Using only the Codex Browser:

1. open `/organizer/events/tambike-cafe-classico/giveaways`;
2. confirm an existing pool can switch between revealed and surprise;
3. confirm the preview changes immediately;
4. confirm actual inventory remains visible to the organizer in surprise mode;
5. confirm revealed title/description validation;
6. upload, replace, and remove a JPEG/PNG/WebP prize image on a disposable
   draft pool only;
7. do not alter or delete production data.

- [ ] **Step 6: Verify public layout at desktop and mobile**

At default desktop width and 390×844:

1. confirm `Raffles`, `Ongoing`, exact prize, entry cutoff, draw date,
   `Winner:`, and `Prize won:`;
2. confirm removed jargon is absent;
3. confirm surprise mode exposes no actual prize in DOM snapshot or page source;
4. confirm optional image is 4:3 and does not dominate the viewport;
5. confirm cards use natural height and no large empty area;
6. confirm `scrollWidth === clientWidth`;
7. confirm actions are at least 44 px;
8. confirm browser logs contain no new errors or warnings;
9. reset the viewport before finalizing the browser tab.

- [ ] **Step 7: Inspect the final change set**

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
git diff --check origin/main..HEAD
```

Expected: only approved raffle presentation/image files and documentation are
changed, with a clean whitespace check.

- [ ] **Step 8: Commit any verification-only correction**

If verification finds a defect, return to the task that owns that behavior,
add a failing regression assertion to that task's named test file, complete its
red-green cycle, stage only the exact files changed by that correction, and
commit them with:

```powershell
git commit -m "fix: resolve raffle presentation verification"
```

If no correction was needed, do not create an empty commit.
