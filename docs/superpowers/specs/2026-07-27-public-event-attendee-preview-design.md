# Public Event Attendee Preview Design

## Goal

Let every event-page visitor see a small, human preview of who is going
without requiring login. Preserve the existing privacy controls and keep the
full attendee roster protected.

The preview must also remain visually intact when a rider portrait cannot be
loaded. A failed image must become an initial avatar instead of exposing a
broken-image icon or disrupting the layout.

## Public privacy boundary

The public preview may contain at most four riders. A rider is eligible only
when every condition below is true:

- the organizer has enabled the event roster;
- the RSVP status is `going`;
- the rider selected `VISIBLE` roster identity;
- the rider has a published profile slug;
- the profile visibility is `PUBLIC`.

`MEMBERS_ONLY`, `PRIVATE`, and anonymous riders remain absent from the public
preview. Their identities do not influence preview copy beyond the already
public aggregate counts.

The preview DTO contains only:

- profile slug;
- display name;
- area;
- same-origin profile photo URL, when present.

It must never contain email, account or verification status, internal user or
RSVP identifiers, storage keys, or other administrative fields.

## Data architecture

Add a dedicated public-preview backend operation rather than weakening the
existing member roster operation.

Both the in-memory and Prisma backends implement the same contract:

1. Resolve the public event and roster setting.
2. Return the public aggregate summary.
3. If the roster is disabled, return no rider identities.
4. Select the first four eligible public riders using the existing stable
   attendee ordering.
5. Sanitize each result into the narrow preview DTO.

The event-page loader calls this public operation for guests and signed-in
visitors alike. The full attendee route continues using the existing
login-aware roster operation, so member-only identities remain confined to
the member surface.

`NOT_FOUND` retains the existing App Router behavior. Other preview failures
remain non-fatal: the event page renders its aggregate turnout and protected
roster action without identities.

## Event-page presentation

The preview keeps the existing “Who’s going” hierarchy and turnout count.

When public riders are available:

- render up to four overlapping circular portraits;
- make each portrait a link to its public rider profile;
- give each link an accessible name containing the rider’s display name;
- do not render the long comma-separated name paragraph;
- keep the facepile compact on mobile and desktop.

The “See who’s going” action remains visible and opens the full attendee
surface. That surface may still require login; only the four-rider preview is
public.

When no public riders are eligible, omit the facepile without adding privacy
or policy explanations.

## Portrait delivery and fallback

Profile photo URLs remain same-origin `/media/...` URLs. Public profile media
must be anonymously deliverable under the existing media authorization rules.

Verification must request every preview photo URL directly:

- the app route may return a signed `307` redirect;
- the final response must be `200 image/webp`;
- a `404` is an underlying media or data problem and must be diagnosed rather
  than accepted as normal.

The portrait component tracks load failure per image. Missing URLs and failed
requests both render the rider’s first display-name character inside the same
52-pixel circle. The failed image is removed from the rendered presentation,
so the browser’s broken-image icon cannot appear.

## Testing

### Backend and loader

- guests receive up to four eligible public Going riders;
- signed-in visitors receive the same public preview;
- anonymous, member-only, private, non-Going, and unpublished riders are
  excluded;
- roster-disabled events return counts without identities;
- the DTO exposes only approved fields;
- not-found and non-fatal fallback behavior remain unchanged.

### Component

- public riders render without a login gate;
- the long visible name list is absent;
- each portrait retains an accessible profile-link name;
- missing photos render initials;
- failed photos switch to initials;
- no eligible riders render a clean count-only state;
- the full-roster action remains present.

### Verification

- focused preview, roster, media, and event-page contract tests pass;
- lint and production build pass;
- guest event HTML contains the public preview but no protected fields;
- each returned media URL is checked through its final response;
- the 390-by-844 event page has no overflow or broken portrait state using the
  required Codex browser when available.

## Non-goals

- making the full roster public;
- exposing member-only profiles or anonymous RSVP identities;
- changing rider profile visibility controls;
- changing media storage, CDN configuration, or upload behavior unless direct
  delivery evidence identifies a separate defect;
- adding motorcycle cards or additional social features to the event page.
