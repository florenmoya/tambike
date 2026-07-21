# Rider Profiles, Motorcycle Showcase, and Event Rosters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver privacy-safe shareable member profiles, one motorcycle showcase, organizer-controlled event rosters, private S3 image handling, and one production sample rider.

**Architecture:** Extend the existing in-memory and Prisma backends behind identical typed methods. Public/member UI consumes sanitized feature DTOs, mutations use authenticated Server Actions, and private media uses five-minute S3 POST policies plus authorized same-origin delivery. Additive schema changes and a declarative AWS/OIDC stack keep production rollout reversible.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript, Prisma 7.8/PostgreSQL, Vitest, shadcn/Radix Nova, AWS SDK v3, Vercel OIDC, Sharp, CloudFormation, Codex Browser.

## Global Constraints

- Profiles support `PUBLIC`, `MEMBERS_ONLY`, and `PRIVATE`; existing profiles remain unpublished/private until explicitly saved.
- Stable profile slugs are generated once on first publish and never change after display-name edits.
- No friends, follows, feeds, likes, comments, messaging, or people directory.
- Organizers enable or disable each event roster; default is disabled.
- Enabled roster cards are available only to signed-in Tambike users.
- Apply roster precedence server-side: disabled means counts only; anonymous RSVP means aggregate; visible RSVP plus non-private published profile means linked card; private/unpublished profile is always anonymous.
- Changing the saved anonymity preference affects future registrations only; existing RSVP choices remain per-event editable.
- Only Going RSVPs appear in rosters.
- Never expose email, verification status, internal user IDs, password data, session data, S3 object keys, or raw S3 URLs through public/member DTOs.
- Return full user lists only to authenticated admins; the signed-in user may still receive their own account email.
- Upload only JPEG, PNG, or WebP; reject SVG/GIF; maximum input is 8 MiB; presigned POST lifetime is five minutes.
- Finalization verifies ownership, file signature, MIME, and dimensions, applies orientation, strips EXIF/GPS, and writes immutable WebP.
- Avatar output is exactly 512×512; motorcycle output fits within 1600×1200 without enlargement; maximum five motorcycle photos.
- S3 stays private in `ap-southeast-1`, with public access blocked, encryption enabled, restricted CORS, and one-day `tmp/` cleanup.
- Vercel uses OIDC temporary credentials and least-privilege IAM; never store persistent AWS access keys.
- Both memory and Prisma backends implement every profile, roster, and media interface.
- Use Node.js Vercel Functions/Fluid Compute, not Edge runtime, for AWS SDK and Sharp code.
- Use only the Codex browser for browser acceptance; never use Playwright for this feature's browser checks.
- Do not run the general Prisma seed against production.
- Any failed required check blocks migration, merge, or push.

---

### Task 1: Additive Profile, Motorcycle, Roster, and Media Schema

**Files:**
- Create: `prisma/migrations/20260722010000_rider_profiles_showcase_rosters/migration.sql`
- Create: `src/features/member-profiles/types.ts`
- Create: `tests/server/member-profile-schema-contract.test.ts`
- Create: `tests/prisma-integration/member-profile-roster-migration.integration.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `tests/server/prisma-integration-harness-contract.test.ts`

**Interfaces:**
- Produces: `ProfileVisibility`, `RosterIdentity`, `MemberProfileView`, `MemberProfileEditorView`, `MotorcycleShowcase`, `EventAttendeeSummary`, `EventAttendeeRosterPage`, `UpdateMemberProfileInput`, `UpsertMotorcycleInput`, and `RosterIdentityInput`.
- Produces Prisma relations `User.motorcycle`, `Event.rosterSettings`, and `RSVP.rosterIdentity` for later backend tasks.

- [ ] **Step 1: Write failing schema and migration tests**

Assert the exact enums, nullable publication/photo columns, one-to-one records, `(eventId,status,goingAt,id)` roster index, `(motorcycleId,position)` uniqueness, photo `mediaId` uniqueness, and explicit existing-RSVP anonymous backfill. The guarded integration test creates representative pre-feature rows, applies only the new SQL, and verifies all old rows remain plus `rosterIdentity='ANONYMOUS'`.

```ts
expect(schema).toContain("enum ProfileVisibility")
expect(schema).toContain("enum RosterIdentity")
expect(schema).toContain("profileSlug             String?            @unique")
expect(schema).toContain("rosterIdentity RosterIdentity @default(ANONYMOUS)")
expect(schema).toContain("@@index([eventId, status, goingAt, id])")
expect(migration).toContain('UPDATE "RSVP" SET "rosterIdentity" = \'ANONYMOUS\'')
```

- [ ] **Step 2: Run red tests**

Run: `npm run test:server -- tests/server/member-profile-schema-contract.test.ts tests/server/prisma-integration-harness-contract.test.ts`

Expected: FAIL because the enums, fields, migration, and types do not exist.

- [ ] **Step 3: Define exact DTOs and inputs**

```ts
export type ProfileVisibility = "PUBLIC" | "MEMBERS_ONLY" | "PRIVATE"
export type RosterIdentity = "VISIBLE" | "ANONYMOUS"

