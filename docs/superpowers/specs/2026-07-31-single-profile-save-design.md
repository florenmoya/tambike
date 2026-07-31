# Single Profile Save Design

## Goal

Remove the confusing split between profile and motorcycle saves on `/profile`.
The editor presents one primary action: **Save profile**.

## Interaction

- One form contains profile details, attendance privacy, profile photo, and
  motorcycle details.
- One save footer appears after the motorcycle details.
- Submitting saves profile details first and saves the motorcycle draft when it
  changed.
- The button has one pending state, **Saving…**, and one success message,
  **Profile saved.**
- If profile details save but motorcycle changes fail, the page says so and
  keeps the motorcycle draft available to retry.
- Profile and motorcycle photos continue uploading immediately after file
  selection. They do not require the save button.

## Safety

- Existing server-side authentication, authorization, and validation remain
  authoritative.
- Required profile and motorcycle fields keep native browser validation.
- Media buttons remain `type="button"` so they cannot submit the profile form.
- No persistence, privacy, or publication rules change.

## Verification

- The rendered editor has one form and one submit button labeled
  **Save profile**.
- Profile photo accepts one file; motorcycle photos accept multiple files.
- Desktop and 390-pixel mobile layouts have no horizontal overflow.
- Focused profile tests, lint, and the production build pass.
