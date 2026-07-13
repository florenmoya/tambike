# Task 5 — Prisma giveaway lifecycle and entry parity

## Implemented

- Added the database-backed campaign configuration, review, lifecycle, public/rider read, and entry APIs to `PrismaTambikeBackend`.
- Enforced organizer-owner/admin configuration authorization, admin-only compliance review and suspension, rider-only self-entry, and the existing pre-award owner/admin cancellation behavior.
- Added interactive transactions with documented lock order: campaign, campaign code, entry, pool, item, then award. Campaign creation and configuration replacement pre-lock the Event row.
- Implemented automatic qualification at campaign open and atomically inside the RSVP/pass and confirmed self/staff check-in Event transactions. Pending self-review arrivals do not reconcile.
- Implemented eligibility parity for active RSVP/pass, confirmed check-in, staff-confirmed check-in, perk redemption, campaign code, and audited manual entry.
- Implemented immediate unlimited `guaranteed` and ordered finite `first_come` direct awards, including void, item release, and chronological reallocation after qualification changes.
- Added canonical hash-chained giveaway audit writes and kept private source facts, code hashes, audit payloads, and entrants out of public/rider DTOs and `getSnapshot`.

## Schema and migration corrections

- Persisted entry path, qualified group IDs, manual-grant state, and opt-in mechanics acknowledgement on `GiveawayEntry`.
- Added campaign-level presence verification, campaign-code creator provenance, and an append-only `GiveawayCampaignCodeClaim` ledger unique by code/rider and code/idempotency key.
- Added immutable direct-allocation provenance on awards, renamed undeployed draw/award `reason` fields to `reasonDigest`, and expanded the scope guard accordingly.
- Added entry provenance, code-claim parentage, and append-only triggers to the existing undeployed giveaway migration.

## Verification

- `npm run db:generate` — passed.
- `npx prisma validate` — passed.
- Focused contract tests (`prisma-giveaway-lifecycle-contract`, `giveaway-schema-contract`) — 19 passed.
- `npm run test:server` — 8 files, 118 tests passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `git diff --check` — passed.
- `npx prisma migrate status` — intentionally blocked: `DATABASE_URL`, `DIRECT_URL`, and related URLs are unset; Prisma reports that `datasource.url` is required. No persistent database command, migration, reset, push, or seed was run.

## Deferred intentionally

- Canonical lock/snapshot creation, drawings, publication, redraws, claims, verification, fulfilment, delivery details, exports, cron lifecycle execution, and browser smoke flows remain for the subsequent giveaway tasks.
- No disposable PostgreSQL URL is configured in this worktree, so database integration/concurrency tests were not run or faked.
