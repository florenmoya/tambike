# Rider profile safety and clarity design

## Goal

Make `/profile` honest, safe, and easy to complete. Saving a draft must not publish it, destructive photo actions must require confirmation, and the editor must explain only actions that affect the current section.

## Publication contract

- Saving identity, visibility, or attendance privacy does not create a public profile.
- Saving motorcycle details does not publish the profile.
- A separate `Publish profile` action is available only after the saved profile has a display name, area, motorcycle make, motorcycle model, and at least one motorcycle photo.
- Publishing allocates the stable rider slug and returns the refreshed editor view.
- Existing profiles with a slug remain published.
- Private published profiles remain owner-only until their visibility changes.
- The server validates publication requirements; the client status is guidance, not the security boundary.

## Editor actions

- Keep `Save profile details` and `Save motorcycle details` separate because motorcycle drafts cannot be persisted until make and model are complete.
- Remove the duplicate header submit behavior. The header `Publish profile` button calls the explicit publish action.
- Keep preview/view navigation available. When drafts are dirty, label the owner route `Preview saved profile` and explain that unsaved changes are not included.
- Warn before refresh, close, or same-origin navigation while profile or motorcycle fields are dirty.
- Photo selection uploads immediately. Copy must say this explicitly.

## Destructive media

- `Delete profile photo` and `Delete motorcycle photo` open an accessible confirmation dialog.
- The dialog names the item, explains that deletion cannot be undone, and offers `Cancel` plus the destructive confirmation.
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
- Cover explicit draft versus publish behavior in memory and Prisma backend contracts.
- Cover confirmation-dialog markup, copy changes, saved-preview behavior, and unsaved-change guard registration.
- Run the focused profile/media suites, targeted ESLint, full server tests, and production build.
- Use only the Codex in-app browser for live QA when its localhost policy allows access; never substitute another browser automation surface.
