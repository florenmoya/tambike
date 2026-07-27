# Raffle Spotlight Design

**Date:** July 27, 2026
**Status:** Approved direction

## Decision

Replace the public event page's plain, technical giveaway stack with a
decision-first **Raffle Spotlight**. The open raffle leads with its prize and
entry state. The completed raffle becomes a compact, celebratory recent-winner
panel.

Rename the section from the unclear **Prize route** to **Raffles & prizes**.
Users should immediately understand what is open, what they can win, and who
recently won without reading implementation or fairness terminology.

## Scope

This pass changes only the public giveaway presentation inside the event detail
page.

It does not change:

- giveaway lifecycle, eligibility, entry, draw, claim, or fulfilment behavior;
- public DTOs, winner privacy, or draw-verification data;
- organizer, admin, claim-desk, pass, or presentation-channel surfaces;
- the event-detail hero, attendee preview, venue, rules, or organizer panels;
- production raffle records.

## Audience and page job

The audience is a rider or guest scanning a Tambike event page. The section has
one job: show the currently actionable raffle first and make the latest public
winner easy to recognize.

The interface must use rider-facing language. Terms such as `Prize route`,
`Draw receipts`, `Published fairness data`, and `Published winner aliases`
must not occupy the primary visual hierarchy.

## Considered approaches

### 1. Raffle Spotlight — selected

Use one dominant open-raffle panel and one compact recent-winner panel.

- Best action hierarchy.
- Makes the current prize feel intentional and worth entering.
- Keeps the completed result visible without letting historical evidence
  dominate the page.

### 2. Equal raffle cards

Give open and completed campaigns matching card weight.

- Simple and scalable.
- Does not tell riders what matters now.
- Repeats the current problem of making status labels do too much work.

### 3. Winner-first showcase

Lead with the announced winner and place the open raffle underneath.

- More celebratory.
- Hides the only currently actionable campaign below historical content.

## Information architecture

```text
RAFFLES & PRIZES
See what is open and who won recently.

┌──────────────────────────────────────────┐
│ OPEN NOW                                 │
│ Weekend Rider Gear Raffle                │
│ Win a rider gear package                 │
│ Opt-in entry                [Entry action]│
│ How it works                            ▾│
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ RECENT WINNER                         🏆 │
│ Cafe Classico Helmet                     │
│ Raffle Sample Rider                      │
│ How it worked · Verify the draw          │
└──────────────────────────────────────────┘
```

Open campaigns appear before completed campaigns. Existing backend ordering is
preserved within each state group.

If more than one campaign is open, the first open campaign receives the
spotlight treatment and additional open campaigns use a quieter compact card.
This pass does not add a carousel, tabs, pagination, or new campaign ranking.

## Copy

| Current | Replacement |
| --- | --- |
| Event giveaways / Prize route | Raffles & prizes |
| Entries open | Open now |
| Prize pools | Prize |
| Published winner aliases | Recent winner |
| Draw receipts | Verify the draw |
| Mechanics and terms | How it works |
| Published fairness data for this draw… | Technical verification stays inside the collapsed draw details. |
| Only winners who choose a public alias… | Winner chose to share this alias. |

The section introduction is: **See what is open and who won recently.**

The action remains role- and state-aware:

- A guest may see **Log in to enter** only where the existing public-entry
  rules already allow it.
- Riders, organizers, and admins do not receive a new or misleading action.
- This redesign does not invent a direct-entry flow on the event page.

## Visual direction

The component remains part of Tambike's near-black event-detail surface but
stops looking like a stack of generic admin cards.

### Palette

- **Asphalt:** `#08090b` — section and card foundation.
- **Pit black:** `#141318` — secondary surface.
- **Signal amber:** `#ffbe45` — open state and the one primary action.
- **Winner green:** `#5bdd91` — winner accent used sparingly.
- **Chrome:** `#e7e8ea` — high-emphasis text.
- **Smoke:** `rgba(231, 232, 234, 0.66)` — supporting copy.

### Type

Use the event page's existing sans-serif family so this component does not
introduce a new font download. Personality comes from scale, weight, and
composition:

- raffle title: 26–34px, heavy, compact line height;
- prize name: 16–18px, strong;
- status and metadata: 11–12px utility labels;
- winner alias: 20–24px, heavy sans-serif, never monospace.

Monospace remains restricted to the collapsed technical draw proof.

### Signature element

The open card uses a restrained motorcycle pit-pass/number-plate motif: an
asymmetric amber status tab and one clipped corner. The motif communicates
“active now” and belongs to Tambike's rider culture. It is the component's only
decorative gesture; surrounding borders and shadows stay quiet.

