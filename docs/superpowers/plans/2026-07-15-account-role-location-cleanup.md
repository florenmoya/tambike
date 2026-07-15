# Account, Role, and Event Location Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Tambike's venue-account and organizer-onboarding systems, retain one organizer at `organizer@bayanko.ph`, move every event to immutable event-owned location fields, and delete only the explicitly identified demo/generated accounts while preserving the real rider and event history.

**Architecture:** Keep the existing server-authoritative in-memory and Prisma backends, but reduce their public model to rider, organizer, and admin. A shared location normalizer defines the input boundary. A guarded PostgreSQL migration snapshots venue data onto events, reassigns all events to the canonical organizer, validates immutable history, and only then removes accounts, relations, tables, and enum values. Test-only riders and passes move into explicit fixtures; no production seed account is used for automated coverage.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Prisma 7.8, PostgreSQL 17, Vitest, Tailwind CSS, and the Codex in-app browser for browser acceptance.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-07-15-account-role-location-cleanup-design.md`.
- Before editing a Next.js route, form action, or browser boundary, re-read the applicable guide under `node_modules/next/dist/docs/`; route `params` remain awaited in Next.js 16.
- Work on `codex/simplify-accounts-locations`; preserve unrelated user changes and inspect `git diff` before every commit.
- Use test-driven development: add the named failing assertion, run it and observe the expected failure, implement the smallest coherent production change, then rerun it.
- Treat `user-marco-organizer` and `user-marco-organizer-profile` as stable primary keys. Change identity fields, never recreate the canonical record.
- Canonical display fields are `Tambike Organizer`: update `User.displayName`, `User.clubName`, `OrganizerProfile.displayName`, `OrganizerProfile.realName`, and `OrganizerProfile.clubPageName`.
- Location limits are fixed: name 120, address 240, optional map link 500, and area 120 characters. Only HTTP and HTTPS map URLs are valid.
- Never run `npm run db:seed` against the configured/live database. Seed execution is allowed only against the loopback `tambike_test_*` database protected by the Prisma integration harness.
- Never point Prisma integration commands at `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_DATABASE_URL`, or `SHADOW_DATABASE_URL`; the existing harness must receive an explicit loopback `TAMBIKE_TEST_DATABASE_URL`.
- Use the Codex browser for browser acceptance. Do not run Playwright or any other browser driver. Reuse an existing dev server when one is already listening.
- Do not deploy the live migration until Prisma generation, targeted tests, the full server suite, the disposable Prisma suite, lint, and build all pass.
- Do not expose passwords, hashes, session tokens, raffle seeds, or rider PII in test output, audit output, commits, or the final handoff.

---

### Task 1: Add the shared event-location boundary

**Files:**

- Create: `src/features/tambike-demo/event-location.ts`
- Modify: `src/features/tambike-demo/types.ts`
- Create: `tests/server/event-location.test.ts`

**Interfaces:**

- Consumes raw form/server values for `locationName`, `locationAddress`, `locationMapLink`, and `area`.
- Produces a trimmed `EventLocationInput` or `null`; it does not throw backend-specific errors.
- Exports one limits object used by server validation, HTML attributes, tests, and the migration contract.

- [ ] **Step 1: Add the failing normalization tests.**

  Cover trimming, an omitted/blank map link becoming `undefined`, exact boundary lengths, each over-limit field, empty required fields, malformed URLs, and non-HTTP protocols.

  ```ts
  expect(normalizeEventLocation({
    locationName: "  Shell Pugon  ",
    locationAddress: "  Antipolo, Rizal  ",
    locationMapLink: " https://maps.example.test/place ",
    area: " Antipolo ",
  })).toEqual({
    locationName: "Shell Pugon",
    locationAddress: "Antipolo, Rizal",
    locationMapLink: "https://maps.example.test/place",
    area: "Antipolo",
  });

  expect(normalizeEventLocation({
    locationName: "Place",
    locationAddress: "Address",
    locationMapLink: "javascript:alert(1)",
    area: "Area",
  })).toBeNull();
  ```

- [ ] **Step 2: Run the new test and confirm it fails because the module/exports do not exist.**

  Run: `npx vitest run tests/server/event-location.test.ts`

  Expected: FAIL with an unresolved `event-location` module or missing exports.

- [ ] **Step 3: Add the additive location contracts.**

  Add to `types.ts` without removing the old venue fields yet:

  ```ts
  export interface EventLocationInput {
    locationName: string;
    locationAddress: string;
    locationMapLink?: string;
    area: string;
  }
  ```

  Implement in `event-location.ts`:

  ```ts
  export const EVENT_LOCATION_LIMITS = {
    name: 120,
    address: 240,
    mapLink: 500,
    area: 120,
  } as const;

  export type RawEventLocationInput = {
    locationName?: unknown;
    locationAddress?: unknown;
    locationMapLink?: unknown;
    area?: unknown;
  };

  export function normalizeEventLocation(
    input: RawEventLocationInput,
  ): EventLocationInput | null;
  ```

  Require a nonempty hostname after `new URL(mapLink)`, accept only `http:` or `https:`, and return `undefined` for a blank optional link.

- [ ] **Step 4: Rerun the targeted test.**

  Run: `npx vitest run tests/server/event-location.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the additive boundary.**

  ```powershell
  git add src/features/tambike-demo/event-location.ts src/features/tambike-demo/types.ts tests/server/event-location.test.ts
  git diff --cached --check
  git commit -m "feat: add event location validation"
  ```

---

### Task 2: Collapse the in-memory domain to one organizer and explicit test fixtures

**Files:**

- Modify: `src/features/tambike-demo/types.ts`
- Modify: `src/features/tambike-demo/data.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/actions.ts`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Create: `tests/server/support/tambike-fixtures.ts`
- Modify: `tests/server/backend-domain.test.ts`

**Interfaces:**

- `Role` becomes `guest | rider | organizer | admin`; `AccountRole` remains `Exclude<Role, "guest">`.
- `Event` and `CreateEventInput` extend `EventLocationInput`; neither exposes `venueId`.
- The runtime in-memory seed contains only the canonical organizer and admin as users, 25 event records, no RSVP/pass rows, and no organizer verification records.
- Test-only users, RSVP rows, and pass rows enter through `TambikeTestSeedOptions.fixture`; runtime construction never supplies that option.

