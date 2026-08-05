# Tambike MVP Requirements and UI Wireflow

## 1. Product model

Tambike is a mobile-first event, RSVP, QR pass, check-in, perk, raffle, and reporting system for motorcycle community events. It is event-first, not a venue directory.

The MVP supports three authenticated roles:

| Role | Purpose |
| --- | --- |
| Rider | Browse events, RSVP/register, receive a Tambike Pass, check in, and manage rider profile data. |
| Organizer | Own the current event catalog, create drafts with arbitrary event locations, operate check-in for owned events, manage giveaways, and view reports. |
| Admin | Review events, publish approved events, manage users, moderate reports, operate check-in when needed, and run platform reporting. |

There is no venue account, venue approval queue, venue-owned workspace, organizer onboarding application, or second-organizer creation flow in the current MVP.

## 2. Accounts and seed policy

Clean seed data contains:

- one organizer: `organizer@bayanko.ph`;
- one admin: `admin@bayanko.ph`;
- the curated event catalog.

The normal seed does not create example riders, deterministic scanner riders, venue users, generated organizer owners, or generated organizer profiles.

## 3. Event lifecycle

Events use event-owned location snapshots:

- `locationName`;
- `locationAddress`;
- optional `locationMapLink`;
- `area`.

Organizers may enter any valid location details when creating an event. The server validates and stores those fields directly on the event; there is no mutable venue record or venue foreign key.

Event statuses:

```text
DRAFT
-> PENDING_ADMIN_REVIEW
-> PUBLISHED
-> COMPLETED
```

Rejected/cancelled states remain available where already supported by product flows, but there is no pending venue status.

## 4. Publishing rules

Only approved organizers can create event drafts. New organizer drafts go directly to admin review when review is required. Admin review checks event content, organizer ownership, location snapshot, risk flags, ride-out information, rules, and perks.

Publication is controlled by admin approval. Venue approval is not required.

## 5. Check-in and perks

QR check-in can be operated by:

- the owning organizer;
- an admin;
- explicitly assigned operators where the giveaway/check-in flow supports assignment.

Check-in validates pass identity, event match, pass status, duplicate check-in, and cancellation. Rider self-check-in also follows the configured event policy and active event window; authorized staff scanning remains available as an operational override. Perk redemption remains separate from attendance and can be marked manually by authorized staff.

## 6. Giveaways and raffle operations

Giveaways remain server-authoritative. Random draws, winner selection, seed reveal, publication, and notifications stay on the server. Organizer/admin operator surfaces may reveal and publish results, but client UI never selects or rerolls winners.

The generic claim desk is available to the owning organizer and authorized admins/operators. It links back to organizer event/giveaway workspaces, not venue routes.

## 7. Route inventory

Public and rider routes:

```text
/
/events
/events/:eventId
/login
/signup
/profile
/passes
/passes/:passId
/test-ride
```

Organizer routes:

```text
/organizer/dashboard
/organizer/events
/organizer/events/create
/organizer/events/:eventId
/organizer/events/:eventId/attendees
/organizer/events/:eventId/scanner
/organizer/events/:eventId/giveaways
/organizer/events/:eventId/report
/organizer/reports
```

Admin routes:

```text
/admin
/admin/events/review
/admin/events/review/:reviewId
/admin/giveaways
/admin/reports
/admin/reports/:eventId
/admin/users
/admin/leads
/admin/moderation
```

Removed routes return the normal Next.js not-found response:

```text
/venue/**
/organizer/apply
/admin/verifications/organizers/**
```

## 8. Primary wireflows

### Rider RSVP

```text
Browse events
-> Open event detail
-> Select Going/Register
-> Log in or create rider account
-> Choose direct arrival or ride-out
-> Receive Tambike Pass with QR
-> Check in at event
```

### Organizer event creation

```text
Open organizer dashboard
-> Create Event
-> Enter event type, details, location snapshot, ride/meetup details, perks, and rules
-> Submit draft
-> Event enters admin review
-> Admin publishes
-> Organizer operates attendee tools, check-in, giveaways, and report
```

### Admin event review

```text
Open admin event review queue
-> Inspect event, organizer, location snapshot, risk flags, rules, and perks
-> Approve publish, reject, or request changes
-> Published events become visible to riders
```

## 9. Screen requirements

| Screen | Requirement |
| --- | --- |
| Event cards | Show poster, title, date/time, location/area, going/interested count, organizer, and perk preview. |
| Event detail | Show event location snapshot, optional map link, organizer, rules, ride-out/meetup information, RSVP CTA, and giveaway panel where applicable. |
| Create event | Use free-text location name/address/area and optional map URL fields. No venue selector. |
| Organizer event workspace | Show location snapshot, attendee tools, scanner, giveaway claim desk link, and report link. |
| Admin event review | Show event summary, organizer, location snapshot, risk flags, perks, ride-out info, and rules. |
| Admin users | Show rider, organizer, and admin accounts only. |
| Reports | Show event-level RSVP, attendance, no-show, perk, and operational notes. |

## 10. Acceptance checks

- The Prisma schema and generated client contain no `Venue` model, `venue` role, `Event.venueId`, `ownedVenues`, or `PENDING_VENUE_APPROVAL`.
- Clean seed creates one organizer and one admin, with no example rider, scan rider, venue user, or generated organizer owner.
- Organizer event creation accepts arbitrary valid location data and produces `PENDING_ADMIN_REVIEW`.
- Public event, pass, organizer, admin, and report surfaces read the event-owned location snapshot.
- Removed venue/onboarding routes and controls are absent from navigation and active UI.
- Browser acceptance must use the Codex browser surface, not Playwright.