The completed panel uses a single trophy mark and a green rule. It must feel
recognizable and celebratory without confetti, animation, or a second competing
hero.

## Component behavior

Refactor `PublicGiveawayPanel` into small presentation units while preserving
the existing data-loading boundary:

- `PublicGiveawayPanel`
  - loads the existing public campaigns;
  - partitions active/open and completed campaigns for presentation;
  - renders the section heading and responsive layout.
- `OpenGiveawaySpotlight`
  - shows state, title, primary prize, entry mode, relevant schedule, and the
    existing allowed guest action;
  - keeps mechanics and terms in **How it works**.
- `CompletedGiveawayResult`
  - shows prize and public winner alias at a glance;
  - keeps mechanics under **How it worked**;
  - keeps reproducibility data under **Verify the draw**.
- `CompactGiveawayCard`
  - handles additional campaigns without giving each one full hero weight.

These may remain in `public-giveaway-panel.tsx` if the resulting file stays
clear. Split a child file only if the implementation becomes difficult to read.

## Data and privacy

Continue using `listPublicGiveawaysForEventAction` and the existing
`PublicEventGiveaway` DTO. Do not add a broader event snapshot or client-side
lookup.

The completed panel displays only aliases already present in the public result
array. It never exposes a user ID, email, entrant list, claim credential,
entry source, or private winner identity.

If a completed campaign has no public alias, show **Winner not publicly listed**
without implying that no winner exists.

## Loading, empty, and error states

- Preserve the current behavior of hiding the entire section when no public
  campaigns exist.
- Keep unavailable data non-blocking; the event page remains usable and the
  section stays hidden.
- Replace the plain loading sentence with a compact reserved spotlight
  skeleton that does not make the layout jump.
- A campaign with no prize item title falls back to the pool title or existing
  inventory summary.
- Long raffle, prize, and alias text wraps without horizontal scrolling.

## Responsive layout

### Desktop

At 900px and wider, use a two-column composition:

- open spotlight: approximately two-thirds of the width;
- recent winner: approximately one-third of the width.

Additional campaigns span the available width underneath in a compact grid.

### Mobile

At 390px:

1. section heading;
2. open spotlight;
3. recent winner;
4. any additional compact campaigns.

Cards use the full content width. Primary copy remains visible without opening
details. Touch actions are at least 44px high.

For the current Cafe Classico fixture:

- the entire giveaway section should target no more than about 680px while all
  details remain collapsed;
- the open spotlight should target no more than about 340px;
- the completed winner panel should target no more than about 220px.

These are readability targets, not clipping constraints. Content may grow
vertically when localization or unusually long real data requires it.

## Accessibility

- Keep one section-level `h2` and one `h3` per campaign.
- Status is expressed with text and not color alone.
- The trophy and gift graphics are decorative unless they convey otherwise
  unavailable information.
- Native `details`/`summary` controls remain keyboard-accessible.
- Focus states use a visible amber outline against the dark background.
- Text and interactive controls meet WCAG AA contrast.
- Reduced-motion users receive no reveal or hover animation.

## Testing and verification

### Automated

- Assert that the public section says **Raffles & prizes** and no longer renders
  **Prize route**.
- Assert that open campaigns render before completed campaigns.
- Assert that the primary fixture renders **Open now**, the active prize, and
  **Recent winner** with `Raffle Sample Rider`.
- Assert that the winner alias is not rendered with technical/monospace
  styling.
- Assert that mechanics and verification remain collapsed secondary content.
- Preserve existing guest-login eligibility and privacy tests.
- Run the focused giveaway presentation tests, full server suite, lint,
  production build, and `git diff --check`.

### Browser

Using the Codex browser against the local app and the deployed production page:

- verify 1440px desktop and 390×844 mobile layouts;
- confirm the open raffle is the first and strongest item;
- confirm the active prize and recent winner are understandable without opening
  details;
- confirm the current fixture no longer produces the approximately 1,030px
  collapsed mobile section measured before this redesign;
- confirm no horizontal overflow, clipped copy, layout shift, or new console
  errors;
- verify guest, rider, and organizer views do not show an invalid entry action.

## Acceptance criteria

- **Prize route** is absent from the public event page.
- A rider can identify the open raffle and its prize within a few seconds.
- The public winner alias is visually prominent and understandable.
- Technical draw proof is available but collapsed under **Verify the draw**.
- The current mobile fixture is materially shorter than the existing 1,030px
  section and keeps its primary information visible with details collapsed.
- Existing giveaway actions, lifecycle state, privacy, and public data contracts
  remain unchanged.
- Desktop and mobile browser checks and all required automated gates pass before
  publication.
