# Per-Event RSVP Roster Visibility Design

## Goal

Let each rider decide, for each event, whether their eligible name and motorcycle may appear in “Who’s going,” while keeping anonymous riders in aggregate attendance counts.

## Rider experience

The Going registration modal adds one checkbox:

> Show my name and bike in Who’s going.

The checkbox appears only for a Going RSVP. It defaults from the signed-in rider’s `defaultRosterIdentity` profile preference:

- `VISIBLE` starts checked.
- `ANONYMOUS` starts unchecked.

Sample Rider’s profile default is `VISIBLE`, so Sample Rider sees the checkbox checked initially.

Submitting the Going form saves the selected value on that event’s RSVP:

- Checked saves `rosterIdentity: "VISIBLE"`.
- Unchecked saves `rosterIdentity: "ANONYMOUS"`.

The selection belongs to that RSVP. Changing the rider’s global profile preference later does not rewrite existing event choices. The global preference only supplies the initial choice for an RSVP that does not already exist.

Interested RSVPs do not show or change the roster-visibility option.

## Privacy and roster precedence

An RSVP marked `VISIBLE` is eligible to expose a rider only when all existing safeguards also pass:

- The organizer enabled the event roster.
- The RSVP status is Going.
- The rider profile has a stable public slug.
- The profile is published and sufficiently public for the surface.
- The public event preview additionally requires an uploaded motorcycle photo.

If any safeguard fails, the rider remains count-only even when the RSVP says `VISIBLE`.

An RSVP marked `ANONYMOUS` always remains count-only. Public and member responses must not expose its rider identity, profile, motorcycle, email, internal IDs, verification state, media IDs, or storage keys.

## Preview selection and priority

Both backends must classify visibility from `RSVP.rosterIdentity`, not the rider’s current global profile preference.

For the public four-bike preview:

1. Select Going RSVPs for the event.
2. Keep only RSVP-level `VISIBLE` choices that pass the public-profile and bike-photo safeguards.
3. Preserve the existing stable order by `goingAt`, then RSVP ID.
4. Apply the four-rider limit after those filters.

This gives riders who allowed display priority because anonymous or otherwise ineligible RSVPs never consume a preview slot.

The full attendee roster uses the same RSVP-level visibility choice and existing pagination order. Aggregate Going, visible, and anonymous counts remain accurate.

## Data and backend behavior

No Prisma migration is required because `RSVP.rosterIdentity` already exists and defaults to `ANONYMOUS`.

Extend the existing registration input with an optional `rosterIdentity`. For Going registration:

- An explicit valid input is persisted.
- When no explicit value is supplied for a new RSVP, use the rider’s current global default.
- When no explicit value is supplied for an existing RSVP, preserve that RSVP’s saved choice.

The in-memory and Prisma backends must follow the same rules. Prisma updates must write the per-event choice when it is supplied instead of leaving the old value unchanged.

The registration response continues returning the saved RSVP visibility value. Pass creation, RSVP status, attendance type, club name, Going timestamp, eligibility reconciliation, and audit behavior remain unchanged.

## UI state and errors

The modal owns the checkbox state alongside attendance type. Submission passes the selected per-event visibility through the existing provider and server action.

If registration fails, the modal stays open, keeps the rider’s selections, and shows the existing inline error. The visibility choice must not create a separate partial save.

## Verification

Use test-driven development and extend existing tests:

- The Going modal renders the checkbox and initializes it from the rider default.
- Sample Rider starts checked and can uncheck it.
- The provider/action passes the selected `rosterIdentity`.
- Both backends save explicit per-event choices and preserve them when the global preference later changes.
- Existing RSVPs preserve their choice when an update omits `rosterIdentity`.
- Anonymous RSVPs count toward Going but never appear in the roster or public preview.
- Visible eligible RSVPs are filtered before the four-bike limit and retain stable ordering.
- Private, unpublished, Interested, photo-less, and organizer-disabled cases remain protected.
- Focused tests, full server tests, lint, and production build pass.
- Reuse the existing Tambike development server and use only the Codex Browser to verify Sample Rider’s checked/unchecked Going flow and the resulting event preview.

## Scope boundaries

Do not change the organizer roster toggle, profile-privacy screen, attendee route authentication, database schema, pass UI, RSVP counts, raffle eligibility, check-in behavior, or unrelated poster/raffle/demo work.
