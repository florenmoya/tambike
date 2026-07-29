# Profile Edit and Public Preview Mode

Date: 2026-07-29
Status: Approved design

## Problem

The Garage Studio currently shows a compact sidebar preview that is visually and structurally different from the rider garage seen at `/riders/[slug]`. Riders cannot confidently tell how their profile will look to another person.

The motorcycle photo controls also use the labels “Move earlier” and “Move later.” Those labels describe an abstract sequence instead of the visible left-to-right photo order and do not explain that the first photo becomes the large cover image.

## Goals

- Let a rider switch between editing and an accurate visitor-facing preview without leaving `/profile`.
- Keep unsaved text and motorcycle-detail drafts visible in preview mode.
- Use the same garage presentation component for the preview and the public rider route so their designs cannot drift.
- Give motorcycle photo actions names that describe the visible result.
- Preserve the existing upload queue, five-photo limit, drag-and-drop ordering, retry, refresh, and deletion behavior.
- Keep profile privacy and publication rules unchanged.

## Non-goals

- No new public route or separate preview URL.
- No changes to profile visibility, roster identity, media storage, upload validation, or publication rules.
- No social graph, comments, likes, messaging, or additional motorcycles.
- Locally selected photos do not appear in public preview until their upload and gallery refresh complete.

## Chosen Experience

The profile workspace will have a two-option mode control:

- **Edit profile** — the existing identity, privacy, avatar, motorcycle, and photo-management forms.
- **Preview profile** — a full-width rendering of the same rider garage presentation visitors see.

The selected mode is local interface state. Switching modes does not navigate, reload the page, submit a form, or discard unsaved drafts.

Preview mode includes a compact private notice above the garage:

> Preview — only you can see this

The notice belongs to the editor shell and is never part of the shared public garage component.

If the profile is unpublished or private, preview remains available. Its purpose is to show the rider what the garage would look like if a permitted visitor could open it; it does not bypass backend access rules or create a public URL.

## Shared Garage Presentation

Extract the visitor-facing garage article from `MemberProfileScreen` into a focused presentational component named `RiderGarageView`.

`RiderGarageView`:

- Accepts a `MemberProfileView`.
- Renders the identity plate, avatar, role/organizer context, area, joined date, bio, motorcycle hero, specifications, story, and ordered contact strip.
- Contains no editor controls, draft state, privacy notice, data loading, or route behavior.
- Remains the single source of truth for both public and preview presentation.

`MemberProfileScreen` retains public-page concerns:

- The page-level garage background and shell.
- The “Tambike / Rider garages” back link.
- The shared `RiderGarageView`.

The profile editor preview renders the same `RiderGarageView` inside a preview shell without the public route’s back link.

## Draft Preview Adapter

Add a pure adapter that produces a preview-safe `MemberProfileView` from:

- The latest `MemberProfileEditorView`.
- The current profile draft.
- The current motorcycle draft.

The adapter merges:

- Draft display name, area, bio, and visibility.
- Draft motorcycle make, model, year, displacement, nickname, and description.
- Saved profile photo, joined date, role, organizer information, slug, and ordered saved motorcycle photos from the latest editor snapshot.

The adapter must not mutate editor or draft objects. It must never introduce email, verification data, internal IDs, storage keys, or any other non-public field.

The adapter includes a preview motorcycle only when both trimmed draft make and model are present. Otherwise preview shows the same empty-garage state as the public page. This keeps `RiderGarageView` free of editor-only placeholder behavior and makes incomplete required data visually obvious before save.

## Photo Ordering Controls

The saved-photo cards will continue to be displayed in their persisted order. Position zero remains the cover image used by the public garage hero.

Replace the current text:

- “Move earlier” → **Move left**
- “Move later” → **Move right**

For every non-cover photo, add a direct **Set as cover** action. It moves that photo to position zero through the existing reorder operation. The current cover is visibly labeled **Cover photo** and does not show a redundant Set as cover action.

Each card shows its order as **Photo N of M**. The action order is:

