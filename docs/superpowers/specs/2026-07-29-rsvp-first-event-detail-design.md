# RSVP-First Event Detail Design

**Date:** 2026-07-29
**Status:** Approved in conversation
**Scope:** Public event detail page only

## Summary

Reshape the event-detail hero around one job: help a rider decide whether to attend. The current page gives similar visual weight to the title, poster, schedule strip, RSVP buttons, and attendee gallery, so there is no obvious first action.

The approved direction replaces those competing blocks with one compact rider decision card. Event essentials lead into the RSVP actions, and the attendee bikes become supporting social proof inside the same decision area. The poster remains visible as event identification, but no longer dominates the page.

## Subject, Audience, and Page Job

- **Subject:** A recurring motorcycle meetup at Cafe Classico.
- **Audience:** Riders deciding whether to attend, including signed-out visitors.
- **Single page job:** Let a rider understand the essentials and make an RSVP decision within the first screen.

## Goals

- Make `I’m going` the unmistakable primary action.
- Let riders scan what, when, and where before deciding.
- Keep the event poster visible without allowing it to compete with RSVP.
- Use turnout and uploaded motorcycles as confidence-building social proof.
- Preserve the existing public privacy rules, roster behavior, and four-bike limit.
- Reduce above-the-fold height and bring the supporting event sections closer.
- Keep desktop and mobile layouts readable without horizontal overflow.

## Non-Goals

- Do not change RSVP persistence, attendance privacy, check-in, passes, or raffle behavior.
- Do not change the public attendee-preview DTO or backend queries.
- Do not expose names, bikes, or profile links for anonymous or otherwise ineligible riders.
- Do not redesign the lower event sections beyond spacing and visual continuity.
- Do not add new fonts, icon libraries, routes, dependencies, or animation systems.
- Do not change event poster assets.

## Approved Direction

### Desktop hierarchy

The hero uses a two-column composition:

```text
┌──────────────────────────────────────────────────────────────┐
│ Tambike · Every Saturday                     ┌─────────────┐ │
│ Tambike at Cafe Classico                     │ small event │ │
│ Classic bikes, coffee, and a relaxed meetup. │ poster      │ │
│                                              └─────────────┘ │
│ 6:00–8:00 PM · Casa Classico · Davao City                    │
│                                                              │
│ ┌──────────────── Rider decision card ─────────────────────┐ │
│ │ Are you joining?                  16 riders              │ │
│ │ [ I’m going ] [ Interested ] [ Share ]                  │ │
│ │ [bike] [bike] [bike] [bike]  16 interested · ~55       │ │
│ │                                 expected · View all bikes│ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

┌──────────────── What to expect ───────────────┐ ┌── Perk ──┐
```

- Main decision content occupies roughly 70–75% of the hero width.
- The poster occupies roughly 200–220px and aligns with the title/decision content.
- The event title is reduced from its current oversized treatment and stays within two lines.
- The existing three boxed date/time/location columns become one compact essentials row.
- The attendee preview is no longer a separate large card.

### Mobile hierarchy

```text
┌────────────────────────────┐
│ Tambike · Saturday [poster]│
│ Tambike at Cafe Classico   │
│ Short description          │
│ 6:00–8:00 PM               │
│ Casa Classico · Davao City │
│ ┌──── Rider decision ────┐ │
│ │ Are you joining?       │ │
│ │ [I’m going][Interested]│ │
│ │ [ Share event ]        │ │
│ │ [bike][bike]           │ │
│ │ [bike][bike] View all  │ │
│ └────────────────────────┘ │
└────────────────────────────┘
```

- Title and a 64–80px poster thumbnail share the introduction row.
- Essentials appear before the decision card.
- The poster never pushes RSVP below a full-screen poster.
- Primary and secondary RSVP actions share the first button row.
- Share spans the available width below them.
- Four bike thumbnails use a two-column grid inside the decision card.

## Components and Information Architecture

### Event introduction

Contains:

- event type and recurrence;
- title;
- shortened event description;
- compact essentials row;
- supporting poster.

The essentials row combines:

- time;
- venue;
- area or city.

The current boxed `Date`, `Time`, and `Location` cells are removed from the hero. Recurrence remains visible in the eyebrow, so `Every Saturday` is not duplicated as a separate heavy block.

### Rider decision card

This is the page’s signature element and primary visual anchor.

It contains, in order:

1. `Are you joining?`
2. turnout summary;
3. RSVP and share actions;
4. public attendee-bike preview;
5. link to the full attendee roster.

The card owns the only strong amber border/accent in the hero. Other surfaces use neutral borders so the decision reads as intentional rather than one card among many.

### Attendee-bike preview

Keep the existing behavior and data:

- heading: `16 riders` with singular handling for one rider;
- supporting line: `16 interested · ~55 expected`;
- up to four eligible uploaded motorcycles;
- roster action: `View all bikes`;
- each bike still links to the eligible rider’s public profile.

The preview becomes a compact footer within the decision card:

- four landscape thumbnails in one desktop row;
- two columns on mobile;
- no rider portrait or initials fallback;
- a failed bike image removes only that tile;
- an unavailable or organizer-disabled roster collapses the bike area without leaving an empty bordered panel.

### Lower event content

Keep the current content and behavior for:

