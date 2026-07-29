# Rider-first profile status design

## Goal

Make the top of Garage Studio answer the rider's real question: what should I do next so other riders can recognize me and my bike at a meetup?

## Evidence and direction

Motorcycle community products consistently make identity, bike/garage, photos, and local connection the primary profile signals. The current readiness bar is an internal completion metric and does not explain the value to a rider.

The replacement uses one short rider-facing message, a compact three-signal summary, and one contextual action. It avoids a large checklist and keeps the existing Edit profile / Preview profile switch unchanged.

## States

- Incomplete: `Show riders what you ride`; explain that name, home base, bike, and a photo help recognition; show Identity, Motorcycle, and Photo signals with completion states; show one action for the first incomplete signal.
- Complete but unpublished: `Ready for your next meetup`; explain that the card is ready but private; show `Ready to share` and the existing publish action.
- Published: `Your rider card is live`; explain that the card is discoverable; show `View your rider page` as the primary action.

The existing `Not published` badge, `4 of 4 ready` progress bar, and internal item names are removed from the header. The actual profile forms remain unchanged below it.

## Interaction and accessibility

- The contextual action is a real button or existing publish/view action; it must not be decorative copy.
- The status group has a stable accessible label and exposes the same three signals visually and to assistive technology.
- Existing 44px mode-toggle targets, focus styles, responsive layout, and preview behavior remain intact.
