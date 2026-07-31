# Event Poster Navigation Feedback Design

## Goal

Give riders immediate, localized feedback after they click any visible featured-event poster while its event page is opening.

## Interaction

- Clicking a visible poster immediately marks that poster as busy.
- The selected poster receives a restrained dark veil, a gold ring spinner, and the copy `Opening event…`.
- The indicator follows the selected Next.js link's real pending state and clears automatically when navigation completes.
- A drag remains a carousel gesture: it changes the featured poster without showing the loading state or opening an event.
- The loading state disappears naturally when the event route replaces the discovery screen.

## Accessibility

- The selected poster surface exposes `aria-busy="true"`.
- The loading message uses `role="status"` so assistive technology announces it without stealing focus.
- The spinner is decorative and hidden from assistive technology.
- Reduced-motion users see the same overlay with a static ring instead of rotation.

## Visual Treatment

- Keep the event artwork visible beneath Road Tar (`#0a0504`) at 72% opacity.
- Use Tambike Gold (`#ffca5d`) and Brass (`#b67623`) for the tire-ring spinner, with Warm Cream (`#fff4cf`) utility text and Muted Ash (`#9c9185`) support tones.
- Reuse the carousel's existing condensed utility typography; introduce no new font.
- Center the indicator within the poster so feedback is visible for both featured and partially exposed side posters.
- Make the ring resemble a minimal motorcycle tire, which is the single branded signature of this loading state.
- Do not add a global progress bar, full-page blocker, or layout shift.

## Verification

- Add a regression that delays event navigation, clicks a poster, and observes `Opening event…` before the destination loads.
- Verify a real coordinate click shows the overlay immediately and reaches the correct event.
- Verify dragging still changes the featured event without triggering the overlay.
- Check desktop and mobile layouts, reduced motion, console errors, lint, and production build status.
