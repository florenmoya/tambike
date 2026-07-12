# Task 3: In-memory giveaway lifecycle and automatic eligibility report

## Scope

Implemented only the memory runtime layer in `src/server/backend.ts` and the focused domain suite in `tests/server/giveaway-domain.test.ts`.

- Added an isolated in-memory giveaway aggregate and seed collections for giveaways and perk redemptions. `getSnapshot()` and the global demo state remain unchanged.
- Added organizer/admin lifecycle methods, narrow public/rider DTO reads, mechanics versioning, request-ID-to-persistent-ID mapping, generic audit mirrors, and hash-chained aggregate audit records.
- Added post-commit automatic eligibility reconciliation for RSVP/pass changes and confirmed self/staff check-ins.
- Added `lockGiveaway()` as approved by the parent task: it freezes entry status and creates only an in-memory snapshot marker. Full encrypted snapshot and draw creation remain for the later draw task.
- Did not change Prisma backend, actions/routes, UI, migrations, or seed/reset behavior outside the in-memory seed shape.

## RED evidence

Before production implementation:

```text
npx vitest run tests/server/giveaway-domain.test.ts
Test Files  1 failed (1)
Tests  8 failed (8)
TypeError: backend.createGiveaway is not a function
```

All failures were the intended missing backend API failure; no pre-existing behavior was used as a false-green substitute.

## GREEN and final verification

```text
npx vitest run tests/server/giveaway-domain.test.ts
Test Files  1 passed (1)
Tests  9 passed (9)

npm run test:server
Test Files  7 passed (7)
Tests  85 passed (85)

npx tsc --noEmit
Exit code: 0

npm run lint
Exit code: 0

git diff --check
Exit code: 0
```

## Behavior covered

- Event-owner/admin creation and wrong-organizer, rider, and venue denial.
- Required compliance review before opening; constrained pause/cancel/suspend lifecycle.
- Automatic active-RSVP/pass entry creation, weighted entry counts, and withdrawal after RSVP becomes `interested`.
- Non-automatic campaign-code/manual conditions never create automatic entries.
- Pending self-review check-ins remain ineligible; a staff confirmation satisfies staff-confirmed eligibility.
- Self-instant `rider_qr` satisfies confirmed check-in but not staff-confirmed check-in.
- A locked campaign ignores later RSVP and staff scan activity and rejects configuration edits.
- Public/rider DTOs omit emails, phones, source snapshots, audit data, claim secrets, ciphertext, user/rider identifiers, and other-rider data.

## Self-review

- Lifecycle authorization reuses event ownership logic; venue users retain scanner access only and cannot configure giveaways.
- Reconciliation only runs after the source state has committed and only mutates `open` automatic campaigns.
- Withdrawn entries retain their last positive stored weight rather than writing a zero-weight entry.
- Entry events and audit events are immutable records; audit hashes use the approved canonical JSON helper. Free-text reasons are retained internally but only their SHA-256 digest is placed in the append-only audit payload.
- No giveaway candidate, audit, delivery, or claim data is returned from snapshot/public/rider reads.

## Deferred concerns

- The approved input contract has no independent maximum entry-weight field, so this task sums qualifying group weights without an additional cap. Winner limits remain award limits, not entry-weight limits.
- Perk redemption is evaluated from the isolated in-memory redemption collection, but no redemption mutation API belongs to this task.
- The snapshot marker intentionally lacks draw seed/encryption/digest records; the later draw task owns those cryptographic fields and transactions.
