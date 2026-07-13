# Flexible Event Raffles and Giveaways Design

## Decision

Tambike will add a dedicated, event-scoped giveaway domain. It will support raffles, guaranteed gifts, first-come rewards, and organizer-selected awards without treating a check-in as an automatic redemption.

This is an intentional expansion of the existing MVP requirements. The current requirements document declares automated raffles a non-goal because organizer mechanics, permits, and promotions require human review. Every operational giveaway therefore requires an organizer attestation and admin compliance approval before entries open or prizes are drawn. Tambike records mechanics and evidence; it does not certify permits, calculate taxes, collect payments, or promise legal eligibility in any jurisdiction.

## Product model

One event may contain many **Event Giveaways**. A giveaway contains its own mechanics, eligibility rules, entry window, prize pools, review state, and audit history.

Each prize pool chooses one award method:

| Award method | Use case | Server behavior |
| --- | --- | --- |
| Random draw | Raffle grand prize or door prize | Selects eligible snapshot entries using a committed CSPRNG seed and a deterministic ranking algorithm. |
| Guaranteed | Every eligible rider receives a limited or unlimited entitlement | Creates a claimable award only while inventory is available; staff still fulfils it manually. |
| First come | First 50 stickers, food stubs, or vouchers | Atomically reserves the next available prize item for an eligible rider. |
| Manual selection | Best-build award, sponsor choice, or staff-recognized prize | Authorized organizer/admin chooses an eligible snapshot entry and supplies a reason. |

An event may mix these prize pools in a single campaign. For example, a brand activation can award one random helmet, reserve 50 first-come stickers, and manually select a best-build winner under the same mechanics and eligibility window.

## Eligibility and entry policy

Campaigns combine the following server-evaluated sources:

- Rider has a going RSVP with an active pass.
- Rider has a confirmed event check-in.
- Rider has a staff-confirmed event check-in. This is the safer default for door-prize raffles.
- Rider redeemed a named existing perk.
- Organizer/admin grants a manual entry to an existing Tambike rider.
- Rider explicitly opts in or claims a campaign code after accepting the current mechanics.

The organizer chooses the allowed sources, entry mode, event-window cutoff, one-entry or weighted-entry limit, excluded roles, and whether a winner must be physically verified before fulfilment. The server never accepts a client-supplied candidate list, entry count, or winner list.

Before the first draw, the campaign transitions to **locked**. The backend materializes a canonical candidate snapshot containing the qualifying source facts and entry weights. Later registrations, check-ins, cancellations, and profile edits do not modify that snapshot. Manual changes before lock create an auditable entry event; changes after lock require a disqualification or redraw path and do not rewrite history.

## Lifecycle

```text
draft
  -> pending_compliance_review
  -> approved
  -> scheduled or open
  -> locked
  -> drawing
  -> claims_open
  -> completed

draft/pending/approved/scheduled/open -> cancelled
approved/scheduled/open/locked/claims_open -> suspended
```

- Only an approved campaign for a published, ongoing, or completed event can open, lock, draw, or fulfil prizes.
- Configuration is mutable only before entries exist. Material changes after approval create a new mechanics version and return the campaign to compliance review.
- A scheduled lifecycle is evaluated in UTC with the campaign's stored IANA time zone for display. Organizers can also manually open, pause, close, or lock within the same validation rules.
- A winner who declines, fails verification, is disqualified, or misses the claim deadline creates an immutable replacement chain. A redraw never overwrites the original award.

## Fairness and audit

The default random-draw protocol is server-side commit/reveal:

1. At lock time, generate 32 CSPRNG bytes and persist only its SHA-256 commitment with the locked snapshot digest and configuration digest.
2. Encrypt the seed with the server reward key. It is unavailable to organizers, riders, logs, and pre-draw API responses.
3. At draw time, rank every snapshot entry unit by `HMAC-SHA-256(seed, giveawayId + snapshotEntryId + unit)`, then allocate prize items in canonical order.
4. Persist draw algorithm version, candidate digest, commitment, selected awards, and a hash-chain audit record in one transaction.
5. After results are published, reveal the seed and provide a non-PII verification payload so the draw ranking can be reproduced.

