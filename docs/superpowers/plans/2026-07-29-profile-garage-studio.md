# Profile Garage Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incomplete `/profile` settings stack with a professional Garage Studio editor that includes draft-aware preview and secure multi-file motorcycle photo uploads.

**Architecture:** Preserve the existing presign, direct-to-private-storage, and finalization pipeline. Add a pure queue domain for deterministic multi-file selection and retry behavior, a client photo workspace that schedules one upload at a time, and a focused draft-aware preview component composed by `ProfileSettings`.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript, existing shadcn/Radix components, Lucide icons, Vitest, existing private S3 media actions, and the Codex in-app browser.

## Global Constraints

- Read the relevant local Next.js 16 guides under `node_modules/next/dist/docs/` before editing application code.
- Reuse the existing `/api/member-media/uploads` and `finalizeMemberMediaAction` pipeline; do not add a provider, bucket, public storage key, or dependency.
- Accept only JPEG, PNG, and WebP files no larger than 8 MB each.
- Enforce five total motorcycle photos across persisted and queued items.
- Upload accepted files sequentially in selection order.
- Preserve unsaved identity, privacy, and motorcycle drafts during media refreshes.
- Keep profile and roster privacy precedence unchanged.
- Never expose email, verification state, internal IDs, password data, storage keys, or presigned fields in a public profile DTO.
- Keep drag-and-drop optional; every operation must remain keyboard-operable.
- Prevent horizontal overflow at `390 x 844` and respect reduced-motion preferences.
- Do not modify the unrelated carousel changes already present in `src/app/globals.css`, `src/features/tambike-demo/tambike-screen.tsx`, `tests/server/event-poster-assets-contract.test.ts`, or `tests/tambike-demo.spec.ts`; use a profile CSS module instead of `globals.css`.
- Do not create a branch or worktree.

---

### Task 1: Deterministic Motorcycle Photo Queue

**Files:**
- Create: `src/features/member-profiles/member-media-file-validation.ts`
- Create: `src/features/member-profiles/motorcycle-photo-queue.ts`
- Modify: `src/features/member-profiles/member-media-uploader.tsx`
- Create: `tests/server/member-profile-photo-queue.test.ts`
- Read: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- Read: `node_modules/next/dist/docs/01-app/02-guides/forms.md`
- Read: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`

**Interfaces:**
- Produces `validateMemberMediaFile(file: Pick<File, "type" | "size">): string | null` from `member-media-file-validation.ts`.
- Produces:
  - `MotorcyclePhotoQueueStatus = "ready" | "uploading" | "uploaded" | "failed"`
  - `MotorcyclePhotoQueueItem`
  - `enqueueMotorcyclePhotoFiles(input: EnqueueMotorcyclePhotoFilesInput): { items: MotorcyclePhotoQueueItem[] }`
  - `nextReadyMotorcyclePhoto(items: MotorcyclePhotoQueueItem[]): MotorcyclePhotoQueueItem | undefined`
  - `patchMotorcyclePhotoQueueItem(items, id, patch): MotorcyclePhotoQueueItem[]`
  - `removeMotorcyclePhotoQueueItem(items, id): MotorcyclePhotoQueueItem[]`

- [ ] **Step 1: Read the project-version Next.js guides**

Run:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
Get-Content -Raw node_modules/next/dist/docs/01-app/02-guides/forms.md
Get-Content -Raw node_modules/next/dist/docs/01-app/02-guides/server-actions.md
```

Expected: the local Next.js 16.2.11 guidance is available before application edits begin.

- [ ] **Step 2: Write queue tests**

Create `tests/server/member-profile-photo-queue.test.ts` with:

