# Public Raffle Status Layout

## Goal

Make the event raffle section understandable whether an event has one or many
open raffles, published winners, or both. Do not make an open raffle and an
older completed raffle look like two states of the same campaign.

## Public Layout

The section keeps the simple eyebrow label and heading:

- Eyebrow: `Raffles`
- Heading: `Event raffles`

Campaigns are separated by purpose instead of mixed into one spotlight grid.

### Open raffles

- Render this group when at least one campaign is open.
- Label the group `Open raffles`.
- Render every open campaign as an entry-focused card.
- Use the status label `Open now`.
- Keep the visible prize, prize description, campaign title, dates, entry
  action, mechanics, and terms on the card.
- The first open raffle may remain visually prominent, but later open raffles
  must expose the same essential information without requiring a disclosure.

### Recent winners

- Render this group only when a completed campaign has a published public
  winner.
- Label the group `Recent winners`.
- Present completed campaigns as past results, not as active raffle states.
- Use the status label `Latest winner` for the newest result and `Winner`
  for any additional published results.
- Keep the prize image, campaign title, public winner alias, prize won,
  mechanics, terms, and optional draw verification visible in the existing
  result card.
- When no public winner exists, omit this group entirely. Do not show an empty
  state that implies a draw already happened.

## State Rules

- Open raffles and recent winners may appear at the same time because they
  represent different campaigns, but they must be in separately titled groups.
- Multiple open raffles are all shown under `Open raffles`.
- If there are open raffles but no published winners, show only `Open raffles`.
- If there are published winners but no open raffles, show only
  `Recent winners`.
- Other public campaign states remain in compact cards beneath the primary
  groups with their existing truthful state labels.
- If no campaign is displayable, do not render the public raffle section.

## Responsive Behavior

- Desktop may use a multi-column grid within each group.
- Mobile uses one card per row.
- Cards and prize media must stay within the viewport without horizontal
  scrolling.
- Group headings remain visible and must not be replaced by status-only badges.

## Accessibility

- The section heading labels the whole raffle region.
- Each displayed group has its own heading.
- Status text does not rely on color alone.
- Existing prize-image alternative text and keyboard-accessible actions remain.

## Verification

- Add a component test with multiple open raffles and no completed raffle; it
  must show `Open raffles`, every open campaign, and no `Recent winners`.
- Add a component test with open raffles and a published winner; it must render
  the two separately titled groups.
- Update copy assertions from `Ongoing` and `Completed` to the public labels
  `Open now`, `Latest winner`, and `Winner` as applicable.
- Verify the production event at desktop and mobile widths after deployment.
