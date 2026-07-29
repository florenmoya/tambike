# Profile Photo Queue Before Motorcycle Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new rider select and preview motorcycle photos before saving a motorcycle, then automatically upload that unchanged queue after motorcycle persistence succeeds.

**Architecture:** Separate local file selection from network-upload eligibility in `MotorcyclePhotoWorkspace`. Pass a persisted-motorcycle-derived `uploadEnabled` flag into the existing scheduler, keep the queue local while false, and let the existing sequential presign/S3/finalize pipeline resume when the flag becomes true.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript, existing private S3 member-media pipeline, Vitest, and the Codex in-app browser.

## Global Constraints

- Read the relevant Next.js 16.2.11 guides under `node_modules/next/dist/docs/` before editing application code.
- Keep file selection local until a persisted motorcycle exists.
- Do not send a presign, S3, or finalize request while `uploadEnabled` is false.
- Preserve JPEG, PNG, and WebP validation, the 8 MB per-file limit, and the five-photo total limit.
- Preserve selection order, sequential upload, retry, refresh-only recovery, cover, reorder, and delete behavior.
- Preserve unsaved profile and motorcycle drafts across editor refreshes.
- Reuse the existing private S3 presign/direct-upload/finalize pipeline.
- Do not add a provider, bucket, API route, dependency, or public media key.
- Keep the picker and recovery actions keyboard-operable and announce waiting state through the polite live region.
- Do not modify unrelated event, carousel, roster, or demo files.
- Preserve all existing dirty changes.
- Do not create a branch or worktree.

---

### Task 1: Decouple Local Photo Selection From Upload Eligibility

**Files:**
- Modify: `src/features/member-profiles/motorcycle-photo-upload-orchestrator.ts`
- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `tests/server/motorcycle-photo-upload-orchestrator.test.ts`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- `MotorcyclePhotoWorkspaceProps` replaces `disabled: boolean` with `uploadEnabled: boolean`.
- `createMotorcyclePhotoUploadScheduler().processNext(input)` adds `uploadEnabled: boolean`.
- `ProfileSettings` passes `uploadEnabled={Boolean(editor.motorcycle)}`.
- The queue live-region copy while waiting is exactly:
  `Photos are ready. Save your motorcycle to start uploading.`

- [ ] **Step 1: Read the project-version Next.js guides**

Run:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
Get-Content -Raw node_modules/next/dist/docs/01-app/02-guides/forms.md
Get-Content -Raw node_modules/next/dist/docs/01-app/02-guides/server-actions.md
```

Expected: the local Next.js 16.2.11 client/server boundary, form, and Server
Action guidance is available before application edits.

- [ ] **Step 2: Add a failing scheduler regression**

In `tests/server/motorcycle-photo-upload-orchestrator.test.ts`, add
`uploadEnabled: true` to every existing `processNext` call, then add:

```ts
test("keeps selected photos queued until a persisted motorcycle enables upload", async () => {
  const harness = schedulerHarness([item("a.webp"), item("b.webp")]);
  const uploads: string[] = [];

  const process = (uploadEnabled: boolean) => harness.scheduler.processNext({
    uploadEnabled,
    motorcyclePhotoPosition: 0,
    upload: async (next) => {
      uploads.push(next.id);
    },
    refresh: async () => undefined,
    describeFailure: memberMediaUploadFailure,
  });

  await expect(process(false)).resolves.toBe(false);
  expect(uploads).toEqual([]);
  expect(harness.queue()).toMatchObject([
    { id: "queue:a.webp", status: "ready" },
    { id: "queue:b.webp", status: "ready" },
  ]);

  await expect(process(true)).resolves.toBe(true);
  expect(uploads).toEqual(["queue:a.webp"]);
  expect(harness.queue()).toMatchObject([
    { id: "queue:b.webp", status: "ready" },
  ]);
});
```

This test represents both a new unsaved motorcycle and a failed motorcycle save:
the queue remains unchanged for as long as `uploadEnabled` remains false.

- [ ] **Step 3: Add failing UI contracts**

Extend the existing multi-file workspace contract in
`tests/server/member-profile-ui-contract.test.ts`:

```ts
test("allows local photo selection before motorcycle persistence", () => {
  const settings = source(
    "src/features/member-profiles/profile-settings.tsx",
  );
  const workspace = source(
    "src/features/member-profiles/motorcycle-photo-workspace.tsx",
  );

  expect(settings).toContain(
    "uploadEnabled={Boolean(editor.motorcycle)}",
  );
  expect(workspace).toContain("uploadEnabled: boolean");
  expect(workspace).toContain(
    "Photos are ready. Save your motorcycle to start uploading.",
  );
  expect(workspace).toContain("disabled={availableSlots === 0}");
  expect(workspace).toContain("uploadEnabled,");
  expect(workspace).not.toContain("disabled={!editor.motorcycle}");
  expect(workspace).not.toContain("if (disabled || files.length === 0)");
});
```

The test must fail against the current source because the picker still receives
`disabled={!editor.motorcycle}` and the waiting guidance does not exist.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```powershell
npx vitest run tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL because `processNext` does not accept or enforce
`uploadEnabled`, and the workspace still disables selection before persistence.

