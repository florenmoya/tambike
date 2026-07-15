## Task 5 report: Prisma backend, seed, and integration fixture parity

Status: DONE

### Changed files

- `src/server/prisma-backend.ts`
- `prisma/seed.ts`
- `tests/prisma-integration/fixtures.ts`
- `tests/prisma-integration/event-location.integration.test.ts`
- `tests/prisma-integration/seed-policy.integration.test.ts`
- `tests/prisma-integration/giveaway-draw.integration.test.ts`
- `tests/prisma-integration/giveaway-live-presentation.integration.test.ts`
- `tests/server/prisma-giveaway-lifecycle-contract.test.ts`

### Summary

- Removed Prisma backend dependencies on `Venue`, `venueId`, `ownedVenues`, `approvalType`, `PENDING_VENUE_APPROVAL`, `approveVenueWithConditions`, and venue-owner authorization.
- Prisma event creation now normalizes event-owned location input and creates organizer events directly in `PENDING_ADMIN_REVIEW`.
- Admin publish now records event-specific admin review rows without `approvalType`.
- Check-in and giveaway operation authorization now permits admin, owning approved organizer, and explicit giveaway operators.
- Replaced the seed with canonical organizer/admin plus clean source `demoEvents` only; source `demoEvents.length` is 24.
- Added reusable Prisma integration fixture builder for owned users/events/passes and moved giveaway integration tests onto it.

### Commands and results

- `npx vitest run tests/server/prisma-giveaway-lifecycle-contract.test.ts tests/server/prisma-giveaway-perk-contract.test.ts`
  - RED before implementation: failed on `approveVenueWithConditions`/venue residue.
  - GREEN after implementation: 2 files passed, 29 tests passed.
- `npm run db:generate`
  - PASS; Prisma Client generated successfully.
- `npm run test:prisma:prepare` with `TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS=1`, `TAMBIKE_PREPARE_PRISMA_INTEGRATION_SCHEMA=1`, and `TAMBIKE_TEST_DATABASE_URL=postgresql://integration:password@127.0.0.1:5432/tambike_test_giveaways`
  - PASS; no pending migrations on disposable loopback database.
- `npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/event-location.integration.test.ts tests/prisma-integration/seed-policy.integration.test.ts tests/prisma-integration/giveaway-draw.integration.test.ts tests/prisma-integration/giveaway-live-presentation.integration.test.ts`
  - Initial GREEN after fixes: 4 files passed, 4 tests passed.
  - Final rerun: 4 files passed, 4 tests passed.
- `npx tsx -e "import { demoEvents } from './src/features/tambike-demo/data'; console.log(demoEvents.length)"`
  - PASS; printed `24`.
- `rg -n 'venueId|ownedVenues|approveVenueWithConditions|PENDING_VENUE_APPROVAL|approvalType|@seed\.tambike\.local|mina\.rider@example\.com|scan-rider@seed\.tambike\.local|ana\.venue@example\.com|marco\.organizer@example\.com' src/server/prisma-backend.ts prisma/seed.ts`
  - PASS; no active backend/seed hits.
- `git diff --check -- <Task 5 files>`
  - PASS; no whitespace errors.

### Concerns

- The disposable integration run still emits an existing `pg` deprecation warning about concurrent `client.query()` calls during concurrency tests. The tests pass and this warning was not introduced by the location/ownership parity change.
- The worktree contains unrelated Task 7 route/UI deletions and edits; they were intentionally not included in this Task 5 commit.
