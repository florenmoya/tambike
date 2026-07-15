# Account, Role, and Event Location Cleanup Design

## Decision

Tambike will simplify the current MVP to three authenticated roles: rider, organizer, and admin. Venue users, venue approval, and venue-owned operational workspaces will be removed. Organizers may enter an arbitrary location for each event, and the admin review becomes the only approval step before publication.

The existing `user-marco-organizer` record remains the sole organizer identity so its password hash and any valid sessions can be preserved. Its email becomes `organizer@bayanko.ph`, its display name becomes `Tambike Organizer`, and its organizer profile becomes the owner of every existing event.

The cleanup preserves the real rider `florenmoya@gmail.com` and the existing admin. It removes the example rider `mina.rider@example.com`, the deterministic scan rider `scan-rider@seed.tambike.local`, the venue user `ana.venue@example.com`, and all generated organizer users and profiles other than the retained Tambike Organizer.

## Account model

After the migration, the configured database has only these intentional account categories:

| Account | Result |
| --- | --- |
| `organizer@bayanko.ph` | Sole approved organizer, renamed from the existing Marco record. |
| `admin@bayanko.ph` | Existing admin, unchanged. |
| `florenmoya@gmail.com` | Existing real rider, including its RSVP, pass, sessions, and audit history. |
| Future rider signups | Preserved normally. The migration does not delete unknown or real riders. |

All existing events are reassigned to the retained organizer profile before any generated organizer profiles are deleted. The organizer profile keeps its stable primary key. `User.displayName`, `User.clubName`, `OrganizerProfile.displayName`, `OrganizerProfile.realName`, and `OrganizerProfile.clubPageName` are all updated to `Tambike Organizer` so no stale Marco or former club identity remains on the canonical account.

Deleting a known demo user may cascade its sessions, RSVP, pass, and check-in data according to the existing foreign keys. Audit records that support a nullable actor retain the event but lose the deleted demo actor reference. The migration must abort rather than rewrite immutable giveaway history if a removable account is unexpectedly referenced by giveaway entries, awards, fulfilments, or audit events.

## Event location model

The `Venue` model will be removed. It currently combines physical location data with an unused account-ownership concept, while the product now permits the organizer to supply any location.

Each `Event` stores its own location snapshot:

- `locationName`: required display name, trimmed and capped at 120 characters.
- `locationAddress`: required human-readable address, trimmed and capped at 240 characters.
- `locationMapLink`: optional trimmed HTTP or HTTPS navigation link capped at 500 characters.
- `area`: the existing required city or regional label, trimmed and capped at 120 characters.

The migration first adds nullable location fields, copies each event's current venue name, address, and map link, validates that every event has a location name and address, makes those fields required, then drops `Event.venueId`, `Venue.ownerUserId`, and the `Venue` table. Event IDs, slugs, dates, statuses, attendance, passes, check-ins, and giveaway history remain unchanged.

The organizer event form replaces the venue selector with free-text location name, address, area, and optional map-link fields. Server validation remains authoritative. Public event details, passes, organizer workspaces, admin review, reports, and notifications read the frozen event location instead of looking up a mutable venue record.

## Event workflow and authorization

`PENDING_VENUE_APPROVAL` is removed from the Prisma enum and TypeScript unions. Existing rows in that state move to `PENDING_ADMIN_REVIEW`. New organizer submissions also enter `PENDING_ADMIN_REVIEW` directly.

The venue approval action, venue approval DTO state, venue-specific audit action, venue role checks, and venue routes are removed. The complete `/venue/**` route tree, venue console, venue navigation, and venue login redirect disappear rather than rendering dormant or misleading screens.

Because admin review is the only remaining event approval kind, `EventApproval.approvalType` and the `ApprovalType` enum are removed instead of retaining a one-value discriminator. The nullable `CheckIn.scannedBy` foreign key changes from cascade deletion to `SET NULL`, so deleting a former demo staff account cannot delete another rider's check-in record.

Because the MVP is intentionally limited to one organizer, organizer application, organizer verification, and admin-created organizer flows are also removed. Riders cannot upgrade themselves to organizer, and the admin UI cannot create a second organizer account. Restoring multi-organizer onboarding requires a later product decision and its own authorization design.

Operational permissions become:

| Actor | Event operations |
| --- | --- |
| Owning approved organizer | Create and manage every current event, configure check-in, scan passes, configure and present raffles, and operate winner verification or fulfilment for its events. |
| Admin | Review and publish events, perform operational overrides, scan passes, and operate giveaway claims. |
| Explicit giveaway operator | Retains only the already-scoped claim verification and fulfilment permission. |
| Rider | Browses, registers, checks in through allowed rider flows, enters giveaways, and claims only their own awards. |