- [ ] **Step 5: Gate the scheduler with `uploadEnabled`**

In `motorcycle-photo-upload-orchestrator.ts`, extend `processNext`:

```ts
async processNext({
  uploadEnabled,
  motorcyclePhotoPosition,
  upload,
  refresh,
  describeFailure,
}: {
  uploadEnabled: boolean;
  motorcyclePhotoPosition: number;
  upload: (
    item: MotorcyclePhotoQueueItem,
    motorcyclePhotoPosition: number,
  ) => Promise<void>;
  refresh: () => Promise<void>;
  describeFailure: (error: unknown) => MemberMediaUploadFailure;
}) {
  if (!uploadEnabled || uploadInFlight) return false;
```

Keep every existing queue selection, finalized-refresh sentinel, error, preview
release, and sequential-upload transition unchanged.

- [ ] **Step 6: Separate selection from upload in the workspace**

In `motorcycle-photo-workspace.tsx`, change the public prop:

```ts
export interface MotorcyclePhotoWorkspaceProps {
  photos: MotorcycleShowcase["photos"];
  uploadEnabled: boolean;
  mediaPending: boolean;
  onUploaded: () => Promise<void>;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  onReorder: (fromIndex: number, toIndex: number) => Promise<void>;
  onDelete: (url: string, label: string) => Promise<void>;
}
```

Update the component destructuring from `disabled` to `uploadEnabled`.

Allow file selection regardless of persistence:

```ts
const addFiles = (files: File[]) => {
  if (files.length === 0) return;
  const descriptors = createMotorcyclePhotoQueueDescriptors({
    files,
    createObjectUrl: (file) => URL.createObjectURL(file),
    createId: (file) =>
      `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
  });
  previewRegistry.register(descriptors);
  setQueue((current) => enqueueMotorcyclePhotoDescriptors({
    current,
    descriptors,
    persistedCount: photos.length,
  }).items);
};
```

Change queue status calculation so ready files on an unsaved motorcycle announce
the required action before generic waiting copy:

```ts
function queueStatus(
  queue: MotorcyclePhotoQueueItem[],
  uploadEnabled: boolean,
) {
  const uploading = queue.filter(
    (item) => item.status === "uploading",
  ).length;
  const failed = queue.filter(
    (item) => item.status === "failed",
  ).length;
  const ready = queue.filter(
    (item) => item.status === "ready",
  ).length;

  if (!uploadEnabled && ready) {
    return "Photos are ready. Save your motorcycle to start uploading.";
  }
  if (uploading) {
    return `Uploading ${uploading} motorcycle photo${
      uploading === 1 ? "" : "s"
    }.`;
  }
  if (ready) {
    return `${ready} motorcycle photo${
      ready === 1 ? "" : "s"
    } waiting to upload.`;
  }
  if (failed) {
    return `${failed} motorcycle photo${
      failed === 1 ? " needs" : "s need"
    } attention.`;
  }
  return "";
}
```

Call it with both inputs:

```ts
const queueSummary = queueStatus(queue, uploadEnabled);
```

Pass eligibility into the scheduler:

```ts
void scheduler.processNext({
  uploadEnabled,
  motorcyclePhotoPosition: photos.length,
  upload: (item, motorcyclePhotoPosition) =>
    performMemberMediaUpload(
      {
        file: item.file,
        purpose: "motorcycle-photo",
        motorcyclePhotoPosition,
      },
      {
        fetchImpl: fetch,
        finalize: finalizeMemberMediaAction,
        onStatus: () => undefined,
      },
    ),
  refresh: onUploaded,
  describeFailure: memberMediaUploadFailure,
});
```

Include `uploadEnabled` in the effect dependency list. Remove the old early
return that treats an unsaved motorcycle as a disabled workspace.

Keep the picker available unless the five-photo total is reserved:

```tsx
<MemberMediaDropInput
  inputId={inputId}
  disabled={availableSlots === 0}
  onFilesSelected={addFiles}