```ts
import { describe, expect, test } from "vitest";
import {
  enqueueMotorcyclePhotoFiles,
  nextReadyMotorcyclePhoto,
  patchMotorcyclePhotoQueueItem,
  removeMotorcyclePhotoQueueItem,
} from "../../src/features/member-profiles/motorcycle-photo-queue";

function image(name: string, type = "image/webp", size = 10) {
  return new File([new Uint8Array(size)], name, { type });
}

describe("motorcycle photo queue", () => {
  test("keeps accepted files in selection order and rejects files beyond five total slots", () => {
    const result = enqueueMotorcyclePhotoFiles({
      current: [],
      files: [image("a.webp"), image("b.webp"), image("c.webp")],
      persistedCount: 3,
      createObjectUrl: (file) => `blob:${file.name}`,
      createId: (file) => `queue:${file.name}`,
    });

    expect(result.items.map(({ file, status, error }) => ({
      name: file.name,
      status,
      error,
    }))).toEqual([
      { name: "a.webp", status: "ready", error: undefined },
      { name: "b.webp", status: "ready", error: undefined },
      {
        name: "c.webp",
        status: "failed",
        error: "Your garage has room for 2 more photos.",
      },
    ]);
  });

  test("marks invalid files locally without consuming a photo slot", () => {
    const result = enqueueMotorcyclePhotoFiles({
      current: [],
      files: [image("bad.gif", "image/gif"), image("good.webp")],
      persistedCount: 4,
      createObjectUrl: (file) => `blob:${file.name}`,
      createId: (file) => `queue:${file.name}`,
    });

    expect(result.items[0]).toMatchObject({
      status: "failed",
      retryable: false,
      error: "Choose a JPEG, PNG, or WebP image.",
    });
    expect(result.items[1]).toMatchObject({ status: "ready" });
  });

  test("selects only the first ready item and supports retry and removal transitions", () => {
    const queued = enqueueMotorcyclePhotoFiles({
      current: [],
      files: [image("a.webp"), image("b.webp")],
      persistedCount: 0,
      createObjectUrl: (file) => `blob:${file.name}`,
      createId: (file) => `queue:${file.name}`,
    }).items;
    const uploading = patchMotorcyclePhotoQueueItem(queued, "queue:a.webp", {
      status: "uploading",
    });
    expect(nextReadyMotorcyclePhoto(uploading)?.id).toBe("queue:b.webp");
    expect(removeMotorcyclePhotoQueueItem(uploading, "queue:a.webp").map((item) => item.id))
      .toEqual(["queue:b.webp"]);
  });
});
```

- [ ] **Step 3: Run the queue test and verify RED**

Run:

```powershell
npx vitest run tests/server/member-profile-photo-queue.test.ts
```

Expected: FAIL because `motorcycle-photo-queue.ts` does not exist.

- [ ] **Step 4: Extract shared client file validation**

Create `member-media-file-validation.ts`:

```ts
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function validateMemberMediaFile(file: Pick<File, "type" | "size">) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size < 1) {
    return "Choose a non-empty image file.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Choose an image no larger than 8 MB.";
  }
  return null;
}
```

Remove the duplicate constants and function from `member-media-uploader.tsx`, import the function from this module, and re-export it to preserve existing imports and tests:

```ts
import { validateMemberMediaFile } from "./member-media-file-validation";
export { validateMemberMediaFile } from "./member-media-file-validation";
```

- [ ] **Step 5: Implement the pure queue domain**

Create `src/features/member-profiles/motorcycle-photo-queue.ts` with no React imports:

```ts
import { validateMemberMediaFile } from "./member-media-file-validation";

export type MotorcyclePhotoQueueStatus =
  | "ready"
  | "uploading"
  | "uploaded"
  | "failed";

export interface MotorcyclePhotoQueueItem {
  id: string;
  file: File;
  previewUrl: string;
  status: MotorcyclePhotoQueueStatus;
  error?: string;
  retryable: boolean;
}

export function enqueueMotorcyclePhotoFiles(input: {
  current: MotorcyclePhotoQueueItem[];
  files: File[];
  persistedCount: number;
  createObjectUrl: (file: File) => string;
  createId: (file: File) => string;
}) {
  const activeCount = input.current.filter((item) =>
    item.status === "ready" ||
    item.status === "uploading" ||
    (item.status === "failed" && item.retryable)
  ).length;
  let remainingSlots = Math.max(0, 5 - input.persistedCount - activeCount);
  const availableAtSelection = remainingSlots;
  const additions = input.files.map((file) => {
    const error = validateMemberMediaFile(file);
    const base = {
      id: input.createId(file),
      file,
      previewUrl: input.createObjectUrl(file),
    };
    if (error) {
      return { ...base, status: "failed" as const, error, retryable: false };
    }
    if (remainingSlots === 0) {
      return {
        ...base,
        status: "failed" as const,
        error: `Your garage has room for ${availableAtSelection} more photos.`,
        retryable: false,
      };
    }
    remainingSlots -= 1;
    return { ...base, status: "ready" as const, retryable: true };
  });
  return { items: [...input.current, ...additions] };
}

export function nextReadyMotorcyclePhoto(items: MotorcyclePhotoQueueItem[]) {
  return items.find((item) => item.status === "ready");
}

export function patchMotorcyclePhotoQueueItem(
  items: MotorcyclePhotoQueueItem[],
  id: string,
  patch: Partial<Pick<MotorcyclePhotoQueueItem, "status" | "error" | "retryable">>,
) {
  return items.map((item) => item.id === id ? { ...item, ...patch } : item);
}

export function removeMotorcyclePhotoQueueItem(
  items: MotorcyclePhotoQueueItem[],
  id: string,
) {
  return items.filter((item) => item.id !== id);
}
```

