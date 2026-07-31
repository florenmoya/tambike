# Clear Rider Profile Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/profile` a concise, professional editor with unmistakable publish requirements, one-step profile-photo upload, clear motorcycle-gallery capacity, and a separate owner-only preview that matches the public rider profile.

**Architecture:** Keep the existing profile DTOs, server actions, publication rules, media pipeline, and public `/riders/[slug]` route unchanged. Extract pure editor-presentation logic for deterministic status/action copy, remove the embedded editor preview, add an authenticated `/profile/preview` view inside the existing Tambike shell, and continue rendering both owner preview and public pages through `RiderGarageView`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, CSS Modules, existing shadcn/Radix primitives, and the existing private member-media upload actions.

## Global Constraints

- Work in `D:\Github\personal\tambike` on the current branch. Do not create a branch or worktree.
- Preserve all unrelated dirty work. In particular, `src/features/tambike-demo/tambike-screen.tsx` already has unrelated edits; modify and stage only the small profile-preview hunks.
- Follow the checked-in Next.js 16 page/layout guidance in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` and `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`.
- Do not change database schema, storage policy, ownership checks, publication rules, public DTOs, or the public `/riders/[slug]` presentation.
- Use the existing dev server on port 3000 if it is already running.
- Use only the Codex in-app browser for browser verification.
- Run the focused failing test before implementation and the focused passing test after each task.
- Before each commit, run `git diff --check`, inspect `git diff --` for the files listed in that task, and run `git status --short`. Stage only those listed files.

---

## File and Responsibility Map

- Modify `src/features/member-profiles/profile-settings.tsx`
  - Make `/profile` edit-only.
  - Render the compact publication state and contextual viewing link.
  - Add required/optional label text.
- Add `src/features/member-profiles/profile-editor-presentation.ts`
  - Own the five publish requirements, the three incomplete-state signals, status copy, and the single contextual viewing action.
- Modify `src/features/member-profiles/profile-preview-adapter.ts`
  - Add a saved-editor-to-public-preview adapter that cannot expose editor-only fields.
- Add `src/features/member-profiles/profile-preview.tsx`
  - Load authenticated editor data and render the exact shared `RiderGarageView`.
- Add `src/app/profile/preview/page.tsx`
  - Register the owner preview route.
- Modify `src/features/tambike-demo/tambike-screen.tsx`
  - Add the `profile-preview` view and reuse the existing shell/auth-required treatment.
- Modify `src/features/member-profiles/member-media-uploader.tsx`
  - Start avatar upload immediately after file selection and retain preview/progress/error feedback.
- Modify `src/features/member-profiles/motorcycle-photo-workspace.tsx`
  - Expose empty/partial/full capacity and replace the uploader when five saved photos exist.
- Modify `src/features/member-profiles/profile-studio.module.css`
  - Reduce header height, style compact status/legend/preview/capacity states, and retain responsive/focus behavior.
- Modify `tests/server/member-profile-ui-contract.test.ts`
  - Replace obsolete embedded-preview assertions and cover all new profile-editor contracts and pure helpers.

---

### Task 1: Extract deterministic publication presentation

**Files:**

- Create: `src/features/member-profiles/profile-editor-presentation.ts`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

- [ ] **Step 1: Write the failing presentation tests**

Add imports and tests that exercise real behavior rather than only matching source text:

```ts
import {
  getProfileEditorPresentation,
  type ProfileEditorPresentationInput,
} from "../../src/features/member-profiles/profile-editor-presentation";

const completeProfileInput: ProfileEditorPresentationInput = {
  isPublished: false,
  slug: "mika-santos",
  displayName: "Mika Santos",
  area: "Davao City",
  make: "Honda",
  model: "CB650R",
  photoCount: 1,
};