1. Set as cover, when applicable.
2. Move left.
3. Move right.
4. Delete.

Drag-and-drop remains available as a faster pointer interaction. Buttons remain the complete keyboard and touch alternative.

Accessible names describe the result and target, for example:

- `Set motorcycle photo 3 as cover`
- `Move motorcycle photo 3 left`
- `Move motorcycle photo 3 right`
- `Delete motorcycle photo 3`

Disabled boundary controls remain visible so the ordering model does not jump between cards. Move left is disabled for the cover; Move right is disabled for the last photo.

## Layout and Responsive Behavior

The mode control sits near the Garage Studio heading and readiness summary so it governs the whole workspace.

Edit mode keeps the existing forms but removes the compact sticky preview column. This gives the editor more usable width and eliminates the current squeezed third-column behavior.

Preview mode is full width and uses the same asphalt, concrete, chrome, and signal-amber garage treatment as the public page. The editor-only preview notice uses the existing Studio visual language so it is clearly outside the visitor-facing card.

On small screens:

- The mode control remains a two-item segmented control with 44-pixel minimum targets.
- The public garage component follows its existing responsive rules.
- Photo actions stack or wrap without horizontal overflow.
- Large motorcycle media remains bounded to the viewport.

Reduced-motion and keyboard-focus behavior remain supported.

## State and Data Flow

1. `/profile` loads `MemberProfileEditorView` as it does today.
2. Form changes update the existing profile and motorcycle draft state.
3. Switching to Preview profile calls the pure adapter during render.
4. `RiderGarageView` renders the derived view immediately without a request or save.
5. Saving profile or motorcycle data follows existing actions and reconciliation.
6. Successful media upload refreshes the editor snapshot; the next preview render includes the saved photo.
7. Reordering or setting a cover uses the existing reorder action and refresh path.

Mode switches never affect save status, dirty flags, upload queue state, or pending operations.

## Error and Empty States

- Existing save, upload, retry, refresh, and delete messages remain in Edit profile mode.
- Preview mode never suppresses an active operation or clears its status.
- Missing avatar, motorcycle, photo, bio, or optional specifications reuse the public garage’s existing empty states.
- If a draft contains incomplete required motorcycle data, preview uses the public empty-garage state while Save motorcycle continues to enforce validation.

## Testing

### Unit and contract coverage

- The draft adapter overlays draft text and motorcycle details while preserving saved media and public metadata.
- The adapter omits non-public fields by type and source contract.
- Both public and preview paths render `RiderGarageView`.
- The obsolete compact preview and “Move earlier/later” labels are absent.
- Set as cover maps the selected photo to position zero.
- Move-left/right boundary states and accessible labels are correct.
- Existing upload queue, refresh pause, deletion, and reorder tests remain green.

### Browser verification

Use the existing development server and Codex in-app browser:

1. Open a rider with a saved motorcycle and multiple photos.
2. Change identity and motorcycle fields without saving.
3. Switch to Preview profile and confirm the draft values appear in the full public garage layout.
4. Switch back and confirm drafts and queued-upload state are preserved.
5. Set a non-cover photo as cover and confirm the hero/contact-strip order changes after refresh.
6. Verify Move left, Move right, drag ordering, and Delete at desktop and mobile widths.
7. Open the corresponding public `/riders/[slug]` page after save and confirm the garage presentation matches preview, excluding the editor-only notice and shell.
8. Confirm no horizontal overflow and no browser console warnings or errors.

## Acceptance Criteria

- Riders can switch between Edit profile and Preview profile on `/profile`.
- Preview reflects unsaved profile and motorcycle drafts without navigation or saving.
- Preview and `/riders/[slug]` use the same visitor-facing garage component.
- The compact sidebar preview is removed.
- Photo controls use Set as cover, Move left, Move right, and Delete.
- Cover and photo position are obvious without reading implementation terminology.
- Existing privacy, upload, reorder, retry, refresh, and deletion behavior remains intact.
- Focused tests, lint, production build, and the browser flow pass.