export interface MemberProfileView {
  slug: string
  displayName: string
  area: string
  role: "rider" | "organizer" | "admin"
  bio?: string
  visibility: ProfileVisibility
  joinedAt: string
  profilePhotoUrl?: string
  motorcycle?: MotorcycleShowcase
  organizer?: { hostedEventCount: number }
}

export interface MotorcycleShowcase {
  make: string
  model: string
  year?: number
  displacementCc?: number
  nickname?: string
  description?: string
  photos: Array<{ url: string; position: number; width: number; height: number }>
}

export interface EventAttendeeSummary {
  eventId: string
  eventTitle: string
  rosterEnabled: boolean
  goingCount: number
  visibleCount: number
  anonymousCount: number
}

export interface EventAttendeeRosterPage {
  summary: EventAttendeeSummary
  attendees: Array<Pick<MemberProfileView, "slug" | "displayName" | "area" | "profilePhotoUrl" | "motorcycle">>
  nextCursor?: string
  pageSize: number
}
```

`MemberProfileEditorView` extends the member view with the owner's saved default and publication state, but not storage keys. `UpdateMemberProfileInput` carries `displayName`, `area`, optional `bio`, `visibility`, and `defaultRosterIdentity`. `UpsertMotorcycleInput` carries make/model plus bounded optional fields. `RosterIdentityInput` is `{ rosterIdentity: RosterIdentity }`.

- [ ] **Step 4: Implement the additive Prisma schema and SQL**

Add nullable profile photo columns to `User`; `Motorcycle` and `MotorcyclePhoto` with cascade deletes; `EventRosterSettings.enabled @default(false)`; and `RSVP.rosterIdentity @default(ANONYMOUS)`. The SQL creates types/tables/indexes, adds columns with safe defaults, backfills every RSVP, and sets the new column `NOT NULL`.

- [ ] **Step 5: Run green schema tests and guarded migration integration**

Run: `npm run db:generate`

Run: `npm run test:server -- tests/server/member-profile-schema-contract.test.ts tests/server/prisma-integration-harness-contract.test.ts`

Run only with an explicit loopback `tambike_test_*` URL: `npm run test:prisma -- tests/prisma-integration/member-profile-roster-migration.integration.test.ts`

Expected: all targeted tests PASS; the guarded command refuses non-loopback/non-`tambike_test_*` databases.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260722010000_rider_profiles_showcase_rosters src/features/member-profiles/types.ts tests/server/member-profile-schema-contract.test.ts tests/server/prisma-integration-harness-contract.test.ts tests/prisma-integration/member-profile-roster-migration.integration.test.ts
git commit -m "feat: add member profile and roster schema"
```

---

### Task 2: Profile Visibility, Stable Slugs, Sanitization, and Admin User Boundary

**Files:**
- Create: `src/server/member-profiles/profile-domain.ts`
- Create: `tests/server/member-profile-domain.test.ts`
- Create: `tests/prisma-integration/member-profile-visibility.integration.test.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/actions.ts`
- Modify: `src/server/demo-state.ts`
- Modify: `src/features/tambike-demo/types.ts`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Modify: `tests/server/backend-domain.test.ts`

**Interfaces:**
- Consumes schema/DTOs from Task 1.
- Produces backend methods `getMemberProfile(sessionToken: string | undefined, slug: string)`, `getMemberProfileEditor(sessionToken: string)`, `updateMemberProfile(sessionToken: string, input: UpdateMemberProfileInput)`, and `upsertMotorcycle(sessionToken: string, input: UpsertMotorcycleInput)`.
- Produces server actions `getMemberProfileAction`, `getMemberProfileEditorAction`, `updateMemberProfileAction`, and `upsertMotorcycleAction`.

- [ ] **Step 1: Write failing domain tests**

Cover guest/public, guest/members-only denial, signed-in/members-only, owner/private, admin/private, outsider/private non-enumerating not-found, unpublished lookup, slug collision suffixes, slug stability after display-name edits, 500-character bio limit, motorcycle field bounds, and public DTO forbidden-key scanning.

