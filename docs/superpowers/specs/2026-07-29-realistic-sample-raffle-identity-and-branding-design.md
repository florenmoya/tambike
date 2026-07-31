# Realistic Sample Raffle Identity and Helmet Branding

## Goal

Remove the remaining obviously synthetic public labels from the completed Cafe Classico raffle while preserving its existing draw, award, claim, and fulfillment history.

The completed raffle will present:

- winner: **Gabriel Cruz**
- campaign: **HJC C10 FOP Helmet Raffle**
- prize: **HJC C10 FOP Full-Face Helmet**
- image: the matching HJC C10 FOP product image from HJC's official product page

The ongoing Weekend Rider Gear Raffle stays unchanged because its prize is a multi-item package rather than a specific helmet model.

## Why this approach

The current award is attached to a dedicated seeded user:

- email: `raffle.winner.sample@tambike.ph`
- display name: `Raffle Winner`
- public winner alias: `Cafe Classico Rider`

Changing only the displayed alias to another existing rider's name would make the public result inconsistent with the award owner. Rebuilding the raffle around another rider would replace immutable giveaway history. Renaming the dedicated user and its published alias together keeps the result truthful and preserves the existing award.

The current prize is also internally generic:

- campaign title: `Cafe Classico Helmet Raffle`
- public prize title: `Cafe Classico Helmet`
- item title: `Cafe Classico Helmet`
- media: an unbranded stock helmet photo

The HJC C10 FOP is a real full-face model with a matching official product page and image. The sample will identify the exact model without implying Tambike or Cafe Classico created the helmet.

Official product source:

- page: `https://hjchelmets.us/products/c10-fop`
- image: `https://hjchelmets.us/cdn/shop/files/mc23___c10_fop_1.webp?v=1769468143&width=1600`

## Public presentation

The completed result card will read:

- `Winner: Gabriel Cruz`
- `Prize won: HJC C10 FOP Full-Face Helmet`

The campaign title will be `HJC C10 FOP Helmet Raffle`.

The prize description will be:

> A branded full-face helmet for everyday road riding.

The giveaway terms will name the same exact helmet model. A sponsor disclosure will state:

> HJC is shown as the sample prize brand. No sponsorship or endorsement is implied.

The disclosure belongs to giveaway compliance data, not as extra promotional copy in the compact result card.

## Source-of-truth changes

Update the sample raffle constants and input builders:

- `SAMPLE_RAFFLE_WINNER_NAME` → `Gabriel Cruz`
- `SAMPLE_RAFFLE_WINNER_ALIAS` → `Gabriel Cruz`
- `COMPLETED_SAMPLE_RAFFLE_TITLE` → `HJC C10 FOP Helmet Raffle`
- completed public presentation and prize item → `HJC C10 FOP Full-Face Helmet`
- completed terms and sponsor disclosure → exact branded wording
- completed photo source → official HJC product page and matching image
- completed photo media ID → `sample-raffle-hjc-c10-fop-photo-v1`

The seeded dedicated account keeps its stable ID and email so the existing award relationship remains valid.

Historical design documents remain historical. Active tests, current provisioning documentation, and maintenance constants must use the new public labels.

## Existing database update

Add a dedicated preview-first maintenance command. It must inspect only:

- the dedicated user at `raffle.winner.sample@tambike.ph`
- the completed Cafe Classico giveaway with the exact old title
- its one current fulfilled award
- its first prize pool, first prize item, latest mechanics version, and prize image

Preview output includes only host/database plus exact old/new values. It never prints credentials.

Apply is allowed only with `--apply`. Every mutation uses the previewed ID plus exact legacy value guards:

- user display name: `Raffle Winner` → `Gabriel Cruz`
- award public alias: `Cafe Classico Rider` → `Gabriel Cruz`
- giveaway title: `Cafe Classico Helmet Raffle` → `HJC C10 FOP Helmet Raffle`
- prize public title and item title: `Cafe Classico Helmet` → `HJC C10 FOP Full-Face Helmet`
- prize description → branded description
- mechanics: append one reviewed mechanics version with the branded terms and sponsor disclosure
- prize image: replace only `sample-raffle-helmet-photo-v1` with the normalized official HJC image

The transaction must abort when any guarded row no longer matches the preview. Organizer-edited or differently provisioned giveaways are skipped.

## Image replacement safety

The apply path:

1. fetches the official HJC image
2. validates a supported image content type and non-empty body
3. normalizes it through the existing member image pipeline
4. uploads it to a new S3 key using the new media ID
5. starts the guarded database transaction
6. updates the existing `GiveawayPrizeImage` record to the new media ID, key, dimensions, and MIME type
7. appends the giveaway audit event
8. commits the transaction
9. deletes the old stock-photo object only after commit

If upload or transaction fails, delete the newly uploaded object and leave the old database row and object intact.

## Audit integrity

Do not rewrite or delete existing draw, award, claim, fulfillment, or audit records.

Append:

- a giveaway update audit event covering branded prize presentation and source page
- a winner publication audit event covering the alias change

Continue the existing audit hash chain using the last event's sequence and hash.

## Testing

Add focused tests for:

- source constants use `Gabriel Cruz`
- completed raffle input uses one exact HJC C10 FOP name throughout
- sponsor disclosure is explicit and non-promotional
- photo source points to the official HJC page and new media ID
- preview plans only exact legacy rows
- already-updated rows are idempotent
- organizer-edited rows are skipped
- apply guards every changed row
- stale rows abort and roll back
- image upload failure leaves database untouched
- transaction failure removes the new uploaded object
- successful commit removes the old object
- CLI defaults to preview and requires `--apply`

Run the full server test suite after focused tests. Do not run a production build or start another development server.

## Browser verification

Reuse the existing localhost server and verify the Cafe Classico completed raffle at desktop and mobile widths.

Required visible result:

- no `Raffle Winner`
- no `Cafe Classico Rider`
- no `Cafe Classico Helmet`
- `Winner: Gabriel Cruz`
- `Prize won: HJC C10 FOP Full-Face Helmet`
- matching branded helmet image
- no horizontal overflow

## Non-goals

- changing the winner to Mika Santos or another existing rider
- rebuilding the completed draw
- changing award, claim, or fulfillment ownership
- presenting HJC as a Tambike sponsor
- changing the ongoing Weekend Rider Gear Raffle
