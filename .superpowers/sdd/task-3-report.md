# Task 3: Remove Event-Level Privacy APIs and Controls

## Implementation

- Replaced the event-specific roster privacy UI contract with absence assertions for the editor, field, copy, server actions, and four-argument registration call.
- Preserved positive contracts for `View attendee roster`, `configureEventRoster`, and `listEventAttendees`.
- Removed `rosterIdentity` from `registerForEventAction()` and the demo provider registration method/callback.
- Deleted `updateEventRosterIdentityAction()` and `getEventRosterIdentityAction()`.
- Deleted `updateEventRosterIdentity()` and `getEventRosterIdentity()` from the in-memory and Prisma backends.
- Simplified `RsvpModal` to attendance selection, submit/error state, and pass navigation only.
- Removed the existing-RSVP privacy editor/form/helper types and normalization logic from the event detail screen.
- Removed the obsolete `.existing-rsvp-identity*` CSS.
- Removed the unused `passes` binding left in `EventDetail`.
- Removed the obsolete `rosterIdentity` parameter/import from the shared `registerTestPass()` helper so it conforms to the current `RegistrationInput`.

## Deleted files

- `src/features/member-profiles/roster-identity-field.tsx`
- `tests/server/event-roster-ui-rerender.test.ts`

## RED evidence

Command run before production edits:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts
```

Relevant active-checkout output:

```text
tests/server/event-roster-ui-contract.test.ts (8 tests | 1 failed)
× removes event-specific privacy APIs and controls while preserving roster access
AssertionError: expected source not to contain "ExistingRsvpIdentityEditor"
```

The command exited `1`, proving the new absence contract failed for the intended missing removal. Vitest also discovered the explicitly out-of-scope `.codex/worktrees/rider-profile-showcase` copy and reported three unrelated failures there (one stale route contract and two duplicate-React hook failures).

## GREEN evidence

The exact brief command was run after implementation:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts tests/server/event-roster-domain.test.ts
```

Output summary:

```text
Test Files  1 failed | 3 passed (4)
Tests  4 failed | 33 passed (37)
```

All active-checkout UI/domain files passed. The overall exit remained `1` only because Vitest additionally collected `.codex/worktrees/rider-profile-showcase/tests/server/event-roster-ui-contract.test.ts`; that stale test expects the controls this task removes and also has two duplicate-React hook failures. The stale checkout was preserved as required.

Clean scoped proof:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts tests/server/event-roster-domain.test.ts --exclude ".codex/worktrees/**"
```

```text
Test Files  2 passed (2)
Tests  17 passed (17)
Exit code: 0
```

Final scoped ESLint:

```powershell
npx eslint src/server/actions.ts src/server/backend.ts src/server/prisma-backend.ts src/features/tambike-demo/demo-provider.tsx src/features/tambike-demo/tambike-screen.tsx tests/server/event-roster-ui-contract.test.ts tests/server/support/tambike-fixtures.ts
```

```text
Exit code: 0
```

TypeScript:

```powershell
npx tsc --noEmit
```

```text
src/server/backend.ts(4245,29): error TS18048: 'entry.user' is possibly 'undefined'.
src/server/backend.ts(7669,29): error TS18048: 'user' is possibly 'undefined'.
Exit code: 1
```

The Task 3 fixture error from the first TypeScript run was fixed. These two remaining errors are pre-existing nullability issues in unrelated, untouched backend logic.

Diff validation:

```powershell
git diff --check
```

```text
Exit code: 0
```

## Stale-symbol searches

The exact requested command was run:

```powershell
rg -n "ExistingRsvpIdentity|RosterIdentityField|registrationRosterIdentity|updateEventRosterIdentity|getEventRosterIdentity|Change for this event|Profile default" src tests
```

It matched only the required negative assertions in `tests/server/event-roster-ui-contract.test.ts` (lines 173-185). This is unavoidable because the brief requires those exact strings in that test.

The production-source search is clean:

```powershell
rg -n "ExistingRsvpIdentity|RosterIdentityField|registrationRosterIdentity|updateEventRosterIdentity|getEventRosterIdentity|Change for this event|Profile default" src
```

```text
No matches
Exit code: 1
```

The removed registration field/caller search is also clean:

```powershell
rg -n "rosterIdentity" src/server/actions.ts src/features/tambike-demo/demo-provider.tsx src/features/tambike-demo/tambike-screen.tsx
```

```text
No matches
Exit code: 1
```

## Self-review

- Confirmed organizer roster enablement and attendee roster links remain present.
- Confirmed the provider interface has exactly three registration parameters and the server action input has only status, attendance type, and optional club name.
- Confirmed both backend implementations no longer expose event-specific privacy mutations/reads.
- Confirmed the RSVP modal retains all three attendance radio choices, error output, cancel action, submit pending state, and pass navigation.
- Confirmed both dedicated component/test files are deleted and their event-detail/CSS callers are gone.
- Confirmed no unrelated checkout or generated file was changed.
- Confirmed all edited source/test files pass scoped ESLint and `git diff --check`.

## Concerns

- The repository-level Vitest discovery includes the stale `.codex/worktrees/rider-profile-showcase` checkout even when exact root test paths are provided. The task explicitly marks that checkout out of scope, so it was not edited.
- The exact stale-symbol command cannot return zero matches because the updated UI contract intentionally contains the searched symbols in negative assertions.
- Full TypeScript remains blocked by two unrelated pre-existing nullability errors in `src/server/backend.ts`; Task 3 introduced no remaining TypeScript error.