```ts
for (const forbidden of ["email", "verificationStatus", "userId", "id", "objectKey", "passwordHash"]) {
  expect(JSON.stringify(publicView)).not.toContain(forbidden)
}
```

Add a snapshot test proving `getSnapshot()` returns `users: []` for guest/rider/organizer and the full list only for an authenticated admin.

- [ ] **Step 2: Run red tests**

Run: `npm run test:server -- tests/server/member-profile-domain.test.ts tests/server/backend-domain.test.ts`

Expected: FAIL because profile visibility methods and the admin-only user boundary are absent.

- [ ] **Step 3: Implement pure profile policy helpers**

```ts
export function canViewMemberProfile(
  viewer: { role: "rider" | "organizer" | "admin"; ownsProfile: boolean } | null,
  visibility: ProfileVisibility,
) {
  if (viewer?.ownsProfile || viewer?.role === "admin") return true
  if (visibility === "PUBLIC") return true
  return visibility === "MEMBERS_ONLY" && viewer !== null
}

export function profileSlugBase(displayName: string) {
  return displayName.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "rider"
}
```

Build a sanitization function that accepts internal records and emits only `MemberProfileView` fields. Represent media only as `/media/{opaqueMediaId}`.

- [ ] **Step 4: Implement both backends and actions**

Generate a slug only when an owner first saves/publishes profile settings and `profileSlug` is null. Resolve collisions deterministically with `-2`, `-3`, and so on in memory and inside a Prisma transaction. Validate all inputs before writing. Count organizer-hosted events without exposing organizer profile IDs.

Change snapshot construction so only admin sessions receive the full user list. Keep `currentUser` intact so a signed-in account can see its own email.

- [ ] **Step 5: Run memory and Prisma tests**

Run: `npm run test:server -- tests/server/member-profile-domain.test.ts tests/server/backend-domain.test.ts`

Run with guarded loopback test DB: `npm run test:prisma -- tests/prisma-integration/member-profile-visibility.integration.test.ts`

Expected: PASS in both backends with identical visibility and sanitization behavior.

- [ ] **Step 6: Commit**

```bash
git add src/server/member-profiles/profile-domain.ts src/server/backend.ts src/server/prisma-backend.ts src/server/actions.ts src/server/demo-state.ts src/features/tambike-demo/types.ts src/features/tambike-demo/demo-provider.tsx tests/server/member-profile-domain.test.ts tests/server/backend-domain.test.ts tests/prisma-integration/member-profile-visibility.integration.test.ts
git commit -m "feat: enforce member profile privacy"
```

---

### Task 3: Organizer-Controlled Event Rosters and RSVP Identity

**Files:**
- Create: `src/server/member-profiles/roster-domain.ts`
- Create: `tests/server/event-roster-domain.test.ts`
- Create: `tests/prisma-integration/event-roster.integration.test.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/actions.ts`
- Modify: `src/features/tambike-demo/types.ts`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Modify: `tests/server/support/tambike-fixtures.ts`

**Interfaces:**
- Consumes profile sanitization and Task 1 roster types.
- Produces `configureEventRoster(sessionToken, eventId, { enabled })`, `listEventAttendees(sessionToken | undefined, eventId, { cursor?, limit? })`, and `updateEventRosterIdentity(sessionToken, eventId, { rosterIdentity })` in both backends.
- Extends `registerForEvent` input with optional `rosterIdentity`; omitted values copy `User.defaultRosterIdentity` only when the RSVP is first created.

- [ ] **Step 1: Write failing roster behavior tests**

Cover default-disabled counts-only; owner/admin configuration; non-owner forbidden; audit prior/next values; Going-only inclusion; anonymous RSVP; visible/public; visible/members-only for signed-in viewers; visible/private forced anonymous; unpublished forced anonymous; guest enabled-roster authentication requirement; saved-default application to new RSVP; default changes not rewriting old RSVP; per-event override; composite cursor ordering; malformed cursor rejection; limit default 24 and maximum 50; no duplicates across pages.

- [ ] **Step 2: Run red tests**

Run: `npm run test:server -- tests/server/event-roster-domain.test.ts`

Expected: FAIL because the roster methods and identity field are absent.

- [ ] **Step 3: Implement cursor and precedence helpers**