- [ ] **Step 6: Run queue tests and focused uploader tests**

Run:

```powershell
npx vitest run tests/server/member-profile-photo-queue.test.ts tests/server/member-profile-ui-contract.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 7: Commit the queue domain**

Run:

```powershell
git add -- src/features/member-profiles/member-media-file-validation.ts src/features/member-profiles/member-media-uploader.tsx src/features/member-profiles/motorcycle-photo-queue.ts tests/server/member-profile-photo-queue.test.ts
git commit -m "feat: add motorcycle photo upload queue"
```

Expected: one commit containing only the queue domain and its tests.

---

### Task 2: Multi-File Motorcycle Photo Workspace

**Files:**
- Create: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Create: `src/features/member-profiles/profile-studio.module.css`
- Modify: `src/features/member-profiles/member-media-uploader.tsx`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Consumes queue helpers from Task 1.
- Consumes `performMemberMediaUpload(input, dependencies): Promise<void>` and `validateMemberMediaFile(file): string | null`.
- Produces:
  - `MotorcyclePhotoWorkspace`
  - `MemberMediaDropInput`
  - item-level states and callbacks for upload, retry, removal, move, drag reorder, and deletion.

- [ ] **Step 1: Add failing UI contract tests**

Extend `tests/server/member-profile-ui-contract.test.ts` to assert:

```ts
test("offers a multi-file drag and drop motorcycle workspace", () => {
  const workspace = source(
    "src/features/member-profiles/motorcycle-photo-workspace.tsx",
  );
  expect(workspace).toContain('multiple');
  expect(workspace).toContain('onDrop');
  expect(workspace).toContain("Drop motorcycle photos here");
  expect(workspace).toContain("nextReadyMotorcyclePhoto");
  expect(workspace).toContain("performMemberMediaUpload");
  expect(workspace).toContain('aria-live="polite"');
  expect(workspace).toContain("styles.motorcyclePhotoDropzone");
  expect(workspace).toContain("styles.motorcyclePhotoCardCover");
  expect(workspace).toContain("draggable");
  expect(workspace).toContain("onDragStart");
  expect(workspace).toContain("onDrop");
  expect(workspace).toMatch(/Cover/);
  expect(workspace).toMatch(/Retry/);
  expect(workspace).toMatch(/Remove/);
  expect(workspace).toMatch(/Move motorcycle photo .* earlier/);
  expect(workspace).toMatch(/Move motorcycle photo .* later/);
});

test("allows a multiple file picker while preserving the five-photo cap", async () => {
  const uploader = await import(
    "../../src/features/member-profiles/member-media-uploader"
  );
  const DropInput = (uploader as unknown as {
    MemberMediaDropInput?: (props: {
      inputId: string;
      disabled: boolean;
      onFilesSelected: (files: File[]) => void;
    }) => ReactNode;
  }).MemberMediaDropInput;
  expect(DropInput).toBeTypeOf("function");
  const markup = renderToStaticMarkup(DropInput!({
    inputId: "motorcycle-files",
    disabled: false,
    onFilesSelected: () => undefined,
  }));
  expect(markup).toMatch(/<input[^>]*multiple=""/);
  expect(markup).toContain("image/jpeg,image/png,image/webp");
});