- what to expect;
- perk;
- venue/map;
- ride or meetup information;
- rules;
- organizer;
- raffles.

Reduce the vertical gap between the hero and the first supporting section. The lower sections should read as deeper information after the attendance decision, not as another competing hero.

## Exact Action Copy

- Primary action: `I’m going`
- Secondary action: `Interested`
- Tertiary action: `Share`
- Decision prompt: `Are you joining?`
- Roster action: `View all bikes`

The existing Going modal retains:

- attendance choice;
- per-event privacy checkbox;
- exact checkbox copy: `Show my name and bike in Who’s going.`

## Visual System

### Palette

Reuse the current dark event-detail identity with stricter roles:

- **Pit black — `#070809`:** page background.
- **Workshop panel — `#151417`:** rider decision card and supporting surfaces.
- **Steel border — `#303237`:** neutral dividers and secondary borders.
- **Signal amber — `#F8BF53`:** primary action, focus, and decision emphasis only.
- **Burgundy haze — `#742846`:** restrained ambient background glow.
- **Rider white — `#F7F7F5`:** primary text.

Amber is not used equally across labels, borders, links, and buttons. Spending it on the decision card and `I’m going` makes the hierarchy legible.

### Typography

No new font dependency is added.

- **Display:** existing Geist Sans at 850–900 weight for the event title, with a smaller maximum size and tighter line length.
- **Body:** existing Geist Sans at 540–620 for descriptions and supporting copy.
- **Utility:** existing Geist Mono for recurrence and compact event essentials, used sparingly to evoke a garage ticket or event placard.

### Surfaces and depth

- Remove the heavy raised treatment from `Interested` and `Share`.
- Use one elevated surface: the rider decision card.
- Keep secondary controls flat and neutral.
- Reduce decorative glow and border contrast on the poster and lower panels.
- Do not add unrelated gradients, badges, or decorative numbering.

### Motion

- Retain the existing subtle hover zoom on bike thumbnails.
- Use a 150ms color/transform transition on RSVP and share controls.
- Do not add hero entrance animation or continuous ambient motion.
- Respect `prefers-reduced-motion`.

## Interaction and State Behavior

- `I’m going` opens the existing attendance/privacy modal.
- `Interested` keeps the existing direct registration behavior.
- `Share` keeps the existing native-share/copy behavior and inline feedback.
- Submission errors remain inline and do not close the Going modal.
- RSVP success continues to revalidate the event and attendee routes.
- Signed-out riders continue to receive the existing login prompt.
- Roster-disabled, unavailable, empty, and bike-image-failure states collapse gracefully.
- No state change should make the layout jump wider than the viewport.

## Accessibility

- Maintain heading order with one page `h1`.
- Keep action names visible, not icon-only.
- Minimum control height is 44px.
- Use visible `:focus-visible` treatment with Signal Amber.
- Preserve the attendee preview’s accessible labels for bike/profile links.
- Keep sufficient contrast for secondary text and neutral controls.
- Preserve logical keyboard order: essentials → RSVP actions → bikes → roster link → lower content.

## Implementation Boundaries

Expected implementation surfaces:

- `src/features/tambike-demo/tambike-screen.tsx`
  - reorganize the event-detail hero;
  - place RSVP actions and the attendee preview inside the decision card;
  - preserve all existing handlers and modal behavior.
- `src/features/member-profiles/event-attendee-preview.tsx`
  - restructure the preview wrapper, heading, and roster action for the compact decision-card footer;
  - preserve data handling, eligibility, links, and failure behavior.
- `src/features/member-profiles/event-attendee-preview.module.css`
  - convert the separate card into a compact decision-card footer.
- `src/app/globals.css`
  - update event-detail layout, essentials, buttons, poster, spacing, and responsive rules.
- Existing event-detail and attendee-preview tests
  - update or extend; do not create a duplicate test surface unnecessarily.

No backend, Prisma schema, migration, action contract, or public DTO change is expected.

## Verification

### Automated

- Run focused event-detail and attendee-preview UI/contract tests.
- Run existing roster/privacy tests to prove the redesign does not weaken filtering.
- Run TypeScript and lint, recording unrelated baseline failures separately.
- Do not run a production build unless explicitly requested.

### Browser

Reuse the existing Tambike server on `localhost:3000`; do not start another dev process.

Verify with the Codex Browser at:

- desktop around `1440 × 900`;
- mobile around `430 × 932`.

Check:

- RSVP decision is visible without scrolling at both sizes;
- title stays within two lines;
- poster remains supporting and does not dominate;
- essentials are readable;
- four desktop bike thumbnails and two mobile columns render;
- no horizontal overflow;
- keyboard focus is visible;
- Going modal and per-event privacy checkbox still work;
- Interested and Share still work;
- roster-disabled and failed-image states do not leave empty visual shells;
- browser console has no new errors.

## Acceptance Criteria

- A rider can identify the event, time, place, and primary RSVP action within the first screen.
- `I’m going` is the only strongly emphasized action.
- The poster is visibly secondary to the decision.
- The attendee bikes reinforce RSVP inside the same card instead of forming a second hero.
- Existing RSVP, privacy, roster, pass, share, and Interested behavior remain unchanged.
- All public privacy exclusions and the four-bike limit remain intact.
- Desktop and mobile layouts have no horizontal overflow.
