# Event Detail 4K-to-Mobile Responsive Fix Design

**Date:** 2026-07-29
**Status:** Approved through the annotated desktop screenshot
**Scope:** Public event-detail layout only

## Problem

The event hero uses a 1480px rail while the lower sections use a separate
1120px rail. On a 4K display this creates an oversized RSVP card, a visually
detached poster, and a second alignment for the supporting content. The
desktop grid also persists too long on narrower screens, compressing the
decision content before the 640px mobile breakpoint.

After the first responsive pass, desktop still assigned the poster to both
grid rows with `"decision poster"`. Because the RSVP card is taller than the
poster, that spanning poster area leaves a large unusable region below the
poster.

## Approved Responsive System

- Use one centered 1200px maximum rail for the hero and lower sections.
- Desktop above 1024px:
  - event introduction and a 200px poster share the first row;
  - RSVP decision card spans the full rail below them;
  - poster remains adjacent to the event introduction without reserving space
    beside the RSVP card;
  - attendee bikes remain four across inside the decision card.
- Tablet from 641px through 1024px:
  - title and a 140px poster share the first row;
  - RSVP decision card spans the full rail below;
  - supporting sections align to the same rail.
- Mobile at 640px and below:
  - retain the existing 72px poster and full-width decision card;
  - actions and two-column bike grid remain unchanged.
- Use an accurate `next/image` `sizes` value for all three poster widths.

## Boundaries

- Do not change RSVP, Interested, Share, privacy, attendee filtering, bike
  data, routes, lower-section content, or poster assets.
- Do not alter unrelated carousel work already present in shared files.
- Do not add dependencies, breakpoints outside the event-detail block, or a
  new test file.
- Preserve the staged accessibility fixes from the preceding event-detail
  work.

## Verification

- Extend the existing event-detail CSS contract before changing production
  CSS.
- Update the existing poster-asset contract for the responsive `sizes` value.
- Run focused event-detail, attendee-preview, poster, and roster tests.
- Reuse an existing localhost server for browser checks; do not start a
  duplicate server.
- At 3840px, 1440px, 1024px, 768px, and 430px verify common alignment, no
  horizontal overflow, an attached poster, and readable RSVP/bike content.