This produces a tamper-evident application-level record. It does not claim to protect against a privileged database operator that can alter the database itself. The platform must not advertise an independently public-randomness guarantee unless it adds a separately reviewed external beacon protocol.

Every configuration mutation, compliance decision, entry grant, freeze, draw, award verification, claim, fulfilment, redraw, suspension, and export writes both:

- a high-level existing `AuditLog` record; and
- a `GiveawayAuditEvent` record with an append-only hash chain and no PII, session tokens, or unrevealed entropy.

Database triggers reject update and delete operations on `GiveawayAuditEvent` for the application role. Event deletion is restricted while giveaway history exists; cancellation and retention preserve evidence.

## Roles

| Actor | Allowed |
| --- | --- |
| Owning approved organizer | Draft mechanics, prizes, and eligibility; submit for review; operate approved campaigns; view only campaign-scoped fulfilment data. |
| Admin | Approve/reject compliance review, suspend, void, force a reasoned redraw, inspect complete audit history, and export approved operational data. |
| Event venue owner or explicitly assigned giveaway operator | Verify winner presence and manually fulfil a prize. Cannot edit mechanics, lock entries, draw, redraw, or export entrants. |
| Rider | Read public mechanics, accept terms, create only their own allowed entry, see only their own entry/award/claim state, and present a claim QR. |
| Guest | Read public mechanics and published non-PII winner aliases only. |

Existing event ownership checks remain the baseline. A new `GiveawayOperator` grant limits delegated staff to verification and fulfilment. Rider self-check-in policy remains independent: pending review check-ins do not qualify until staff confirmation.

## Prize fulfilment

Each prize pool expands into individually lockable `GiveawayPrizeItem` records. This makes inventory, reservation, fulfilment, and redraw race-safe.

- Onsite physical prize: staff scans the rider's one-time award QR or enters its manual code, verifies the award, then records handoff.
- Manual-contact prize: the rider receives an in-app notification and the organizer records a contact outcome without placing contact information in public views or exports.
- Digital-code prize: the code is encrypted at rest and released only to the authenticated winner after the award becomes claimable.

The existing `Perk` and `PerkRedemption` data remains separate. No existing `Perk(type = "Raffle")` is backfilled into a giveaway, and a confirmed check-in never automatically redeems a limited perk or prize.

## Surfaces

- Organizer: `/organizer/events/[eventId]/giveaways` hosts the campaign builder, candidate preview, lock/draw controls, prize worklist, and audit timeline.
- Admin: `/admin/giveaways` and `/admin/giveaways/[eventId]` host compliance review, suspension/override controls, and data export.
- Venue/staff: `/venue/events/[eventId]/giveaways` contains an award-verification and fulfilment queue only.
- Rider: the event page explains mechanics; the pass and completed check-in views show only the rider's own entry/award state. A dedicated claim page renders a one-time award QR but cannot fulfil it.
- Public: an optional winner list uses a rider-selected alias, never email, phone, pass ID, entry source, or audit data.

The staff prize scanner is a distinct `GiveawayClaimPanel`. It may reuse camera, QR-image-upload, and manual-code capture primitives from the pass scanner, but it calls distinct giveaway actions and cannot perform attendance mutations.

## Privacy, safety, and reporting

Public and rider DTOs exclude emails, phones, raw IDs, source metadata, audit data, prize secrets, and unrevealed seeds. Giveaway workspaces use scoped server actions rather than placing candidate or winner data in the broad `DemoState` snapshot.

Reports show counts only where appropriate: eligible riders, entries, disqualifications, prizes allocated, verified, fulfilled, expired, and redraws. Raw entrant/winner CSV is admin-only, uses CSV-injection escaping, sends `Cache-Control: private, no-store`, and creates an export audit event. Organizers receive only the information necessary to fulfil their own approved prize.

## Explicit exclusions

- No paid entries, tickets, wallets, cash handling, or tax calculation.
- No automatic permit validation or legal conclusion.
- No public entrant list.
- No automatic prize fulfilment from a check-in.
- No migration of display-only raffle perks into operational campaigns.
- No use of a rider's QR code to bypass staff verification or claim fulfilment.
