# Event Attendee Bike Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace rider portraits in the public event attendee preview with up to four uploaded motorcycle photos while keeping the current attendance, privacy, and roster behavior.

**Architecture:** Extend the existing public attendee DTO with one narrow `bikePhoto` object and make both backends select visible Going riders who have a photo before applying the four-rider limit. The existing client component renders those photos as a responsive grid and removes failed images without falling back to a face.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript, Next Image, CSS Modules, Vitest, Prisma/PostgreSQL, Codex browser.

## Global Constraints

- Work directly in the current `main` checkout; do not create a branch or worktree.
- Preserve unrelated poster-carousel edits in `src/app/globals.css`, `src/features/tambike-demo/tambike-screen.tsx`, `tests/tambike-demo.spec.ts`, and their untracked design/plan files.
- Extend existing tests; do not create another test file.
- Use test-driven steps: run each focused test in a failing state before changing production code.
- Keep `getPublicEventAttendeePreview` unauthenticated but server-filtered.
- Preserve roster enablement, Going-only filtering, public profile visibility, visible roster identity, publication, stable attendance ordering, and aggregate counts.
- Expose only `slug`, `displayName`, `area`, and one `bikePhoto` containing `url`, `width`, and `height`.
- Never expose profile portraits, full motorcycle records, make/model details, email addresses, internal IDs, verification state, media IDs, or storage keys.
- Riders without an uploaded bike photo are omitted and never fall back to a portrait or initial.
- Keep the full attendee roster, rider profiles, RSVP behavior, media upload behavior, schema, and dependencies unchanged.
- Follow the installed Next.js 16.2.11 Image guidance: provide intrinsic width and height, a responsive `sizes` value, required `alt`, and retain `unoptimized` for the same-origin media delivery route.
- Before running `npm run dev`, confirm whether this checkout already has a development server and reuse it.
- Use only the Codex browser for browser verification; do not run Playwright.
- Do not deploy or push unless the user separately requests it.

---

## File Structure

- `src/features/member-profiles/types.ts`
  - Defines the narrow public `bikePhoto` preview field.
- `src/server/backend.ts`
  - Selects photo-bearing public riders in the in-memory backend.
- `src/server/prisma-backend.ts`
  - Applies the equivalent relational filter and projection in PostgreSQL.
- `tests/server/event-attendee-public-preview-domain.test.ts`
  - Proves photo eligibility, stable ordering, the four-rider limit, privacy exclusions, and safe output through real backend behavior.
- `tests/server/event-attendee-preview-loader.test.ts`
  - Proves the route loader preserves the narrow bike-photo DTO and safe failure states.
- `src/features/member-profiles/event-attendee-preview.tsx`
  - Renders the bike grid, profile links, and broken-image removal.
- `src/features/member-profiles/event-attendee-preview.module.css`
  - Owns the responsive four-column/two-column landscape grid.
- `tests/server/event-attendee-preview-ui.test.tsx`
  - Proves bike-first rendering, empty states, privacy copy, links, and image failures.

---

### Task 1: Return Four Privacy-Safe Riders With Bike Photos

**Files:**

- Modify: `tests/server/event-attendee-public-preview-domain.test.ts`
- Modify: `tests/server/event-attendee-preview-loader.test.ts`
- Modify: `src/features/member-profiles/types.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`

**Interfaces:**

- Consumes:
  - `MemberProfileView.motorcycle.photos`
  - `PUBLIC_ATTENDEE_PREVIEW_LIMIT`
  - Existing `goingAt` then RSVP-ID ordering
- Produces:

```ts
export interface EventAttendeePreviewBikePhoto {
  url: string;
  width: number;
  height: number;
}

export type EventAttendeePreviewRider = Pick<
  MemberProfileView,
  "slug" | "displayName" | "area"
> & {
  bikePhoto: EventAttendeePreviewBikePhoto;
};
```

- [ ] **Step 1: Add a real media-backed preview test harness**

In `tests/server/event-attendee-public-preview-domain.test.ts`, import the media-store types and replace plain backend construction with a local harness that exercises the public upload/finalization API:

