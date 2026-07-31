# Large-Screen Seven-Poster Carousel Design

## Goal

Show two additional event posters in the featured carousel on large and 4K
screens without changing the established five-poster composition on smaller
viewports.

## Responsive behavior

- Viewports below 1920px continue to show offsets `-2` through `+2`: two
  posters on each side of the highlighted event.
- Viewports at 1920px and wider also show offsets `-3` and `+3`, producing
  seven visible posters.
- The added outer posters are smaller, darker, deeper, and more sharply angled
  than the existing side posters so the highlighted event remains dominant.
- The outer posters stay inside the viewport at 2048px and scale naturally
  through 4K.

## Interaction and accessibility

- All visible posters retain the existing pointer navigation and loading
  feedback.
- Dragging, wheel buttons, keyboard movement, and the highlighted caption are
  unchanged.
- Responsive visibility is derived from the same 1920px media query in the
  component and CSS so hidden posters cannot intercept pointer input or appear
  in the accessibility tree.
- A viewport change updates poster visibility without resetting the highlighted
  event.

## Verification

- At 1440px, exactly five posters remain visible.
- At 2048px and 3840px, exactly seven posters are visible and the two outer
  posters remain inside the viewport.
- The highlighted poster stays centered.
- An outer poster remains clickable at the large-screen breakpoint.
- Existing loading, drag, lint, and production-build checks continue to pass.
