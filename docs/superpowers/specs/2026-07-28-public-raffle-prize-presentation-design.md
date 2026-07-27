# Public Raffle Prize Presentation Design

**Date:** July 28, 2026
**Status:** Approved direction; awaiting written-spec review

## Goal

Make Tambike raffles read like a familiar Philippine raffle promotion: show
what a rider can win, when entries close, when the draw happens, and who won.
The organizer decides whether each prize is revealed or kept as a surprise.

The public page must never expose an internally configured prize when the
organizer selected **Keep it a surprise**.

## Scope

This improvement covers:

- prize-level reveal or surprise configuration;
- a public prize name, short description, and optional uploaded image;
- safe public API projection and redaction;
- an organizer preview of the public prize card;
- clearer ongoing and completed raffle cards on the event page;
- migration of existing prize pools without hiding currently published prizes.

It preserves the existing giveaway lifecycle, compliance review, eligibility,
entry, draw, claim, fulfilment, privacy, and audit behavior.

## Product decisions

### Prize disclosure belongs to each prize pool

A flexible campaign can contain several prize pools with different award
methods and audiences. Disclosure therefore belongs to the prize pool, not to
the whole campaign.

Each pool has one public disclosure mode:

- **Show the prize** — display the organizer's public prize presentation.
- **Keep it a surprise** — display only **Surprise prize** until the organizer
  changes the setting and republishes the configuration.

Campaign visibility remains separate. It still decides who can see the raffle;
prize disclosure decides what those viewers can know about a visible pool.

### Internal inventory and public presentation are separate

Existing pool and item titles remain the operational truth used for inventory,
draw allocation, claiming, fulfilment, and auditing.

The organizer separately configures:

- public prize name;
- optional short public description;
- optional public prize image.

This prevents an internal inventory label from accidentally becoming marketing
copy and gives surprise prizes a hard redaction boundary.

### Existing published prizes remain revealed

The migration defaults existing pools to **Show the prize** and backfills the
public prize name from:

1. the first finite prize-item title, when present;
2. otherwise the prize-pool title.

The two Cafe Classico sample raffles therefore continue to show
**Weekend Rider Gear Package** and **Cafe Classico Helmet**.

## Data model

Add a prize-disclosure enum with `revealed` and `surprise` values.

Add these fields to `GiveawayPrizePool`:

- `publicDisclosure` — required, default `revealed`;
- `publicTitle` — required by application validation when revealed;
- `publicDescription` — optional and length-limited;
- one optional relation to a finalized giveaway prize image.

Add a dedicated `GiveawayPrizeImage` record containing:

- owning prize-pool ID;
- uploader user ID;
- storage key and media ID;
- normalized MIME type;
- width and height;
- finalized timestamp and creation timestamp.

Prize images use a giveaway-specific ownership record and storage namespace.
They do not reuse rider-owned `MotorcyclePhoto` records.

The existing JPEG, PNG, and WebP validation, 8 MiB upload ceiling, image
normalization, S3 storage adapter, and cleanup pattern may be extracted and
reused. Arbitrary remote image URLs are not accepted.

When a pool changes to surprise:

- public projection ignores `publicTitle`, `publicDescription`, and image even
  if stale values remain during a failed or interrupted save;
- the organizer save clears its public image through the normal recoverable
  cleanup process;
- internal pool and item titles remain unchanged.

## Validation and lifecycle

For a revealed pool:

- public prize name is required after trimming;
- public description is optional;
- image is optional;
- a missing image never blocks publication.

For a surprise pool:

- public prize name and description are not required;
- no public image is returned;
- public copy is exactly **Surprise prize**.

Prize disclosure and public presentation are part of campaign configuration.
The existing configuration mutability and compliance-review rules apply:
material changes after approval follow the existing mechanics-version/review
path rather than bypassing review.

## Organizer experience

Rename the current prize fields to distinguish their jobs:

- **Pool title** becomes **Internal prize group**.
- **Prize items** becomes **Actual prizes and inventory**.

Add a **Public prize display** area to every prize pool:

```text
Public prize display
(•) Show the prize
( ) Keep it a surprise

Public prize name
[ Weekend Rider Gear Package                    ]

Short description (optional)
[ Helmet, riding gloves, and Tambike gear.       ]

Prize image (optional)
[ Upload image ]

PUBLIC PREVIEW
WIN: Weekend Rider Gear Package
Entries close: August 10
Draw date: August 12
```

Switching to **Keep it a surprise** changes the preview immediately to
**Surprise prize** and explains that actual inventory remains private and
available to authorized operators.

The editor keeps multiple pools, quantities, award methods, fulfilment modes,
eligible groups, and presence verification. This work does not simplify away
the existing flexible raffle features.

## Public API and privacy

Replace the public prize-pool inventory shape with a safe presentation shape:

```ts
interface PublicPrizePresentation {
  disclosure: "revealed" | "surprise";
  title: string; // exact public title or "Surprise prize"
  description?: string;
  image?: {
    url: string;
    width: number;
    height: number;
  };
}
```

The event-page DTO does not expose internal pool titles or prize-item titles.
It contains only the safe presentation plus non-sensitive award-method and
availability information needed by the public UI.

Public winner results use the same safe presentation title. A surprise result
therefore says **Prize won: Surprise prize** unless the organizer has revealed
the prize through an approved configuration change.

Rider claim and authorized operator surfaces continue to receive the actual
prize identity through their existing authenticated, scoped DTOs.