/>
```

- [ ] **Step 7: Pass persistence state from `ProfileSettings`**

Replace:

```tsx
disabled={!editor.motorcycle}
```

with:

```tsx
uploadEnabled={Boolean(editor.motorcycle)}
```

Do not change motorcycle save, editor refresh, draft reconciliation, or media
action implementations.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-ui-contract.test.ts tests/server/member-profile-photo-queue.test.ts
```

Expected: PASS with the new pre-save pause regression and all existing
validation, refresh-recovery, and five-photo tests.

- [ ] **Step 9: Run the broader member-media gate**

Run:

```powershell
npx vitest run tests/server/member-media-infra-contract.test.ts tests/server/member-media-image-normalizer.test.ts tests/server/member-media-cloudfront.test.ts tests/server/member-media-cleanup-route.test.ts tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-ui-contract.test.ts tests/server/member-profile-schema-contract.test.ts tests/server/member-profile-photo-queue.test.ts tests/server/member-profile-domain.test.ts tests/server/member-media-upload-policy.test.ts tests/server/member-media-smoke-core.test.ts tests/server/member-media-service.test.ts tests/server/member-media-route-contract.test.ts tests/server/prisma-member-media-reindex-contract.test.ts
```

Expected: all member-profile and member-media tests pass.

- [ ] **Step 10: Run static verification**

Run:

```powershell
npm run lint
npm run build
git diff --check
```

Expected: ESLint exits `0`, the Next.js 16.2.11 production build succeeds, and
the whitespace check reports no errors.

- [ ] **Step 11: Commit the scoped fix**

Run:

```powershell
git add -- src/features/member-profiles/motorcycle-photo-upload-orchestrator.ts src/features/member-profiles/motorcycle-photo-workspace.tsx src/features/member-profiles/profile-settings.tsx tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-ui-contract.test.ts
git commit -m "fix: queue motorcycle photos before save"
```

Expected: one commit containing only the queue-eligibility behavior and its
regressions.

---

### Task 2: Verify the Fresh-Rider Browser Flow

**Files:**
- Modify: none unless browser verification finds a reproducible defect.

**Interfaces:**
- Consumes the running app at `http://localhost:3000/profile`.
- Consumes the repository fixture
  `public/demo/poster-ducati-track-day.jpg`.
- Produces browser and request-chain evidence for pre-save selection and
  post-save automatic upload.

- [ ] **Step 1: Reuse the existing development server**

Run:

```powershell
netstat -ano -p tcp | findstr /R /C:":3000 .*LISTENING"
(Invoke-WebRequest -UseBasicParsing http://localhost:3000/profile -TimeoutSec 10).StatusCode
```

Expected: one existing listener and HTTP `200`. Do not start another server.

- [ ] **Step 2: Create a disposable rider in the Codex in-app browser**

Use the visible signup flow with a unique `example.test` address. Do not reuse a
real email, upload a user photo, expose the generated password, or delete an
account without explicit authorization.

Expected: the new rider opens `/profile` with no persisted motorcycle.

- [ ] **Step 3: Select a photo before saving the motorcycle**

Use the browser file-chooser flow to select:

```text
D:\Github\personal\tambike\public\demo\poster-ducati-track-day.jpg
```

Before motorcycle save, verify:

- the chooser is enabled;
- a local queue preview appears;
- the polite status says
  `Photos are ready. Save your motorcycle to start uploading.`;
- the saved-photo gallery remains empty;
- browser network events contain no request to
  `/api/member-media/uploads` and no S3 request.

- [ ] **Step 4: Save the motorcycle and verify automatic upload**

Enter:

```text
Make: Honda
Model: CB650R
```

Click `Save motorcycle` without choosing the file again.

Verify:

- the motorcycle save succeeds;
- the existing queued photo transitions to uploading;
- `/api/member-media/uploads` returns HTTP `200`;
- the direct S3 request returns HTTP `204`;
- the saved gallery contains one photo labeled `Cover`;
- the local queue is empty after the editor refresh;
- current-page console warnings and errors are empty.

- [ ] **Step 5: Run the final repository gate**

Run:

```powershell
npx vitest run tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-ui-contract.test.ts tests/server/member-profile-photo-queue.test.ts
npm run lint
npm run build
git diff --check
git status --short --branch
```

Expected: focused tests, lint, build, and whitespace checks pass. Repository
status contains no new uncommitted Garage Studio files and preserves every
unrelated dirty file unchanged.
