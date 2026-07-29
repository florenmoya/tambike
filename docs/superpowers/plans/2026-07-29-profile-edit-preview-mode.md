# Profile Edit and Public Preview Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading compact Garage Studio preview with a full, draft-aware rendering of the actual public rider garage and make motorcycle photo ordering actions immediately understandable.

**Architecture:** Extract a server/client-safe `RiderGarageView` and media-image primitive from the current public screen, then feed that same view from a pure draft adapter inside `/profile`. Keep Edit and Preview content mounted and toggle them with the `hidden` attribute so drafts and the local upload queue survive mode changes. Continue using the existing reorder action for adjacent moves, drag ordering, and the new Set as cover action.

**Tech Stack:** Next.js 16.2.11 App Router, React 19 client state, TypeScript, CSS Modules plus existing global garage styles, shadcn Button, Vitest, Codex in-app browser.

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, `node_modules/next/dist/docs/01-app/01-getting-started/12-images.md`, and `node_modules/next/dist/docs/03-architecture/accessibility.md` before application edits.
- Do not add dependencies, routes, database fields, API actions, media formats, or storage behavior.
- Do not change profile visibility, publication, roster-identity, or public-profile authorization rules.
- Do not create a branch or worktree.
- Preserve unrelated staged, unstaged, and untracked work; stage only files named by the current task.
- Extend `tests/server/member-profile-ui-contract.test.ts`; do not create a new test file.
- Reuse an existing development server on port 3000; do not start a second server.
- Browser verification must use the Codex in-app browser surface only.
- Keep Edit and Preview content mounted so switching modes preserves unsaved drafts and `MotorcyclePhotoWorkspace` queue state.
- Use this exact editor-only notice: `Preview — only you can see this`.
- Use these exact photo actions: `Set as cover`, `Move left`, `Move right`, and `Delete`.
- Locally selected photos enter preview only after upload finalization and the existing editor refresh succeeds.

---

### Task 1: Shared Rider Garage View and Draft Adapter

**Files:**
- Create: `src/features/member-profiles/member-media-image.tsx`
- Create: `src/features/member-profiles/rider-garage-view.tsx`
- Create: `src/features/member-profiles/profile-preview-adapter.ts`
- Modify: `src/features/member-profiles/member-profile-screen.tsx`
- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-studio-preview.tsx`
- Test: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Consumes: `MemberProfileView`, `MemberProfileEditorView`, `UpdateMemberProfileInput`, and `UpsertMotorcycleInput` from `src/features/member-profiles/types.ts`.
- Produces: `MemberMediaImage(props: ImageProps): ReactElement`.
- Produces: `RiderGarageView({ profile, prioritizeMedia? }: { profile: MemberProfileView; prioritizeMedia?: boolean }): ReactElement`.
- Produces: `toProfilePreviewView(editor: MemberProfileEditorView, profileDraft: UpdateMemberProfileInput, motorcycleDraft: UpsertMotorcycleInput): MemberProfileView`.
- Preserves: `MemberProfileScreen({ profile }: { profile: MemberProfileView })` as the public-route component API.

- [ ] **Step 1: Add failing adapter and shared-renderer tests**

Update the imports and add these assertions to `tests/server/member-profile-ui-contract.test.ts`:

```tsx
import { RiderGarageView } from "../../src/features/member-profiles/rider-garage-view";
import { toProfilePreviewView } from "../../src/features/member-profiles/profile-preview-adapter";