The server performs redaction before serialization. Client components never
receive hidden prize data and are not responsible for concealing it.

## Public event-page design

Use familiar Philippine raffle language and natural-height cards.

```text
RAFFLES
Join the current raffle or see the latest result.

┌──────────────────────────────────────────────┐
│ ONGOING                                      │
│ WIN: Weekend Rider Gear Package              │
│ Weekend Rider Gear Raffle                    │
│ Entries close: August 10                     │
│ Draw date: August 12                         │
│ [ Enter raffle ]  [ Raffle details ]         │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ COMPLETED                                    │
│ Cafe Classico Helmet Raffle                  │
│ Winner: Raffle Sample Rider                  │
│ Prize won: Cafe Classico Helmet              │
│ [ View result ]                              │
└──────────────────────────────────────────────┘
```

### Information hierarchy

- The revealed prize is the largest text in an ongoing card.
- **Surprise prize** occupies the same position when hidden.
- The campaign name is supporting context, not a competing headline.
- Completed cards lead with **Winner:** and **Prize won:** labels.
- Entry cutoff and draw date appear only when configured.
- The primary action uses existing role and eligibility rules.

Remove these terms from the primary public surface:

- Featured prize
- Opt-in entry
- Recent winner
- How it worked
- Verify the draw

Use one secondary **Raffle details** or **View result** control. Mechanics,
terms, sponsor disclosure, and optional draw-verification information can live
inside that secondary disclosure with plain labels.

### Visual direction

Keep Tambike's dark rider identity, but use the structure of a familiar local
promo rather than an operations dashboard:

- one amber status strip for an ongoing raffle;
- prize image at a restrained 4:3 ratio when uploaded;
- no empty placeholder artwork when there is no image;
- no forced equal card heights;
- no clipped corner large enough to affect content;
- small celebratory green accent for a completed result;
- sentence-case utility labels and readable body copy.

Desktop may use a two-column layout, but both cards align to the top and keep
their natural height. Mobile stacks the cards at full width.

## Loading, empty, and failure behavior

- Hide the section when no visible campaigns exist.
- Preserve the event page when raffle data is unavailable.
- Reserve only the compact height needed for the loading state.
- If a revealed legacy pool somehow lacks a public title, fail closed to
  **Prize details unavailable** rather than exposing an internal title.
- If an uploaded image is unavailable, show the text presentation without a
  broken-image placeholder.
- Long prize names, campaign names, and winner aliases wrap without horizontal
  scrolling.

## Accessibility

- Keep one section `h2` and one campaign `h3`.
- Express ongoing/completed state with text, not color alone.
- Prize-image alt text is generated from the public prize name; decorative
  surprise artwork, if ever added later, has empty alt.
- Actions remain at least 44 px high.
- Native disclosure controls remain keyboard accessible.
- Focus outlines, text, and status accents meet WCAG AA contrast.

## Testing strategy

Implementation follows red-green-refactor.

### Data and privacy

- A revealed pool requires a public title.
- A surprise pool serializes only **Surprise prize**.
- Internal pool and item titles never occur in a surprise public DTO.
- Existing pools migrate to revealed with the expected backfilled public title.
- Authenticated claim/operator DTOs retain the actual prize identity.

### Organizer

- The editor supports reveal and surprise modes per pool.
- Revealed mode validates the public prize name.
- Surprise mode preview hides the actual prize.
- Multiple pools can mix revealed and surprise prizes.
- Image upload validates type, size, ownership, and finalization.

### Public UI

- The prize leads the ongoing card.
- Completed output uses **Winner:** and **Prize won:**.
- Removed jargon is absent from the main surface.
- Dates render only when present.
- Role-specific entry actions retain existing behavior.
- Cards do not stretch to equal height.

### Verification

- Focused giveaway and migration tests.
- Full server suite.
- Prisma validation and generated-client check.
- Lint and production build.
- `git diff --check`.
- Codex browser verification at desktop and 390×844 mobile for revealed and
  surprise states, with no horizontal overflow or console errors.

## Rollout

1. Apply the additive schema migration and backfill existing prize pools.
2. Deploy server projection and organizer support together so old and new
   records remain readable.
3. Update the Cafe Classico sample manifests with explicit public prize names.
4. Verify revealed and surprise DTOs before changing the public cards.
5. Deploy the public presentation and confirm both production aliases resolve
   to the same ready deployment.

No destructive cleanup or prize-data rewrite is part of this rollout.

## Out of scope

- Paid raffle tickets or payment collection.
- Permit validation, tax calculation, or legal certification.
- Changes to winner selection or randomness.
- Public entrant lists.
- Automatic prize fulfilment.
- Multiple images or a prize-image gallery.
- Decorative stock images supplied by Tambike.

## Acceptance criteria

- Organizers can configure actual prizes and separate public presentation for
  each prize pool.
- Organizers can deliberately reveal a prize or keep it a surprise.
- Revealed prizes show their exact public name and optional image.
- Surprise prizes cannot leak internal titles through the public API or HTML.
- Ongoing cards clearly show prize, entry cutoff, draw date, and valid action.
- Completed cards clearly show winner and prize won.
- Public jargon and oversized empty cards are removed.
- Existing published sample prizes remain visible after migration.
- Multiple flexible prize pools and all existing award methods continue to
  work.
- Automated, responsive browser, privacy, and production-build checks pass
  before publication.
