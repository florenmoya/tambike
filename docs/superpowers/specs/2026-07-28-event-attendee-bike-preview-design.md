# Event Attendee Bike Preview Design

## Goal

Replace rider portraits in the public event attendee preview with the motorcycles those riders uploaded. The preview should make the event feel rider-focused while preserving the existing attendance summary, roster link, privacy rules, and compact RSVP-adjacent hierarchy.

## Selected approach

Show up to four unique visible attendees who have at least one uploaded motorcycle photo that the existing public media service authorizes for this viewer. Use the first photo in each rider's saved motorcycle-photo order.

The alternatives were rejected:

- Putting bike photos inside the existing circles would crop motorcycles poorly.
- Showing multiple photos from the same rider would turn the section into a motorcycle gallery instead of attendee social proof.
- Falling back to rider portraits would make the visual treatment inconsistent with the bike-first intent.

## Public data contract

Keep the preview as a separate, server-only public read model. Each preview rider may expose only:

- Public rider slug
- Public display name
- Area
- First motorcycle photo URL
- First motorcycle photo width and height

Do not expose the profile portrait, full motorcycle record, make, model, description, internal media identifiers, storage keys, email, account identifiers, or verification state.

The existing eligibility rules remain authoritative:

- The organizer enabled the attendee roster.
- The RSVP is `going`.
- The rider chose a visible roster identity.
- The rider profile is public and published.
- The rider has a public profile slug.
- The rider has at least one uploaded motorcycle photo available through the existing public media service.

Attendance aggregates continue to count all applicable attendees, including anonymous attendees. Filtering for bike photos affects only the featured preview tiles.

## Selection and ordering

Preserve the current attendee ordering by `goingAt` and RSVP identifier. Filter eligible attendees to those with a motorcycle photo, then take the first four unique riders.

Both the in-memory and Prisma backends must return the same result. The Prisma query should require at least one motorcycle photo before applying the four-rider limit so attendees without bike photos do not consume preview slots.

## Interface

Replace the overlapping circular facepile with a responsive image grid:

- Four landscape tiles in one row when space permits.
- Two columns on narrow mobile screens.
- A consistent aspect ratio with `object-fit: cover`.
- Rounded corners and a restrained event-accent border that fit the existing event card.
- Each tile links to the rider's public profile.
- Each link has an accessible label naming the rider and the bike preview.
- Decorative images use empty alt text because the link label provides the meaning.

Do not add motorcycle specifications, badges, instructional copy, or internal policy language. Keep the existing heading, attendance counts, empty state, and “See who’s going” action.

## Failure behavior

- Riders without a bike photo are omitted by the server.
- If a returned photo fails in the browser, hide that tile without substituting a portrait or initial.
- If no eligible bike photos remain, show the existing neutral attendee-preview empty state.
- If the preview read fails, preserve the existing attendance-count fallback and roster navigation behavior.
- If the organizer disabled the roster, show counts only and expose no rider or bike links.

## Verification

Use test-first implementation:

1. Add failing backend tests proving that only riders with bike photos fill the four preview slots, ordering is stable, and private or anonymous riders remain excluded.
2. Add a failing public-contract test proving that only the narrow bike-photo fields are exposed.
3. Add failing component tests proving that bike photos render, profile portraits do not render, missing-bike riders are absent, and broken images disappear without portrait fallback.
4. Run the focused server tests, lint, and the production build.
5. Reuse an existing development server when available and verify the event page with the Codex browser at desktop and mobile widths. Confirm the bike grid, profile links, roster link, readable cropping, and no horizontal overflow.

## Out of scope

- Changing the full attendee roster cards
- Adding bike-photo uploads or moderation behavior
- Changing rider profile pages
- Changing RSVP, roster visibility, or anonymity controls
- Deploying or modifying production data