The giveaway claim authorization adds the owning organizer as an allowed operator. The removed venue-owner shortcut is not replaced with a broad role check.

## Seed and fixture policy

The application seed stops creating:

- Mina Rider;
- Seeded Scan Rider and its deterministic RSVP/pass;
- Ana Venue;
- generated `@seed.tambike.local` organizer owners;
- venue ownership and venue approval rows.

The seed creates only the retained organizer, admin, event content, and other non-user content needed for a clean installation. Event content points to the single organizer and embeds its location snapshot.

Tests must not depend on production-like seed users. Server and Prisma tests create riders, passes, and organizer/operator assignments inside their own setup. Browser tests create isolated test users or load fixtures only in the disposable browser-test database. A deterministic scanner pass may still exist inside a test fixture, but it must not be part of the normal application seed or configured runtime database.

## Data migration order

The migration is deliberately ordered to preserve referential integrity:

1. Assert that the canonical organizer user and profile exist and that `organizer@bayanko.ph` is not already owned by another user.
2. Add nullable event location fields and backfill them from each referenced venue.
3. Rename the canonical organizer user and profile.
4. Reassign every event to the canonical organizer profile.
5. Convert `PENDING_VENUE_APPROVAL` events to `PENDING_ADMIN_REVIEW` and remove venue-only approval rows.
6. Validate that removable accounts have no immutable giveaway-history references.
7. Delete the known example rider, scan rider, venue user, and noncanonical generated organizer profiles and users.
8. Make event location fields required, remove venue foreign keys and tables, and replace the PostgreSQL role and event-status enums without the removed values.

The migration targets known demo and generated identities, not broad email-domain deletion. It asserts that every noncanonical organizer is one of the current generated seed owners and aborts if an unexpected organizer exists. Unknown riders, the real rider, admin, events, attendance, and valid giveaway data are outside the delete set.

## UI and route cleanup

The organizer console becomes the sole event-operations workspace. Its event list contains every current event after reassignment. Check-in, reports, giveaway configuration, live raffle presentation, and claim fulfilment remain reachable from organizer routes.

The admin console removes venue-account counts, venue approval language, venue-specific filters, organizer verification queues, and organizer-creation controls. Review copy refers to event location and organizer ownership. Account role labels and filters contain rider, organizer, and admin only.

Public and rider-facing screens retain location information and map links, but no longer suggest that a venue has a Tambike account, approved an event, or owns the operational workspace.

The authoritative MVP requirements and route inventory are updated in the same change. They describe direct organizer-to-admin review, event-owned location snapshots, organizer/admin check-in, and the three-role account model. Venue-account requirements and routes are removed rather than left as historical acceptance criteria.

## Validation and failure handling

- Event creation rejects an empty title, location name, address, area, date, or time.
- `locationMapLink`, when present, must be an HTTP or HTTPS URL.
- Only an approved organizer may create or manage an event.
- Only the owning organizer or admin may configure check-in and raffle mechanics.
- Data migration fails before destructive deletion if the canonical organizer is missing, the target email conflicts, an event cannot be backfilled, or a removable user owns immutable giveaway history.
- Removed venue routes return the normal not-found response and are absent from navigation.

## Verification

Automated coverage will prove:

- `venue` and `PENDING_VENUE_APPROVAL` no longer exist in the generated client or public TypeScript contracts;
- organizer application and organizer-creation routes/actions are absent, preventing a second organizer;
- arbitrary event locations round-trip through in-memory and Prisma backends;
- every migrated event belongs to Tambike Organizer and retains its prior location text;
- the configured seed produces one organizer, no venue user, and no example or scan rider;
- the migration rejects an unexpected second organizer instead of deleting it;
- Floren's rider data is preserved by the live-data migration;
- organizer and admin check-in and giveaway operations still work;
- removed venue routes and controls are absent;
- tests create their own rider/scanner fixtures instead of relying on application seed identities.

Required verification includes Prisma generation, targeted server and migration tests, the complete server suite, Prisma integration preparation and suite, lint, production build, and Codex-browser acceptance of organizer login, the all-events list, arbitrary-location event creation, direct admin review, check-in, raffle claim operations, and removed venue-route behavior.

## Explicit exclusions

- Reintroducing multiple organizer accounts or per-event delegated managers.
- A venue directory, venue claiming, venue invitations, or venue approval.
- Preserving the former third-party organizer names as authenticated accounts or public event owners.
- Deleting the real rider, admin, events, or their valid operational history.
- Using a real rider account as an automated test fixture.