test("shows and cleans up an avatar preview before upload", () => {
  const uploader = source(
    "src/features/member-profiles/member-media-uploader.tsx",
  );
  expect(uploader).toContain("URL.createObjectURL");
  expect(uploader).toContain("URL.revokeObjectURL");
  expect(uploader).toContain("Selected avatar preview");
});
```

Update the existing keyboard photo-control contract to inspect `motorcycle-photo-workspace.tsx` instead of `profile-settings.tsx`, because Task 2 transfers ownership of those controls.

- [ ] **Step 2: Run focused contracts and verify RED**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL because the workspace and `MemberMediaDropInput` do not exist.

- [ ] **Step 3: Add the reusable multiple-file input**

In `member-media-uploader.tsx`, export:

```tsx
export function MemberMediaDropInput({
  inputId,
  disabled,
  inputRef,
  onFilesSelected,
}: {
  inputId: string;
  disabled: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onFilesSelected: (files: File[]) => void;
}) {
  return (
    <Input
      ref={inputRef}
      id={inputId}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      disabled={disabled}
      onChange={(event) => {
        onFilesSelected(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = "";
      }}
    />
  );
}
```

Keep the avatar uploader single-file and keep `performMemberMediaUpload` as the only transport implementation.

- [ ] **Step 4: Add the avatar selection preview**

In `MemberMediaUploader`, create an object URL when an avatar file is selected, revoke the previous URL when selection changes and on unmount, and render:

```tsx
{!isMotorcyclePhoto && selectedPreviewUrl ? (
  <img
    className={styles.avatarSelectionPreview}
    src={selectedPreviewUrl}
    alt="Selected avatar preview"
  />
) : null}
```

Import the profile CSS module and add a bounded square preview rule. Successful upload clears the file and causes the cleanup effect to revoke the object URL.

- [ ] **Step 5: Implement the sequential workspace**

Create `motorcycle-photo-workspace.tsx` as a client component. It must:

```tsx
export interface MotorcyclePhotoWorkspaceProps {
  photos: MotorcycleShowcase["photos"];
  disabled: boolean;
  mediaPending: boolean;
  onUploaded: () => Promise<void>;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  onReorder: (fromIndex: number, toIndex: number) => Promise<void>;
  onDelete: (url: string, label: string) => Promise<void>;
}
```

Use `enqueueMotorcyclePhotoFiles` for picker and drop events. Use one guarded `useEffect` to select `nextReadyMotorcyclePhoto(queue)`, mark it `uploading`, await `performMemberMediaUpload`, refresh persisted editor state, mark it `uploaded`, revoke its preview URL, and remove it. On error, retain it as `failed` with `retryable: true`.

Render:

```tsx
<section className="motorcycle-photo-workspace" aria-labelledby="motorcycle-photo-title">
  <div
    className="motorcycle-photo-dropzone"
    onDragOver={(event) => event.preventDefault()}
    onDrop={handleDrop}
  >
    <ImagePlus aria-hidden="true" />
    <strong>Drop motorcycle photos here</strong>
    <span>JPEG, PNG, or WebP · 8 MB each · up to 5 photos</span>
    <Label htmlFor={inputId}>Choose photos</Label>
    <MemberMediaDropInput
      inputId={inputId}
      disabled={disabled || availableSlots === 0}
      onFilesSelected={addFiles}
    />
  </div>
  <div aria-live="polite">{queueSummary}</div>
  <ul className="motorcycle-photo-queue" aria-label="Photos waiting to upload">
    {queue.map((item) => (
      <li key={item.id} data-status={item.status}>
        <img src={item.previewUrl} alt="" />
        <strong>{item.file.name}</strong>
        <span>{item.error ?? item.status}</span>
        {item.status === "failed" && item.retryable ? (
          <Button type="button" onClick={() => retryItem(item.id)}>Retry</Button>
        ) : null}
        <Button type="button" onClick={() => removeItem(item.id)}>Remove</Button>
      </li>
    ))}
  </ul>
  <ol className="motorcycle-photo-grid" aria-label="Saved motorcycle photos">
    {photos.map((photo, index) => (
      <li
        key={photo.url}
        className={index === 0 ? styles.motorcyclePhotoCardCover : undefined}
        draggable={!mediaPending}
        onDragStart={() => setDraggedIndex(index)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (draggedIndex !== null && draggedIndex !== index) {
            void onReorder(draggedIndex, index);
          }
          setDraggedIndex(null);
        }}
      >
        <MemberMediaImage
          src={photo.url}
          alt={`Motorcycle photo ${index + 1}`}
          width={photo.width || 800}
          height={photo.height || 600}
          sizes="(max-width: 640px) 45vw, 280px"
        />
        <span>{index === 0 ? "Cover" : `Photo ${index + 1}`}</span>
        <Button
          type="button"
          aria-label={`Move motorcycle photo ${index + 1} earlier`}
          disabled={mediaPending || index === 0}
          onClick={() => onMove(index, -1)}
        >
          Move earlier
        </Button>
        <Button
          type="button"
          aria-label={`Move motorcycle photo ${index + 1} later`}
          disabled={mediaPending || index === photos.length - 1}
          onClick={() => onMove(index, 1)}
        >
          Move later
        </Button>
        <Button
          type="button"
          aria-label={`Delete motorcycle photo ${index + 1}`}
          disabled={mediaPending}
          onClick={() => onDelete(photo.url, `Photo ${index + 1}`)}
        >
          Delete
        </Button>
      </li>
    ))}
  </ol>