- [ ] **Step 1: Replace backend-domain expectations before production edits.**

  Remove organizer-application/admin-created-organizer tests and add assertions that:

  - the anonymous snapshot exposes exactly `organizer@bayanko.ph` and `admin@bayanko.ph` as seeded users;
  - all 25 events use `user-marco-organizer-profile` and contain valid location snapshots;
  - no Mina, Ana, scan rider, venue role, or generated organizer email exists;
  - an approved organizer creates an arbitrary-location event directly in `PENDING_ADMIN_REVIEW`;
  - a rider cannot create an event;
  - blank/over-limit/unsafe location input returns `INVALID_INPUT`;
  - admin publication works without a venue approval transition.

  Use the canonical constants instead of searching for Marco or ARAI profile names.

- [ ] **Step 2: Add a reusable fixture helper contract.**

  In `tests/server/support/tambike-fixtures.ts`, define:

  ```ts
  export type AuthenticatedFixture = {
    user: UserProfile;
    sessionToken: string;
  };

  export type TestActors = {
    admin: AuthenticatedFixture;
    organizer: AuthenticatedFixture;
    rider: AuthenticatedFixture;
    outsider: AuthenticatedFixture;
  };

  export async function createTestActors(
    backend: TambikeBackend,
    namespace: string,
  ): Promise<TestActors>;

  export async function createPublishedTestEvent(
    backend: TambikeBackend,
    actors: Pick<TestActors, "admin" | "organizer">,
    overrides?: Partial<CreateEventInput>,
  ): Promise<Event>;

  export async function registerTestPass(
    backend: TambikeBackend,
    rider: AuthenticatedFixture,
    eventId: string,
  ): Promise<Pass>;
  ```

  `createTestActors` logs in the core organizer/admin and creates rider/outsider accounts through `signUpRider`; it must generate namespace-specific emails and never use Floren.

- [ ] **Step 3: Run the backend-domain test and observe the old seed/workflow failures.**

  Run: `npx vitest run tests/server/backend-domain.test.ts`

  Expected: FAIL because the old snapshot contains venue/demo users and event creation still requires `venueId` and venue approval.

- [ ] **Step 4: Replace the public TypeScript contracts.**

  In `types.ts`:

  ```ts
  export type Role = "guest" | "rider" | "organizer" | "admin";

  export type EventStatus =
    | "DRAFT"
    | "PENDING_ADMIN_REVIEW"
    | "PUBLISHED"
    | "ONGOING"
    | "COMPLETED"
    | "NEEDS_CHANGES"
    | "REJECTED"
    | "CANCELLED";

  export interface CreateEventInput extends EventLocationInput {
    title: string;
    type: EventType;
    date: string;
    time: string;
    expectedRiders: number;
    perkPreview: string;
  }
  ```

  Make `Event` extend `EventLocationInput`. Delete `Venue`, `UserProfile.venueId`, `Approval.type`, `OrganizerApplicationInput`, `AdminCreateOrganizerInput`, and `OrganizerVerificationRecord`.

- [ ] **Step 5: Convert static content to frozen locations and the canonical organizer.**

  In `data.ts`:

  - delete `venues`, `getVenue`, and `venueApproval`;
  - export `TAMBIKE_ORGANIZER_USER_ID = "user-marco-organizer"` and `TAMBIKE_ORGANIZER_PROFILE_ID = "user-marco-organizer-profile"`;
  - replace `organizers` with one `Tambike Organizer` profile using the canonical profile ID;
  - rename `mockUsers` to `seedUsers` and keep only the canonical organizer and existing admin;
  - set the organizer email to `organizer@bayanko.ph`, profile ID to the canonical profile ID, and display/club values to `Tambike Organizer`;
  - inline the current venue name, address, map link, and area on each of the 25 events before deleting the directory;
  - reassign every event to `user-marco-organizer-profile`;
  - convert the static event in `PENDING_VENUE_APPROVAL` to `PENDING_ADMIN_REVIEW`;
  - replace operational phrases such as `Respect venue staff` with `Respect event staff`, while preserving natural location descriptions where they remain accurate.

- [ ] **Step 6: Remove onboarding and venue approval from the in-memory backend.**

  In `backend.ts`:

  - remove `VENUE_APPROVED`, the demo scanner pass, the `BackendSeed.organizerVerifications` field, organizer-verification storage/cloning/validation, `reservedUserEmails`, and the methods `applyAsOrganizer`, `reviewOrganizerApplication`, `createOrganizerForAdmin`, and `listOrganizerVerifications`;
  - make `createSeed` load `seedUsers`, all 25 canonical events, and empty RSVP/pass collections;
  - add `TambikeTestFixture` with optional `users`, `rsvps`, and `passes`, and let `resetTambikeBackendForTests(options)` forward the complete `TambikeTestSeedOptions`;
  - hash each fixture user's supplied test password inside `createSeed` rather than accepting a hash;
  - normalize event location, validate existing required event fields, set `organizerId` from the authenticated approved organizer's profile (the only production value is the canonical profile), and create in `PENDING_ADMIN_REVIEW`;
  - delete `approveVenueWithConditions` and make `approvePublish` accept `PENDING_ADMIN_REVIEW` directly;
  - change default rule copy to `Respect event staff`.

  The test seam is:

  ```ts
  export type TambikeTestFixture = {
    users?: Array<UserProfile & { password: string }>;
    rsvps?: Array<RSVP & { userId: string; goingAt?: string }>;
    passes?: Array<Pass & { userId: string }>;
  };

  export type TambikeTestSeedOptions = {
    fixture?: TambikeTestFixture;
    perkQuantities?: Record<string, number>;
    generateGiveawayDrawSeed?: () => Uint8Array;
    generateGiveawayUuid?: () => string;
  };
  ```

- [ ] **Step 7: Remove the obsolete action/provider state.**

  Delete `approveVenueWithConditionsAction`, its provider import/callback, `venueConditions`, `venueDecision`, and the related context members. Keep `approvePublishAction` as the sole event-review transition.

- [ ] **Step 8: Implement the fixture helper and rerun the domain tests.**

  Run:

  ```powershell
  npx vitest run tests/server/event-location.test.ts tests/server/backend-domain.test.ts
  ```

  Expected: PASS. No test logs or snapshots contain passwords or tokens.