```ts
export function encodeRosterCursor(value: { goingAt: string; rsvpId: string }) {
  return Buffer.from(JSON.stringify([value.goingAt, value.rsvpId]), "utf8").toString("base64url")
}

export function classifyRosterEntry(input: {
  enabled: boolean
  rosterIdentity: RosterIdentity
  profileSlug?: string
  profileVisibility: ProfileVisibility
}) {
  if (!input.enabled) return "COUNT_ONLY" as const
  if (input.rosterIdentity === "ANONYMOUS") return "ANONYMOUS" as const
  if (!input.profileSlug || input.profileVisibility === "PRIVATE") return "ANONYMOUS" as const
  return "VISIBLE" as const
}
```

Decode cursors with a strict tuple/type/date check and throw `BackendError("INVALID_INPUT")` for malformed values.

- [ ] **Step 4: Implement identical memory and Prisma behavior**

Authorize configuration by organizer-profile ownership or admin role. For Prisma, query one extra row beyond the clamped limit, sort by `goingAt ASC, id ASC`, and apply the cursor tuple predicate. Build the visible page only from sanitized profile data and compute the anonymous aggregate across the whole Going set, not just the visible page.

When an existing RSVP is updated without a roster identity, preserve its stored identity. When a new RSVP is inserted without one, copy the user's saved default. Write `ROSTER_SETTINGS_UPDATED` audit metadata with booleans only.

- [ ] **Step 5: Run memory and guarded Prisma tests**

Run: `npm run test:server -- tests/server/event-roster-domain.test.ts`

Run with guarded loopback test DB: `npm run test:prisma -- tests/prisma-integration/event-roster.integration.test.ts`

Expected: all precedence, ownership, pagination, default, override, and audit tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/member-profiles/roster-domain.ts src/server/backend.ts src/server/prisma-backend.ts src/server/actions.ts src/features/tambike-demo/types.ts src/features/tambike-demo/demo-provider.tsx tests/server/event-roster-domain.test.ts tests/prisma-integration/event-roster.integration.test.ts tests/server/support/tambike-fixtures.ts
git commit -m "feat: add privacy-aware event rosters"
```

---

### Task 4: Private S3 Upload Policy and Image Normalization Core

**Files:**
- Create: `src/server/member-media/types.ts`
- Create: `src/server/member-media/config.ts`
- Create: `src/server/member-media/store.ts`
- Create: `src/server/member-media/s3-store.ts`
- Create: `src/server/member-media/image-normalizer.ts`
- Create: `src/server/member-media/upload-policy.ts`
- Create: `tests/server/member-media-upload-policy.test.ts`
- Create: `tests/server/member-media-image-normalizer.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`

**Interfaces:**
- Produces `MemberMediaStore` with `createPresignedPost`, `getObject`, `putObject`, and `deleteObject`.
- Produces `createMemberUploadPolicy`, `normalizeMemberImage`, and an S3 implementation using Vercel OIDC.

- [ ] **Step 1: Install exact feature dependencies**

Run: `npm install @aws-sdk/client-s3 @aws-sdk/s3-presigned-post @vercel/oidc-aws-credentials-provider sharp`

Expected: package manifest and lockfile include all four direct dependencies.

- [ ] **Step 2: Write failing upload-policy and image tests**

Policy tests require a 300-second expiry, exact `tmp/users/{userId}/{nonce}` key, exact allowed content type, `content-length-range` of `1..8388608`, and rejection of unsupported types. Image tests use generated buffers to prove JPEG/PNG/WebP acceptance, signature/MIME mismatch rejection, malformed/oversized input rejection, SVG/GIF rejection, avatar 512×512 cover, motorcycle max 1600×1200 without enlargement, and metadata removal verified with `sharp(...).metadata()`.

- [ ] **Step 3: Run red tests**

Run: `npm run test:server -- tests/server/member-media-upload-policy.test.ts tests/server/member-media-image-normalizer.test.ts`

Expected: FAIL because the member-media modules do not exist.

- [ ] **Step 4: Implement configuration and policy**

Require `AWS_REGION`, `AWS_ROLE_ARN`, and `S3_BUCKET_NAME`; pin production to `ap-southeast-1`; accept only exact MIME values; and use `createPresignedPost` with exact fields plus size condition.

```ts
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"])

const s3 = new S3Client({
  region: config.region,
  credentials: awsCredentialsProvider({ roleArn: config.roleArn }),
})
```

- [ ] **Step 5: Implement Sharp normalization**

Read at most `MAX_UPLOAD_BYTES + 1`, validate the decoded format and claimed MIME, call `rotate()` to honor orientation, omit `withMetadata()` so EXIF/GPS is removed, resize by purpose, and output WebP with deterministic options. Return `{ bytes, mimeType: "image/webp", width, height }`.

- [ ] **Step 6: Run green tests**

Run: `npm run test:server -- tests/server/member-media-upload-policy.test.ts tests/server/member-media-image-normalizer.test.ts`

Expected: all policy, format, dimension, and metadata tests PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example src/server/member-media tests/server/member-media-upload-policy.test.ts tests/server/member-media-image-normalizer.test.ts
git commit -m "feat: add private member image pipeline"
```

