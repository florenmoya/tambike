# Profile Photo Queue Before Motorcycle Save

## Problem

On a new rider profile, motorcycle photo selection is disabled until the
motorcycle record has been saved. The storage workflow is healthy, but the UI
silently blocks the first photo action and does not explain the dependency.

## Goal

Let riders select and preview motorcycle photos immediately. Keep those files
local until a motorcycle exists, then begin the existing secure sequential
upload flow automatically after the motorcycle is saved.

## User Experience

- The motorcycle photo picker remains available before the motorcycle is saved.
- Selected JPEG, PNG, and WebP files show local previews immediately.
- The five-photo total limit and 8 MB per-file limit remain unchanged.
- While no motorcycle exists, the queue shows:
  `Photos are ready. Save your motorcycle to start uploading.`
- Saving the motorcycle unlocks the existing upload scheduler without requiring
  the rider to choose the files again.
- Uploads continue sequentially in the original selection order.
- Existing retry, refresh-recovery, reorder, cover, and delete behavior remains
  unchanged.

## Component Design

### ProfileSettings

`ProfileSettings` continues to own motorcycle persistence. It passes an
`uploadEnabled` flag to `MotorcyclePhotoWorkspace` based on whether the editor
has a persisted motorcycle.

### MotorcyclePhotoWorkspace

The workspace separates two concerns that are currently combined:

- file selection is available whenever the photo limit and general pending
  state permit it;
- network upload scheduling runs only when `uploadEnabled` is true.

Queued files and object URLs remain owned by the workspace, so an editor refresh
after motorcycle save does not discard them. The existing scheduler starts on
the next render when `uploadEnabled` changes to true.

### Existing Upload Pipeline

The fix does not change presigning, direct private S3 upload, finalization,
normalization, ownership checks, or same-origin media delivery. No new storage
provider, bucket, API route, or public object key is introduced.

## Data Flow

1. Rider selects one or more files.
2. Client validation runs immediately.
3. Accepted files enter the local queue and display previews.
4. If no motorcycle exists, the scheduler remains paused and guidance directs
   the rider to save the motorcycle.
5. Motorcycle save succeeds and refreshes the editor with a persisted
   motorcycle.
6. `uploadEnabled` becomes true.
7. The scheduler uploads and finalizes queued files one at a time in selection
   order.
8. The editor refreshes after each finalized photo and preserves unsaved profile
   drafts.

## Error Handling

- Invalid type, empty file, oversize file, and photo-cap errors remain local and
  item-specific.
- If motorcycle save fails, queued previews remain available and no storage
  request starts.
- Upload failures retain the existing retry behavior.
- A finalized photo whose editor refresh fails continues to block later queued
  uploads until `Refresh gallery` succeeds.
- Navigating away revokes all remaining object URLs; unsent files are not
  persisted.

## Accessibility

- The waiting guidance is exposed through the existing polite live region.
- The picker remains keyboard-operable.
- The guidance names the exact action required: `Save motorcycle`.
- Disabled or pending states must never be communicated by color alone.

## Verification

Automated tests must prove:

- a new profile can select files before a motorcycle exists;
- selected files stay queued and the scheduler does not call the upload
  dependency while `uploadEnabled` is false;
- changing `uploadEnabled` to true processes the existing queue in order;
- a failed motorcycle save leaves the queue intact;
- existing queue validation, refresh-pause, and five-photo limits still pass.

Browser verification must use a disposable rider and confirm:

- the picker is usable before motorcycle save;
- the local preview and waiting guidance appear;
- saving make and model starts the queued upload automatically;
- the saved gallery displays the uploaded photo as `Cover`;
- the presign request succeeds, S3 returns success, and the current-page console
  has no errors.

## Out of Scope

- Uploading media without a persisted motorcycle.
- Persisting unsent browser files across navigation or refresh.
- Changing avatar uploads.
- Adding another motorcycle, storage provider, or media API.
- Refactoring unrelated profile, event, carousel, or roster code.