- [ ] **Step 9: Commit the in-memory domain collapse.**

  ```powershell
  git add src/features/tambike-demo/types.ts src/features/tambike-demo/data.ts src/server/backend.ts src/server/actions.ts src/features/tambike-demo/demo-provider.tsx tests/server/support/tambike-fixtures.ts tests/server/backend-domain.test.ts
  git diff --cached --check
  git commit -m "refactor: simplify Tambike account domain"
  ```

---

### Task 3: Move check-in and giveaway operations to organizer/admin fixtures

**Files:**

- Modify: `src/server/backend.ts`
- Modify: `src/server/actions.ts`
- Modify: `src/features/check-in/check-in-policy-panel.tsx`
- Modify: `src/features/giveaways/public-giveaway-panel.tsx`
- Modify: `src/features/giveaways/giveaway-operator-workspace.tsx`
- Modify: `src/app/giveaway-ops/[eventId]/page.tsx`
- Modify: `tests/server/check-in-policy.test.ts`
- Modify: `tests/server/giveaway-claims-domain.test.ts`
- Modify: `tests/server/giveaway-domain.test.ts`
- Modify: `tests/server/giveaway-lifecycle-api.test.ts`
- Modify: `tests/server/giveaway-live-presentation-contract.test.ts`
- Modify: `tests/server/giveaway-report-notifications.test.ts`
- Modify: `tests/server/giveaway-ui-data-contract.test.ts`
- Modify: `tests/server/organizer-giveaway-presentation.test.ts`
- Modify: `tests/server/organizer-giveaway-workspace.test.ts`

**Authorization contract:**

1. Admin may scan and operate claims.
2. The approved organizer whose `organizerProfileId` matches `event.organizerId` may scan and operate claims.
3. An active explicit `GiveawayOperator` may verify/fulfil only its assigned campaign.
4. Riders, unrelated organizers, and revoked operators are forbidden.

- [ ] **Step 1: Migrate test setup to `createTestActors`, `createPublishedTestEvent`, and `registerTestPass`.**

  Remove all logins/lookups for Mina, Ana, or the seeded scan rider. Replace every `venueId` event input and `approveVenueWithConditions` call with an explicit location plus direct admin publication.

- [ ] **Step 2: Reverse the claim-authorization assertions before implementation.**

  In `giveaway-claims-domain.test.ts`, replace the old “organizer forbidden, venue owner allowed” case with:

  ```ts
  await expect(
    backend.getGiveawayClaimQueue(actors.organizer.sessionToken, giveaway.id),
  ).resolves.toBeDefined();

  await expect(
    backend.getGiveawayClaimQueue(actors.outsider.sessionToken, giveaway.id),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  ```

  Add an injected unrelated organizer fixture, plus explicit-operator grant and revoke assertions, so ownership is not accidentally replaced with a broad organizer-role permission.

- [ ] **Step 3: Run the affected tests and observe the old venue authorization/fixture failures.**

  Run:

  ```powershell
  npx vitest run tests/server/check-in-policy.test.ts tests/server/giveaway-claims-domain.test.ts tests/server/giveaway-domain.test.ts tests/server/giveaway-lifecycle-api.test.ts tests/server/giveaway-live-presentation-contract.test.ts tests/server/giveaway-report-notifications.test.ts tests/server/giveaway-ui-data-contract.test.ts tests/server/organizer-giveaway-presentation.test.ts tests/server/organizer-giveaway-workspace.test.ts
  ```

  Expected: FAIL in venue-owner assumptions and removed seeded identities.

- [ ] **Step 4: Implement the new in-memory authorization.**

  `requireCheckInStaff(user, event)` accepts only admin or the approved owning organizer. `requireGiveawayOperator(user, event, giveaway)` checks admin, then owning approved organizer, then an active explicit assignment. Remove every `user.venueId === event.venueId` branch.

- [ ] **Step 5: Update operational copy and links.**

  - `staff_only` says organizer/admin staff.
  - Scanner success/error copy in `src/server/actions.ts` names organizer/admin staff and never a venue account.
  - The public giveaway viewer role union removes `venue`.
  - The generic operator workspace has no `/venue/**` back link; organizers go back to their organizer event/giveaway workspace.
  - The giveaway operations page comment describes organizer/admin/assigned-operator access.

- [ ] **Step 6: Rerun the affected test set.**

  Run the command from Step 3.

  Expected: PASS, including explicit operator revocation and unchanged raffle winner-selection behavior.

- [ ] **Step 7: Commit the operations authorization change.**

  ```powershell
  git add src/server/backend.ts src/server/actions.ts src/features/check-in/check-in-policy-panel.tsx src/features/giveaways/public-giveaway-panel.tsx src/features/giveaways/giveaway-operator-workspace.tsx src/app/giveaway-ops/[eventId]/page.tsx tests/server/check-in-policy.test.ts tests/server/giveaway-claims-domain.test.ts tests/server/giveaway-domain.test.ts tests/server/giveaway-lifecycle-api.test.ts tests/server/giveaway-live-presentation-contract.test.ts tests/server/giveaway-report-notifications.test.ts tests/server/giveaway-ui-data-contract.test.ts tests/server/organizer-giveaway-presentation.test.ts tests/server/organizer-giveaway-workspace.test.ts
  git diff --cached --check
  git commit -m "refactor: move event operations to organizers"
  ```

---

### Task 4: Add the guarded account/location database migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260715120000_simplify_accounts_and_locations/migration.sql`
- Create: `tests/server/account-role-location-schema-contract.test.ts`
- Create: `tests/prisma-integration/account-role-location-migration.integration.test.ts`

**Schema result:**

- `Role` contains `rider`, `organizer`, and `admin` only.
- `EventStatus` has no `PENDING_VENUE_APPROVAL`.
- `ApprovalType` and `EventApproval.approvalType` are gone.
- `Venue`, `User.ownedVenues`, `Event.venueId`, and `Event.venue` are gone.
- `Event.locationName @db.VarChar(120)`, `locationAddress @db.VarChar(240)`, optional `locationMapLink @db.VarChar(500)`, and `area @db.VarChar(120)` are persisted.
- `CheckIn.scanner` uses `onDelete: SetNull`.

