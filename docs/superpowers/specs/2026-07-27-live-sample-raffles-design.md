# Live Sample Raffles Design

Date: 2026-07-27

## Goal

Add two clearly labeled sample raffles to the live Tambike database so the
public and organizer experiences demonstrate both finished and active states:

- one completed raffle with one published demo winner;
- one ongoing raffle that is open for entries and has no winner.

## Host Event

Both raffles belong to `Tambike at Cafe Classico`
(`tambike-cafe-classico`). This event is already published and has 15 RSVPs,
including designated demo rider accounts. Reusing it avoids creating an
unnecessary sample event or changing unrelated accounts.

## Sample Campaigns

### Completed raffle

- Title: `Cafe Classico Helmet Raffle`
- Kind: raffle
- Final campaign state: completed
- Prize: one helmet
- Winner count: one
- Winner: a designated demo rider, never a real rider account
- Result: published through the normal draw publication flow
- Public winner label: a demo-safe alias derived from the selected demo rider

The campaign must retain its authoritative eligibility, frozen snapshot,
selection, award, publication, audit, and completion history. The public event
page may show only the winner alias and other already-approved public raffle
details.

### Ongoing raffle

- Title: `Weekend Rider Gear Raffle`
- Kind: raffle
- Campaign state: open
- Prize: one rider gear package
- Entries: open to eligible event riders
- Winner: none

This campaign represents the pending/ongoing experience. It must not contain a
draw, award, winner label, or published result.

## Implementation Approach

Use the application's existing server-authoritative giveaway lifecycle rather
than direct table inserts. The implementation should:

1. authenticate through the existing application login flow and invoke the same
   authorized backend operations used by the organizer and admin surfaces;
2. create each campaign with valid mechanics, schedule, eligibility, and prize
   configuration;
3. approve and progress the campaigns through their factual lifecycle states;
4. enter only designated demo riders in the completed raffle;
5. select one designated demo rider, publish the result, and finalize the
   completed campaign;
6. leave the ongoing campaign open without a draw or award.

The operation must be idempotent by stable sample identifiers or a preflight
lookup, so rerunning it cannot create duplicates.

## Safety and Privacy

- Perform a read-only preflight before any write.
- Do not reset, reseed, delete, or replace existing live data.
- Do not enter or select the real rider account attached to the event.
- Do not expose email addresses, phone numbers, claim credentials, delivery
  details, random seeds, or private entrant data.
- Use a designated demo rider for the visible winner.
- Stop without partial success if required organizer/admin authorization,
  encryption configuration, or lifecycle prerequisites are missing.
- Record the exact created campaign identifiers so the two samples can be
  removed later through a separately approved cleanup.

## Verification

After creation:

1. query the live backend read-only and confirm exactly two sample campaigns;
2. confirm the completed raffle has exactly one current award and one published
   demo-safe public winner;
3. confirm the ongoing raffle is open and has no draw or award;
4. open the public `Tambike at Cafe Classico` event page in the Codex browser
   and inspect both raffle states at mobile dimensions;
5. open the organizer giveaway workspace and confirm completed and open status
   presentation;
6. capture concise evidence without exposing private rider or claim data.

## Out of Scope

- New raffle UI or layout changes
- New events or real rider accounts
- Production deployment
- Changes to authentication, raffle policy, or winner-selection algorithms
- Cleanup or deletion of the sample data