test("names the first missing publish requirement and shows only incomplete signals", () => {
  const presentation = getProfileEditorPresentation({
    ...completeProfileInput,
    displayName: "",
    area: "",
    photoCount: 0,
  });

  expect(presentation.state).toBe("incomplete");
  expect(presentation.label).toBe("Complete your profile");
  expect(presentation.description).toBe("Display name is required to publish.");
  expect(presentation.requirements.map(({ label, required, ready }) => ({
    label,
    required,
    ready,
  }))).toEqual([
    { label: "Display name", required: true, ready: false },
    { label: "Area / city", required: true, ready: false },
    { label: "Make", required: true, ready: true },
    { label: "Model", required: true, ready: true },
    { label: "Motorcycle photos", required: true, ready: false },
  ]);
  expect(presentation.signals).toEqual([
    { label: "Identity", ready: false },
    { label: "Motorcycle", ready: true },
    { label: "Photo", ready: false },
  ]);
  expect(presentation.viewAction).toEqual({
    label: "Preview profile",
    href: "/profile/preview",
  });
});

test("returns compact ready and live states with one contextual viewing action", () => {
  const ready = getProfileEditorPresentation(completeProfileInput);
  expect(ready).toMatchObject({
    state: "ready",
    label: "Ready to publish",
    signals: [],
    viewAction: { label: "Preview profile", href: "/profile/preview" },
  });

  const live = getProfileEditorPresentation({
    ...completeProfileInput,
    isPublished: true,
  });
  expect(live).toMatchObject({
    state: "live",
    label: "Live",
    signals: [],
    viewAction: {
      label: "View public profile",
      href: "/riders/mika-santos",
    },
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: the suite fails because `profile-editor-presentation.ts` does not exist.

- [ ] **Step 3: Implement the pure presentation helper**

Create the helper with these public types and behavior:

```ts
export interface ProfileEditorPresentationInput {
  isPublished: boolean;
  slug: string | null;
  displayName: string;
  area: string;
  make: string;
  model: string;
  photoCount: number;
}

export interface ProfileRequirement {
  key: "displayName" | "area" | "make" | "model" | "photos";
  label: string;
  required: true;
  ready: boolean;
  href: "#profile-identity" | "#profile-motorcycle" | "#motorcycle-photos";
}

export function getProfileEditorPresentation(
  input: ProfileEditorPresentationInput,
) {
  const requirements: ProfileRequirement[] = [
    {
      key: "displayName",
      label: "Display name",
      required: true,
      ready: Boolean(input.displayName.trim()),
      href: "#profile-identity",
    },
    {
      key: "area",
      label: "Area / city",
      required: true,
      ready: Boolean(input.area.trim()),
      href: "#profile-identity",
    },
    {
      key: "make",
      label: "Make",
      required: true,
      ready: Boolean(input.make.trim()),
      href: "#profile-motorcycle",
    },
    {
      key: "model",
      label: "Model",
      required: true,
      ready: Boolean(input.model.trim()),
      href: "#profile-motorcycle",
    },
    {
      key: "photos",
      label: "Motorcycle photos",
      required: true,
      ready: input.photoCount > 0,
      href: "#motorcycle-photos",
    },
  ];
  const complete = requirements.every((requirement) => requirement.ready);
  const firstMissing = requirements.find((requirement) => !requirement.ready);
  const state = input.isPublished ? "live" : complete ? "ready" : "incomplete";
  const signals = complete || input.isPublished
    ? []
    : [
        {
          label: "Identity",
          ready: requirements[0].ready && requirements[1].ready,
        },
        {
          label: "Motorcycle",
          ready: requirements[2].ready && requirements[3].ready,
        },
        { label: "Photo", ready: requirements[4].ready },
      ];

  return {
    state,
    label:
      state === "live"
        ? "Live"
        : state === "ready"
          ? "Ready to publish"
          : "Complete your profile",
    description:
      state === "live"
        ? "Other riders can view your rider profile."
        : state === "ready"
          ? "Your required details are complete."
          : `${firstMissing!.label} is required to publish.`,
    requirements,
    signals,
    firstMissing,
    viewAction:
      input.isPublished && input.slug
        ? {
            label: "View public profile",
            href: `/riders/${input.slug}`,
          }
        : { label: "Preview profile", href: "/profile/preview" },
  };
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: the new presentation tests pass; obsolete embedded-preview tests may still fail only after they are intentionally replaced in Task 2.

- [ ] **Step 5: Commit the helper and tests**

```powershell
git add -- src/features/member-profiles/profile-editor-presentation.ts tests/server/member-profile-ui-contract.test.ts
git commit -m "test: define rider profile editor states"
```

---

### Task 2: Make `/profile` an edit-only, self-explanatory workspace

**Files:**

- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

- [ ] **Step 1: Replace obsolete editor-mode tests with failing edit-only contracts**

Remove assertions that require `StudioMode`, `studioModeSwitch`, embedded `RiderGarageView`, and the old “Garage Studio” header. Add source-contract assertions for:

```ts
test("keeps profile editing and profile viewing as separate routes", () => {
  const settings = source("src/features/member-profiles/profile-settings.tsx");

  expect(settings).toContain("Your rider profile");
  expect(settings).toContain(
    "Add the details riders see when they open your profile.",
  );
  expect(settings).toContain("getProfileEditorPresentation");
  expect(settings).toContain("presentation.viewAction.href");
  expect(settings).not.toContain("StudioMode");
  expect(settings).not.toContain("studioMode");
  expect(settings).not.toContain("<RiderGarageView");
  expect(settings).not.toContain("toProfilePreviewView");
  expect(settings).not.toContain("Edit profile");
  expect(settings).not.toContain("View your rider page");
});

test("visibly marks every publish requirement and optional profile field", () => {
  const settings = source("src/features/member-profiles/profile-settings.tsx");

  for (const label of [
    "Display name *",
    "Area / city *",
    "Make *",
    "Model *",
  ]) {
    expect(settings).toContain(label);
  }
  for (const label of [
    "Garage note (optional)",
    "Profile photo (optional)",
    "Year (optional)",
    "Displacement (cc) (optional)",
    "Nickname (optional)",
    "Motorcycle note (optional)",
  ]) {
    expect(settings).toContain(label);
  }
  expect(settings).toContain("* Required to publish");
  expect(settings).toContain("<MotorcyclePhotoWorkspace");
  expect(settings).toContain('required value={profileDraft.displayName}');
  expect(settings).toContain('required value={profileDraft.area}');
  expect(settings).toContain('name="make" required');
  expect(settings).toContain('name="model" required');
});
```

Update the CSS contract to require `.studioHeaderActions`, `.studioState`, `.requiredLegend`, and the mobile stacked header, while forbidding `.studioModeSwitch` and `.studioPreviewMode`.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: failures mention the old header/mode switch, missing required/optional text, and missing compact-header classes.

- [ ] **Step 3: Remove editor preview state and wire the presentation helper**

In `profile-settings.tsx`:

- remove `StudioMode`;
- remove the `studioMode` state;
- remove `RiderGarageView` and `toProfilePreviewView` imports;
- remove `previewProfile`;
- remove the edit/preview buttons and embedded preview section;
- keep the editor mounted unconditionally;
- derive `presentation` from current drafts and saved photo count.

Core derivation:

```ts
const presentation = getProfileEditorPresentation({
  isPublished: editor.isPublished,
  slug: editor.slug,
  displayName: profileDraft.displayName,
  area: profileDraft.area,
  make: motorcycleDraft.make,
  model: motorcycleDraft.model,
  photoCount: photos.length,
});
```

Render the compact header:

```tsx
<header className={styles.studioHeader}>
  <div className={styles.studioHeading}>
    <span>Rider profile</span>
    <h1 id="profile-settings-title">Your rider profile</h1>
    <p>Add the details riders see when they open your profile.</p>
  </div>
  <div className={styles.studioHeaderActions}>
    <span className={styles.studioState} data-state={presentation.state}>
      {presentation.label}
    </span>
    <Button asChild variant="outline">
      <Link href={presentation.viewAction.href}>
        {presentation.viewAction.label}
      </Link>
    </Button>
  </div>
  <div className={styles.studioStatus}>
    <p>{presentation.description}</p>
    {presentation.state === "ready" ? (
      <Button type="button" onClick={submitProfileForm}>
        Publish profile
      </Button>
    ) : presentation.state === "incomplete" && presentation.firstMissing ? (
      <Button asChild variant="outline">
        <a href={presentation.firstMissing.href}>
          Add {presentation.firstMissing.label.toLowerCase()}
        </a>
      </Button>
    ) : null}
    {presentation.signals.length ? (
      <ul aria-label="Profile requirements">
        {presentation.signals.map((signal) => (
          <li key={signal.label} data-ready={signal.ready}>
            <span aria-hidden="true">{signal.ready ? "✓" : "○"}</span>
            {signal.label}
          </li>
        ))}
      </ul>
    ) : null}
  </div>
</header>
<p className={styles.requiredLegend}>* Required to publish</p>
```

Do not add a second view link in the status block.

- [ ] **Step 4: Make labels explicit**

Use visible text in each `Label`/section heading:

```tsx
<Label htmlFor="profile-display-name">Display name *</Label>
<Label htmlFor="profile-area">Area / city *</Label>
<Label htmlFor="profile-bio">Garage note (optional)</Label>
<CardTitle><Camera aria-hidden="true" /> Profile photo (optional)</CardTitle>
<Label htmlFor="motorcycle-make">Make *</Label>
<Label htmlFor="motorcycle-model">Model *</Label>
<Label htmlFor="motorcycle-year">Year (optional)</Label>
<Label htmlFor="motorcycle-displacement">Displacement (cc) (optional)</Label>
<Label htmlFor="motorcycle-nickname">Nickname (optional)</Label>
<Label htmlFor="motorcycle-description">Motorcycle note (optional)</Label>
```

Leave the native `required` attributes on display name, area, make, and model.

- [ ] **Step 5: Replace large/mode-switch styling with compact responsive styling**

In `profile-studio.module.css`:

- reduce `h1` to `font-size: clamp(2rem, 5vw, 3.5rem)`;
- add `.studioHeading`, `.studioHeaderActions`, `.studioState`, and `.requiredLegend`;
- keep `.studioStatus` compact and render its signal list only when supplied;
- remove `.studioModeSwitch`, `.studioPreviewMode`, and old embedded-preview rules;
- at `max-width: 900px`, stack the actions below the heading;
- at `max-width: 640px`, keep actions full-width only where it aids touch use;
- retain focus-visible and reduced-motion rules.

Target layout:

```css
.studioHeaderActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.625rem;
}

.studioState {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--studio-steel) 36%, transparent);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
}

.requiredLegend {
  margin: 1rem 0 0;
  color: color-mix(in srgb, var(--studio-paper) 72%, transparent);
  font-size: 0.8125rem;
}
```

- [ ] **Step 6: Run the focused suite and verify edit-only behavior**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: editor hierarchy, labels, native required attributes, and compact responsive CSS contracts pass.

- [ ] **Step 7: Commit the edit-only redesign**

```powershell
git add -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "feat: clarify rider profile editing"
```

---

### Task 3: Add a dedicated authenticated owner preview

**Files:**

- Create: `src/app/profile/preview/page.tsx`
- Create: `src/features/member-profiles/profile-preview.tsx`
- Modify: `src/features/member-profiles/profile-preview-adapter.ts`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

- [ ] **Step 1: Write failing route, adapter, and presentation tests**

Add tests:

```ts
import {
  toProfilePreviewView,
  toSavedProfilePreviewView,
} from "../../src/features/member-profiles/profile-preview-adapter";

test("maps saved editor data into the public-safe owner preview", () => {
  const preview = toSavedProfilePreviewView(editor);

  expect(preview).toMatchObject(publicProfile);
  expect(preview).not.toHaveProperty("defaultRosterIdentity");
  expect(preview).not.toHaveProperty("isPublished");
});

test("routes owner preview through the shared public garage renderer", () => {
  const route = source("src/app/profile/preview/page.tsx");
  const preview = source("src/features/member-profiles/profile-preview.tsx");
  const screen = source("src/features/tambike-demo/tambike-screen.tsx");

  expect(route).toContain('<TambikeScreen view="profile-preview"');
  expect(screen).toContain('| "profile-preview"');
  expect(screen).toContain('view === "profile-preview"');
  expect(preview).toContain("Preview — only you can see this");
  expect(preview).toContain('href="/profile"');
  expect(preview).toContain("Back to edit");
  expect(preview).toContain("<RiderGarageView");
  expect(preview).toContain("toSavedProfilePreviewView");
  expect(preview).not.toContain("Your rider profile");
  expect(preview).not.toContain("Complete your profile");
});
```

Keep the existing test proving the public `/riders/[slug]` route remains server-loaded and does not contain owner controls.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: failures report the missing route, preview component, `profile-preview` screen view, and saved preview adapter.

- [ ] **Step 3: Add the saved editor adapter**

In `profile-preview-adapter.ts`:

```ts
export function toSavedProfilePreviewView(
  editor: MemberProfileEditorView,
): MemberProfileView {
  return toProfilePreviewView(
    editor,
    {
      displayName: editor.displayName,
      area: editor.area,
      bio: editor.bio,
      visibility: editor.visibility,
      defaultRosterIdentity: editor.defaultRosterIdentity,
    },
    {
      make: editor.motorcycle?.make ?? "",
      model: editor.motorcycle?.model ?? "",
      year: editor.motorcycle?.year,
      displacementCc: editor.motorcycle?.displacementCc,
      nickname: editor.motorcycle?.nickname,
      description: editor.motorcycle?.description,
    },
  );
}
```

- [ ] **Step 4: Build the owner preview component**

Create `profile-preview.tsx` as a client component. Load editor data with `getMemberProfileEditor`, show the same loading/error treatment used by profile settings, transform through `toSavedProfilePreviewView`, and render:

```tsx
<section className={styles.previewPage} aria-label="Your rider profile preview">
  <div className={styles.previewNotice} role="status">
    <span>Preview — only you can see this</span>
    <Button asChild variant="outline">
      <Link href="/profile">Back to edit</Link>
    </Button>
  </div>
  <div className="garage-profile-page">
    <div className="garage-profile-shell">
      <RiderGarageView
        profile={toSavedProfilePreviewView(editor)}
        prioritizeMedia
      />
    </div>
  </div>
</section>
```

Do not import `ProfileSettings` or render editor status/requirements here.

- [ ] **Step 5: Register the view inside the existing authenticated shell**

Create `src/app/profile/preview/page.tsx`:

```tsx
import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

export default function Page() {
  return <TambikeScreen view="profile-preview" />;
}
```

In `tambike-screen.tsx`, make only these scoped changes:

- import `ProfilePreview`;
- add `"profile-preview"` to `TambikeView`;
- render `<ProfilePreviewScreen />` for that view;
- add a small screen function beside `ProfileScreen`:

```tsx
function ProfilePreviewScreen() {
  const { currentUser } = useDemo();

  if (!currentUser) {
    return (
      <AuthRequired
        title="Log in to preview profile"
        body="Your preview is only available from your rider account."
      />
    );
  }

  return (
    <LightView>
      <ProfilePreview />
    </LightView>
  );
}
```

- [ ] **Step 6: Style only the owner notice and preview containment**

Add `.previewPage` and `.previewNotice` rules to `profile-studio.module.css`. The notice must remain compact, wrap at 390 px, and not alter global `.garage-profile-page` public styling.

- [ ] **Step 7: Run the focused suite**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: the owner route, auth shell integration, public-safe mapping, and shared renderer contracts pass.

- [ ] **Step 8: Commit only profile-preview hunks**

Because `tambike-screen.tsx` is already dirty, inspect and stage only the profile-preview hunks:

```powershell
git diff -- src/features/tambike-demo/tambike-screen.tsx
git add -- src/app/profile/preview/page.tsx src/features/member-profiles/profile-preview.tsx src/features/member-profiles/profile-preview-adapter.ts src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git add -p -- src/features/tambike-demo/tambike-screen.tsx
git diff --cached
git commit -m "feat: add dedicated rider profile preview"
```

Do not stage unrelated carousel/event/raffle changes from `tambike-screen.tsx`.

---

### Task 4: Make profile-photo upload one step

**Files:**

- Modify: `src/features/member-profiles/member-media-uploader.tsx`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

- [ ] **Step 1: Write a failing one-step upload contract**

Replace the old two-step uploader expectations with:

```ts
test("starts profile photo upload from file selection without a second button", () => {
  const uploader = source(
    "src/features/member-profiles/member-media-uploader.tsx",
  );

  expect(uploader).toContain("Choose profile photo");
  expect(uploader).toContain(
    "Optional · Square images work best · JPEG, PNG, or WebP · Up to 8 MB.",
  );
  expect(uploader).toContain("void uploadSelected(selected)");
  expect(uploader).toContain('aria-live="polite"');
  expect(uploader).toContain("selectedPreviewUrl");
  expect(uploader).not.toContain("Upload avatar photo");
});
```

Retain the existing behavioral tests for local validation, presign, FormData upload, finalization, error mapping, pending chooser disabling, and object-URL cleanup.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: failure reports the old avatar label/helper and the remaining Upload button.

- [ ] **Step 3: Refactor selection into immediate upload**

Replace `selectFile` plus button-driven `upload` with an async selection handler that takes the selected file directly:

```ts
const uploadSelected = async (selected: File | null) => {
  clearSelectedPreview();
  setStatus("");
  if (!selected) return;

  const previewUrl = URL.createObjectURL(selected);
  selectedPreviewUrlRef.current = previewUrl;
  setSelectedPreviewUrl(previewUrl);

  const validationError = validateMemberMediaFile(selected);
  if (validationError) {
    setStatus(validationError);
    if (inputRef.current) inputRef.current.value = "";
    return;
  }

  setPending(true);
  try {
    await performMemberMediaUpload(
      { file: selected, purpose: "avatar" },
      {
        fetchImpl: fetch,
        finalize: finalizeMemberMediaAction,
        onStatus: setStatus,
      },
    );
    await onUploaded();
    clearSelectedPreview();
    if (inputRef.current) inputRef.current.value = "";
    setStatus("Profile photo uploaded.");
  } catch (error) {
    setStatus(memberMediaUploadFailure(error).message);
    if (inputRef.current) inputRef.current.value = "";
  } finally {
    setPending(false);
  }
};
```

Wire the chooser with:

```tsx
<Label htmlFor={inputId}>Choose profile photo</Label>
<p>Optional · Square images work best · JPEG, PNG, or WebP · Up to 8 MB.</p>
<MemberMediaFileChooser
  inputRef={inputRef}
  inputId={inputId}
  purpose="avatar"
  photoCount={0}
  pending={pending}
  onFileSelected={(selected) => {
    void uploadSelected(selected);
  }}
/>
```

Remove the separate Upload button. Keep selected preview visible during upload and on failure, revoke object URLs on replacement/success/unmount, and keep progress in the existing `aria-live` status.

- [ ] **Step 4: Run the focused suite**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: one-step UI contracts and all upload pipeline/error tests pass.

- [ ] **Step 5: Commit the one-step avatar flow**

```powershell
git add -- src/features/member-profiles/member-media-uploader.tsx tests/server/member-profile-ui-contract.test.ts
git commit -m "feat: upload profile photo on selection"
```

---

### Task 5: Explain motorcycle-photo capacity in every state

**Files:**

- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

- [ ] **Step 1: Write failing capacity and full-gallery tests**

Import and test a pure copy helper:

```ts
import { motorcyclePhotoCapacityLabel } from "../../src/features/member-profiles/motorcycle-photo-workspace";

test("explains empty, partial, and full motorcycle gallery capacity", () => {
  expect(motorcyclePhotoCapacityLabel(0))
    .toBe("0 of 5 photos · Add up to 5");
  expect(motorcyclePhotoCapacityLabel(2))
    .toBe("2 of 5 photos · Add up to 3 more");
  expect(motorcyclePhotoCapacityLabel(5))
    .toBe("5 of 5 photos · Delete one to add another");
});

test("replaces the chooser when the saved motorcycle gallery is full", () => {
  const workspace = source(
    "src/features/member-profiles/motorcycle-photo-workspace.tsx",
  );

  expect(workspace).toContain("Motorcycle photos *");
  expect(workspace).toContain(
    "The first photo is your cover. JPEG, PNG, or WebP · Up to 8 MB each.",
  );
  expect(workspace).toContain("motorcyclePhotoCapacityLabel(photos.length)");
  expect(workspace).toMatch(
    /photos\.length >= 5[\s\S]*?motorcyclePhotoFull[\s\S]*?:[\s\S]*?motorcyclePhotoDropzone/,
  );
});
```

Keep existing queue, retry, refresh, set-cover, move-left/right, drag-reorder, Delete, and five-slot scheduling tests.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: failures mention the missing helper, missing required section title, and missing full-gallery branch.

- [ ] **Step 3: Add bounded capacity copy**

Export:

```ts
export function motorcyclePhotoCapacityLabel(photoCount: number) {
  const count = Math.min(5, Math.max(0, photoCount));
  const remaining = 5 - count;

  if (remaining === 0) {
    return "5 of 5 photos · Delete one to add another";
  }
  if (count === 0) {
    return "0 of 5 photos · Add up to 5";
  }
  return `${count} of 5 photos · Add up to ${remaining} more`;
}
```

Use the saved `photos.length` for this public capacity statement. Continue using `availableSlots` with active queue count to prevent over-selection while uploads are pending.

- [ ] **Step 4: Render required title, helper, capacity, and a true full state**

At the top of the workspace:

```tsx
<div className={styles.motorcyclePhotoHeading}>
  <div>
    <strong id="motorcycle-photo-title">Motorcycle photos *</strong>
    <span>
      The first photo is your cover. JPEG, PNG, or WebP · Up to 8 MB each.
    </span>
  </div>
  <span className={styles.motorcyclePhotoCapacity} aria-live="polite">
    {motorcyclePhotoCapacityLabel(photos.length)}
  </span>
</div>
```

Render a saved-gallery full state instead of the inactive uploader:

```tsx
{photos.length >= 5 ? (
  <div className={styles.motorcyclePhotoFull}>
    <ImagePlus aria-hidden="true" />
    <strong>Gallery full</strong>
    <span>5 of 5 photos · Delete one to add another</span>
  </div>
) : (
  <div className={styles.motorcyclePhotoDropzone}>
    {/* existing drop/select behavior */}
  </div>
)}
```

Keep `MemberMediaDropInput disabled={availableSlots === 0}` so a queue occupying all remaining slots cannot exceed five. The queue progress immediately below explains that those slots are uploading.

- [ ] **Step 5: Style capacity and full-gallery messaging**

Add `.motorcyclePhotoHeading`, `.motorcyclePhotoCapacity`, and `.motorcyclePhotoFull`. The capacity must remain visible above the uploader/gallery on desktop and mobile. The full state should use the dropzone footprint but no file input.

- [ ] **Step 6: Run the focused suite**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: exact empty/partial/full copy and all prior upload/reorder contracts pass.

- [ ] **Step 7: Commit the gallery guidance**

```powershell
git add -- src/features/member-profiles/motorcycle-photo-workspace.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "feat: explain motorcycle photo capacity"
```

---

### Task 6: Verify the complete rider journey

**Files:**

- Verify only; fix scoped regressions in the files above and extend `tests/server/member-profile-ui-contract.test.ts` only when a missing contract is discovered.

- [ ] **Step 1: Run focused and full automated checks**

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
npm run test:server
npm run lint
npm run build
```

Expected: all commands exit 0. If a failure comes from unrelated dirty work, record the exact failing test/file and prove the profile-focused suite separately; do not alter unrelated work to make the tree green.

- [ ] **Step 2: Reuse the existing development server**

Check first:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

If port 3000 is already listening, reuse it. Start `npm run dev` only when no server is running, then confirm `http://localhost:3000/profile` responds.

- [ ] **Step 3: Re-read and use the Codex browser skill**

Open `/profile` in the in-app browser and verify the signed-in flow. Do not use Playwright even though the repository contains Playwright tests.

- [ ] **Step 4: QA a published profile**

Verify:

- heading is `Your rider profile`, with no `Garage Studio` or `Edit profile`;
- state is `Live`;
- exactly one viewing link is shown and says `View public profile`;
- there is no embedded preview and no `View your rider page`;
- all five requirements have visible asterisks;
- all six optional labels say `(optional)`;
- the public link opens `/riders/[slug]`;
- the public page has no owner-only controls.

- [ ] **Step 5: QA an incomplete unpublished profile**

Verify:

- state is `Complete your profile`;
- the first missing requirement is named;
- only Identity/Motorcycle/Photo signals appear;
- exactly one viewing link says `Preview profile`;
- `/profile/preview` shows only `Preview — only you can see this`, `Back to edit`, and the shared garage view;
- Back to edit returns to `/profile`;
- completed unpublished state changes to `Ready to publish` and shows the existing publish action without the three-signal list.

- [ ] **Step 6: QA profile-photo success and failure**

Use a valid local JPEG/PNG/WebP no larger than 8 MB for success. Verify one file selection immediately progresses through preparing/uploading/finishing, then updates the saved image without a second Upload click.

Exercise a rejected type or over-8-MB file. Verify:

- the preview remains visible when useful;
- the status explains JPEG/PNG/WebP and 8 MB;
- the chooser becomes usable again;
- selecting a valid image afterward succeeds;
- Delete still removes the saved profile photo.

- [ ] **Step 7: QA motorcycle-photo behavior**

Verify:

- empty state says `0 of 5 photos · Add up to 5`;
- selecting multiple valid photos automatically uploads them;
- partial state reports the correct remaining capacity;
- the first saved image is labeled cover;
- `Set as cover`, `Move left`, `Move right`, drag reorder, Delete, Retry, and Refresh gallery remain reachable and correctly labeled;
- at five saved photos, the chooser is replaced by `5 of 5 photos · Delete one to add another`;
- deleting one restores the chooser and correct capacity.

- [ ] **Step 8: QA responsive layout and accessibility**

At desktop and 390 px width, verify:

- the first card begins near the compact header without the old mode/status wall;
- no horizontal overflow (`document.documentElement.scrollWidth === document.documentElement.clientWidth`);
- images stay within the viewport;
- status/action/notice text wraps without overlap;
- Tab focus is visible on links, inputs, selects, upload controls, save/publish actions, cover/order actions, and Delete;
- required indicators are readable without relying on color;
- browser console has no current-page errors and media requests complete successfully.

- [ ] **Step 9: Inspect final scope and commit any verification-only correction**

```powershell
git status --short
git diff --check
git diff -- src/app/profile src/features/member-profiles tests/server/member-profile-ui-contract.test.ts
```

If verification required a scoped correction, rerun the failed gate and commit only that correction:

```powershell
git add -- src/app/profile/preview/page.tsx src/features/member-profiles/profile-editor-presentation.ts src/features/member-profiles/profile-preview-adapter.ts src/features/member-profiles/profile-preview.tsx src/features/member-profiles/profile-settings.tsx src/features/member-profiles/member-media-uploader.tsx src/features/member-profiles/motorcycle-photo-workspace.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "fix: complete rider profile editor QA"
```

Do not stage or commit unrelated pre-existing work.

---

## Completion Gate

- `/profile` is edit-only and contains no redundant edit/preview mode controls.
- Published and unpublished profiles expose exactly one contextual viewing link.
- The five publish requirements and six optional fields are visibly identified.
- Profile-photo selection begins upload immediately.
- Motorcycle gallery capacity is correct at 0, partial, and 5 photos.
- `/profile/preview` is authenticated and uses `RiderGarageView`.
- `/riders/[slug]` remains the authoritative public page with no owner controls.
- Focused tests, server tests, lint, and build pass or any unrelated pre-existing failure is precisely documented.
- Desktop and 390 px in-app browser QA covers upload, preview/public parity, ordering, errors, accessibility, media loading, and overflow.
- Final diff contains no unrelated work, unfinished markers, or temporary debug text.