- [ ] **Step 1: Add a failing generated-schema contract.**

  Assert against `Prisma.dmmf` and migration text that:

  - generated enums exclude `venue` and `PENDING_VENUE_APPROVAL`;
  - DMMF has no `Venue`, `ownedVenues`, `venueId`, or `approvalType`;
  - location fields have the intended requiredness/native lengths;
  - the migration contains `BEGIN`, timeouts, an empty-install branch, the exact allowlist, immutable-history guards, enum replacements, `SET NULL`, postconditions, and `COMMIT`.

- [ ] **Step 2: Add failing disposable migration tests.**

  Use `pg.Client` with the explicit harness URL. For each case, create a unique quoted schema, `SET search_path` to that schema, apply every migration before `20260715120000_simplify_accounts_and_locations`, then apply the new migration. Always drop the schema in `finally`.

  Cases:

  1. empty legacy tables migrate successfully without a canonical account;
  2. representative legacy data backfills location text, reassigns every event, converts status, renames the organizer, deletes only known demo accounts, nulls an audit actor/scanner, and preserves a Floren RSVP/pass;
  3. an unexpected organizer aborts atomically;
  4. a case-insensitive `organizer@bayanko.ph` conflict aborts atomically;
  5. a blank/invalid venue snapshot aborts atomically;
  6. any removable user referenced by immutable giveaway history aborts atomically.

  After each expected failure, assert that the legacy `Venue`, old role/status values, and original account rows are still present, proving rollback.

- [ ] **Step 3: Run the new contracts and confirm they fail against the old schema/missing migration.**

  Run:

  ```powershell
  npx vitest run tests/server/account-role-location-schema-contract.test.ts
  npm run test:prisma:prepare
  npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/account-role-location-migration.integration.test.ts
  ```

  Expected: the server contract fails first because the schema still has venue; the integration test fails because the new migration is absent.

- [ ] **Step 4: Update the Prisma schema.**

  Remove the objects listed under “Schema result,” add the four event location native types, and change the scanner relation:

  ```prisma
  scanner User? @relation("ScannerUser", fields: [scannedBy], references: [id], onDelete: SetNull)
  ```

- [ ] **Step 5: Start the SQL migration with explicit transaction/timeout protection.**

  ```sql
  BEGIN;
  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '60s';

  CREATE TEMP TABLE "_AccountCleanupOrganizerAllowlist" (
    "userId" text PRIMARY KEY,
    "profileId" text UNIQUE NOT NULL,
    "email" text UNIQUE NOT NULL
  ) ON COMMIT DROP;
  ```

  Insert these exact 20 generated tuples; never delete by domain wildcard:

  ```text
  user-cafe-classico | cafe-classico | cafe-classico@seed.tambike.local
  user-arai-hjc-riders | arai-hjc-riders | arai-hjc-riders@seed.tambike.local
  user-ducati-access-plus | ducati-access-plus | ducati-access-plus@seed.tambike.local
  user-republik-riders | republik-riders | republik-riders@seed.tambike.local
  user-mandirigma-endutour | mandirigma-endutour | mandirigma-endutour@seed.tambike.local
  user-motoir-ph | motoir-ph | motoir-ph@seed.tambike.local
  user-makina-moto | makina-moto | makina-moto@seed.tambike.local
  user-dsboys-tambike | dsboys-tambike | dsboys-tambike@seed.tambike.local
  user-boys-underbone-laguna | boys-underbone-laguna | boys-underbone-laguna@seed.tambike.local
  user-swabz-classic-motoparts | swabz-classic-motoparts | swabz-classic-motoparts@seed.tambike.local
  user-yloco-bandits | yloco-bandits | yloco-bandits@seed.tambike.local
  user-motor-ace-bmw | motor-ace-bmw | motor-ace-bmw@seed.tambike.local
  user-fullprint-manila | fullprint-manila | fullprint-manila@seed.tambike.local
  user-boys-of-garage | boys-of-garage | boys-of-garage@seed.tambike.local
  user-ccph-upper-east | ccph-upper-east | ccph-upper-east@seed.tambike.local
  user-ccph-cebu | ccph-cebu | ccph-cebu@seed.tambike.local
  user-antipolo-endurance-challenge | antipolo-endurance-challenge | antipolo-endurance-challenge@seed.tambike.local
  user-laguna-moto-fest | laguna-moto-fest | laguna-moto-fest@seed.tambike.local
  user-ngo-philippines | ngo-philippines | ngo-philippines@seed.tambike.local
  user-mindanao-wide-motocross | mindanao-wide-motocross | mindanao-wide-motocross@seed.tambike.local
  ```

- [ ] **Step 6: Implement preflight and immutable-history guards before any destructive statement.**

  Compute `empty_install` from `User`, `OrganizerProfile`, `Event`, and `Venue` counts. If all are empty, skip identity/data assertions but still perform schema changes. Otherwise use `DO $$ ... RAISE EXCEPTION ... $$` blocks to assert:

  - canonical user/profile ownership, organizer role, and target-email availability case-insensitively;
  - exact match between every noncanonical organizer and the allowlist;
  - exact ID/email/role match for optional Mina (`user-mina-rider`), scan rider (`user-demo-scan-rider`), and Ana (`user-ana-venue`), with no other venue user;
  - every event joins a venue and all trimmed snapshot values meet the limits/protocol;
  - removable users have no reference in the following restricted columns:
    `EventGiveaway.creatorUserId`, `organizerAttestedById`, `complianceReviewerId`, `suspendedByUserId`; `GiveawayMechanicsVersion.createdByUserId`, `reviewedByUserId`; `GiveawayCampaignCode.createdByUserId`, `revokedByUserId`; `GiveawayEntry.riderId`; `GiveawayCampaignCodeClaim.riderId`; `GiveawayEntryEvent.actorUserId`; `GiveawaySnapshot.lockedByUserId`; `GiveawayDraw.initiatedByUserId`; `GiveawayAward.winnerUserId`; `GiveawayClaimVerification.operatorActorUserId`; `GiveawayFulfillment.operatorActorUserId`; `GiveawayDeliveryDetail.submittedByUserId`; all three `GiveawayOperator` user columns; and `GiveawayAuditEvent.actorUserId`;
  - a removable reviewer is not referenced by a surviving admin `EventApproval`.

  Do not use unsupported `ADD CONSTRAINT IF NOT EXISTS` syntax.

