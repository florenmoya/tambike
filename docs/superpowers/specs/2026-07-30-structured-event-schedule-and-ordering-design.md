# Structured Event Schedule and Ordering Design

**Date:** 2026-07-30
**Status:** Awaiting written approval
**Scope:** Event scheduling, organizer event form, and public event-list ordering

## Summary

Replace organizer-entered date and time labels with a real event schedule. Tambike stores the event start, end, timezone, and optional weekly recurrence, then generates human-readable labels for the public UI.

The public event list is ordered for a rider deciding what to attend:

1. events happening now;
2. upcoming events, nearest occurrence first;
3. finished events, most recently finished first;
4. legacy events without a usable structured date last.

For a weekly event such as Tambike at Cafe Classico, its next Saturday occurrence determines where it appears in the list.

## Goals

- Make event dates valid, sortable values instead of arbitrary text.
- Let organizers create a one-time event or a weekly recurring event.
- Show riders the nearest relevant events first.
- Generate consistent public date and time labels in the event timezone.
- Preserve existing RSVP, attendee privacy, check-in, giveaway, and event-detail behavior.
- Migrate known demo/seed events without exposing migration details in the UI.

## Non-Goals

- Do not redesign the full organizer console or public event cards.
- Do not add monthly or custom recurrence rules in this change.
- Do not create a separate event record for every weekly occurrence.
- Do not change an RSVP into a per-occurrence RSVP in this change; recurring events retain their current series-level RSVP behavior.
- Do not add a calendar provider or external scheduling service.
- Do not run a production build or start another development server.

## Schedule Model

An event schedule consists of:

- `startsAt`: the first occurrence start as a real date-time;
- `endsAt`: the first occurrence end as a real date-time;
- `timeZone`: an IANA timezone, defaulting to `Asia/Manila`;
- `recurrence`: either `NONE` or `WEEKLY`;
- `recurrenceEndsAt`: optional final recurrence date.

`startsAt` and `endsAt` are stored in UTC. The timezone is stored separately so Tambike can calculate and display the intended local wall-clock time.

Existing `dateLabel` and `timeLabel` fields remain temporarily as legacy fallbacks during migration. New and edited events use the structured schedule as the source of truth; their display labels are not entered manually.

## Organizer Experience

Replace the current `Date label` and `Time label` text fields with:

- start date;
- start time;
- end date;
- end time;
- timezone;
- repeat: `Does not repeat` or `Weekly`;
- optional recurrence end date when `Weekly` is selected.

Validation:

- start and end are required;
- end must be after start;
- recurrence end cannot be before the first occurrence;
- a timezone must be selected;
- invalid fields show concise inline errors.

For a weekly event, the organizer selects the first real occurrence. Tambike derives the weekday from that date. It does not ask the organizer to type `Every Saturday`.

## Generated Public Copy

Public labels are derived from the schedule:

- one-time event card: `Sat · Sep 19, 2026`;
- recurring event eyebrow: `Every Saturday`;
- event time: `6:00 PM – 8:00 PM`;
- differing start/end dates include both dates;
- all labels render in the event timezone.

The database values remain machine-sortable while the UI remains rider-friendly.

## Occurrence Calculation

For a one-time event, the relevant occurrence is its stored start and end.

For a weekly event:

- preserve the local weekday, start time, duration, and timezone from the first occurrence;
- calculate the current occurrence when the present time falls inside an occurrence;
- otherwise calculate the next valid weekly occurrence;
- stop generating future occurrences after `recurrenceEndsAt`, when provided.

This calculation is shared by the Prisma and in-memory backends so development and database-backed behavior do not drift.

## Event-List Ordering

Each public event receives a schedule state and comparison time:

- `ONGOING`: the current occurrence has started but not ended;
- `UPCOMING`: the next occurrence is in the future;
- `PAST`: a one-time event ended, or a recurring series has ended;
- `UNSCHEDULED`: no structured or safely parseable schedule exists.

Sort order:

1. `ONGOING`, earliest ending first;
2. `UPCOMING`, earliest start first;
3. `PAST`, latest ending first;
4. `UNSCHEDULED`, stable existing order.

Ties use event creation time and then event ID for deterministic results.

Search and category filters apply without changing this chronological ordering.

## Migration and Compatibility

- Add nullable schedule fields first so existing rows continue to load.
- Backfill known parseable one-time event labels into structured schedules.
- Configure Tambike at Cafe Classico as a weekly event in `Asia/Manila`, using its existing Saturday 6:00–8:00 PM schedule.
- Keep unparseable legacy labels visible, but place those events after scheduled events.
- New event creation requires a structured schedule.
- Existing organizer edits convert an event to a structured schedule before saving.
- Public API/domain mapping continues to expose formatted `date` and `time` strings where current components require them, minimizing unrelated UI churn.

## Accessibility and Responsive Behavior

- Use native date/time inputs with associated labels.
- Keep validation connected to the relevant input.
- Do not rely on color alone for invalid state.
- Stack schedule fields on narrow screens and use a compact grid on wider screens.
- Generated date labels may wrap naturally without creating horizontal overflow.

## Expected Implementation Surfaces

- `prisma/schema.prisma` and a focused migration for schedule fields and recurrence.
- Event domain types and schedule helpers.
- Prisma and in-memory event creation/listing implementations.
- Organizer event form and validation.
- Seed/demo event schedule data.
- Existing event list, event-state, backend-domain, and organizer tests.

Before changing Next.js components or actions, read the relevant installed Next.js 16 documentation under `node_modules/next/dist/docs/`.

## Verification

### Automated

- Prove new events cannot save arbitrary text as a date.
- Prove end-before-start is rejected.
- Prove one-time and weekly labels are generated correctly.
- Prove ongoing, nearest upcoming, recently past, and unscheduled ordering.
- Prove weekly events sort by their current or next occurrence.
- Prove query/category filtering preserves chronological ordering.
- Run focused server and UI contract tests, followed by the existing server test suite.
- Run type checking and linting; record unrelated baseline failures separately.
- Do not run `npm run build`.

### Browser

Reuse the existing app at `http://localhost:3000`.

Verify with the Codex Browser:

- create a one-time event using real date/time controls;
- create a weekly event and confirm generated recurrence copy;
- confirm the public list shows ongoing/nearest upcoming events first;
- confirm event detail displays the generated date/time copy;
- check desktop and mobile form layouts;
- confirm no horizontal overflow or new console errors.

## Acceptance Criteria

- Organizers no longer type date or time display labels.
- A saved event has a valid start, end, timezone, and supported recurrence value.
- Cafe Classico displays `Every Saturday` from its recurrence schedule.
- Public events are ordered by current/next real occurrence, not creation order or label text.
- Past events remain discoverable after upcoming events, newest past event first.
- Existing event records remain readable during migration.
- RSVP, privacy, attendee preview, check-in, and giveaway behavior remain unchanged.
