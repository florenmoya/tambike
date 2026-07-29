# Event Attendee Profile Overlay Design

**Date:** 2026-07-29
**Status:** Approved by direct instruction
**Scope:** Public event-detail attendee preview only

## Goal

Make each featured attendee feel like a rider profile instead of an anonymous
bike thumbnail. The uploaded bike remains the card background, while the
rider's public avatar and display name identify who owns it.

## Card Design

- Keep the existing four-card desktop and two-card mobile grids.
- Keep the bike photo full-bleed with the existing 3:2 card ratio.
- Add a dark bottom gradient so profile information stays readable across
  light and dark bike photos.
- Overlay the rider's public profile photo as a small circular avatar and show
  the display name beside it.
- Keep the entire tile linked to `/riders/[slug]` with the existing accessible
  profile-oriented label.
- If a public profile has no avatar or the avatar fails to load, keep the bike
  and rider name visible without generating an initial or placeholder image.
- If the bike background fails, retain the existing behavior that removes the
  broken tile.
- Rename the roster action from `View all bikes` to `View More`.

## Public Data and Privacy

- Extend `EventAttendeePreviewRider` with optional `profilePhotoUrl`.
- Both memory and Prisma public-preview implementations obtain the URL from
  the already-sanitized public profile view.
- Continue requiring Going status, visible RSVP identity, a public profile,
  roster enabled, and an uploaded motorcycle photo before a rider enters the
  preview.
- Do not expose email, user IDs, media storage keys, verification fields,
  motorcycle metadata, or private/member-only/anonymous profiles.

## Verification

- Add failing public-preview domain tests for the optional public avatar URL.
- Add failing UI tests for avatar, display-name overlay, bike background, and
  `View More`.
- Preserve the preview loader's narrow DTO and outage behavior.
- Run focused domain, loader, UI, event-detail, and roster tests.
- Reuse localhost:3000 and verify desktop and mobile layouts without starting
  another dev server or running a production build.