---

### Task 5: Media Finalization, Persistence, Cleanup, and Authorized Delivery

**Files:**
- Create: `src/server/member-media/service.ts`
- Create: `src/app/api/member-media/uploads/route.ts`
- Create: `src/app/media/[mediaId]/route.ts`
- Create: `tests/server/member-media-service.test.ts`
- Create: `tests/server/member-media-route-contract.test.ts`
- Create: `tests/prisma-integration/member-media-persistence.integration.test.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/actions.ts`

**Interfaces:**
- Consumes `MemberMediaStore` and Task 1 media columns/records.
- Produces `finalizeMemberMedia(sessionToken, { purpose, tempKey, claimedMimeType, motorcyclePhotoPosition? })`, `deleteMemberMedia`, and `reorderMotorcyclePhotos` in both backends.
- Produces authenticated presign `POST /api/member-media/uploads`, finalization/deletion/reorder Server Actions, and authorized `GET /media/[mediaId]`.

- [ ] **Step 1: Write failing service and route tests**

Use an in-memory fake store to cover unauthenticated presign/finalize; temp-key owner mismatch; missing/expired temp object; sixth-photo rejection; avatar replacement cleanup; motorcycle replacement/deletion cleanup; reorder uniqueness; database/state failure deleting the new finalized object; success deleting temp and old finalized objects; raw key never serialized; owner/admin/private/public/member authorization; missing objects; and `Cache-Control: private, no-store`.

- [ ] **Step 2: Run red tests**

Run: `npm run test:server -- tests/server/member-media-service.test.ts tests/server/member-media-route-contract.test.ts`

Expected: FAIL because service/backend/route methods do not exist.

- [ ] **Step 3: Implement transactional service orchestration**

Final keys are `media/users/{userId}/avatar/{uuid}.webp` or `media/users/{userId}/motorcycles/{uuid}.webp`. Upload the normalized object first. Persist only opaque media ID, private key, MIME, dimensions, and timestamp. If persistence fails, delete the new object. After persistence succeeds, delete temp and replaced objects. Treat cleanup `NoSuchKey` as idempotent while surfacing other S3 failures.

- [ ] **Step 4: Implement backend persistence and authorization**

Memory maps and Prisma transactions enforce the same five-photo limit and positions. Media resolution loads the owning profile's publication/visibility before returning an internal stream descriptor. The descriptor never crosses into a JSON response.

- [ ] **Step 5: Implement App Router boundaries**

Await dynamic route params. Read session cookies inside each handler/action. Return JSON from upload signing only after auth; stream WebP bytes for media; return non-enumerating 404 for forbidden/private/unpublished media. Do not declare Edge runtime or static caching.

- [ ] **Step 6: Run unit and guarded Prisma tests**

Run: `npm run test:server -- tests/server/member-media-service.test.ts tests/server/member-media-route-contract.test.ts`

Run with guarded loopback test DB: `npm run test:prisma -- tests/prisma-integration/member-media-persistence.integration.test.ts`

