# Rider Profiles, Motorcycle Showcase, and Event Rosters Design

## Goal

Add shareable rider and organizer profiles, private image storage, one motorcycle showcase per member, and organizer-controlled event rosters without turning Tambike into a social network or exposing account data.

## Chosen Approach

Extend the existing Tambike backend contract in parallel for the in-memory and Prisma implementations. Public and member-facing routes consume new sanitized DTOs instead of the current admin-oriented `UserProfile` records. Mutations remain authenticated server actions; dynamic media delivery and direct-to-S3 upload signing use App Router route handlers.

The feature is one cohesive delivery because profile visibility, RSVP identity, roster precedence, and media authorization share the same privacy boundary. Work is still split into independently testable schema/domain, profile, roster, media, interface, provisioning, and production-release tasks.

## Scope

- Add `/riders/[slug]` for published rider and organizer profiles.
- Add `/events/[eventId]/attendees` for roster counts and, when enabled, signed-in member cards.
- Add profile identity and motorcycle editing to `/profile`.
- Add roster settings and attendee identity information to the organizer attendee workspace.
- Add a visible/anonymous choice to event registration and existing RSVP editing.
- Add private image upload, finalization, replacement, and authorized delivery.
- Add one idempotently provisioned production sample rider, `Mika Santos — Sample Rider`.
- Restrict full user-list data to authenticated admins.

## Explicit Non-goals

No friends, follows, feeds, likes, comments, messages, people directory, multiple motorcycles, public S3 objects, raw S3 URLs, production use of the general Prisma seed, or implicit publication of existing profiles.

## Data Model

Add Prisma enums `ProfileVisibility { PUBLIC, MEMBERS_ONLY, PRIVATE }` and `RosterIdentity { VISIBLE, ANONYMOUS }`.

Extend `User` with:

- `profileSlug String? @unique`; null means the profile has never been explicitly published. Generate it once on the first profile publish/save and never regenerate it after name changes.
- `profileBio String?` with a 500-character application limit.
- `profileVisibility ProfileVisibility @default(PRIVATE)`.
- `defaultRosterIdentity RosterIdentity @default(ANONYMOUS)`.
- nullable profile-photo media metadata: opaque media ID, storage key, MIME type, width, height, and finalized timestamp. Storage keys never enter public or member DTOs.

Add a one-to-one `Motorcycle` keyed by `userId` with make, model, year, displacement, nickname, description, and timestamps. Add ordered `MotorcyclePhoto` rows with positions 0–4, opaque media IDs, private storage metadata, and a uniqueness constraint on `(motorcycleId, position)`.

Add a one-to-one `EventRosterSettings` keyed by `eventId`, with `enabled=false` and timestamps. Extend `RSVP` with `rosterIdentity RosterIdentity @default(ANONYMOUS)`. The additive migration explicitly backfills every existing RSVP to `ANONYMOUS` and adds indexes for profile slug lookup, Going-roster pagination, and ordered motorcycle-photo lookup.

## DTO and Privacy Boundary

Introduce focused types in `src/features/member-profiles/types.ts`:

- `MemberProfileView`: display name, area, role label, bio, visibility, stable slug, joined date, authorized media URL, sanitized motorcycle showcase, and organizer badge/hosted-event count where applicable.
- `MotorcycleShowcase`: descriptive fields and up to five ordered authorized media URLs.
- `EventAttendeeSummary`: event identity, roster-enabled state, Going count, visible count, and anonymous count.
- `EventAttendeeRosterPage`: summary, sanitized rider cards, opaque next cursor, and page size.

These DTOs never include email, verification status, internal user IDs, password data, session data, S3 object keys, or raw S3 URLs. The current user may continue to receive their own account email through authenticated account state. `DemoState.users` is empty for guests, riders, and organizers and populated only for authenticated admins.

## Profile Visibility

`getMemberProfile(viewerSessionToken, slug)` enforces:

- `PUBLIC`: visible to guests and signed-in users.
- `MEMBERS_ONLY`: visible only to a valid signed-in Tambike account.
- `PRIVATE`: visible only to the owner or an admin.
- null `profileSlug`: not published and not routable, except through the owner's `/profile` editor.

