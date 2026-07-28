# Public Raffle Inline Details and Sample Media Design

**Date:** July 28, 2026
**Status:** Approved

## Goal

Make the public event raffle section understandable without opening disclosure
controls. Each raffle should look like a simple promotional prize card rather
than an organizer or verification interface.

The two Cafe Classico sample raffles should also use realistic prize photos and
public-facing copy with no `sample` or `demo` language.

## Scope

This change covers:

- the public event-page raffle cards;
- the public copy for the two existing Cafe Classico seeded raffles;
- one managed prize image for each seeded raffle;
- the production provisioning path needed to apply those updates safely.

It does not change raffle eligibility, entry, award, claim, fulfilment,
compliance, privacy, or organizer prize-configuration behavior.

## Public information hierarchy

Important raffle information is visible immediately.

### Ongoing raffle

Show:

- prize image, when the organizer published one;
- `Ongoing` status;
- public prize name;
- campaign name;
- public prize description, when present;
- who can join or the concise entry mechanic;
- entry closing date, when configured;
- draw date, when configured;
- sponsor disclosure, when configured;
- the existing context-aware entry action.

Do not place this information inside `Raffle details`.

### Completed raffle

Show:

- prize image, when the organizer published one;
- `Completed` status;
- campaign name;
- winner alias, when publicly shared;
- public prize won;
- a concise result summary;
- draw date, when configured;
- sponsor disclosure, when configured.

Do not place this information inside `View result`.

### Technical draw verification

Published draw verification is not needed to understand the prize or result.
Keep it available under one secondary `Draw verification` disclosure after the
visible result summary.

Do not expose internal policy, encrypted draw material, entrant data, or
operator terminology.

## Layout

Use natural-height promotional cards.

On desktop, each card uses a restrained image area above its copy so an image
does not squeeze the text into a narrow column. On smaller screens, the same
single-column order is preserved.

Images use a consistent 4:3 crop with `object-fit: cover`. Do not render an
empty image placeholder when a prize has no image.

The existing amber ongoing and green completed accents remain. Reduce unused
empty space and eliminate the large blank areas produced by collapsed
accordions.

## Seeded public copy

Replace operational demonstration wording with normal raffle language.

### Ongoing

- Campaign: `Weekend Rider Gear Raffle`
- Prize: `Weekend Rider Gear Package`
- Description: `Helmet, riding gloves, and Tambike gear for your next ride.`
- Mechanics: `Registered event riders may enter once while the raffle is open.`
- Terms: `One winner will receive the Weekend Rider Gear Package. The organizer
  will announce and contact the winner after the draw.`

### Completed

- Campaign: `Cafe Classico Helmet Raffle`
- Prize: `Cafe Classico Helmet`
- Description: `A full-face helmet for safer everyday rides.`
- Public winner alias: `Cafe Classico Rider`
- Mechanics/result summary: `One eligible rider was selected from valid
  entries.`
- Terms: `The winner receives one Cafe Classico Helmet. The organizer will
  contact the winner with claiming instructions.`

Internal provisioning and audit descriptions may continue to use `sample` when
needed for operators. Those words must not appear in the public event-page DTO
fields or winner alias.

## Sample prize photos

Use two free-to-use Pexels photos selected by the user-approved direction:

- Helmet raffle:
  `https://www.pexels.com/photo/photo-of-a-motorcycle-helmet-15928222/`
- Weekend gear raffle:
  `https://www.pexels.com/photo/man-wearing-a-safety-helmet-15625079/`

Download and normalize the files once, record their source and photographer in
the deployment documentation, and provision them through Tambike's existing
managed giveaway prize-media lifecycle. Do not hotlink Pexels and do not add
arbitrary remote URLs to the public data model.

The public page does not need to display photo attribution because the Pexels
license does not require it, but the repository provisioning documentation must
retain the source URLs.

## Provisioning and idempotency

Update the existing sample-raffle provisioner rather than creating duplicate
campaigns, prize pools, winners, or media records.

The provisioner must:

- locate the two exact seeded campaigns and their prize pools;
- update the public copy and winner alias;
- upload/finalize the selected image only when the expected managed media is
  not already attached;
- preserve stable campaign and prize-pool IDs;
- remain safe to rerun;
- verify the exact public titles, descriptions, mechanics, terms, winner alias,
  and attached media after completion.

Do not delete unrelated media or raffle data.

## Verification

Automated checks should prove:

- ongoing and completed essentials render without clicking;
- the old `Raffle details` and `View result` controls are absent;
- only `Draw verification` remains collapsible;
- public output contains no seeded `demo` or `sample` wording;
- prize images render only when included in the safe public presentation;
- surprise prizes still redact their title, description, and image;
- image-less raffles still render cleanly;
- the provisioner is idempotent and targets only the intended raffle graph.

Browser verification should cover the production event page at desktop and
mobile widths, including the image crop, readable card hierarchy, visible
dates/mechanics/result, working entry action, and technical verification
disclosure.

