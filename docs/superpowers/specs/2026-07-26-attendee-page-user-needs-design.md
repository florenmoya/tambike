# Attendee Page User-Needs Redesign

**Status:** Approved
**Date:** 2026-07-26
**Surface:** `/events/[eventId]/attendees`

## Problem

The attendee page currently looks separate from the Tambike event experience. Its oversized dark header emphasizes internal roster and privacy concepts instead of helping riders see who they may meet.

The public page currently exposes:

- “Ride roll-call”
- a privacy-policy explanation
- separate Going, Visible riders, and Anonymous riders totals

Those details make the page harder to scan and expose implementation language that belongs in organizer tools.

## Evidence and user job

Comparable event products use public guest lists to provide social proof and help attendees recognize who is going. Search, attendance states, hidden-guest accounting, check-in, and privacy settings remain organizer concerns.

The primary rider job is:

> I want to see who is going to this event so I know who I may meet and what they ride.

The page therefore needs to provide:

1. clear event context and a way back to the event;
2. one simple turnout total;
3. recognizable rider identity;
4. motorcycle context that supports conversation and discovery;
5. direct access to each visible rider profile.

## Selected design

Use a compact social-roster header followed immediately by rider cards:

```text
← Tambike at Cafe Classico

Who’s going                         15 going
────────────────────────────────────────────

[Rider card]  [Rider card]  [Rider card]
[Rider card]  [Rider card]  [Rider card]
```

### Header

- Add a back link using the event title and `/events/{eventId}`.
- Use “Who’s going” as the page heading.
- Show only the aggregate Going total, formatted as “15 going”.
- Remove the oversized, boxed promotional hero.
- Use the live event detail page’s dark visual language: layered amber and plum atmosphere over the `#030303 → #101113 → #030303` background, cream/white text, translucent white dividers, and amber turnout emphasis.
- Scope the dark palette to the public attendee route so organizer roster panels keep their existing readable light treatment.

### Remove from the public page

- “Ride roll-call”
- “Attendance choices belong to each rider. Private and unpublished profiles stay anonymous.”
- “Visible riders”
- “Anonymous riders”
- public explanations of roster settings or privacy precedence

Privacy enforcement and aggregate breakdowns remain unchanged in the backend. Organizer tools retain Going, Visible, and Anonymous totals.

### Rider cards

Keep the useful social information already present:

- profile photo;
- display name;
- area;
- motorcycle photo;
- motorcycle nickname, make, and model;
- link to the rider profile.

Cards should share the event page’s visual language and remain fully bounded within the viewport. Keep the established light identity area and dark motorcycle area for legibility. Mobile uses one column; wider screens progressively add columns.

### States

- **Signed out:** “Log in to see who’s going” with a login action.
- **Roster unavailable:** “The rider list isn’t available for this event.” Do not mention organizer settings.
- **No attendees:** “No riders yet” with a link to join the event.
- **Pagination:** Keep “Load more riders” and its existing progress/error announcements.

## Scope

This change is presentation-only:

- no schema or data-model changes;
- no change to privacy or authorization rules;
- no change to media delivery;
- no search, filtering, messaging, following, or social graph;
- no removal of organizer-only attendance totals.

Search can be reconsidered when typical visible rosters exceed the current first page.

## Accessibility and responsive behavior

- Preserve a single descriptive `h1`.
- Give the Going total an understandable accessible label.
- Keep visible keyboard focus on the back link, rider cards, login action, and load-more action.
- Verify at 390×844 and a desktop viewport.
- Require no horizontal overflow and no image wider than its card or viewport.

## Verification

Automated contracts must prove that the public roster:

- includes the event back link, “Who’s going”, aggregate Going total, and visible rider cards;
- excludes the removed privacy sentence, “Ride roll-call”, “Visible riders”, and “Anonymous riders”;
- preserves organizer-only anonymous and visible totals;
- preserves signed-out, unavailable, empty, and pagination behavior.

Live browser verification must compare the attendee page with the event detail page at mobile and desktop widths and confirm successful CloudFront-backed image rendering.

## Research references

- [Luma: Event Guest List](https://help.luma.com/p/event-guest-list)
- [Meetup: Reviewing an attendees list](https://help.meetup.com/hc/en-us/articles/39234367565709-Reviewing-an-attendees-list)
- [Eventbrite: Permissions Glossary](https://www.eventbrite.com/help/en-us/articles/362073/)
- [GOV.UK: Designing content and transactions around user needs](https://www.gov.uk/service-manual/design/govuk-content-transactions)

## Success criteria

- A rider can identify the event, turnout, and visible attendees without reading internal policy language.
- The public page visually continues the live dark Tambike event-detail journey without changing light organizer surfaces.
- Public privacy behavior is enforced silently.
- Organizer operational information remains available only in organizer surfaces.
