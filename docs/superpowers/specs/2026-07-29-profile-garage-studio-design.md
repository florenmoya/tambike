# Profile Garage Studio Design

## Goal

Turn `/profile` into a complete, professional rider-profile editor centered on the rider's motorcycle and photos. Riders must be able to update identity, privacy, motorcycle details, avatar, and an ordered motorcycle gallery without losing unsaved work or leaving the page.

The existing private S3 upload and finalization pipeline remains authoritative. This work improves the editing experience and does not introduce another storage provider, public object keys, or a separate media model.

## Product Direction

The page becomes a "Garage Studio": a photo-led editor inspired by a well-kept motorcycle workshop rather than a generic settings dashboard.

Desktop uses a two-column composition:

```text
+---------------------------------------------------------------+
| Garage Studio                       [View public rider page]    |
| Build the rider card people see at events                     |
+--------------------------------------+------------------------+
| EDITOR                               | LIVE RIDER CARD        |
| Profile completion and status        | Sticky preview         |
|                                      | Avatar and identity     |
| Identity and privacy                 | Motorcycle hero        |
| Motorcycle details                   | Key specifications      |
| Motorcycle photo workspace           | Short profile note      |
+--------------------------------------+------------------------+
```

On mobile, the same content becomes one vertical flow. The editor leads, the preview becomes a compact summary near the top, and every media control stays inside the viewport.

## Visual System

- Asphalt: `#17191C` for the page canvas and strongest text.
- Workshop paper: `#F4F1EA` for editor surfaces.
- Brushed steel: `#AEB4B8` for quiet borders and metadata.
- Signal amber: `#F2A41D` for the active cover, progress, and primary actions.
- Tail-light red: `#B83B32` for destructive actions and errors only.
- Roadside green: `#3E6B55` for confirmed saves and completed uploads.

Typography keeps the application's existing loaded fonts but uses them deliberately: condensed, tightly tracked display treatment for the Garage Studio title; calm sans-serif body copy; and monospace utility labels for photo order and motorcycle specifications.

The signature element is the motorcycle photo rail. Its first frame is visibly larger and labeled `Cover`, making the public rider-card result understandable while editing. Motion is limited to upload progress, reordering feedback, and a restrained preview update. Reduced-motion preferences disable nonessential transitions.

## Page Structure

### Header and completion

The header identifies the page as `Garage Studio`, describes its single purpose, and provides `View rider page` when the profile is published. A compact completion summary directs riders to missing essentials without exposing internal policy or implementation details.

### Live preview

The preview uses the current draft values for display name, area, profile note, privacy state, and motorcycle details. It uses uploaded media after finalization. It is informative rather than a second editing surface.

The preview remains sticky on large screens and becomes a compact, non-sticky card on small screens.

### Identity and privacy

Identity, profile visibility, and roster identity remain one save boundary because their states affect whether the rider can appear publicly or on event rosters. Existing server-enforced privacy precedence remains unchanged.

The public UI explains outcomes in rider language:

- Public: anyone with the profile link can view the rider card.
- Members only: signed-in Tambike members can view it.
- Private: only the rider can view it.
- Visible roster identity: eligible rider cards can appear on enabled rosters.
- Anonymous roster identity: attendance contributes only to the count.

Private and unpublished profiles continue to appear anonymously regardless of the selected roster identity.

### Avatar

The avatar editor shows the current image or a purposeful empty state, a local preview after file selection, upload progress, retry guidance, replace, and delete. Square images are recommended, but the existing backend normalization remains authoritative.

### Motorcycle details

Motorcycle make and model remain required before motorcycle photos can be finalized. Year, displacement, nickname, and note remain optional. The section shows a clear saved state and preserves form values during unrelated media refreshes.

### Motorcycle photo workspace

Riders can drag images into the workspace or use a file picker. The picker supports multiple files.

The workspace:

- accepts JPEG, PNG, and WebP;
- accepts at most 8 MB per file;
- enforces five total motorcycle photos, including existing and queued files;
- creates local previews before network work starts;
- shows each item's filename and state;
- uploads accepted files sequentially;
- retains successful uploads when another item fails;
- lets riders retry or remove failed and queued items;
- clears local object URLs when previews are removed or the component unmounts;
- labels the first persisted photo `Cover`;
- supports reordering through drag-and-drop and explicit keyboard-operable move controls;
- supports individual deletion with clear destructive labeling.

