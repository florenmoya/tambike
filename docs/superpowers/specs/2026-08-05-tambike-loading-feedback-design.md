# Tambike Loading Feedback Design

## Goal

Give riders immediate, unmistakable feedback while Tambike opens an event or
loads the profile editor. Both states will use the existing motorcycle wheel as
the shared branded loading signature.

## Scope

This change covers two loading moments:

1. the initial member-profile editor request on `/profile`; and
2. navigation from any event link on `/events`, including the featured carousel
   and every event-grid card.

It does not change event routing, profile data loading, error recovery, event
registration, or any persistent data.

## Visual Direction

The existing carousel wheel supplies the tire, spokes, hub, metallic highlights,
and rotational motion. The loading treatment will preserve that recognizable
shape while giving it a dedicated loading size and class so carousel navigation
styles and responsive rules cannot accidentally change the loader.

The supporting palette remains Tambike-specific:

- Road Tar: `#0a0504` for the modal veil and wheel depth;
- Tambike Gold: `#ffca5d` for the primary loading highlight;
- Brass: `#b67623` for the secondary metallic accent;
- Warm Cream: `#fff4cf` for the status copy; and
- Muted Ash: `#9c9185` for supporting copy.

The wheel is the single expressive element. Surrounding surfaces remain quiet,
compact, and free from decorative progress bars, percentages, or skeleton rows.

## Shared Loading Wheel

A small reusable presentational component will render the existing tire, four
spokes, and hub. It accepts no progress value and exposes no interactive
behavior. The wheel is decorative and hidden from assistive technology; its
adjacent status copy communicates the loading state.

Normal motion rotates continuously at a calm, readable speed. Under
`prefers-reduced-motion: reduce`, rotation stops and the gold/brass highlights
remain visible so the state does not depend on motion alone.

## Profile Loading State

While `getMemberProfileEditor()` is unresolved, `/profile` shows a compact,
centered loading panel inside the existing profile content area. The panel uses
the wheel above:

- primary copy: **Getting your garage ready…**
- supporting copy: **Loading your profile and motorcycle details.**

The loading container uses `role="status"`, `aria-live="polite"`, and
`aria-busy="true"`. It reserves enough vertical space to avoid a jarring jump
without resembling an empty full-size form.

If loading fails, the current actionable error alert remains in place. The error
state does not retain the wheel or imply that work is still progressing.

## Event Navigation Modal

Activating any featured-event or grid-event link on `/events` immediately shows
a fixed loading modal over the current page. The backdrop keeps the event page
recognizable beneath a dark veil while making the loading state impossible to
miss.

The centered status panel contains:

- the shared wheel;
- primary copy: **Opening event…**; and
- the selected event title as supporting context.

The modal follows the selected Next.js link's real pending state rather than a
timer. It appears only after an event link is activated and disappears naturally
when navigation replaces the page. It blocks pointer interaction while pending
to prevent duplicate navigation. The selected link and current document retain
their normal navigation behavior.

Although visually modal, the surface is a non-interactive status rather than an
ARIA dialog: there is nothing to confirm, cancel, or focus. The status uses
`role="status"`, `aria-live="polite"`, and `aria-busy="true"`; the wheel remains
decorative. The event title is plain text and no internal routing details appear.

## Component Boundaries

- A reusable wheel component owns only the branded wheel markup.
- A profile loading component owns the inline panel and profile-specific copy.
- An event navigation status component reads the pending state of its enclosing
  event link and owns the fixed modal plus selected event title.
- Existing featured and grid event links remain the navigation source of truth.

These boundaries let both loading experiences share the brand element without
coupling profile loading to event navigation or altering the carousel wheel
controls.

## Data and State Flow

### Profile

1. `/profile` renders with no editor data.
2. The profile status panel is visible while the existing editor request is
   pending.
3. Successful data loading replaces the panel with the existing Garage Studio.
4. A failed request replaces it with the existing safe error alert.

### Event navigation

1. A rider activates a featured or grid event link.
2. The selected link enters its Next.js pending state.
3. That link's event status component renders the fixed modal with the selected
   event title.
4. Pointer interaction is blocked while the destination is opening.
5. Route replacement removes the discovery page and its loading modal.

No global timer, synthetic percentage, or persistent navigation state is added.

## Responsive Behavior

The event backdrop covers the visual viewport. Its status panel stays within the
mobile safe area, uses a bounded width, wraps long event titles, and never causes
horizontal overflow. The profile panel remains centered on desktop and mobile,
with compact padding and copy widths appropriate to a 390-pixel viewport.

## Verification

Implementation will begin with failing regression coverage for the desired
markup and pending-state behavior. Verification will include:

- the profile pending state uses the shared wheel and approved copy;
- a deliberately delayed featured-event navigation shows the modal before the
  destination loads;
- a deliberately delayed grid-event navigation shows the same modal with the
  selected event title;
- only the activated event link reports the pending state;
- duplicate pointer interaction is blocked while navigation is pending;
- reduced motion removes wheel rotation without hiding status feedback;
- profile loading failures still show the existing actionable alert;
- focused automated tests and lint pass;
- the production build completes; and
- read-only browser checks confirm desktop and 390-pixel mobile layout, no
  horizontal overflow, no console errors, and successful navigation to the
  intended event.

Browser verification will not submit profile changes or perform unrelated
persistent actions.