</section>
```

Import `profile-studio.module.css` and replace the literal class strings in this illustrative hierarchy with the corresponding CSS-module keys. The persisted gallery must render the first photo in a larger `motorcyclePhotoCardCover` item, use `MemberMediaImage`, label it `Cover`, and retain explicit earlier/later/delete buttons. Revoke every remaining queue preview URL on unmount.

Create the initial CSS module with the drop zone, queue card, persisted photo grid, cover tile, progress, focus, and mobile-width rules needed by this workspace. Use only the design tokens from the specification.

- [ ] **Step 6: Run focused queue and UI tests**

Run:

```powershell
npx vitest run tests/server/member-profile-photo-queue.test.ts tests/server/member-profile-ui-contract.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 7: Commit the photo workspace**

Run:

```powershell
git add -- src/features/member-profiles/member-media-uploader.tsx src/features/member-profiles/motorcycle-photo-workspace.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "feat: add multi-photo garage workspace"
```

Expected: one commit containing the multiple-file UI and focused contracts.

---

### Task 3: Draft-Aware Studio Preview and Form State

**Files:**
- Create: `src/features/member-profiles/profile-studio-preview.tsx`
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Consumes `MemberProfileEditorView`, `UpdateMemberProfileInput`, and `UpsertMotorcycleInput`.
- Consumes `MotorcyclePhotoWorkspace` from Task 2.
- Produces:
  - `ProfileStudioPreview`
  - `motorcycleDraftFromEditor(editor: MemberProfileEditorView): UpsertMotorcycleInput`
  - `reconcileMotorcycleDraft(draft, dirty, refreshed): UpsertMotorcycleInput`
  - the Garage Studio editor composition.

- [ ] **Step 1: Add failing draft and preview tests**

Extend `member-profile-ui-contract.test.ts`:

```ts
test("renders a draft-aware Garage Studio preview", () => {
  const preview = source(
    "src/features/member-profiles/profile-studio-preview.tsx",
  );
  expect(preview).toContain("Garage preview");
  expect(preview).toContain("styles.studioPreview");
  expect(preview).toContain("Cover photo");
  expect(preview).not.toMatch(/email|verificationStatus|storageKey/i);
});

test("preserves a dirty motorcycle draft across media refresh", async () => {
  const settings = await import(
    "../../src/features/member-profiles/profile-settings"
  );
  const reconcile = (settings as unknown as {
    reconcileMotorcycleDraft?: (
      draft: Record<string, unknown>,
      dirty: boolean,
      refreshed: MemberProfileEditorView,
    ) => Record<string, unknown>;
  }).reconcileMotorcycleDraft;
  expect(reconcile).toBeTypeOf("function");
  expect(reconcile!(
    { make: "Draft Make", model: "Draft Model" },
    true,
    editor,
  )).toMatchObject({ make: "Draft Make", model: "Draft Model" });
  expect(reconcile!(
    { make: "Old", model: "Old" },
    false,
    editor,
  )).toMatchObject({ make: "Honda", model: "CB650R" });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL because the preview and motorcycle draft reconciliation do not exist.

- [ ] **Step 3: Implement the preview component**

Create `profile-studio-preview.tsx` with:

```tsx
export interface ProfileStudioPreviewProps {
  editor: MemberProfileEditorView;
  profileDraft: UpdateMemberProfileInput;
  motorcycleDraft: UpsertMotorcycleInput;
}