Expected: all auth, limit, cleanup, authorization, route, and persistence tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/member-media/service.ts src/app/api/member-media/uploads/route.ts src/app/media/[mediaId]/route.ts src/server/backend.ts src/server/prisma-backend.ts src/server/actions.ts tests/server/member-media-service.test.ts tests/server/member-media-route-contract.test.ts tests/prisma-integration/member-media-persistence.integration.test.ts
git commit -m "feat: finalize and serve private member media"
```

---

### Task 6: Public Garage Card and Profile Settings UI

**Files:**
- Create: `src/features/member-profiles/member-profile-screen.tsx`
- Create: `src/features/member-profiles/profile-settings.tsx`
- Create: `src/features/member-profiles/member-media-uploader.tsx`
- Create: `src/app/riders/[slug]/page.tsx`
- Create: `src/app/riders/[slug]/not-found.tsx`
- Create: `tests/server/member-profile-ui-contract.test.ts`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes profile editor/view/actions and media endpoints from Tasks 2 and 5.
- Produces a server-rendered public/member profile route and authenticated settings UI.

- [ ] **Step 1: Write failing UI contract tests**

Assert awaited slug params, server-side profile query, `notFound()` for non-enumerating failures, `next/image` use, alt text, labeled visibility/default controls, avatar and maximum-five photo upload affordances, upload error live region, keyboard-operable photo reorder/delete buttons, explicit publish/save copy, and no email/verification text in the public component.

- [ ] **Step 2: Run red tests**

Run: `npm run test:server -- tests/server/member-profile-ui-contract.test.ts`

Expected: FAIL because route and components do not exist.

- [ ] **Step 3: Build the garage card**

Use existing tokens and Geist. The profile page leads with an avatar identity plate, followed by one wide motorcycle hero, compact specification labels, and an ordered contact strip of up to five photos. Use `Image` with explicit dimensions/sizes, quiet organizer badge/count, and an honest empty showcase state.

- [ ] **Step 4: Build settings and upload interaction**

Extract the existing profile form from `TambikeScreen`. Provide clear Identity, Attendance privacy, Avatar, Motorcycle, and Motorcycle photos sections using current shadcn primitives. Upload flow calls the presign route, submits the browser `FormData` directly to S3, finalizes via action, and shows pending/success/failure via `aria-live`. Disable a sixth-photo chooser and explain the cap.

- [ ] **Step 5: Run contract, type, and focused lint checks**

Run: `npm run test:server -- tests/server/member-profile-ui-contract.test.ts`

Run: `npx tsc --noEmit`

Run: `npx eslint src/features/member-profiles src/app/riders src/features/tambike-demo/tambike-screen.tsx`

Expected: all commands PASS without accessibility or hook warnings.

- [ ] **Step 6: Commit**

```bash
git add src/features/member-profiles/member-profile-screen.tsx src/features/member-profiles/profile-settings.tsx src/features/member-profiles/member-media-uploader.tsx src/app/riders/[slug] src/features/tambike-demo/tambike-screen.tsx src/features/tambike-demo/demo-provider.tsx src/app/globals.css tests/server/member-profile-ui-contract.test.ts
git commit -m "feat: add member garage profile experience"
```

---

### Task 7: Event Attendee Route, Organizer Controls, and RSVP Identity UI

**Files:**
- Create: `src/features/member-profiles/event-attendee-roster.tsx`
- Create: `src/features/member-profiles/organizer-roster-panel.tsx`
- Create: `src/features/member-profiles/roster-identity-field.tsx`
- Create: `src/app/events/[eventId]/attendees/page.tsx`
- Create: `tests/server/event-roster-ui-contract.test.ts`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes roster methods/actions from Task 3 and garage-card excerpts from Task 6.
- Produces the member attendee route, organizer on/off controls, registration identity field, and existing-RSVP identity editor.

- [ ] **Step 1: Write failing UI contract tests**

Assert awaited event params, signed-in enabled-roster gate, disabled counts-only state, anonymous aggregate card, linked visible rider cards, cursor `Load more` behavior, organizer ownership-oriented switch copy, no raw user/account fields, saved-default explanation, per-event radio choice, private-profile forced-anonymous explanation, labeled controls, live save status, and keyboard focus.

- [ ] **Step 2: Run red tests**

Run: `npm run test:server -- tests/server/event-roster-ui-contract.test.ts`

Expected: FAIL because route/components do not exist.

- [ ] **Step 3: Build attendee and organizer surfaces**

The attendee route starts with counts, then either counts-only, login gate, visible cards plus one anonymous aggregate, or a direction-rich empty state. The organizer panel replaces the current “directory can be added” placeholder with the actual toggle, visible/anonymous totals, and sanitized page.

- [ ] **Step 4: Add registration and existing-RSVP controls**

Extend the RSVP modal and registration action call with a required `VISIBLE`/`ANONYMOUS` radio choice initialized from the user's saved default. On an existing RSVP, render a separate edit control bound to `updateEventRosterIdentityAction`; never rewrite it when the profile default changes.

- [ ] **Step 5: Run contract, type, and focused lint checks**

Run: `npm run test:server -- tests/server/event-roster-ui-contract.test.ts tests/server/event-roster-domain.test.ts`

Run: `npx tsc --noEmit`

Run: `npx eslint src/features/member-profiles src/features/organizer/organizer-console.tsx src/features/tambike-demo/tambike-screen.tsx src/app/events/[eventId]/attendees/page.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/member-profiles/event-attendee-roster.tsx src/features/member-profiles/organizer-roster-panel.tsx src/features/member-profiles/roster-identity-field.tsx src/app/events/[eventId]/attendees/page.tsx src/features/organizer/organizer-console.tsx src/features/tambike-demo/tambike-screen.tsx src/features/tambike-demo/demo-provider.tsx src/app/globals.css tests/server/event-roster-ui-contract.test.ts
git commit -m "feat: add attendee roster interfaces"
```

---

### Task 8: AWS/Vercel OIDC Infrastructure and Real S3 Smoke

**Files:**
- Create: `infra/aws/tambike-member-media.yaml`
- Create: `docs/deployment/member-media-aws-oidc.md`
- Create: `scripts/smoke-member-media-s3.ts`
- Create: `tests/server/member-media-infra-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces CloudFormation outputs `BucketName` and `VercelRoleArn` and script `npm run smoke:member-media-s3`.
- Consumes deployment parameters `VercelTeamSlug`, `VercelProjectName`, `AllowedOrigin`, and optional `ExistingOidcProviderArn`.