- [ ] **Step 7: Implement the data-preserving mutation order.**

  1. Add nullable location columns and backfill from `Venue` with `btrim`/`NULLIF`.
  2. Update the canonical user email and all five display fields to `Tambike Organizer`.
  3. Reassign every event to `user-marco-organizer-profile`.
  4. Convert `PENDING_VENUE_APPROVAL` to `PENDING_ADMIN_REVIEW` and delete venue approval rows.
  5. Drop/recreate the scanner FK as `ON DELETE SET NULL` before account deletion.
  6. Delete only the 20 allowlisted generated users plus the three exact optional demo users.
  7. Add `NOT NULL`, native lengths, trimmed-value checks, and the HTTP/HTTPS map-link check.
  8. Drop `Event_venueId_fkey`, `venueId`, and `Venue`.
  9. Drop `EventApproval.approvalType`, then drop `ApprovalType`.
  10. Rebuild `Role` and `EventStatus` by renaming the old type, creating the reduced type, dropping defaults, casting through text, restoring defaults, and dropping the old type.

- [ ] **Step 8: Add SQL postconditions before `COMMIT`.**

  On nonempty legacy data, assert one organizer user/profile, all events owned by the canonical profile, no allowlisted/demo accounts, no removed role/status values, and valid location snapshots. Record baseline Floren/event counts at the start in temporary storage and assert those counts are unchanged at the end.

- [ ] **Step 9: Generate Prisma and rerun migration tests.**

  Run:

  ```powershell
  npm run db:generate
  npx vitest run tests/server/account-role-location-schema-contract.test.ts
  npm run test:prisma:prepare
  npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/account-role-location-migration.integration.test.ts
  ```

  Expected: PASS for the empty, happy, rejection, and rollback cases.

- [ ] **Step 10: Inspect the destructive diff and commit the migration separately.**

  ```powershell
  git diff -- prisma/schema.prisma prisma/migrations/20260715120000_simplify_accounts_and_locations/migration.sql
  git add prisma/schema.prisma prisma/migrations/20260715120000_simplify_accounts_and_locations/migration.sql tests/server/account-role-location-schema-contract.test.ts tests/prisma-integration/account-role-location-migration.integration.test.ts
  git diff --cached --check
  git commit -m "feat: migrate events away from venue accounts"
  ```

---

### Task 5: Bring the Prisma backend, seed, and integration fixtures to parity

**Files:**

- Modify: `src/server/prisma-backend.ts`
- Modify: `prisma/seed.ts`
- Create: `tests/prisma-integration/fixtures.ts`
- Create: `tests/prisma-integration/event-location.integration.test.ts`
- Create: `tests/prisma-integration/seed-policy.integration.test.ts`
- Modify: `tests/prisma-integration/giveaway-draw.integration.test.ts`
- Modify: `tests/prisma-integration/giveaway-live-presentation.integration.test.ts`
- Modify: `tests/server/prisma-giveaway-lifecycle-contract.test.ts`
- Modify: `tests/server/prisma-giveaway-perk-contract.test.ts`

**Interfaces:**

- `PrismaEventRecord` has `locationName`, `locationAddress`, and nullable `locationMapLink`, with no venue relation.
- Prisma event creation uses the same `normalizeEventLocation` boundary as the in-memory backend.
- `createPrismaEventFixture` owns all test users/events/passes it creates and uses unique suffixes.
- The normal seed creates two accounts (organizer/admin), 25 canonical events, and zero venue/demo/scanner/generated-owner rows.

- [ ] **Step 1: Add the failing arbitrary-location integration test and seed policy assertions.**

  `event-location.integration.test.ts` creates an organizer/admin/rider fixture, creates and publishes an event with a unique location, reloads it through `PrismaTambikeBackend`, and checks the exact trimmed round trip.

  `seed-policy.integration.test.ts` runs only on the disposable database and asserts:

  ```ts
  expect(await prisma.user.count({ where: { role: "organizer" } })).toBe(1);
  expect(await prisma.user.count({ where: { email: { endsWith: "@seed.tambike.local" } } })).toBe(0);
  expect(await prisma.user.findMany({ where: {
    email: { in: ["mina.rider@example.com", "scan-rider@seed.tambike.local", "ana.venue@example.com"] },
  } })).toEqual([]);
  expect(await prisma.event.count()).toBe(25);
  ```

  Also assert all events use the canonical profile and have nonblank location snapshots.

- [ ] **Step 2: Run targeted tests and observe old Prisma mapping/seed failures.**

  Run:

  ```powershell
  npx vitest run tests/server/prisma-giveaway-lifecycle-contract.test.ts tests/server/prisma-giveaway-perk-contract.test.ts
  npm run test:prisma:prepare
  npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/event-location.integration.test.ts tests/prisma-integration/seed-policy.integration.test.ts
  ```

  Expected: FAIL on venue includes/mapping and old seed identities.

- [ ] **Step 3: Update Prisma record shapes and includes.**

  In `prisma-backend.ts`:

  - remove `PrismaEventRecord.venueId`, `PrismaUserRecord.ownedVenues`, the static `venues` import, and every `ownedVenues` include;
  - remove venue from `giveawayConfigurationInclude`, check-in event loading, and self-check-in QR resolution;
  - map location fields directly in `toEvent`; never fall back to a static directory;
  - remove `toUserProfile().venueId`;
  - normalize location and create events in `PENDING_ADMIN_REVIEW`;
  - delete `approveVenueWithConditions`;
  - make `approvePublish` use an event-specific approval ID such as `admin-review-${eventId}` and remove `approvalType` writes;
  - allow the approved owning organizer in `requireCheckInStaff` and `requireGiveawayOperator`, preserve admin/explicit assignment behavior, and remove venue-owner behavior.