export function ProfileStudioPreview({
  editor,
  profileDraft,
  motorcycleDraft,
}: ProfileStudioPreviewProps) {
  const cover = editor.motorcycle?.photos
    .toSorted((left, right) => left.position - right.position)[0];
  return (
    <aside className={styles.studioPreview} aria-label="Garage preview">
      <span className={styles.studioPreviewEyebrow}>Garage preview</span>
      <div className={styles.studioPreviewHero}>
        {cover ? (
          <MemberMediaImage
            src={cover.url}
            alt="Cover photo"
            width={cover.width || 1200}
            height={cover.height || 900}
            sizes="(max-width: 900px) 100vw, 34vw"
          />
        ) : (
          <div className={styles.studioPreviewEmpty}><Bike /></div>
        )}
      </div>
      <h2>{profileDraft.displayName || "Your rider name"}</h2>
      <p>{profileDraft.area || "Your area"}</p>
      <strong>{motorcycleDraft.make || "Motorcycle make"} {motorcycleDraft.model || "and model"}</strong>
      <p>{profileDraft.bio || "Add a short garage note to introduce your ride."}</p>
    </aside>
  );
}
```

Import `profile-studio.module.css`, use only member-facing fields and finalized `/media/...` URLs, and add preview hero, identity, specification, and empty-state rules to the module.

- [ ] **Step 4: Convert motorcycle inputs to a preserved controlled draft**

In `profile-settings.tsx`, add:

```ts
export function motorcycleDraftFromEditor(
  editor: MemberProfileEditorView,
): UpsertMotorcycleInput {
  return {
    make: editor.motorcycle?.make ?? "",
    model: editor.motorcycle?.model ?? "",
    year: editor.motorcycle?.year,
    displacementCc: editor.motorcycle?.displacementCc,
    nickname: editor.motorcycle?.nickname ?? "",
    description: editor.motorcycle?.description ?? "",
  };
}

