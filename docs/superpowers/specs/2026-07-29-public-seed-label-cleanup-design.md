# Public Seed Label Cleanup Design

**Date:** 2026-07-29

## Goal

Remove visible `Sample` and `Demo` markers from seeded rider identities and
public raffle winner labels without deleting or changing the behavior of the
underlying accounts, bikes, RSVPs, profiles, or raffle records.

## Scope

The cleanup applies to public-facing data owned by known seeded accounts:

- Rider display names such as `Mika Santos — Sample Rider` become natural names
  such as `Mika Santos`.
- Demo roster names such as `Paolo Reyes — Demo Rider` become `Paolo Reyes`.
- Public raffle winner names and aliases lose `Sample` and `Demo` markers.
- Provisioning definitions and assertions are updated so future runs preserve
  the clean public names.
- Existing local database records are migrated by exact seeded identity, not by
  a broad text replacement.

The cleanup does not remove or rename internal email addresses, lock keys,
session IDs, audit values, script names, source module names, or `/demo` asset
paths. Those values are not public UI and are required to identify and maintain
the seeded records safely.

## Data Safety

The migration targets only exact known seed identities, primarily their stable
seed email addresses and expected current labels. It must not update arbitrary
users whose legitimate name happens to contain `Sample` or `Demo`.

No user, profile, motorcycle, media object, RSVP, pass, event, giveaway,
award, or audit event is deleted.

The migration must be idempotent: rerunning it leaves already-clean records
unchanged and future provisioning must not restore the old suffixes.

## Implementation

1. Add failing tests that expect clean public names from rider and raffle
   provisioning.
2. Update seed manifests/constants to use clean public names and aliases.
3. Add or extend a narrowly scoped migration path that updates existing known
   seeded database records.
4. Run the migration against the active local Tambike database only after
   confirming the target and previewing the exact rows.
5. Verify the event attendee preview, rider roster/profile surfaces, and public
   raffle presentation no longer expose `Sample` or `Demo`.

## Verification

- Focused provisioning and public presentation tests pass.
- A read-only database query confirms no known seeded public display name or
  public winner alias contains `Sample` or `Demo`.
- The running localhost event page shows natural rider names at desktop and
  mobile widths.
- Existing bikes, RSVP counts, rider links, and raffle records remain present.
- Unrelated dirty workspace changes remain untouched.