- [ ] **Step 1: Write failing infrastructure contract tests**

Assert region-independent CloudFormation syntax plus bucket public-access block, SSE-S3 encryption, versioning, `tmp/` one-day expiration, CORS restricted to the supplied origin and POST only, strict team-mode `aud` and `sub` trust conditions, least-privilege temp/final object permissions, no wildcard AWS service actions, and outputs for env configuration.

- [ ] **Step 2: Run red test**

Run: `npm run test:server -- tests/server/member-media-infra-contract.test.ts`

Expected: FAIL because template/docs/script do not exist.

- [ ] **Step 3: Implement CloudFormation and guide**

Use `AWS::S3::Bucket`, an optional conditionally-created `AWS::IAM::OIDCProvider`, `AWS::IAM::Role`, and inline policy limited to the created bucket's `tmp/*` and `media/*` keys. Bind production exactly to `owner:${VercelTeamSlug}:project:${VercelProjectName}:environment:production`; add preview only as an explicit deployment parameter, never with project `*`.

Document `AWS_REGION=ap-southeast-1`, `AWS_ROLE_ARN`, `S3_BUCKET_NAME`, Vercel team-mode issuer, current Tambike project check, stack deploy/update, and stack rollback.

- [ ] **Step 4: Implement destructive-safe S3 smoke**

Require a non-production prefix beginning `smoke/`, upload one generated JPEG through the presigned flow, finalize it, fetch it through authorized service code, assert WebP dimensions/metadata, and delete only the exact keys returned by that run. Refuse empty prefixes, `tmp/`, `media/`, or production sample prefixes.

- [ ] **Step 5: Run contract tests**

Run: `npm run test:server -- tests/server/member-media-infra-contract.test.ts`

Expected: PASS. Do not run the real smoke until a test bucket/role exists.

- [ ] **Step 6: Commit**

```bash
git add infra/aws/tambike-member-media.yaml docs/deployment/member-media-aws-oidc.md scripts/smoke-member-media-s3.ts tests/server/member-media-infra-contract.test.ts package.json
git commit -m "ops: define private member media infrastructure"
```

---

### Task 9: Idempotent Production Sample Rider Provisioner

**Files:**
- Create: `scripts/provision-sample-rider.ts`
- Create: `scripts/sample-rider-manifest.example.json`
- Create: `src/server/member-profiles/sample-rider.ts`
- Create: `tests/server/sample-rider-provisioner.test.ts`
- Create: `tests/prisma-integration/sample-rider-provisioner.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `npm run provision:sample-rider -- --confirm-production --manifest <path>`.
- Requires `TAMBIKE_SAMPLE_RIDER_PASSWORD` at runtime and six local image paths in the manifest; never reads a committed password.
- Consumes real profile, media, motorcycle, RSVP, and pass services from earlier tasks.

- [ ] **Step 1: Write failing idempotency and safety tests**

Cover missing confirmation, missing/blank password, missing assets, wrong event, wrong asset count, normal user role, public profile, visible default, one motorcycle, one avatar, five ordered photos, one Going RSVP/pass for `tambike-cafe-classico`, repeated-run exact counts, and no general seed import or invocation.

- [ ] **Step 2: Run red tests**

Run: `npm run test:server -- tests/server/sample-rider-provisioner.test.ts`

Expected: FAIL because the provisioner does not exist.

- [ ] **Step 3: Implement the reusable provisioning service**

Use a stable sample email constant only inside the provisioning module, bcrypt-hash the supplied password, and upsert by that email inside a transaction. Call the same profile/motorcycle/media/registration/pass services as normal flows. Preserve the existing account ID and stable slug on repeats. Replace drifted sample media only after new media succeeds.

- [ ] **Step 4: Implement the CLI and manifest**

Parse an explicit manifest containing one `avatar` path and exactly five `motorcyclePhotos` paths. Require `--confirm-production`. Print only stable counts/slug/event outcome; never print the password, hash, raw keys, signed URLs, or database URL.

- [ ] **Step 5: Run unit and guarded Prisma idempotency tests**

Run: `npm run test:server -- tests/server/sample-rider-provisioner.test.ts`

Run with guarded loopback test DB: `npm run test:prisma -- tests/prisma-integration/sample-rider-provisioner.integration.test.ts`

Expected: two consecutive runs produce exactly one rider, motorcycle, avatar, five photos, RSVP, and pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/provision-sample-rider.ts scripts/sample-rider-manifest.example.json src/server/member-profiles/sample-rider.ts tests/server/sample-rider-provisioner.test.ts tests/prisma-integration/sample-rider-provisioner.integration.test.ts package.json
git commit -m "feat: provision production sample rider safely"
```