export function reconcileMotorcycleDraft(
  draft: UpsertMotorcycleInput,
  dirty: boolean,
  refreshed: MemberProfileEditorView,
) {
  return dirty ? draft : motorcycleDraftFromEditor(refreshed);
}
```

Store `motorcycleDraft` and `motorcycleDirty` beside the existing profile draft. Make the motorcycle inputs controlled, submit the current draft, clear `motorcycleDirty` after a successful save, and use `reconcileMotorcycleDraft` inside media refreshes.

- [ ] **Step 5: Run the focused UI contract**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 6: Commit preview and draft preservation**

Run:

```powershell
git add -- src/features/member-profiles/profile-studio-preview.tsx src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "feat: add draft-aware garage preview"
```

Expected: one commit containing the preview and form-state behavior.

---

### Task 4: Professional Garage Studio Composition

**Files:**
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Consumes `ProfileStudioPreview` and `MotorcyclePhotoWorkspace`.
- Produces the final responsive `/profile` presentation.

- [ ] **Step 1: Add failing structure and responsive contracts**

Extend the UI contract:

```ts
test("composes the profile editor as a professional Garage Studio", () => {
  const settings = source("src/features/member-profiles/profile-settings.tsx");
  const styles = source(
    "src/features/member-profiles/profile-studio.module.css",
  );
  expect(settings).toContain("Garage Studio");
  expect(settings).toContain("ProfileStudioPreview");
  expect(settings).toContain("MotorcyclePhotoWorkspace");
  expect(settings).toContain("styles.studioEditor");
  expect(settings).toContain("styles.studioPreviewColumn");
  expect(settings).toContain("Profile readiness");
  expect(settings).toContain("readyItems.length");
  expect(styles).toContain(".studio");
  expect(styles).toContain(".motorcyclePhotoCardCover");
  expect(styles).toMatch(/@media\s*\(max-width:\s*900px\)/);
  expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL because the final studio composition and styling are absent.

- [ ] **Step 3: Recompose `ProfileSettings`**

Before the JSX return, calculate a compact completion summary from rider-facing essentials:

```ts
const readinessItems = [
  { label: "Identity", ready: Boolean(profileDraft.displayName.trim() && profileDraft.area.trim()) },
  { label: "Avatar", ready: Boolean(editor.profilePhotoUrl) },
  { label: "Motorcycle", ready: Boolean(motorcycleDraft.make.trim() && motorcycleDraft.model.trim()) },
  { label: "Photos", ready: photos.length > 0 },
];
const readyItems = readinessItems.filter((item) => item.ready);
```

Replace the outer wrapper and header with:

```tsx
<div
  className={`profile-settings ${styles.studio}`}
  aria-labelledby="profile-settings-title"
>
  <header className={styles.studioHeader}>
    <div>
      <span>Rider profile</span>
      <h1 id="profile-settings-title">Garage Studio</h1>
      <p>Build the rider card people see before the next meetup.</p>
    </div>
    {editor.slug ? (
      <Button asChild>
        <Link href={`/riders/${editor.slug}`}>View rider page</Link>
      </Button>
    ) : (
      <Badge>Not published</Badge>
    )}
    <div className={styles.readiness} aria-label="Profile readiness">
      <strong>{readyItems.length} of {readinessItems.length} ready</strong>
      <span>
        {readinessItems.filter((item) => !item.ready).map((item) => item.label).join(" · ") ||
          "Your garage card is ready"}
      </span>
    </div>
  </header>
```

Immediately after the header, open the layout and editor wrappers:

```tsx
  <div className={styles.studioLayout}>
    <div className={styles.studioEditor}>
```

Move the existing identity/privacy form, avatar card, and motorcycle form unchanged inside `studioEditor`. Replace the old motorcycle-photo `Card` with:

```tsx
      <MotorcyclePhotoWorkspace
        photos={photos}
        disabled={!editor.motorcycle}
        mediaPending={mediaPending}
        onUploaded={refreshEditor}
        onMove={movePhoto}
        onReorder={reorderPhoto}
        onDelete={removeMedia}
      />
```

Add the arbitrary drag reorder handler beside `movePhoto`:

```ts
const reorderPhoto = async (fromIndex: number, toIndex: number) => {
  if (fromIndex === toIndex) return;
  const reordered = [...photos];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  setMediaPending(true);
  setMediaStatus("");
  try {
    const refreshed = await reorderMotorcyclePhotos(
      reordered.map((photo) => mediaIdFromUrl(photo.url)),
    );
    setProfileEditorState((current) => reconcileEditorRefresh(current, refreshed));
    setMediaStatus("Motorcycle photo order saved.");
  } catch (error) {
    setMediaStatus(actionErrorMessage(error));
  } finally {
    setMediaPending(false);
  }
};
```

Then close the editor, render the preview column, and close the two outer wrappers:

```tsx
    </div>
    <div className={styles.studioPreviewColumn}>
      <ProfileStudioPreview
        editor={editor}
        profileDraft={profileDraft}
        motorcycleDraft={motorcycleDraft}
      />
    </div>
  </div>
</div>
```

Keep the existing server actions, pending states, privacy copy, accessible labels, and save status regions. Remove the old motorcycle photo list from `ProfileSettings` after the workspace owns that UI.

- [ ] **Step 4: Add a narrowly scoped Garage Studio style block**

Extend the existing profile CSS module without changing `globals.css`. Derive all colors from:

```css
.studio {
  --studio-asphalt: #17191c;
  --studio-paper: #f4f1ea;
  --studio-steel: #aeb4b8;
  --studio-amber: #f2a41d;
  --studio-red: #b83b32;
  --studio-green: #3e6b55;
}
```

Implement:

- a calm dark canvas and warm editor surfaces;
- a desktop `minmax(0, 1.35fr) minmax(300px, 0.65fr)` layout;
- a sticky preview with `position: sticky; top: 96px`;
- a larger cover tile followed by a two-column photo rail;
- 44-pixel minimum action targets;
- visible `:focus-visible` states;
- a single-column layout at `max-width: 900px`;
- a bounded two-column photo grid at `390px`;
- `min-width: 0`, `max-width: 100%`, and overflow guards on media containers;
- reduced-motion overrides for transitions and upload progress.

- [ ] **Step 5: Run focused and full static verification**

Run:

```powershell
npx vitest run tests/server/member-profile-photo-queue.test.ts tests/server/member-profile-ui-contract.test.ts
npm run lint
npm run build
```

Expected: all commands exit `0`. If lint or build exposes unrelated pre-existing failures, record the exact files and keep this task scoped.

- [ ] **Step 6: Inspect the scoped diff before commit**

Run:

```powershell
git diff --check
git diff -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio-preview.tsx src/features/member-profiles/motorcycle-photo-workspace.tsx src/features/member-profiles/member-media-uploader.tsx src/features/member-profiles/member-media-file-validation.ts src/features/member-profiles/motorcycle-photo-queue.ts src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts tests/server/member-profile-photo-queue.test.ts
```

Expected: no whitespace errors and no edits to unrelated carousel code.

- [ ] **Step 7: Commit the finished studio presentation**

Run:

```powershell
git add -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "feat: complete profile Garage Studio"
```

Expected: one commit containing only the final composition, CSS, and updated contracts.

---

### Task 5: Local Browser Upload and Responsive Verification

**Files:**
- Modify: none unless verification discovers a reproducible defect; any defect first receives a failing focused test in the owning task's test file.

**Interfaces:**
- Consumes the running local app at `http://localhost:3000/profile`.
- Produces fresh evidence for the complete authenticated profile and media flow.

- [ ] **Step 1: Reuse the existing dev server**

Run:

```powershell
netstat -ano -p tcp | findstr /R /C:":3000 .*LISTENING"
Invoke-WebRequest -UseBasicParsing http://localhost:3000/profile -TimeoutSec 10 | Select-Object StatusCode
```

Expected: one listener and HTTP `200`. Do not start another `npm run dev` process.

- [ ] **Step 2: Prepare browser-safe test images**

Use these three non-sensitive repository fixtures:

```text
public/demo/poster-ducati-track-day.jpg
public/demo/poster-long-ride-charity.jpg
public/demo/poster-tambike-cafe-classico.jpg
```

Use `package.json` as the invalid-file selection. Do not upload user photos or files containing personal data.

Expected: three valid files under 8 MB and one invalid file for rejection guidance.

- [ ] **Step 3: Verify desktop workflow in the Codex in-app browser**

At a desktop viewport:

- authenticate with a disposable or documented seeded rider account;
- open `/profile`;
- confirm Garage Studio, editor, and live preview are visible;
- change identity and motorcycle drafts without saving;
- choose three images in one selection;
- confirm all local previews appear before upload finalization;
- confirm uploads complete sequentially in selection order;
- confirm dirty drafts remain unchanged;
- confirm the first persisted image is labeled `Cover`;
- move a photo earlier and later using explicit controls;
- delete one uploaded photo;
- choose an invalid file and confirm item-level guidance;
- retry a deliberately failed upload if a safe local failure can be induced;
- save profile and motorcycle details;
- open the public rider page and confirm finalized media appears;
- inspect current-page console errors.

Expected: the full flow completes with no stale drafts, unexpected exposure, or current-page console errors.

- [ ] **Step 4: Verify mobile workflow**

Set the in-app browser viewport to `390 x 844`, reload `/profile`, and verify:

- header, forms, upload target, queued previews, gallery, and controls fit the viewport;
- the preview is non-sticky and appears in the intended mobile order;
- no image exceeds the content width;
- action buttons remain usable;
- `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

Expected: no horizontal overflow and no clipped controls.

- [ ] **Step 5: Run the complete automated gate**

Run:

```powershell
npm run test:server
npm run lint
npm run build
git diff --check
git status --short --branch
```

Expected: server suite, lint, build, and whitespace check pass. Status shows only the intended Garage Studio commits plus the user's preserved unrelated changes.
