# Poster Coverflow Carousel Design

## Goal

Modernize the existing featured-event carousel using the approved Hero 210-inspired poster geometry while preserving Tambike's dark event-discovery page and existing carousel behavior.

## Visual Design

- The carousel contains event posters only; it adds no hero heading, supporting copy, or call-to-action.
- Five posters remain visible on desktop.
- The highlighted poster stays centered, largest, front-facing, and fully readable.
- The two adjacent posters scale down and rotate slightly toward the highlighted poster.
- The two outer posters rotate close to edge-on and recede further in depth.
- Only the highlighted event displays its title, date, and location.
- Inactive captions remain hidden visually and from interaction while retaining stable card geometry during transitions.
- Poster artwork remains legible; overlays are restrained instead of heavily darkening inactive posters.

## Interaction

- Preserve the current five-second autoplay, infinite wrapping, drag/swipe navigation, keyboard navigation, focus treatment, and previous/next tire controls.
- A manual interaction continues to delay autoplay using the existing timing logic.
- Card movement uses the current event data and active-index state; no carousel dependency is added.

## Responsive Behavior

- Desktop shows the complete five-poster fan.
- Mobile keeps the active poster centered with neighboring posters partially visible and touch-drag enabled.
- The caption remains limited to the highlighted poster at every breakpoint.
- Reduced-motion behavior and keyboard focus remain supported by the existing page rules.

## Verification

- Add a browser regression that confirms only one caption is displayed.
- Add a browser regression that confirms the outer cards project narrower than the adjacent cards and the adjacent cards project narrower than the highlighted card.
- Verify initial state, one next transition, desktop geometry, and mobile overflow in the Codex browser.
- Run lint and a production build.