- [ ] **Step 4: Add explicit Prisma fixture builders.**

  Implement:

  ```ts
  export async function createPrismaEventFixture(
    prisma: PrismaClient,
    options?: {
      suffix?: string;
      riderCount?: number;
      location?: EventLocationInput;
    },
  ): Promise<{
    eventId: string;
    organizerId: string;
    organizerProfileId: string;
    organizerSession: string;
    adminId: string;
    adminSession: string;
    riders: Array<{ userId: string; sessionToken: string; passId?: string }>;
  }>;
  ```

  Update both existing giveaway integration files to use it; remove direct Venue creation and any seeded identity dependency.

- [ ] **Step 5: Simplify the production seed.**

  In `prisma/seed.ts`:

  - remove `randomUUID`, the internal generated-owner hash, venue imports/loops, generated organizer loops, Mina/Ana/scan rider creation, deterministic RSVP/pass creation, and venue deletion/approval rows;
  - create/upsert only the canonical organizer/profile and admin;
  - write each of the 25 event location snapshots and the canonical organizer ID;
  - retain the refusal guard when giveaway or giveaway-audit history exists;
  - structure the seed so the integration test calls it only with the explicitly protected disposable client; do not permit silent fallback to the application database.

- [ ] **Step 6: Update source-slicing contract boundaries.**

  In `prisma-giveaway-lifecycle-contract.test.ts`, replace the boundary anchored on `approveVenueWithConditions` with `approvePublish`, and assert the source has no `.venue`, `ownedVenues`, or venue-owner authorization branch.

- [ ] **Step 7: Regenerate and run the targeted Prisma set.**

  Run:

  ```powershell
  npm run db:generate
  npx vitest run tests/server/prisma-giveaway-lifecycle-contract.test.ts tests/server/prisma-giveaway-perk-contract.test.ts
  npm run test:prisma:prepare
  npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/event-location.integration.test.ts tests/prisma-integration/seed-policy.integration.test.ts tests/prisma-integration/giveaway-draw.integration.test.ts tests/prisma-integration/giveaway-live-presentation.integration.test.ts
  ```

  Expected: PASS. The seed-policy test must report only disposable database coordinates if it reports any coordinates at all.

- [ ] **Step 8: Commit Prisma parity.**

  ```powershell
  git add src/server/prisma-backend.ts prisma/seed.ts tests/prisma-integration/fixtures.ts tests/prisma-integration/event-location.integration.test.ts tests/prisma-integration/seed-policy.integration.test.ts tests/prisma-integration/giveaway-draw.integration.test.ts tests/prisma-integration/giveaway-live-presentation.integration.test.ts tests/server/prisma-giveaway-lifecycle-contract.test.ts tests/server/prisma-giveaway-perk-contract.test.ts
  git diff --cached --check
  git commit -m "refactor: simplify Prisma event ownership"
  ```

---

### Task 6: Replace venue selection with event-owned location UI

**Files:**

- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/tambike-demo/event-state.ts`
- Modify: `src/components/file-upload-06.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/server/organizer-giveaway-workspace.test.ts`
- Create: `tests/server/account-role-location-ui-contract.test.ts`

**UI contract:**

- Organizer create uses required location name/address/area and optional URL map link.
- Organizer/admin/public/pass views read the event snapshot; no mutable venue lookup remains.
- All existing events appear under the canonical organizer.
- Map actions render only when a map link exists.

- [ ] **Step 1: Add failing UI source/component contracts.**

  Assert that the organizer form has `name="locationName"`, `locationAddress`, `area`, and `locationMapLink`; contains no `name="venueId"`; uses the shared max lengths; and submits to direct admin review. Assert admin/public views use location fields, event search includes name/address, and the map link is conditional.

- [ ] **Step 2: Run the UI contract and observe failures on the venue selector/lookups.**

  Run: `npx vitest run tests/server/account-role-location-ui-contract.test.ts tests/server/organizer-giveaway-workspace.test.ts`

  Expected: FAIL because the old form and location renderers still call `getVenue`.

- [ ] **Step 3: Update organizer event creation and details.**

  In `organizer-console.tsx`:

  - replace the venue `<select>` with accessible fields and `maxLength` values from `EVENT_LOCATION_LIMITS`;
  - use `<input type="url">` for the optional map link;
  - send the four location values to `createEventDraft`;
  - describe the next state as direct admin review;
  - display name, address, area, and optional map action from the event;
  - rename `OrganizerEventRow.venue` and the table column to `location`;
  - remove `PENDING_VENUE_APPROVAL` badge/copy and `mockUsers` fallback;
  - filter by the authenticated organizer profile and add a visible claim-desk link to `/giveaway-ops/${event.id}`.

- [ ] **Step 4: Update admin event review and account summaries.**

  In `admin-console.tsx`:

  - remove venue imports/cards/counts, `UserRow.venueId`, venue status, and venue-owner validation copy;
  - rename event review `venue` fields/columns to `location`;
  - show the frozen location snapshot and optional map action in review detail;
  - change review copy to organizer → admin;
  - replace the Venue records summary card with Published events;
  - leave only rider, organizer, and admin in account labels/filters.

  Remove the venue-directory sample/upload language from `file-upload-06.tsx`.

- [ ] **Step 5: Update rider/public location surfaces.**

  In `tambike-screen.tsx` and `event-state.ts`:

  - replace `getVenue` in event detail/pass with the event snapshot;
  - show `Open map` only when `locationMapLink` exists;
  - remove the venue capacity note (it is not part of the event snapshot);
  - change `Go direct to venue` to `Go directly to the event location`;
  - search both `locationName` and `locationAddress`;
  - refer only to organizer/admin review in CTA state.

  Rename `.event-detail-venue-card` to `.event-detail-location-card` and delete orphaned venue-order CSS.

- [ ] **Step 6: Rerun the targeted UI tests.**

  Run: `npx vitest run tests/server/account-role-location-ui-contract.test.ts tests/server/organizer-giveaway-workspace.test.ts`

  Expected: PASS.

- [ ] **Step 7: Commit event-owned location UI.**

  ```powershell
  git add src/features/organizer/organizer-console.tsx src/features/admin/admin-console.tsx src/features/tambike-demo/tambike-screen.tsx src/features/tambike-demo/event-state.ts src/components/file-upload-06.tsx src/app/globals.css tests/server/account-role-location-ui-contract.test.ts tests/server/organizer-giveaway-workspace.test.ts
  git diff --cached --check
  git commit -m "feat: add organizer-defined event locations"
  ```

---

### Task 7: Delete venue and second-organizer routes and dormant surfaces

**Files:**

- Delete: `src/app/venue/dashboard/page.tsx`
- Delete: `src/app/venue/requests/page.tsx`
- Delete: `src/app/venue/requests/[requestId]/page.tsx`
- Delete: `src/app/venue/events/page.tsx`
- Delete: `src/app/venue/events/[eventId]/page.tsx`
- Delete: `src/app/venue/events/[eventId]/checkin/page.tsx`
- Delete: `src/app/venue/events/[eventId]/giveaways/page.tsx`
- Delete: `src/app/venue/events/[eventId]/report/page.tsx`
- Delete: `src/app/venue/reports/page.tsx`
- Delete: `src/features/venue/venue-console.tsx`
- Delete: `src/features/giveaways/venue-giveaway-queue.tsx`
- Delete: `src/app/organizer/apply/page.tsx`
- Delete: `src/app/admin/verifications/organizers/page.tsx`
- Delete: `src/app/admin/verifications/organizers/[organizerId]/page.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/site-header.tsx`
- Modify: `tests/server/giveaway-operations-routes.test.ts`
- Modify: `tests/server/login-page.test.ts`
- Modify: `tests/tambike-demo.spec.ts`
- Create: `tests/server/account-role-location-route-contract.test.ts`

**Route result:** `/venue/**`, `/organizer/apply`, and `/admin/verifications/organizers/**` have no page module and return the normal Next.js not-found response. No redirect hides their removal.

- [ ] **Step 1: Add the failing route/source contract.**

  Use `existsSync` to assert every deleted page/component path is absent. Scan active source for `/venue/`, `/organizer/apply`, `/admin/verifications/organizers`, `VenueConsole`, `VenueGiveawayQueue`, `organizer-apply`, and `admin-organizers`; allow only prose that describes a physical location, not a role/workspace/approval.

- [ ] **Step 2: Run the route contract and observe failures while files/links exist.**

  Run: `npx vitest run tests/server/account-role-location-route-contract.test.ts tests/server/giveaway-operations-routes.test.ts tests/server/login-page.test.ts`

  Expected: FAIL listing the venue/application/verification routes and navigation links.

- [ ] **Step 3: Delete the route/component files exactly as listed.**

  Do not replace them with redirects or custom pages. Next's file-system router should own the 404 behavior.

- [ ] **Step 4: Prune dormant screen variants and navigation.**

  In `tambike-screen.tsx`, remove:

  - venue role labels, destinations, footer links, permissions, protected views, and all venue-only view components;
  - `organizer-apply`, its “Host an Event” links, and rider-upgrade copy;
  - every dormant organizer/admin `TambikeView` variant and its component/render/protection branch (`organizer-dashboard`, `organizer-events`, `organizer-create`, `organizer-event`, `organizer-attendees`, `organizer-scanner`, `organizer-report`, `organizer-reports`, `admin-dashboard`, `admin-organizers`, `admin-event-reviews`, `admin-event-review`, `admin-moderation`, `admin-users`, `admin-leads`, `admin-reports`, and `admin-report`). Real organizer/admin routes already use `OrganizerConsole` and `AdminConsole`.

  The remaining `TambikeView` union is exactly `discovery`, `events`, `event-detail`, `passes`, `pass-detail`, `login`, `signup`, `profile`, `event-register`, and `event-test-ride`. Delete helpers/imports used only by removed variants instead of keeping dead code.

  In `admin-console.tsx`, remove the organizer verification/create section, detail component, queue/cards/actions, and sidebar entry. In organizer/public navigation, never offer a route that can create or verify a second organizer. Confirm `app-sidebar.tsx` and `site-header.tsx` contain no removed links.

- [ ] **Step 5: Update route tests and the checked-in Playwright specification without executing Playwright.**

  - Remove venue page imports/mocks and venue queue assertions from `giveaway-operations-routes.test.ts`.
  - Assert the organizer workspace links the generic claim desk and that it has no venue back link.
  - In `tests/tambike-demo.spec.ts`, remove venue credentials/scenarios, organizer application/verification scenarios, Mina/scanner seed dependencies, and old venue approval steps; describe arbitrary location/direct admin review and normal 404s for removed routes.
  - Do not run `npm run test:e2e`; browser acceptance is Task 9 with the Codex browser.

- [ ] **Step 6: Rerun route/source contracts.**

  Run: `npx vitest run tests/server/account-role-location-route-contract.test.ts tests/server/giveaway-operations-routes.test.ts tests/server/login-page.test.ts`

  Expected: PASS.

- [ ] **Step 7: Commit surface deletion.**

  ```powershell
  git add -A -- src/app/venue src/features/venue src/features/giveaways/venue-giveaway-queue.tsx src/app/organizer/apply src/app/admin/verifications/organizers
  git add src/features/tambike-demo/tambike-screen.tsx src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/components/app-sidebar.tsx src/components/site-header.tsx tests/server/giveaway-operations-routes.test.ts tests/server/login-page.test.ts tests/server/account-role-location-route-contract.test.ts tests/tambike-demo.spec.ts
  git diff --cached --check
  git commit -m "refactor: remove venue and organizer onboarding surfaces"
  ```

---

### Task 8: Update product requirements and prove the complete codebase

**Files:**

- Modify: `tambike-platform-mvp-requirements-ui-wireflow.md`
- Modify as failures require: any active source/test file still carrying structural venue or second-organizer assumptions

- [ ] **Step 1: Rewrite the authoritative requirements and route inventory.**

  Document three authenticated roles, one organizer, direct organizer-to-admin review, event-owned location snapshots, organizer/admin scanning, owning-organizer/admin/explicit-operator claim operations, and the removed route inventory. Keep physical-location prose where it is product content; remove venue account, ownership, approval, or workspace requirements.

- [ ] **Step 2: Run structural residue scans.**

  Run:

  ```powershell
  rg -n 'PENDING_VENUE_APPROVAL|approveVenueWithConditions|venueId|ownedVenues|OrganizerApplication|AdminCreateOrganizer|OrganizerVerification|/venue/|organizer/apply|admin/verifications/organizers' src prisma/schema.prisma prisma/seed.ts tests tambike-platform-mvp-requirements-ui-wireflow.md
  rg -n 'mina\.rider@example\.com|scan-rider@seed\.tambike\.local|ana\.venue@example\.com|@seed\.tambike\.local|marco\.organizer@example\.com' src prisma/seed.ts tests tambike-platform-mvp-requirements-ui-wireflow.md
  ```

  Expected: no active product hits. Exact legacy identities may appear only inside the new guarded migration and its migration tests. Historical migrations remain unchanged.

- [ ] **Step 3: Run formatting/diff validation.**

  Run:

  ```powershell
  git diff --check
  git status --short
  ```

  Expected: no whitespace errors; only planned files are modified.

- [ ] **Step 4: Run Prisma generation and targeted contracts.**

  ```powershell
  npm run db:generate
  npx vitest run tests/server/event-location.test.ts tests/server/backend-domain.test.ts tests/server/check-in-policy.test.ts tests/server/account-role-location-schema-contract.test.ts tests/server/account-role-location-ui-contract.test.ts tests/server/account-role-location-route-contract.test.ts tests/server/giveaway-claims-domain.test.ts tests/server/giveaway-operations-routes.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Run the complete server suite.**

  Run: `npm run test:server`

  Expected: PASS with no seeded venue/Mina/scanner dependency.

- [ ] **Step 6: Prepare and run the complete disposable Prisma suite.**

  Confirm the explicit loopback `TAMBIKE_TEST_DATABASE_URL` points to a `tambike_test_*` database and differs from every application URL, then run:

  ```powershell
  npm run test:prisma:prepare
  npm run test:prisma
  ```

  Expected: PASS, including migration rejection/rollback, seed policy, location round trip, giveaway draw, and live-presentation cases.

- [ ] **Step 7: Run lint and production build.**

  ```powershell
  npm run lint
  npm run build
  ```

  Expected: both exit 0. Resolve root causes; do not suppress new errors or weaken tests.

- [ ] **Step 8: Commit requirements and verification-driven cleanup.**

  ```powershell
  git add tambike-platform-mvp-requirements-ui-wireflow.md
  git diff --cached --check
  git commit -m "docs: align Tambike with simplified account model"
  ```

---

### Task 9: Apply the configured database migration and run Codex-browser acceptance

**Files:** None expected; if acceptance reveals a defect, return to the relevant earlier task, add a regression test, fix it, and repeat all affected verification.

- [ ] **Step 1: Reconfirm the live/configured preflight immediately before mutation.**

  Run a read-only Prisma query and record only aggregate/nonsecret facts:

  - current user counts by role;
  - canonical user/profile IDs and target-email availability;
  - total event count and event counts by organizer/status;
  - count of the exact 23 deletion candidates;
  - Floren user/RSVP/pass counts;
  - removable-user references in every guarded giveaway column.

  Expected from the audited starting state: 26 users, 21 organizers, 3 riders, 1 venue, 1 admin, 25 events, one pending-venue event, zero giveaway/history rows, and Floren with one RSVP and one pass. If state has drifted, stop before mutation and reconcile it against migration guards; do not broaden the delete set.

- [ ] **Step 2: Check migration state and apply only migrations.**

  ```powershell
  npx prisma migrate status --config prisma.config.ts
  npx prisma migrate deploy --config prisma.config.ts
  ```

  Expected: `20260715120000_simplify_accounts_and_locations` applies successfully. Do not run `prisma db seed`.

- [ ] **Step 3: Verify configured database postconditions read-only.**

  Assert:

  - one organizer at `organizer@bayanko.ph`, display/profile fields all `Tambike Organizer`, stable user/profile IDs, and approved status;
  - existing admin unchanged;
  - Floren unchanged with the same RSVP/pass counts;
  - Mina, scan rider, Ana, and all 20 allowlisted generated users absent;
  - all 25 audited events owned by `user-marco-organizer-profile` with valid frozen location data;
  - no `Venue` table, `venue` role, pending-venue status, or `ApprovalType` remains;
  - total configured users are three for the audited starting state (one organizer, one admin, one real rider). If new legitimate riders appeared after preflight, preserve and report them rather than deleting them.

- [ ] **Step 4: Reuse or start the local app correctly.**

  Check the current terminal/listeners first. Reuse the existing Next dev server if it is healthy. Only if none is running, start `npm run dev` with the required environment and keep its process/session ID for diagnostics.

- [ ] **Step 5: Read and use `browser:control-in-app-browser` for acceptance.**

  With the Codex browser only, verify:

  1. organizer login uses `organizer@bayanko.ph` and lands in the organizer workspace;
  2. the organizer list contains formerly separate-owner events under Tambike Organizer;
  3. create-event accepts a new arbitrary location and optional map URL, then shows `PENDING_ADMIN_REVIEW` without a venue step;
  4. admin review shows the frozen location and publishes the event;
  5. organizer and admin can access check-in and the generic giveaway claim desk, while an unassigned rider cannot;
  6. public event/pass views show the location and conditionally show the map action;
  7. raffle configuration and live presentation still open from organizer routes;
  8. `/venue/dashboard`, `/venue/requests/example`, `/venue/events/example`, `/organizer/apply`, and `/admin/verifications/organizers` return normal not-found pages;
  9. no venue account, venue approval, or second-organizer creation control appears in navigation/admin UI.

  Use a disposable test rider created for acceptance or the protected in-memory/browser-test fixture. Never automate against Floren's account.

- [ ] **Step 6: Check browser and server evidence together.**

  Capture the exact tested URL, dev-server PID/session, organizer/admin/rider outcomes, removed-route status, and any console/server errors. If communication or auth fails, diagnose before claiming browser coverage.

- [ ] **Step 7: Run final post-deploy smoke commands.**

  ```powershell
  npm run test:server
  npx prisma migrate status --config prisma.config.ts
  git status --short --branch
  ```

  Expected: server suite passes, database is up to date, and the branch contains no uncommitted implementation changes.

---

## Completion Evidence

The final handoff must separate automated, database, and browser evidence. Report the exact branch and commit(s), commands with exit results, configured-database account/event counts, preserved Floren counts, and the specific browser flows/routes observed. Do not claim Playwright coverage, do not claim a browser flow that was inferred from source, and do not merge until all required evidence is green.