```ts
import type {
  MemberMediaStore,
  StoredMemberMediaObject,
} from "../../src/server/member-media/store";

async function createPreviewHarness() {
  const objects = new Map<string, StoredMemberMediaObject>();
  let mediaSequence = 0;
  const store: MemberMediaStore = {
    createPresignedPost: async (input) => ({
      url: "https://uploads.example.test",
      fields: { key: input.key, "Content-Type": input.mimeType },
    }),
    getObject: async (key) => {
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return object;
    },
    putObject: async (input) => {
      objects.set(input.key, {
        body: input.body,
        contentType: input.mimeType,
      });
    },
    deleteObject: async (key) => {
      if (!objects.delete(key)) {
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      }
    },
  };
  const backend = await createTambikeTestBackend({
    memberMedia: {
      store,
      createUuid: () => `preview-bike-${++mediaSequence}`,
      normalize: async () => ({
        bytes: Buffer.from("normalized-bike"),
        mimeType: "image/webp",
        width: 1200,
        height: 800,
      }),
    },
  });

  async function addBikePhoto(
    rider: { sessionToken: string; user: { id: string } },
    label: string,
  ) {
    await backend.upsertMotorcycle(rider.sessionToken, {
      make: "Honda",
      model: "CB650R",
    });
    const tempKey = `tmp/users/${rider.user.id}/${label}`;
    objects.set(tempKey, {
      body: Buffer.from("jpeg"),
      contentType: "image/jpeg",
      lastModified: new Date(),
    });
    return backend.finalizeMemberMedia(rider.sessionToken, {
      purpose: "motorcycle-photo",
      tempKey,
      claimedMimeType: "image/jpeg",
      motorcyclePhotoPosition: 0,
    });
  }

  return { backend, addBikePhoto };
}
```

Make `addPreviewCandidate` return the signed-up rider so exclusion tests can add a bike photo before calling the public preview.

- [ ] **Step 2: Change the domain expectations to require bike photos before the limit**

Update the public-rider test so both the public and members-only riders have bike photos, then assert the exact safe output:

```ts
expect(preview.attendees).toEqual([
  {
    slug: "public-rider",
    displayName: "Public Rider",
    area: "Quezon City",
    bikePhoto: {
      url: "/media/preview-bike-1",
      width: 1200,
      height: 800,
    },
  },
]);
expect(JSON.stringify(preview)).not.toMatch(
  /Members Rider|profilePhoto|email|userId|rsvpId|verification|storageKey|make|model/i,
);
```

Replace the old limit test with six ordered public Going riders: rider zero has no bike, riders one through five each have one. Assert that the result contains riders one through four, proving the photo filter runs before the four-rider limit:

```ts
expect(preview.attendees.map(({ displayName }) => displayName)).toEqual([
  "Public Preview Rider 1",
  "Public Preview Rider 2",
  "Public Preview Rider 3",
  "Public Preview Rider 4",
]);
```

Give every anonymous, private, unpublished, and interested exclusion candidate a bike photo before asserting that the public attendees array remains empty.

- [ ] **Step 3: Update the loader fixture to demand the narrow bike field**

In `tests/server/event-attendee-preview-loader.test.ts`, replace each `profilePhotoUrl` with:

```ts
bikePhoto: {
  url: `/media/bike-${index + 1}`,
  width: 1200,
  height: 800,
},
```

Assert the first rider contains that exact object and tighten the negative assertion:

```ts
expect(JSON.stringify(result)).not.toMatch(
  /signedIn|profilePhoto|motorcycle|email|userId|verification|storageKey|make|model/i,
);
```

- [ ] **Step 4: Run the backend and loader tests to verify RED**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts
```

Expected: FAIL because the public backend still returns portrait-shaped data and does not skip riders without bike photos.

- [ ] **Step 5: Replace the public preview rider type**

In `src/features/member-profiles/types.ts`, replace the existing `EventAttendeePreviewRider` alias with the `EventAttendeePreviewBikePhoto` interface and `EventAttendeePreviewRider` type shown in this task’s Interfaces block.

- [ ] **Step 6: Filter and project the in-memory preview**

In `src/server/backend.ts`, preserve the existing RSVP filters and sort, then map to sanitized profiles before filtering and slicing:

```ts
.map(({ user }) => this.toMemberProfileView(user))
.filter(
  (profile): profile is typeof profile & {
    motorcycle: NonNullable<typeof profile.motorcycle>;
  } => Boolean(profile.motorcycle?.photos[0]),
)
.slice(0, PUBLIC_ATTENDEE_PREVIEW_LIMIT)
.map((profile) => {
  const photo = profile.motorcycle.photos[0]!;
  return {
    slug: profile.slug,
    displayName: profile.displayName,
    area: profile.area,
    bikePhoto: {
      url: photo.url,
      width: photo.width,
      height: photo.height,
    },
  };
});
```

Keep the sort before the profile mapping so ordering remains `goingAt`, then RSVP ID.

- [ ] **Step 7: Filter and project the Prisma preview**

In `src/server/prisma-backend.ts`, add this relation requirement inside the existing `user` filter:

```ts
motorcycle: {
  is: {
    photos: { some: {} },
  },
},
```

Keep `take: PUBLIC_ATTENDEE_PREVIEW_LIMIT` after that database filter. In the result mapping, replace `profilePhotoUrl` with:

```ts
const photo = profile.motorcycle!.photos[0]!;
return {
  slug: profile.slug,
  displayName: profile.displayName,
  area: profile.area,
  bikePhoto: {
    url: photo.url,
    width: photo.width,
    height: photo.height,
  },
};
```

The existing ordered photo include remains the source of the first saved motorcycle photo.

- [ ] **Step 8: Run the focused backend and loader tests**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts
```