test("derives a public-safe preview from unsaved profile and motorcycle drafts", () => {
  const preview = toProfilePreviewView(
    editor,
    {
      displayName: "Draft Rider",
      area: "Cebu City",
      bio: "Draft garage note.",
      visibility: "MEMBERS_ONLY",
      defaultRosterIdentity: "VISIBLE",
    },
    {
      make: "Yamaha",
      model: "XSR900",
      year: 2025,
      displacementCc: 890,
      nickname: "Midnight",
      description: "Unsaved motorcycle note.",
    },
  );

  expect(preview).toMatchObject({
    slug: "mika-santos",
    displayName: "Draft Rider",
    area: "Cebu City",
    bio: "Draft garage note.",
    visibility: "MEMBERS_ONLY",
    role: "organizer",
    joinedAt: "July 22, 2026",
    profilePhotoUrl: "/media/avatar-1",
    organizer: { hostedEventCount: 3 },
    motorcycle: {
      make: "Yamaha",
      model: "XSR900",
      year: 2025,
      displacementCc: 890,
      nickname: "Midnight",
      description: "Unsaved motorcycle note.",
      photos: editor.motorcycle?.photos,
    },
  });
  expect(preview).not.toHaveProperty("defaultRosterIdentity");
  expect(preview).not.toHaveProperty("isPublished");
});

test("uses the public empty-garage state for an incomplete motorcycle draft", () => {
  const preview = toProfilePreviewView(
    editor,
    {
      displayName: editor.displayName,
      area: editor.area,
      bio: editor.bio,
      visibility: editor.visibility,
      defaultRosterIdentity: editor.defaultRosterIdentity,
    },
    { make: "Honda", model: "" },
  );

  expect(preview.motorcycle).toBeUndefined();
  expect(renderToStaticMarkup(createElement(RiderGarageView, { profile: preview })))
    .toContain("No motorcycle added yet");
});

test("uses one shared rider garage view for public and editor presentation", () => {
  const screen = source("src/features/member-profiles/member-profile-screen.tsx");
  const garage = source("src/features/member-profiles/rider-garage-view.tsx");

  expect(screen).toContain("<RiderGarageView");
  expect(garage).toContain("garage-identity-plate");
  expect(garage).toContain("garage-motorcycle-hero");
  expect(garage).toContain("garage-contact-strip");
  expect(garage).not.toMatch(/email|verificationStatus|storageKey/i);
});
```

Move the existing direct-image source assertion from `member-profile-screen.tsx` to `member-media-image.tsx`, and change source assertions for garage markup to inspect `rider-garage-view.tsx`.

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL because `rider-garage-view.tsx`, `member-media-image.tsx`, `profile-preview-adapter.ts`, and their exports do not exist.

- [ ] **Step 3: Extract the same-origin media primitive**

Create `src/features/member-profiles/member-media-image.tsx`:

```tsx
import Image, { type ImageProps } from "next/image";

