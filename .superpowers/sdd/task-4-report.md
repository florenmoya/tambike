# Task 4 report — in-memory giveaway entry, draw, and award lifecycle

## Scope delivered

- Added in-memory APIs for rider opt-in, hashed expiring campaign codes, manual grant/revoke, manual perk redemption, snapshot lock, deterministic random draw, manual selection, publication, rider decline, and redraw.
- Replaced the marker-only lock with a deterministic frozen candidate snapshot, SHA-256 commitment, AES-256-GCM encrypted 32-byte seed, and public-safe verification output.
- Added direct entry-time awards for unlimited guaranteed pools and finite first-come pools; random/manual awards retain paired draw/snapshot provenance.
- Preserved current check-in eligibility semantics: pending self-review does not qualify, self-instant qualifies normal confirmed-check-in only, and staff-confirmed rules still require a staff confirmation method.
- Kept campaign codes, source facts, candidate identities, seed ciphertext, and claim secrets out of public/rider DTOs and the global demo snapshot.

## Provenance schema correction

The undeployed `20260713000000_flexible_event_giveaways` migration was amended with the parent-approved direct-award model:

- `GiveawayAward.entryId` is required.
- `drawId` and `snapshotEntryId` are nullable but strictly paired; `rank` is null for entry-time awards and positive for draw-backed awards.
- Parentage guards require the entry/rider, pool, draw, and snapshot entry to be in scope, including an exact `draw.snapshotId = snapshotEntry.snapshotId` match.
- Removed the one-current-award-per-pool/snapshot-entry index so configured per-rider pool limits are enforced by the domain instead. The single-current-prize-item index remains.

## Review repairs included

- Mixed `manual_selection` and `random_draw` pools can be processed before publication without invalid lifecycle transitions; selecting after publication is deliberately rejected so published results remain stable.
- Pre-lock automatic withdrawal and manual revocation supersede direct guaranteed/first-come awards, release finite reserved inventory, and append audit records.
- Suspended campaigns reject publish and redraw actions.
- Finite perk redemption uses the existing `Perk.quantity` field as the authoritative limit; the test seed can override that real field without adding a new event input.
- Removed the misleading public optional manual-grant idempotency key rather than implying unsupported replay semantics.

## Test-first evidence

- Initial Task 4 behavior RED: `tests/server/giveaway-domain.test.ts` had 21 tests, with 13 passing and 8 failing because the new APIs/key enforcement did not exist.
- Initial schema provenance RED: direct award field contract failed because `GiveawayAward.entryId` was absent.
- Review-repair RED: combined giveaway domain/schema suite had 36 tests, with 30 passing and 6 failing exactly for mixed draw sequencing, direct-award release, suspension, finite-perk exhaustion, and exact snapshot parentage.
- Final focused GREEN: `npx vitest run tests/server/giveaway-domain.test.ts tests/server/giveaway-schema-contract.test.ts` — 36/36 passed.

## Final verification

- `npm run test:server` — 7 files, 107/107 tests passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npx prisma validate` — passed.
- `npm run db:generate` — passed.
- `npm run build` — passed.
- `git diff --check` — passed.

No persistent database was seeded, reset, or migrated. Browser smoke testing is deferred to the later actions/routes/UI task because this task intentionally adds only in-memory backend behavior and tests.

## Post-review integrity follow-up

- Revalidation now evaluates every current direct award against the entry's current pool eligibility. A lost pool group voids only the affected award, releases a reserved finite item, records `GIVEAWAY_AWARD_VOIDED`, preserves the revalidation source evidence, and then allocates newly eligible entry-time awards.
- Snapshot entries now persist the frozen source fingerprint and qualified eligibility-group IDs. The in-memory snapshot entries and their group arrays are frozen; both the entry evidence and snapshot digest include those facts.
- The undeployed migration blocks all snapshot-entry updates/deletes and permits a snapshot update only for the one-way `seedRevealedAt` null-to-value transition (with `updatedAt` excluded from the comparison). Snapshot deletion is rejected.
- Campaign and prize-pool winner limits are immutable after any award history, in both the in-memory update path and the migration guards.
- Giveaway audit rows are unconditionally append-only. The seed no longer has a purge bypass and refuses to run if an event giveaway or giveaway audit record exists; a fresh giveaway-free database remains seedable.
- Campaign-code creation now rejects missing, malformed, past, and equal-to-now expiries before issuing a token.

### Integrity regression evidence

- RED: `npx vitest run tests/server/giveaway-domain.test.ts tests/server/giveaway-schema-contract.test.ts` — 35/41 passed; the six failures covered mutable winner limits, past code creation, retained pool-specific award, absent frozen snapshot fields/guards, and the audit purge bypass.
- GREEN: `npm run db:generate && npx vitest run tests/server/giveaway-domain.test.ts tests/server/giveaway-schema-contract.test.ts` — 42/42 passed.
- GREEN: `npm run test:server` — 7 files, 113/113 tests passed.
- GREEN: `npx prisma validate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` all passed.
- `npx prisma migrate status` was invoked but cannot run in this isolated worktree because neither `DATABASE_URL` nor `DIRECT_URL` is configured. No persistent database was connected, seeded, reset, or migrated.
