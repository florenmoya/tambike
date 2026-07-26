# Event Detail Social-Proof Redesign

**Status:** Approved direction
**Date:** 2026-07-26
**Surface:** `/events/[eventId]`

## Problem

The event detail page still reads as a long stack of equally weighted text panels. On the live Cafe Classico page at 390 × 844:

- the event header is about 885 pixels tall;
- the attendance section begins about 1,489 pixels from the top;
- the three attendance values stack into another 228-pixel block;
- `10% coffee discount` is the attendance panel's main heading even though it is a secondary perk;
- real riders are available on the attendee page, but the event page offers only a low-emphasis roster link.

This hides the strongest social reason to attend: who is already going.

## Considered Approaches

### 1. Improve the existing count panel

Keep Going, Interested, and Expected as numbers, change the heading, and make the roster link stronger.

This is the smallest change, but the result remains abstract and does not answer who a rider may meet.

### 2. Add a compact member-only rider preview

Show the Going total and a few eligible rider portraits and names near the RSVP actions. Signed-out visitors see the turnout total and a login prompt instead of rider identities.

This is the selected approach. It adds useful social proof without duplicating the full roster page or weakening its access and privacy rules.

### 3. Embed full attendee cards

Show several full rider-and-motorcycle cards directly on the event page.

This provides the richest preview, but it would make the event page longer, duplicate the attendee page, and compete visually with the event decision and RSVP actions.

## Selected Experience

### Event header

Keep the current title, short description, schedule band, RSVP actions, and compact poster. Insert a social-proof strip immediately after the RSVP actions and before the poster in mobile reading order.

The strip contains:

- `15 riders are going` as its main message;
- up to four eligible attendee portraits;
- short visible names beside or below the portraits;
- one clear `See who’s going` link to `/events/{eventId}/attendees`;
- a quiet supporting line for Interested and Expected rather than three equal statistic cards.

At desktop widths, the strip stays in the text column. At mobile widths, it becomes a bounded card that fits within the viewport and appears before the poster.

### Signed-out and unavailable states

Actual rider identities remain member-only.

- **Signed in:** show up to four server-authorized visible attendees.
- **Signed out:** show the Going total and `Log in to see riders`.
- **Roster disabled:** show the Going total without rider identities or roster-policy explanations.
- **No visible riders:** show the Going total and `Rider profiles will appear here as they join`.
- **Preview load failure:** keep the event page usable with its existing count and roster link; do not fail the whole route.

The server remains responsible for organizer enablement, profile publication, profile privacy, and global attendance-identity precedence. The client never receives private or anonymous attendee identities.

### Perk treatment

Remove `10% coffee discount` as an `InfoPanel` heading. Present it as a compact `Perk` callout associated with the event experience:

```text
PERK  10% off coffee at Casa Classico
```

The perk uses the event accent but does not compete with attendance, RSVP, or venue information.

### Information order

1. Event type, title, and short description
2. Date, time, and location
3. RSVP and Share actions
4. Going total and attendee preview
5. Compact poster
6. What to expect
7. Perk callout
8. Venue and map
9. Conditional ride or meetup details
10. Rules
11. Organizer
12. Giveaways

The old `Perk and attendance` panel and vertically stacked attendance statistics are removed.

## Visual Direction

The new strip should feel like riders arriving together, not another dashboard card.

- Use the established charcoal, plum, and amber event palette.
- Use overlapping circular portraits with clear focus rings and resilient initial fallbacks.
- Keep the turnout sentence typographically dominant.
- Use a subtle connecting rule behind the portraits as the single signature detail.
- Avoid progress bars, large numeric tiles, gradients used only as decoration, and motorcycle thumbnails in this compact preview.
- Keep copy short; the full roster page remains the place for motorcycle details and larger rider cards.

## Data Flow and Component Boundaries

### Server route

`src/app/events/[eventId]/page.tsx` loads a four-person preview with the current server session.

A focused loader:

- requests the first four attendees from the existing roster backend;
- catches `UNAUTHENTICATED` and returns public summary data without attendee identities;
- preserves `NOT_FOUND` behavior for an unknown event;
- converts other preview failures into a non-fatal unavailable state.

### Presentation

Add a focused `EventAttendeePreview` component under `src/features/member-profiles/`.

It receives only:

- event ID;
- Going, Interested, and Expected totals;
- roster availability;
- signed-in state;
- up to four public attendee excerpts containing slug, display name, area, and profile photo URL.

It must not receive email addresses, internal user IDs, verification state, storage keys, or anonymous rider identities.

`TambikeScreen` and `EventDetail` receive the preview as an optional prop so other event-detail renderers and focused tests can retain a safe count-only fallback.

## Accessibility

- Give the preview a descriptive `Who’s going` heading or accessible label.
- Give every rider link an accessible name that includes the display name.
- Use empty alternative text for decorative duplicate portrait imagery only when the link already has an equivalent accessible name.
- Preserve visible keyboard focus for rider links, login, and full-roster navigation.
- Keep all actions at least 44 pixels high on touch devices.
- Do not communicate signed-in access, RSVP state, or roster availability through color alone.
- Respect reduced-motion preferences; the portrait group requires no entrance animation.

## Testing

### Automated

- Loader tests cover signed-in preview, signed-out summary, disabled roster, not found, and non-fatal preview failure.
- UI contracts prove the attendee preview appears near the event actions and before the mobile poster.
- UI contracts prove `10% coffee discount` is no longer an attendance heading.
- Privacy contracts prove the preview exposes only approved public rider fields.
- Existing roster-domain tests continue proving anonymous, private, unpublished, and roster-disabled riders never expose cards.
- Existing RSVP, attendee-page, poster, giveaway, and responsive contracts remain passing.

### Browser

Use the Codex browser at 390 × 844 and a desktop width.

- A signed-in rider sees the Going total and up to four real rider previews near the RSVP actions.
- A signed-out visitor sees no rider identities and gets a useful login action.
- The social-proof strip and portraits remain within the viewport.
- The perk reads as secondary event context.
- `See who’s going` opens the existing roster page.
- RSVP, Interested, Share, poster, map, organizer, and giveaway behavior remain intact.
- There is no horizontal overflow or new console error.

## Scope

- No schema or migration changes.
- No change to roster authorization or privacy precedence.
- No public exposure of member-only rider cards.
- No search, filtering, messaging, following, or social graph.
- No full motorcycle cards on the event detail page.
- No redesign of the attendee page, discovery cards, profiles, organizer tools, or giveaways.

## Success Criteria

- The page's attendance message is people-first rather than perk-first.
- Signed-in riders can recognize a few attendees without opening the roster.
- Signed-out visitors receive turnout social proof without identity leakage.
- The coffee discount remains discoverable but is visually secondary.
- The old three-card attendance stack is removed.
- The event page becomes easier to scan without becoming longer or duplicating the roster page.