The same route and DTO serve riders and organizers. Organizer accounts receive an organizer badge and hosted-event count but no organizer contact or verification fields.

## Roster Rules

Only `going` RSVPs participate. The backend applies this precedence before pagination:

1. Roster disabled: return counts only and no rider cards.
2. RSVP identity `ANONYMOUS`: add to the anonymous aggregate.
3. RSVP identity `VISIBLE` plus a non-private, published profile: return a linked sanitized rider card.
4. Private or unpublished profile: always add to the anonymous aggregate.

An enabled roster requires a signed-in viewer to return cards. A guest receives an authentication-required result rather than member data. The disabled-roster route may show total counts to guests because it contains no member identity.

Roster pages sort Going RSVPs by `goingAt` then RSVP ID and use an opaque base64url cursor containing that composite position. Default page size is 24 and the hard maximum is 50.

Changing `defaultRosterIdentity` affects future registrations only. Registering without an explicit choice copies the user's current default onto the new RSVP. Existing RSVPs retain their stored value and are editable per event through `updateEventRosterIdentity`.

Only the owning organizer or an admin may change `EventRosterSettings`. Every change writes a `ROSTER_SETTINGS_UPDATED` audit record containing the prior and next enabled values, never member identities.

## Media Architecture

Create a dedicated private S3 bucket in `ap-southeast-1` with all public access blocked, SSE-S3 encryption, versioning, restrictive Tambike-origin CORS, and a lifecycle rule that expires `tmp/` objects after one day.

Vercel uses team-mode OIDC and a least-privilege IAM role. The trust policy binds both audience and subject to the Tambike project and permitted environment. The app receives only `AWS_ROLE_ARN`, a pinned `AWS_REGION=ap-southeast-1`, and `S3_BUCKET_NAME`; it stores no persistent AWS access key.

The app uses `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@vercel/oidc-aws-credentials-provider`, and `sharp`.

### Upload flow

1. An authenticated member requests a five-minute presigned POST for `image/jpeg`, `image/png`, or `image/webp` and an avatar or motorcycle-photo purpose.
2. The server creates an exact user-scoped key `tmp/users/{userId}/{nonce}`. The POST policy fixes that key and MIME value and enforces `content-length-range` from 1 byte through 8 MiB.
3. The browser uploads directly to S3.
4. The authenticated finalization action confirms the temp-key owner, downloads no more than 8 MiB, checks the file signature through `sharp`, rejects SVG/GIF or MIME mismatch, applies EXIF orientation, strips all metadata, and emits immutable WebP.
5. Avatars use a centered cover resize to 512×512. Motorcycle photos use an inside resize capped at 1600×1200 without enlargement.
6. The new object is written under `media/users/{userId}/.../{uuid}.webp`, then the database or memory state is updated. On state-write failure the new object is removed. After success, the temp object and any replaced finalized object are removed.

Motorcycle finalization rejects a sixth active photo. Reordering updates only positions; replacement and deletion clean up superseded private objects.

### Delivery flow

`GET /media/[mediaId]` resolves the opaque media ID through the backend, applies the same profile/viewer authorization used by `MemberProfileView`, reads the private object, and streams `image/webp` with `Cache-Control: private, no-store`. It never redirects to or serializes a raw S3 URL. The in-memory backend uses the same media service contract with a deterministic test store.

## App Router and Action Boundaries

- Dynamic page and media route `params` are awaited, matching Next.js 16.2.9.
- Profile and attendee queries execute on the server and pass only sanitized DTOs to client components.
- Server actions re-check authentication and authorization even when the control is rendered only to an authorized account.
- Presigned upload and media delivery use Node.js Vercel Functions/Fluid Compute, not Edge runtime, because the AWS SDK and `sharp` require the Node.js runtime.
- Route handlers are dynamic and uncached where they inspect cookies, request data, or database state.

## Interface Design

Keep Tambike's existing Geist typography and token palette: asphalt `#050506`, concrete `#f7f4ef`, signal `#ffbe45`, chrome `#d7dee2`, fuel `#20b26b`, and brake `#e63b2e`. Do not introduce a global theme change.