Newly selected photos are appended after existing photos in selection order. Reordering is available after finalization. Sequential uploads avoid races around photo position and the five-photo limit.

## Data Flow

1. File selection creates client-only queue items with stable local IDs and preview object URLs.
2. Client validation marks invalid items immediately without contacting the server.
3. Accepted items upload sequentially through `/api/member-media/uploads`.
4. Each file is posted directly to the returned private presigned destination.
5. `finalizeMemberMediaAction` validates, normalizes, stores, and associates the image.
6. The editor refreshes after each successful finalization while preserving dirty identity and motorcycle drafts.
7. The successful queue item resolves into the persisted gallery; failed items remain actionable.
8. Reordering and deletion continue through the existing authenticated backend actions.

No email address, verification state, internal ID, password data, storage key, or presigned upload detail appears in a public profile DTO.

## Component Boundaries

- `ProfileSettings` coordinates editor data, draft preservation, saves, and the overall page composition.
- `ProfileStudioPreview` renders draft-aware rider and motorcycle presentation without performing writes.
- `MemberMediaUploader` remains responsible for one-file transport and finalization behavior.
- `MotorcyclePhotoWorkspace` owns multi-file queue state, local previews, sequential scheduling, and item-level actions.
- Pure queue helpers calculate accepted slots, state transitions, and next upload selection so they can be tested without rendering.

These boundaries keep upload scheduling separate from server transport and prevent the profile page from becoming one indivisible component.

## Error and Empty States

- Invalid type: `Choose a JPEG, PNG, or WebP image.`
- Empty file: `Choose a non-empty image file.`
- Oversized file: `Choose an image no larger than 8 MB.`
- Excess selection: explain how many available slots remain and keep valid in-limit files.
- Authentication failure: direct the rider to log in again.
- Presign or storage outage: keep the item and offer retry.
- Finalization failure: explain that processing failed and offer retry without pretending the photo is saved.
- Empty gallery: show a strong drop target and explain that the first uploaded photo becomes the cover.
- Missing motorcycle: keep photo selection disabled and direct the rider to save make and model first.

Status messages use an accessible polite live region. Errors are tied to the affected queue item and are not communicated by color alone.

## Accessibility and Responsive Requirements

- Every control has a stable visible or accessible name.
- Drag-and-drop is optional; all gallery operations work by keyboard.
- Focus indicators remain visible against light and dark surfaces.
- Pending form fieldsets and media actions expose busy and disabled states.
- Images have useful alternative text, explicit dimensions, and bounded responsive sizing.
- The page has no horizontal overflow at `390 x 844`.
- Touch targets are at least 44 CSS pixels where practical.
- Reduced-motion preferences are respected.

## Testing and Verification

### Automated

- Pure queue tests cover selection order, remaining slots, invalid files, mixed valid/invalid batches, sequential next-item selection, partial failure, retry, and cleanup.
- Uploader tests cover the existing presign, direct upload, finalization, and error mapping behavior.
- UI contract tests cover multiple file selection, accessible status, Cover labeling, move/delete actions, and draft preservation.
- Existing profile-domain, media-policy, privacy, and public DTO tests remain green.
- Run focused profile/media tests first, then the complete server suite, lint, and production build.

### Browser

Using the existing local dev server and a disposable or seeded rider session:

- verify the complete profile editor at desktop size;
- verify local previews before upload;
- upload multiple real test images;
- verify sequential progress and final gallery order;
- mark and reorder the cover through explicit controls;
- delete one photo;
- verify failed or rejected selection guidance;
- confirm dirty profile values survive media refresh;
- verify the public rider page reflects finalized media;
- repeat the critical flow at `390 x 844`;
- confirm no horizontal overflow and inspect current-page console errors.

## Scope Boundaries

This build does not add multiple motorcycles, social following, likes, comments, messaging, image editing, manual cropping, cloud-provider migration, deployment, or changes to event-roster precedence. Those are separate product decisions.