export function MemberMediaImage({ alt, ...props }: ImageProps) {
  return <Image {...props} alt={alt} unoptimized />;
}
```

Update imports in `member-profile-screen.tsx`, `motorcycle-photo-workspace.tsx`, `profile-settings.tsx`, and the temporarily retained `profile-studio-preview.tsx` to use `./member-media-image`. Task 2 deletes the obsolete compact preview after the shared extraction is independently green.

- [ ] **Step 4: Extract the public garage article without changing its markup**

Create `src/features/member-profiles/rider-garage-view.tsx` by moving `initialsFor`, `motorcycleTitle`, and the `<article className="garage-card">…</article>` subtree out of `MemberProfileScreen`.

Use this complete component and apply `prioritizeMedia` only to the avatar and motorcycle hero:

```tsx
import { CalendarDays, MapPin, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { MemberMediaImage } from "./member-media-image";
import type { MemberProfileView, MotorcycleShowcase } from "./types";

function initialsFor(displayName: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function motorcycleTitle(motorcycle: MotorcycleShowcase) {
  return motorcycle.nickname || `${motorcycle.make} ${motorcycle.model}`;
}

export interface RiderGarageViewProps {
  profile: MemberProfileView;
  prioritizeMedia?: boolean;
}

export function RiderGarageView({
  profile,
  prioritizeMedia = false,
}: RiderGarageViewProps) {
  const motorcycle = profile.motorcycle;
  const photos = motorcycle?.photos.toSorted(
    (left, right) => left.position - right.position,
  ) ?? [];
  const hero = photos[0];

  return (
    <article className="garage-card" aria-labelledby="garage-card-title">
      <header className="garage-identity-plate">
        <div className="garage-avatar">
          {profile.profilePhotoUrl ? (
            <MemberMediaImage
              src={profile.profilePhotoUrl}
              alt={`${profile.displayName} profile photo`}
              width={512}
              height={512}
              sizes="(max-width: 640px) 112px, 152px"
              priority={prioritizeMedia}
            />
          ) : (
            <span aria-label={`${profile.displayName} profile photo placeholder`}>
              {initialsFor(profile.displayName)}
            </span>
          )}
        </div>

        <div className="garage-identity-copy">
          <div className="garage-identity-kicker">
            <span>{profile.role === "organizer" ? "Organizer garage" : "Rider garage"}</span>
            {profile.organizer ? (
              <Badge variant="secondary">
                <ShieldCheck aria-hidden="true" /> Organizer
              </Badge>
            ) : null}
          </div>
          <h1 id="garage-card-title">{profile.displayName}</h1>
          <div className="garage-profile-facts">
            <span><MapPin aria-hidden="true" /> {profile.area}</span>
            <span><CalendarDays aria-hidden="true" /> Joined {profile.joinedAt}</span>
            {profile.organizer ? (
              <span>{profile.organizer.hostedEventCount} hosted events</span>
            ) : null}
          </div>
          {profile.bio ? <p>{profile.bio}</p> : <p>Garage notes are still being written.</p>}
        </div>
      </header>

      {motorcycle ? (
        <section className="garage-showcase" aria-labelledby="motorcycle-title">
          <div className="garage-showcase-heading">
            <span>One bike, kept close</span>
            <h2 id="motorcycle-title">{motorcycleTitle(motorcycle)}</h2>
          </div>

          {hero ? (
            <div className="garage-motorcycle-hero">
              <MemberMediaImage
                src={hero.url}
                alt={`${profile.displayName}'s ${motorcycle.make} ${motorcycle.model}`}
                width={1600}
                height={1200}
                sizes="(max-width: 720px) 100vw, 1120px"
                priority={prioritizeMedia}
              />
              <span className="garage-photo-index">
                01 / {String(photos.length).padStart(2, "0")}
              </span>
            </div>
          ) : (
            <div className="garage-motorcycle-empty">
              <span>Showcase awaiting its first photograph</span>
              <strong>{motorcycle.make} {motorcycle.model}</strong>
            </div>
          )}

          <dl className="garage-specifications">
            <div><dt>Make</dt><dd>{motorcycle.make}</dd></div>
            <div><dt>Model</dt><dd>{motorcycle.model}</dd></div>
            {motorcycle.year ? <div><dt>Year</dt><dd>{motorcycle.year}</dd></div> : null}
            {motorcycle.displacementCc ? (
              <div><dt>Engine</dt><dd>{motorcycle.displacementCc} cc</dd></div>
            ) : null}
          </dl>

          {motorcycle.description ? (
            <p className="garage-motorcycle-story">{motorcycle.description}</p>
          ) : null}

          {photos.length ? (
            <ol className="garage-contact-strip" aria-label="Motorcycle photo contact strip">
              {photos.map((photo, index) => (
                <li key={photo.url}>
                  <MemberMediaImage
                    src={photo.url}
                    alt={`${motorcycleTitle(motorcycle)} photo ${index + 1} of ${photos.length}`}
                    width={photo.width || 400}
                    height={photo.height || 300}
                    sizes="(max-width: 640px) 32vw, 208px"
                  />
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : (
        <section className="garage-showcase-empty" aria-labelledby="empty-garage-title">
          <span>Motorcycle showcase</span>
          <h2 id="empty-garage-title">No motorcycle added yet</h2>
          <p>This garage card is published, but its keeper has not added a motorcycle.</p>
        </section>
      )}
    </article>
  );
}
```

Reduce `MemberProfileScreen` to the public shell and back link:

```tsx
import Link from "next/link";

import { RiderGarageView } from "./rider-garage-view";
import type { MemberProfileView } from "./types";

export function MemberProfileScreen({ profile }: { profile: MemberProfileView }) {
  return (
    <section className="garage-profile-page" aria-label={`${profile.displayName} rider garage`}>
      <div className="garage-profile-shell">
        <Link className="garage-profile-back" href="/events">
          Tambike / Rider garages
        </Link>
        <RiderGarageView profile={profile} prioritizeMedia />
      </div>
    </section>
  );
}
```

Do not change class names, copy, ordered-photo sorting, empty states, image dimensions, alt text, or public semantics during the move.

- [ ] **Step 5: Implement the pure preview adapter**

Create `src/features/member-profiles/profile-preview-adapter.ts`:

```ts
import type {
  MemberProfileEditorView,
  MemberProfileView,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "./types";

export function toProfilePreviewView(
  editor: MemberProfileEditorView,
  profileDraft: UpdateMemberProfileInput,
  motorcycleDraft: UpsertMotorcycleInput,
): MemberProfileView {
  const make = motorcycleDraft.make.trim();
  const model = motorcycleDraft.model.trim();
  const hasCompleteMotorcycle = Boolean(make && model);

  return {
    slug: editor.slug ?? "profile-preview",
    displayName: profileDraft.displayName.trim() || "Your rider name",
    area: profileDraft.area.trim() || "Your area",
    role: editor.role,
    bio: profileDraft.bio?.trim() || undefined,
    visibility: profileDraft.visibility,
    joinedAt: editor.joinedAt,
    profilePhotoUrl: editor.profilePhotoUrl,
    organizer: editor.organizer,
    motorcycle: hasCompleteMotorcycle
      ? {
          make,
          model,
          year: motorcycleDraft.year,
          displacementCc: motorcycleDraft.displacementCc,
          nickname: motorcycleDraft.nickname?.trim() || undefined,
          description: motorcycleDraft.description?.trim() || undefined,
          photos: editor.motorcycle?.photos.toSorted(
            (left, right) => left.position - right.position,
          ) ?? [],
        }
      : undefined,
  };
}
```

- [ ] **Step 6: Run the focused tests and type-aware production build**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
npm run build
```

Expected: the focused test file passes; Next.js compilation and TypeScript pass; all static pages generate.

- [ ] **Step 7: Commit the shared view and adapter**

```powershell
git add -- src/features/member-profiles/member-media-image.tsx src/features/member-profiles/rider-garage-view.tsx src/features/member-profiles/profile-preview-adapter.ts src/features/member-profiles/member-profile-screen.tsx src/features/member-profiles/motorcycle-photo-workspace.tsx src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio-preview.tsx tests/server/member-profile-ui-contract.test.ts
git diff --cached --check
git commit -m "refactor: share rider garage preview"
```

---

### Task 2: Edit and Preview Modes Without State Loss

**Files:**
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Delete: `src/features/member-profiles/profile-studio-preview.tsx`
- Test: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Consumes: `RiderGarageView` from Task 1.
- Consumes: `toProfilePreviewView(editor, profileDraft, motorcycleDraft)` from Task 1.
- Produces: local `StudioMode = "edit" | "preview"` state inside `LoadedProfileSettings`.
- Preserves: all current forms, save actions, dirty flags, media callbacks, and `MotorcyclePhotoWorkspace` instance.

- [ ] **Step 1: Replace obsolete compact-preview tests with failing mode tests**

Delete imports and tests for `ProfileStudioPreview`. Add:

```tsx
test("offers edit and exact public-preview modes without unmounting editor state", () => {
  const settings = source("src/features/member-profiles/profile-settings.tsx");

  expect(settings).toContain('"edit" | "preview"');
  expect(settings).toContain("Edit profile");
  expect(settings).toContain("Preview profile");
  expect(settings).toContain("Preview — only you can see this");
  expect(settings).toContain("<RiderGarageView");
  expect(settings).toContain("toProfilePreviewView(");
  expect(settings).toContain('hidden={studioMode !== "edit"}');
  expect(settings).toContain('hidden={studioMode !== "preview"}');
  expect(settings).not.toContain("ProfileStudioPreview");
  expect(settings).not.toContain("studioPreviewColumn");
});

test("styles the full visitor garage preview instead of a compact sidebar card", () => {
  const styles = source(
    "src/features/member-profiles/profile-studio.module.css",
  );

  expect(styles).toContain(".studioModeSwitch");
  expect(styles).toContain(".studioPreviewMode");
  expect(styles).toContain(".studioPreviewNotice");
  expect(styles).toMatch(
    /\.studioPreviewMode\s+:global\(\.garage-profile-page\)[\s\S]*?min-height:\s*auto;/,
  );
  expect(styles).not.toContain(".studioPreviewColumn");
  expect(styles).not.toContain(".studioPreviewHero");
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL because the old `ProfileStudioPreview` and sticky sidebar remain and the mode controls do not exist.

- [ ] **Step 3: Add the mode state and derive the preview profile**

In `LoadedProfileSettings`, add:

```tsx
type StudioMode = "edit" | "preview";

const [studioMode, setStudioMode] = useState<StudioMode>("edit");
const previewProfile = toProfilePreviewView(
  editor,
  profileDraft,
  motorcycleDraft,
);
```

Import `RiderGarageView` and `toProfilePreviewView` from the Task 1 modules. Remove the `ProfileStudioPreview` import.

- [ ] **Step 4: Add the accessible mode control beside the Studio heading**

Place this after the heading copy and before readiness:

```tsx
<div className={styles.studioModeSwitch} role="group" aria-label="Profile workspace mode">
  <Button
    type="button"
    variant={studioMode === "edit" ? "default" : "outline"}
    aria-pressed={studioMode === "edit"}
    onClick={() => setStudioMode("edit")}
  >
    Edit profile
  </Button>
  <Button
    type="button"
    variant={studioMode === "preview" ? "default" : "outline"}
    aria-pressed={studioMode === "preview"}
    onClick={() => setStudioMode("preview")}
  >
    Preview profile
  </Button>
</div>
```

Keep the existing View rider page link or Not published badge; it serves saved/public navigation and is distinct from draft preview.

- [ ] **Step 5: Keep both modes mounted and remove the compact sidebar**

Replace the two-column `studioLayout` wrapper with two mounted panels:

```tsx
<div
  hidden={studioMode !== "edit"}
  className={styles.studioEditor}
>
```

Open that wrapper immediately before the existing `<form action={handleProfileSave}>`. Close it immediately after the existing media-status paragraph whose class includes `styles.mediaStatus`. This exact boundary keeps the profile form, avatar editor, motorcycle form, `MotorcyclePhotoWorkspace`, and media status mounted as one editor panel.

Immediately after that closing `</div>`, add:

```tsx
<section
  hidden={studioMode !== "preview"}
  className={styles.studioPreviewMode}
  aria-label="Profile preview"
>
  <div className={styles.studioPreviewNotice} role="status">
    Preview — only you can see this
  </div>
  <div className="garage-profile-page">
    <div className="garage-profile-shell">
      <RiderGarageView profile={previewProfile} />
    </div>
  </div>
</section>
```

Do not use conditional rendering for the editor panel. The mounted `MotorcyclePhotoWorkspace` owns local object URLs and queue state that must survive mode switches.

Delete `src/features/member-profiles/profile-studio-preview.tsx`.

- [ ] **Step 6: Replace sidebar CSS with mode and full-preview CSS**

Remove `.studioLayout`, `.studioPreviewColumn`, `.studioPreview`, `.studioPreviewEyebrow`, `.studioPreviewHero`, `.studioPreviewIdentity`, `.studioPreviewVisibility`, `.studioPreviewSpecification`, `.studioPreviewNote`, and their compact-preview responsive rules.

Add:

```css
.studioModeSwitch {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
  padding: 0.25rem;
  border: 1px solid color-mix(in srgb, var(--studio-steel) 26%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--studio-asphalt) 82%, transparent);
}

.studioModeSwitch :global([data-slot="button"]) {
  min-height: 44px;
}

.studioPreviewMode {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.studioPreviewNotice {
  border-left: 3px solid var(--studio-amber);
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--studio-amber) 12%, var(--studio-asphalt));
  color: var(--studio-paper);
  padding: 0.875rem 1rem;
  font-weight: 700;
}

.studioPreviewMode :global(.garage-profile-page) {
  min-height: auto;
  padding: clamp(0.75rem, 2vw, 1.5rem);
  border-radius: 1rem;
}
```

At `max-width: 640px`, make `.studioModeSwitch` span the available width. Keep the existing reduced-motion rules and all photo-workspace styles.

- [ ] **Step 7: Run focused UI and queue regressions**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-photo-queue.test.ts
npm run lint
```

Expected: all focused tests pass and ESLint exits 0.

- [ ] **Step 8: Commit the mode UI**

```powershell
git add -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css src/features/member-profiles/profile-studio-preview.tsx tests/server/member-profile-ui-contract.test.ts
git diff --cached --check
git commit -m "feat: preview rider profile as visitors see it"
```

---

### Task 3: Clear Cover and Photo-Order Actions

**Files:**
- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Test: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Consumes: existing `onMove(index, direction)` for one-position moves.
- Consumes: existing `onReorder(fromIndex, toIndex)` for drag ordering and Set as cover.
- Produces: visible `Set as cover`, `Move left`, `Move right`, and `Delete` controls with exact accessible labels.
- Preserves: queue processing, drag-and-drop, five-photo capacity, retry, refresh pause, and deletion callbacks.

- [ ] **Step 1: Write failing photo-control assertions**

Replace the old earlier/later assertions in `tests/server/member-profile-ui-contract.test.ts` with:

```tsx
test("names saved-photo actions by their visible result", () => {
  const workspace = source(
    "src/features/member-profiles/motorcycle-photo-workspace.tsx",
  );

  expect(workspace).toContain("Set as cover");
  expect(workspace).toContain("Move left");
  expect(workspace).toContain("Move right");
  expect(workspace).toContain("Cover photo");
  expect(workspace).toMatch(/Photo\s*\{index \+ 1\}\s*of\s*\{photos.length\}/);
  expect(workspace).toContain("onReorder(index, 0)");
  expect(workspace).toMatch(/Set motorcycle photo \$\{index \+ 1\} as cover/);
  expect(workspace).toMatch(/Move motorcycle photo \$\{index \+ 1\} left/);
  expect(workspace).toMatch(/Move motorcycle photo \$\{index \+ 1\} right/);
  expect(workspace).not.toContain("Move earlier");
  expect(workspace).not.toContain("Move later");
});
```

Keep the existing assertions for draggable cards, Retry, Remove, upload scheduling, and cover styling.

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL on the new labels, Set as cover action, and position copy.

- [ ] **Step 3: Render cover and position as separate information**

Replace the saved-card label with:

```tsx
<div className={styles.motorcyclePhotoCardMeta}>
  <span>Photo {index + 1} of {photos.length}</span>
  {index === 0 ? <strong>Cover photo</strong> : null}
</div>
```

Use the existing amber cover treatment for the `<strong>` and the existing green/monospace treatment for the position.

- [ ] **Step 4: Add Set as cover and rename adjacent moves**

Render the actions in this order:

```tsx
{index > 0 ? (
  <Button
    type="button"
    variant="outline"
    aria-label={`Set motorcycle photo ${index + 1} as cover`}
    disabled={mediaPending}
    onClick={() => void onReorder(index, 0)}
  >
    Set as cover
  </Button>
) : null}
<Button
  type="button"
  variant="outline"
  aria-label={`Move motorcycle photo ${index + 1} left`}
  disabled={mediaPending || index === 0}
  onClick={() => void onMove(index, -1)}
>
  Move left
</Button>
<Button
  type="button"
  variant="outline"
  aria-label={`Move motorcycle photo ${index + 1} right`}
  disabled={mediaPending || index === photos.length - 1}
  onClick={() => void onMove(index, 1)}
>
  Move right
</Button>
```

Keep Delete after those controls. Do not change drag handlers or callback implementations.

- [ ] **Step 5: Style the metadata without changing photo dimensions**

Replace `.motorcyclePhotoCardLabel` rules with:

```css
.motorcyclePhotoCardMeta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.375rem 0.75rem;
  color: var(--studio-green);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.motorcyclePhotoCardMeta strong {
  color: var(--studio-amber);
}
```

Keep action wrapping, 44-pixel button height, narrow-screen single-column actions, and cover-card dimensions.

- [ ] **Step 6: Run focused queue/UI tests and full static checks**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-photo-queue.test.ts
npm run lint
npm run build
git diff --check
```

Expected: focused tests pass; lint exits 0; TypeScript and all static pages build; diff check prints no errors.

- [ ] **Step 7: Commit the photo terminology and cover action**

```powershell
git add -- src/features/member-profiles/motorcycle-photo-workspace.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git diff --cached --check
git commit -m "feat: clarify motorcycle photo ordering"
```

---

### Task 4: Browser Acceptance and Final Regression Gate

**Files:**
- Verify only; no source file changes expected.

**Interfaces:**
- Consumes: the completed Task 1–3 commits.
- Produces: browser evidence for exact preview parity, draft retention, upload-queue retention, cover ordering, responsive layout, and clean console/network behavior.

- [ ] **Step 1: Confirm and reuse the existing development server**

Run:

```powershell
netstat -ano -p tcp | findstr /R /C:":3000 .*LISTENING"
```

Expected: exactly one listener for port 3000. Reuse it. If none exists, run `npm run dev` once and record its PID.

- [ ] **Step 2: Verify live draft preview without saving**

Using the Codex in-app browser:

1. Open `http://localhost:3000/profile`.
2. In Edit profile, change display name, area, garage note, motorcycle nickname, and motorcycle note without saving.
3. Select Preview profile.
4. Confirm the full identity plate, motorcycle hero, specifications, story, and contact strip use the same structure as a public rider page.
5. Confirm all unsaved draft values appear.
6. Confirm `Preview — only you can see this` appears outside the garage card.
7. Return to Edit profile and confirm every unsaved field value remains.

- [ ] **Step 3: Verify upload queue retention across modes**

Use an authorized fixture under `public/demo/`:

1. Select a motorcycle photo in Edit profile.
2. Before saving or while it is queued, switch to Preview profile and back.
3. Confirm the same queued item and local preview remain.
4. Confirm the photo enters the visitor preview only after upload finalization and gallery refresh.
5. Confirm there is no duplicate presign or storage upload caused by mode switching.

- [ ] **Step 4: Verify cover and ordering controls**

With at least three saved photos:

1. Click Set as cover on photo 3.
2. Confirm photo 3 becomes `Cover photo`, `Photo 1 of 3`, and the preview hero.
3. Confirm the old cover moves into the contact-strip order instead of being deleted.
4. Use Move right and Move left and confirm the preview contact strip follows.
5. Drag one card to another position and confirm the same order.
6. Confirm Move left is disabled for the cover and Move right is disabled for the last photo.
7. Confirm Delete still removes only the chosen photo after the existing confirmation flow.

- [ ] **Step 5: Compare preview with the saved public rider page**

Save the profile and motorcycle drafts, then:

1. Open the corresponding `/riders/[slug]` page.
2. Compare identity, avatar, facts, bio, motorcycle title, hero, specifications, story, and contact-strip order.
3. Confirm the presentation matches Preview profile.
4. Confirm the public page does not contain the editor-only notice, mode controls, form controls, privacy status, upload queue, or internal fields.

- [ ] **Step 6: Verify desktop, mobile, console, and overflow**

At a desktop viewport and approximately `390 × 844`:

1. Confirm the two mode buttons have usable 44-pixel targets.
2. Confirm the garage hero and contact strip remain within the viewport.
3. Confirm photo actions wrap or stack without clipping.
4. Confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
5. Confirm browser console warnings/errors are empty.

- [ ] **Step 7: Run the final automated gate**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts tests/server/motorcycle-photo-upload-orchestrator.test.ts tests/server/member-profile-photo-queue.test.ts
npm run lint
npm run build
git diff --check
git status --short --branch
```

Expected: all focused tests pass; lint and build exit 0; all static pages generate; diff check is clean. Report unrelated working-tree changes separately and do not alter them.