The profile signature is a **garage card**: an avatar identity plate leads into one wide motorcycle image, descriptive specification labels, and an ordered five-frame contact strip. It should read like a rider's carefully kept garage card, not a social feed. Supporting forms and organizer controls use the existing shadcn/Radix Nova primitives, density, focus rings, and spacing.

- `/riders/[slug]`: identity plate, visibility-appropriate profile story, one motorcycle showcase, and hosted-event count for organizers.
- `/profile`: tabs or clear sections for identity, roster default, avatar, motorcycle details, and ordered photos; explicit save/publish language and accessible upload progress/errors.
- `/events/[eventId]/attendees`: count-led header, visible garage-card excerpts, one anonymous aggregate card, login gate when enabled for guests, and clear counts-only state when disabled.
- Organizer attendees: existing metrics plus roster on/off control, audit-oriented explanatory copy, visible/anonymous totals, and the sanitized roster list.
- RSVP: a plain visible/anonymous radio choice that explains private profiles are always anonymous. Existing RSVP identity is edited separately from the saved default.

All layouts support mobile, keyboard navigation, visible focus, labeled form controls, `aria-live` errors/status, reduced motion, and non-color status cues.

## Sample Rider

Create `scripts/provision-sample-rider.ts` as an idempotent, production-safe command. It requires an explicit production confirmation flag, the sample password through an environment variable, and the six generated image paths through arguments or a manifest. It never invokes the general Prisma seed.

Each run upserts exactly one normal rider named `Mika Santos — Sample Rider`, one public profile with visible default, one motorcycle, one avatar, five ordered photos, one Going RSVP for `tambike-cafe-classico`, and one active pass. It uses the same image normalization/storage, profile, RSVP, roster, and pass code paths as real users. Repeated runs preserve the same account/profile and replace only drifted sample assets or fields.

## Infrastructure and Release

Commit a parameterized CloudFormation template and deployment guide for the bucket, lifecycle, CORS, Vercel OIDC provider/role, and least-privilege object permissions. Accept an existing OIDC provider ARN to avoid duplicating a provider already shared in the AWS account.

Install the Vercel CLI with `npm i -g vercel` before any environment, preview, deployment, or log operation. Confirm the linked project and current team/project slugs before applying the trust policy. Branch tests and preview/browser acceptance must pass before AWS provisioning or the additive production migration.

Merge only by the approved fast-forward sequence into local `main`, rerun all required tests and Codex-browser smoke on the merged tree, and push directly to `origin/main` only with a clean working tree and all checks passing. If post-push production verification fails, create and test a normal revert commit; never rewrite published `main`.

## Error Handling

Use stable backend error codes for unauthenticated, forbidden, not found, invalid cursor, invalid image, expired upload, ownership mismatch, photo limit, and media unavailable. Public routes collapse forbidden/private/unpublished profile lookups to a non-enumerating not-found response where appropriate. Upload errors tell the member which file constraint failed without returning keys, bucket names, stack traces, or authorization details.

## Verification

- Test-first server coverage for schema contracts, migration backfill, profile visibility, publication/slug stability, sanitized DTOs, admin-only user lists, roster ownership, precedence, defaults and overrides, cursor pagination, and audit records.
- Test-first media coverage for auth, five-minute expiry, user-key ownership, MIME/signature mismatch, malformed and oversized files, SVG/GIF rejection, dimensions, EXIF/GPS removal, five-photo cap, transactional cleanup, and private-object delivery.
- Guarded Prisma integration tests against an explicit loopback `tambike_test_*` database.
- Real S3 smoke only against a non-production prefix and bucket configuration.
- Sample provisioner idempotency proves exactly one rider, motorcycle, avatar, five photos, RSVP, and pass across repeated runs.
- Run `npm run test:server`, guarded Prisma integration tests, real S3 smoke, `npm run lint`, `npm run build`, and `git diff --check` before merge.
- Use only the Codex browser for guest/public/member/private profiles, roster on/off, anonymous/visible attendees, uploads, defaults and per-event overrides, mobile layouts, keyboard access, and the production sample flow.

