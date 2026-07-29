# Discoverable profile save action

## Problem

The profile-details form ends with its save control on the dark page background, visually detached from the light Identity and Attendance privacy cards it saves. The dark button blends into that background and the muted green confirmation text is difficult to read.

## Approved direction

Keep Identity and Attendance privacy in their existing shared form, then attach one full-width light action footer immediately below those cards.

The footer will:

- identify its scope as **Profile details**;
- explain that it saves identity, visibility, and attendance privacy;
- use one high-contrast amber primary button labeled **Save profile details**;
- retain the current loading label **Saving…**;
- show success or failure feedback in a readable status treatment;
- stack its content and make the button full-width on narrow screens.

The separate **Save motorcycle** action remains inside the Motorcycle card because it persists a different form.

## Interaction

- The submit button remains enabled until submission begins.
- While the request is pending, the button is disabled and displays its spinner with **Saving…**.
- The existing polite live region announces the result.
- Saving continues to reconcile the server response without changing profile or attendance semantics.

## Visual treatment

The footer uses Tambike's existing paper, asphalt, amber, and green tokens. Its light surface visually completes the two profile cards above it; the amber action becomes the only dominant control in that form. Status text must remain readable on the light surface.

At widths up to 640 px, the footer becomes a single column and the submit button spans the available width.

## Verification

- A focused UI contract must fail before implementation and then verify the footer copy, button label, status semantics, and mobile rule.
- Live QA must verify discoverability, successful save feedback, keyboard focus, and no horizontal overflow at desktop and 390 px mobile widths.
- Unrelated dirty files and the separate motorcycle form must remain unchanged.
