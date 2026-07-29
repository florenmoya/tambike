# Discoverable Profile Save Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the profile-details save action immediately discoverable, visually attached to the fields it saves, and readable on desktop and mobile.

**Architecture:** Keep the existing shared profile form and server action unchanged. Extract its footer into a small renderable `ProfileDetailsSaveFooter` component, then use Tambike's existing studio tokens to create a full-width light action surface with an amber primary button and high-contrast live feedback.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Vitest, Codex in-app Browser.

## Global Constraints

- The footer scope is **Profile details** and it saves identity, visibility, and attendance privacy.
- The primary label is **Save profile details** and the pending label remains **Saving…**.
- The existing polite live region and pending disable behavior must remain intact.
- At widths up to 640 px, the footer becomes one column and the submit button spans the available width.
- The separate Motorcycle form and **Save motorcycle** action must remain unchanged.
- Preserve unrelated dirty files and do not create a branch or worktree.

---

### Task 1: Attach a high-contrast save footer to profile details

**Files:**
- Modify: `tests/server/member-profile-ui-contract.test.ts`
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`

**Interfaces:**
- Consumes: `profilePending: boolean` and `profileSaveStatus: string` from `LoadedProfileSettings`.
- Produces: `ProfileDetailsSaveFooter({ pending, status }: { pending: boolean; status: string }): ReactNode`.

- [ ] **Step 1: Write the failing rendered-behavior and CSS tests**

Add a dynamic loader next to the existing `loadProfileViewAction` helper:

```ts
async function loadProfileDetailsSaveFooter() {
  const settings = await import("../../src/features/member-profiles/profile-settings");
  return (settings as unknown as {
    ProfileDetailsSaveFooter?: (props: {
      pending: boolean;
      status: string;
    }) => ReactNode;
  }).ProfileDetailsSaveFooter;
}
```

Add a rendered behavior test:

```ts
test("attaches a clear save action to profile details", async () => {
  const ProfileDetailsSaveFooter = await loadProfileDetailsSaveFooter();
  expect(ProfileDetailsSaveFooter).toBeTypeOf("function");

  const markup = renderToStaticMarkup(ProfileDetailsSaveFooter!({
    pending: false,
    status: "Profile changes saved.",
  }));

  expect(markup).toContain('aria-label="Save profile details"');
  expect(markup).toContain("Profile details");
  expect(markup).toContain(
    "Saves identity, visibility, and attendance privacy.",
  );
  expect(markup).toContain("Save profile details");
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain("Profile changes saved.");
});
```

Extend the responsive-style contract to require:

```ts
expect(styles).toMatch(
  /\.profileDetailsSaveFooter\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;[\s\S]*?background:\s*var\(--studio-paper\);/,
);
expect(styles).toMatch(
  /\.profileDetailsSaveButton[\s\S]*?background:\s*var\(--studio-amber\);[\s\S]*?color:\s*var\(--studio-asphalt\);/,
);
expect(styles).toMatch(
  /@media\s*\(max-width:\s*640px\)[\s\S]*?\.profileDetailsSaveFooter\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?\.profileDetailsSaveButton\s*\{[\s\S]*?width:\s*100%;/,
);
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
```

Expected: FAIL because `ProfileDetailsSaveFooter` and the scoped footer styles do not exist.

- [ ] **Step 3: Implement the minimal footer component**

Add this exported component above `ProfileSaveFieldset`:

```tsx
export function ProfileDetailsSaveFooter({
  pending,
  status,
}: {
  pending: boolean;
  status: string;
}) {
  return (
    <section
      className={styles.profileDetailsSaveFooter}
      aria-label="Save profile details"
    >
      <div className={styles.profileDetailsSaveCopy}>
        <strong>Profile details</strong>
        <span>Saves identity, visibility, and attendance privacy.</span>
      </div>
      <div className={styles.profileDetailsSaveActions}>
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className={styles.profileDetailsSaveButton}
        >
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {pending ? "Saving…" : "Save profile details"}
        </Button>
        <p className={styles.profileDetailsSaveStatus} aria-live="polite">
          {status}
        </p>
      </div>
    </section>
  );
}
```

Replace only the first `.profile-settings__save` block with:

```tsx
<ProfileDetailsSaveFooter
  pending={profilePending}
  status={profileSaveStatus}
/>
```

Remove the now-unused `publishLabel` variable. Do not change the Motorcycle form.

- [ ] **Step 4: Add the scoped studio styles**

Add:

```css
.profileDetailsSaveFooter {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem 1.5rem;
  min-width: 0;
  padding: clamp(1rem, 2vw, 1.25rem);
  border: 1px solid color-mix(in srgb, var(--studio-amber) 42%, transparent);
  border-radius: 0.75rem;
  background: var(--studio-paper);
  color: var(--studio-asphalt);
}

.profileDetailsSaveCopy,
.profileDetailsSaveActions {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

.profileDetailsSaveCopy strong {
  font-size: 1rem;
}

.profileDetailsSaveCopy span,
.profileDetailsSaveStatus {
  color: color-mix(in srgb, var(--studio-asphalt) 72%, transparent);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.profileDetailsSaveButton {
  background: var(--studio-amber);
  color: var(--studio-asphalt);
}

.profileDetailsSaveButton:hover {
  background: color-mix(in srgb, var(--studio-amber) 84%, white);
  color: var(--studio-asphalt);
}

.profileDetailsSaveButton:focus-visible {
  outline: 3px solid var(--studio-asphalt);
  outline-offset: 3px;
}

.profileDetailsSaveStatus {
  min-height: 1.2rem;
  margin: 0;
  font-weight: 700;
  text-align: right;
}
```

Inside the existing `@media (max-width: 640px)` rule add:

```css
.profileDetailsSaveFooter {
  grid-template-columns: minmax(0, 1fr);
}

.profileDetailsSaveButton {
  width: 100%;
}

.profileDetailsSaveStatus {
  text-align: left;
}
```

- [ ] **Step 5: Run focused GREEN and scoped static checks**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
npx eslint src/features/member-profiles/profile-settings.tsx tests/server/member-profile-ui-contract.test.ts
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Verify the real save flow in the Codex in-app Browser**

Reuse the existing localhost server and authenticated profile session.

Desktop, 1280×720:

- Confirm the footer appears immediately after Identity and Attendance privacy.
- Confirm the footer surface is light, the button is amber, and the status is readable.
- Change Garage note, click **Save profile details**, and confirm **Profile changes saved.**
- Restore the prior Garage note and save again.
- Confirm the button has a visible keyboard focus indicator.

Mobile, 390×844:

- Confirm the footer is one column.
- Confirm **Save profile details** spans the footer width.
- Confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

- [ ] **Step 7: Commit the scoped fix**

```powershell
git add -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "fix: surface profile details save action"
```