---

### Task 10: Branch Acceptance, Infrastructure Rollout, Main Delivery, and Production Verification

**Files:**
- Modify only files required by verified fixes from this task; every fix starts with a failing regression test.
- Generate ignored sample assets under `.codex/generated/sample-rider/` using the image generation skill: one fictional profile portrait and five consistent photographs of the same motorcycle.

**Interfaces:**
- Consumes all previous tasks.
- Produces a verified production deployment and idempotently provisioned sample rider.

- [ ] **Step 1: Run complete branch checks**

Run: `npm run test:server`

Run guarded integration suite with explicit loopback `tambike_test_*`: `npm run test:prisma`

Run: `npm run lint`

Run: `npm run build`

Run: `git diff --check`

Expected: all PASS and worktree clean.

- [ ] **Step 2: Install and verify Vercel CLI before platform work**

Run with approval: `npm i -g vercel`

Run: `vercel --version`, `vercel whoami`, and `vercel link`/project inspection.

Expected: linked project/team match Tambike; do not infer current project identity from old local state.

- [ ] **Step 3: Preview and Codex-browser acceptance**

Deploy a preview from the feature branch. Use only the Codex browser to verify guest public profile, members-only login gate, private owner/admin access, roster disabled, enabled guest gate, visible and anonymous attendees, profile and motorcycle uploads, saved and per-event identity controls, mobile layouts, keyboard operation, and console errors.

- [ ] **Step 4: Provision non-production AWS resources and run S3 smoke**

Apply the CloudFormation stack first to a non-production/test configuration, configure preview env via Vercel CLI, and run `npm run smoke:member-media-s3` only with a unique `smoke/` prefix. Verify private objects are inaccessible by raw URL.

- [ ] **Step 5: Apply production infrastructure and additive migration**

Only after branch/preview checks pass, apply the production stack, set `AWS_REGION`, `AWS_ROLE_ARN`, and `S3_BUCKET_NAME`, apply the additive Prisma migration, and re-run a production-prefix-safe health check that does not provision the sample yet.

- [ ] **Step 6: Rebase/fast-forward and verify merged local main**

Fetch `origin/main`; if advanced, rebase `codex/rider-profile-showcase` and rerun Steps 1–4. Fast-forward local `main` to `origin/main`, fast-forward merge the feature branch, rerun server tests, guarded Prisma suite, lint, build, diff check, and final Codex-browser smoke against the merged tree.

- [ ] **Step 7: Push main and wait for Ready**

Push directly to `origin/main` only with all checks passing and a clean tree. Wait for production deployment Ready and inspect deployment errors/logs with Vercel CLI.

- [ ] **Step 8: Generate and provision the sample rider**

Generate one fictional profile portrait and five consistent photographs of the same motorcycle. Save them only under ignored `.codex/generated/sample-rider/`, create a local manifest, supply the password through `TAMBIKE_SAMPLE_RIDER_PASSWORD`, and run the one-time idempotent provisioner twice. Verify exact counts remain one rider, one motorcycle, one avatar, five photos, one RSVP, and one pass.

- [ ] **Step 9: Live production acceptance**

Use the Codex browser to verify the live Mika profile, roster visibility/anonymity, upload replacement, event counts, pass, mobile/keyboard behavior, console, and deployment logs. If any production verification fails, write a failing regression, create and test a normal revert or corrective commit, and never force-push or rewrite published main.

---

## Plan Self-review

- Every requirement in the approved design is assigned to Tasks 1–10.
- Public/member sanitization and admin-only full user lists are tested before UI work.
- Memory and Prisma parity is required at each domain task, not deferred to release.
- Upload signing, normalization, persistence, delivery, infrastructure, and sample provisioning have separate review gates.
- All dynamic Next.js params are awaited; all server mutations repeat authorization.
- Production AWS, database, sample, merge, and push operations remain gated behind full branch and preview verification.