Expected: both files PASS, including the no-bike-before-limit case and all privacy exclusions.

- [ ] **Step 9: Commit the public bike-photo contract**

Stage only these files:

```powershell
git add src/features/member-profiles/types.ts src/server/backend.ts src/server/prisma-backend.ts tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts
git commit -m "feat: expose safe attendee bike previews"
```

---

### Task 2: Render the Responsive Bike Grid

**Files:**

- Modify: `tests/server/event-attendee-preview-ui.test.tsx`
- Modify: `src/features/member-profiles/event-attendee-preview.tsx`
- Modify: `src/features/member-profiles/event-attendee-preview.module.css`

**Interfaces:**

- Consumes:
  - `EventAttendeePreviewData.attendees[].bikePhoto`
- Produces:
  - Four landscape bike tiles at wider widths
  - Two columns at widths up to 430 pixels
  - Profile links labeled `View {displayName}’s bike and rider profile`
  - No portrait or initial fallback

- [ ] **Step 1: Rewrite the component fixture around bike photos**

In `tests/server/event-attendee-preview-ui.test.tsx`, give both preview riders a `bikePhoto`; use `/media/bike-mika` and `/media/bike-paolo`, both `1200 × 800`.

Update the main presentation assertions:

```ts
expect(markup).toContain('src="/media/bike-mika"');
expect(markup).toContain('src="/media/bike-paolo"');
expect(markup).toContain("View Mika Santos’s bike and rider profile");
expect(markup).not.toContain("/media/mika");
expect(markup).not.toMatch(
  /anonymous riders|visible riders|profilePhoto|email|userId|verification|make|model/i,
);
```

Replace the portrait/initial tests with one broken-image behavior test. Mount two bike tiles, dispatch `error` on Mika’s image, and assert Mika’s link is removed while Paolo’s remains:

```ts
const failedImage = container.querySelector('img[src$="/media/bike-mika"]');
expect(failedImage).not.toBeNull();

await act(async () => {
  failedImage!.dispatchEvent(new Event("error"));
});

expect(container.querySelector('a[href="/riders/mika-santos"]')).toBeNull();
expect(container.querySelector('a[href="/riders/paolo-reyes"]')).not.toBeNull();
expect(container.textContent).not.toContain(">M<");
```

Keep the roster-disabled, unavailable, empty-preview, grammar, and live-count tests.

- [ ] **Step 2: Run the component test to verify RED**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx
```

Expected: FAIL because the current component reads `profilePhotoUrl`, renders circular portrait links, and substitutes initials.

- [ ] **Step 3: Render only successful bike tiles**

In `src/features/member-profiles/event-attendee-preview.tsx`, rename `failedPhotos` to `failedBikePhotos`, keep the set keyed by rider slug, and derive:

```ts
const bikeRiders = riders.filter(
  (rider) => !failedBikePhotos.has(rider.slug),
);
```

Replace the facepile block with:

```tsx
{bikeRiders.length > 0 ? (
  <div className={styles.riderSummary}>
    <div className={styles.bikeGrid} aria-label="Featured attendee bikes">
      {bikeRiders.map((rider) => (
        <Link
          key={rider.slug}
          className={styles.bikeTile}
          href={`/riders/${rider.slug}`}
          aria-label={`View ${rider.displayName}’s bike and rider profile`}
        >
          <Image
            src={rider.bikePhoto.url}
            alt=""
            width={rider.bikePhoto.width}
            height={rider.bikePhoto.height}
            sizes="(max-width: 430px) calc((100vw - 3.7rem) / 2), 170px"
            unoptimized
            onError={() => {
              setFailedBikePhotos((current) => {
                const next = new Set(current);
                next.add(rider.slug);
                return next;
              });
            }}
          />
        </Link>
      ))}
    </div>
  </div>
) : rosterEnabled && !preview?.unavailable ? (
  <p className={styles.state}>Rider profiles will appear here as they join.</p>
) : null}
```

Delete all initial-letter and portrait-fallback logic.

- [ ] **Step 4: Replace the facepile CSS with a landscape grid**

In `src/features/member-profiles/event-attendee-preview.module.css`, keep the card, heading, state, footer, action, and focus palette. Replace `.riderSummary`, `.facepile`, and `.rider` rules with:

```css
.riderSummary {
  min-width: 0;
}

.bikeGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
  min-width: 0;
}

.bikeTile {
  position: relative;
  min-width: 0;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--event-accent) 32%, #2b2428);
  border-radius: 0.7rem;
  background: #21181d;
}

.bikeTile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 180ms ease;
}

@media (hover: hover) {
  .bikeTile:hover img {
    transform: scale(1.035);
  }
}
```

Include `.bikeTile:focus-visible` in the existing focus rule. At `max-width: 430px`, replace the facepile rule with:

```css
.bikeGrid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

- [ ] **Step 5: Run the focused UI test**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx
```

Expected: all component tests PASS, including removal of one failed bike tile without a portrait fallback.

- [ ] **Step 6: Run all attendee-preview contracts together**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-attendee-public-preview-contract.test.ts tests/server/event-roster-ui-contract.test.ts
```

Expected: all focused files PASS and the full attendee roster tests remain unchanged.

- [ ] **Step 7: Commit the responsive bike grid**

Stage only these files:

```powershell
git add src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-preview.module.css tests/server/event-attendee-preview-ui.test.tsx
git commit -m "feat: showcase attendee bikes on events"
```

---

### Task 3: Verify the Complete Feature

**Files:**

- Modify only if a failure reveals a directly related defect in the files from Tasks 1–2.

**Interfaces:**

- Consumes the backend DTO and responsive bike-grid implementation.
- Produces fresh automated, type/build, privacy, desktop, and mobile evidence.

- [ ] **Step 1: Run the complete server suite**

Run:

```powershell
npm run test:server
```

Expected: every server test PASS.

- [ ] **Step 2: Run Prisma integration coverage**

Run:

```powershell
npm run test:prisma
```

Expected: Prisma integration tests PASS. If the configured test database is unavailable, record the exact infrastructure error and do not report this gate as passing.

- [ ] **Step 3: Run lint and the production build**

Run:

```powershell
npm run lint
npm run build
```

Expected: both commands exit `0`; the build proves the Prisma relation filter and Next Image props type-check on Next.js 16.2.11.

- [ ] **Step 4: Check scope and whitespace**

Run:

```powershell
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Confirm that no schema, dependency, full-roster, profile, RSVP, upload, or unrelated poster-carousel file entered the bike-preview commits.

- [ ] **Step 5: Reuse or start the correct development server**

Inspect listeners on common Next.js ports and confirm the owning process belongs to `D:\Github\personal\tambike`. Reuse it when present. Only if no correct server exists, start `npm run dev` from this checkout and retain the terminal session for logs.

- [ ] **Step 6: Verify mobile with the Codex browser**

Open `/events/tambike-cafe-classico` at 390 × 844 and confirm:

- the attendee preview shows bike photos rather than faces;
- up to four unique rider bikes appear in a two-column grid;
- each tile opens the matching `/riders/{slug}` profile;
- the attendance headline, Interested/Expected copy, and “See who’s going” remain;
- the images crop legibly without stretching;
- no bike tile or document content overflows horizontally.

- [ ] **Step 7: Verify desktop and failure-safe behavior**

At a desktop width, confirm four bike tiles form one row and retain visible keyboard focus. Inspect the browser console for new errors. Use the focused component test as the deterministic proof that a failed image disappears without revealing a rider portrait or initial.

- [ ] **Step 8: Commit only a directly related verification correction**

If verification required a correction, stage only the directly related files and commit:

```powershell
git add src/features/member-profiles/types.ts src/server/backend.ts src/server/prisma-backend.ts src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-preview.module.css tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx
git commit -m "fix: harden attendee bike previews"
```

Rerun the failed focused command plus `npm run test:server`, `npm run lint`, and `npm run build`.

- [ ] **Step 9: Final handoff**

Report the exact commits, test counts, Prisma result, lint/build result, browser widths, profile-link behavior, overflow result, console result, preserved privacy behavior, and any deployment boundary.
