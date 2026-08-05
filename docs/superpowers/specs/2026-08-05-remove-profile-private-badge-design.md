# Remove Profile Private Badge Design

## Decision

Remove the **Private** status badge from the profile settings header. Keep the **Preview profile** action in its current position and preserve all profile visibility and attendance-privacy controls.

## Implementation

- Remove only the state-badge element rendered by `ProfileStudioHeader`.
- Keep the existing presentation state and label available to the rest of the profile editor; this change does not alter privacy behavior or saved data.
- Do not hide the badge with CSS or replace it with other status copy.
- Update the focused profile-header contract test to require **Preview profile** and reject the removed **Private** badge.

## Verification

- Run the focused member-profile UI contract test.
- Confirm the profile header no longer renders **Private** while **Preview profile** remains available.
- Check that no unrelated profile settings or privacy controls changed.

## Scope

No API, database, profile publication, roster privacy, attendance privacy, or public-profile behavior changes are included.
