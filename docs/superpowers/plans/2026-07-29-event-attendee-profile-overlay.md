# Event Attendee Profile Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each public rider's profile photo and name over their uploaded bike in the event attendee preview, and rename the roster action to `View More`.

**Architecture:** Extend the existing privacy-filtered public preview DTO with an optional sanitized profile-photo URL. Render the bike as the full card background and layer a compact avatar/name identity strip over it without changing routes, card counts, or roster eligibility.

**Tech Stack:** Next.js 16.2, React 19, TypeScript, CSS Modules, Vitest

## Global Constraints

- Keep the existing four-card desktop and two-card mobile grids.
- Continue requiring Going status, visible RSVP identity, a public profile, roster enabled, and an uploaded motorcycle photo.
- Do not expose email, user IDs, media storage keys, verification fields, motorcycle metadata, or private/member-only/anonymous profiles.
- If an avatar is missing or fails, keep the bike and rider name without generating an initial or placeholder.
- If the bike background fails, keep the existing behavior that removes the broken tile.
- Rename `View all bikes` to `View More`.
- Preserve unrelated dirty carousel and poster work.
- Do not add dependencies, routes, breakpoints, or test files.
- Reuse localhost:3000; do not start a dev server or run a production build.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/features/member-profiles/types.ts` | Public preview rider DTO |
| `src/server/backend.ts` | Memory backend public preview mapping |
| `src/server/prisma-backend.ts` | Prisma public preview mapping |
| `src/features/member-profiles/event-attendee-preview.tsx` | Bike-background rider card markup and avatar failure handling |
| `src/features/member-profiles/event-attendee-preview.module.css` | Gradient, avatar, name, hover, and reduced-motion styling |
| `tests/server/event-attendee-public-preview-domain.test.ts` | Privacy-safe avatar domain contract |
| `tests/server/event-attendee-preview-loader.test.ts` | Narrow loader DTO contract |
| `tests/server/event-attendee-preview-ui.test.tsx` | Rendered rider identity and failure behavior |
| `tests/server/event-detail-ui-contract.test.ts` | Event-detail integration copy and source contract |

### Task 1: Add the Public Profile Photo to the Preview DTO

**Files:**

- Modify: `tests/server/event-attendee-public-preview-domain.test.ts`
- Modify: `tests/server/event-attendee-preview-loader.test.ts`
- Modify: `src/features/member-profiles/types.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`

**Interfaces:**

- Consumes: sanitized `MemberProfileView.profilePhotoUrl?: string`.
- Produces: `EventAttendeePreviewRider.profilePhotoUrl?: string`.

- [ ] **Step 1: Write failing domain and loader expectations**

Add a finalized public profile photo to the public rider fixture, then require:

```ts
expect(preview.attendees[0]).toMatchObject({
  slug: "public-rider",
  profilePhotoUrl: "/media/preview-bike-2",
  bikePhoto: {
    url: "/media/preview-bike-1",
    width: 1200,
    height: 800,
  },
});
```

Update the loader fixture and expected DTO with:

```ts
profilePhotoUrl: "/media/avatar-rider-1",
```

Keep negative assertions for `email`, `userId`, `verification`, `storageKey`,
`make`, and `model`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts
```

Expected: FAIL because public preview mappings omit `profilePhotoUrl`.

- [ ] **Step 3: Extend the DTO and both backend mappings**

Use:

```ts
export type EventAttendeePreviewRider = Pick<
  MemberProfileView,
  "slug" | "displayName" | "area" | "profilePhotoUrl"
> & {
  bikePhoto: EventAttendeePreviewBikePhoto;
};
```

In both public-preview mappings add:

```ts
profilePhotoUrl: profile.profilePhotoUrl,
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts
```

Expected: both files pass while privacy exclusions remain green.

### Task 2: Render Profile Identity Over the Bike Background

**Files:**

- Modify: `tests/server/event-attendee-preview-ui.test.tsx`
- Modify: `tests/server/event-detail-ui-contract.test.ts`
- Modify: `src/features/member-profiles/event-attendee-preview.tsx`
- Modify: `src/features/member-profiles/event-attendee-preview.module.css`

**Interfaces:**

- Consumes: `EventAttendeePreviewRider.profilePhotoUrl`, `displayName`,
  `bikePhoto`, and `slug`.
- Produces: one linked bike-background card with optional avatar, visible rider
  name, and unchanged rider-profile destination.

- [ ] **Step 1: Write failing rendered UI expectations**

Add avatar URLs to the preview fixture and require:

```ts
expect(markup).toContain('src="/media/avatar-mika"');
expect(markup).toContain("Mika Santos");
expect(markup).toContain(styles.profileOverlay);
expect(markup).toContain("View More");
expect(markup).not.toContain("View all bikes");
```

Add an avatar-error test that dispatches `error` on the avatar image and
asserts the rider link and bike image remain while the failed avatar disappears.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts
```

Expected: FAIL because no avatar/name overlay exists and the action still says
`View all bikes`.

- [ ] **Step 3: Implement the identity overlay**

Track avatar failures separately from bike failures:

```ts
const [failedProfilePhotos, setFailedProfilePhotos] = useState<Set<string>>(
  () => new Set(),
);
```

Give the bike image `className={styles.bikePhoto}`. Inside each link, render:

```tsx
<span className={styles.profileOverlay}>
  {rider.profilePhotoUrl && !failedProfilePhotos.has(rider.slug) ? (
    <span className={styles.avatar}>
      <Image
        src={rider.profilePhotoUrl}
        alt=""
        fill
        sizes="32px"
        unoptimized
        onError={() => {
          setFailedProfilePhotos((current) => {
            const next = new Set(current);
            next.add(rider.slug);
            return next;
          });
        }}
      />
    </span>
  ) : null}
  <span className={styles.riderName}>{rider.displayName}</span>
</span>
```

Rename the action text to `View More`.

- [ ] **Step 4: Add card styling**

Use `.bikePhoto` for the full-bleed background and hover motion. Add a
bottom gradient pseudo-element, a positioned `.profileOverlay`, a 32px circular
`.avatar`, and a truncated high-contrast `.riderName`. Keep the existing
aspect ratio, grid counts, focus ring, and reduced-motion override.

- [ ] **Step 5: Run focused verification**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts tests/server/event-roster-ui-contract.test.ts
```

Expected: all focused files pass.

- [ ] **Step 6: Verify live desktop and mobile layouts**

Reuse localhost:3000 at 1440px and 430px. Confirm four and two cards
respectively, readable rider names, visible avatars when available, working
profile links, and zero horizontal overflow.

- [ ] **Step 7: Commit the scoped implementation**

Stage only the files and shared-file hunks listed above:

```powershell
git commit -m "feat: identify riders in event preview"
```
