# Event Attendee Preview Copy Design

## Goal

Reduce repetition in the public event attendee preview while preserving its meaning, attendance data, roster behavior, and existing visual hierarchy.

## Approved copy

The attendee card will display:

- Eyebrow: `Who’s going`
- Primary count: `16 riders` (with the live count substituted)
- Supporting count: `16 interested · ~55 expected` (with live values substituted)
- Roster action: `See more`

The primary count uses singular grammar for one attendee (`1 rider`) and plural grammar for all other counts (`0 riders`, `2 riders`, and so on).

## Scope

Only the public attendee-preview copy changes. The bike gallery, rider-profile links, aggregate values, attendee ordering, roster visibility, privacy filtering, empty state, RSVP behavior, and attendee route remain unchanged.

## Verification

- Update the existing rendered-component tests first and confirm they fail against the old copy.
- Implement the minimum component change needed to make them pass.
- Run the focused attendee-preview tests.
- Reuse the existing Tambike development server and verify the event card in the Codex Browser at mobile and desktop sizes.
