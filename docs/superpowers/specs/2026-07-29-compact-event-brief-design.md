# Compact Event Brief Design

**Date:** 2026-07-29

## Goal

Make every public event page quickly explain what riders will actually do
without sounding promotional, awkward, or overly formal. Reduce the visual
weight of rules and keep the event-detail page compact from 4K to mobile.

## Rider Need

Philippine tambike communities consistently describe the value of these events
as conversation, community, learning from other riders, shared rides, and a
welcoming place to belong. The event brief should help a rider answer:

1. What happens when I arrive?
2. Is this a casual meetup, organized ride, race, expo, or track event?
3. Can I come alone or as a first-timer?
4. Is there a ride-out, schedule, or access requirement?
5. What behavior does the venue expect?

The copy must not present attendance as a purchase, lead-generation step, or
sales offer.

Research references:

- RobiMotoPH, “Womens Month Tambike 2026 Antipolo”
- Retro Boys Laguna community and event descriptions
- KYMCO Tambike Ride 2025 event recap
- r/PHMotorcycles rider discussion about the desired chill coffee, travel,
  conversation, and community atmosphere

## Public Layout

Replace the current full-width “What to expect” panel and separate full-width
Rules panel with one compact event brief.

The brief contains:

- eyebrow: `The plan`
- an event-type-aware heading
- one or two short factual sentences from `event.whatHappens`
- a quiet `Good to know` row containing the event rules as compact chips

Rules wrap within the brief and do not receive a separate card, heading block,
or full-width row. They remain readable and accessible but visually secondary
to the event plan.

The venue, map, perk, ride schedule, organizer, attendee preview, and raffle
sections remain separate and unchanged except for layout spacing needed to
close the gap left by the removed Rules panel.

## Event-Type Headings

Use one neutral heading per event type:

| Event type | Heading |
| --- | --- |
| Tambike | Coffee, bikes, and conversation |
| Bike Night | An easy night with fellow riders |
| Coffee Ride | A social ride with a coffee stop |
| Club EB | Time with the club and riding community |
| Brand Event | Meet riders and see what is happening |
| Test Ride | Try the bikes and understand the process |
| Charity Ride | Ride together for a cause |
| Track Day | Track sessions and paddock time |
| Endurance Ride | A long ride with planned checkpoints |
| Moto Expo | Bikes, booths, and community |
| Race | Race-day viewing and rider support |

These headings describe the format. They must not use superlatives, urgency,
sales claims, or promises that the source event does not support.

## Copy Standard

Every `whatHappens` description must:

- use plain, natural English;
- stay within one or two short sentences;
- describe arrival and the actual event flow;
- say whether the event is casual, scheduled, spectator-oriented, or includes
  a ride-out when that distinction matters;
- mention first-timer friendliness only when the event format supports it;
- avoid operational jargon such as “conversion,” “lead,” “validation,”
  “follow-up list,” or “attendance rollup”;
- avoid selling language such as “exclusive,” “don’t miss,” “gear up,”
  “experience,” or “unlock”;
- avoid treating a perk as the reason to attend;
- avoid repeating the event title, venue, date, or time already shown nearby.

Example for Cafe Classico:

> Park with the group, grab a drink, and meet riders over bikes and road
> stories. Come by on your own or with friends; there is no ride-out or fixed
> program.

Race, track, expo, and endurance descriptions must be equally practical. For
example, a race description should tell spectators where the schedule and
restricted areas matter, while a charity ride description should identify the
meetup and group departure flow.

## Data Flow

The existing `Event.whatHappens` field remains the source for the description.
No schema migration or new public DTO field is needed.

A small presentation helper maps `EventType` to the event-brief heading. The
event-detail component renders the helper result, the existing description,
and the existing `event.rules` inside the compact brief.

All seeded event descriptions in `src/features/tambike-demo/data.ts` are
rewritten to the copy standard. `prisma/seed.ts` continues to persist those
values for new environments.

Existing event rows in the active database are updated through an exact,
preview-first maintenance operation keyed by stable event ID. It updates only
the expected seeded events and only their `whatHappens` value. The operation is
idempotent and uses old-value guards so changed organizer content is not
overwritten.

## Responsive Behavior

Desktop and 4K:

- the event brief uses the available content width without becoming a tall
  empty card;
- the plan remains the primary text;
- `Good to know` stays visually compact and wraps naturally.

Mobile:

- the brief becomes one compact stack;
- descriptions remain fully readable without truncation;
- rule chips wrap without horizontal scrolling;
- no rule creates a full-width oversized row by itself;
- touch targets and contrast remain accessible.

## Verification

- Contract tests cover every event type heading and the compact rules
  placement.
- Copy tests reject prohibited promotional and operational phrases in seeded
  public event descriptions.
- A maintenance preview lists only exact seeded event IDs and changed
  descriptions.
- Database writes require explicit approval for the named environment after
  preview.
- The second preview reports zero changes.
- Codex Browser verification covers Cafe Classico plus at least one race or
  track event at desktop and mobile widths.
- Browser checks confirm no horizontal overflow and no separate full-width
  Rules panel.
- The full server test suite passes without running a production build.
