# Rider profile safety and clarity design

## Goal

Make `/profile` honest, safe, and easy to complete. The editor must describe the existing save and visibility behavior accurately, destructive photo actions must require confirmation, and each section must explain only the actions users need there.

## Existing profile lifecycle

- Preserve the existing server behavior: the first valid profile-details save can allocate the stable rider slug.
- Do not introduce a separate publish endpoint or change roster/profile visibility semantics.
- Motorcycle details and motorcycle photos improve profile completeness, but the editor must not claim they block publication.
- Profile visibility continues to decide who can view a saved profile. Private profiles remain owner-only until visibility changes.
- The completion state is guidance for building a useful rider card, not a second publication state.

## Editor actions

- Keep `Save profile details` and `Save motorcycle details` separate because motorcycle drafts cannot be persisted until make and model are complete.
- Remove the duplicate header submit behavior. Profile details have one save action in their section.
- Keep preview/view navigation available. When drafts are dirty, label the owner route `Preview saved profile` and explain that unsaved changes are not included.
- Warn before refresh, close, or same-origin navigation while profile or motorcycle fields are dirty.
- Photo selection uploads immediately. Copy must say this explicitly.

## Destructive media

- `Delete profile photo` and `Delete motorcycle photo` open an accessible confirmation dialog.
- The dialog names the item, explains that deletion cannot be undone, and offers `Keep photo` plus `Delete photo`.
- Queue `Remove` remains immediate because it only removes an unpersisted local selection.

## Copy and hierarchy

- Remove the redundant `Rider profile` eyebrow and Identity description.
- Replace the three requirement chips with one missing-requirement sentence and its jump action.
- Keep the required legend, attendance scope, anonymity rule, and save/upload status regions.
- Replace photo jargon and duplicate format copy with one concise instruction at each uploader.
- Use `Previous position` and `Next position` for saved-photo ordering.
- At 640 px and below, render saved motorcycle-photo cards in one column so actions are readable.

## Verification

- Add failing tests before each behavior change.
- Cover honest completion and saved-profile viewing behavior without changing backend publication contracts.
- Cover confirmation-dialog markup, copy changes, saved-preview behavior, and unsaved-change guard registration.
- Run the focused profile/media suites, targeted ESLint, full server tests, and production build.
- Use only the Codex in-app browser for live QA when its localhost policy allows access; never substitute another browser automation surface.
