# Rider-first Profile Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the internal readiness bar in Garage Studio with a rider-facing status panel that gives one clear next action.

**Architecture:** Keep the existing `LoadedProfileSettings` state, save handlers, publish flow, and Edit/Preview mode untouched. Derive a small status model from the existing profile draft, editor publication state, motorcycle draft, and photo list, then render it in the existing studio header. Use CSS module styles for the compact signals and contextual action.

**Tech Stack:** Next.js 16.2.11 App Router, React 19, TypeScript, CSS Modules, Vitest.

## Global Constraints

- Do not change profile visibility, publication behavior, save handlers, preview adapter, upload queue, or public-route rendering.
- Modify only `src/features/member-profiles/profile-settings.tsx`, `src/features/member-profiles/profile-studio.module.css`, and `tests/server/member-profile-ui-contract.test.ts`.
- Preserve unrelated staged, unstaged, and untracked work.
- Extend the existing UI contract test; do not create a test file.
- Keep mode buttons at a minimum 44px target and preserve responsive no-overflow behavior.
- Use rider-facing language: `Identity`, `Motorcycle`, `Photo`, `Ready for your next meetup`, `Your rider card is live`, and `Show riders what you ride`.

---

### Task 1: Add the rider-facing status model and contract tests

**Files:**
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Test: `tests/server/member-profile-ui-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add a test that reads `profile-settings.tsx` and requires the three new titles, the three rider signals, and the absence of `Not published` and `Profile readiness`. Keep `4 of 4 ready` in the failing assertion so the old header cannot accidentally remain.

- [ ] **Step 2: Run the focused test and confirm red**

Run `npx vitest run tests/server/member-profile-ui-contract.test.ts`.
Expected: the new assertion fails against the current header.

- [ ] **Step 3: Implement a typed status model**

In `LoadedProfileSettings`, reuse `readinessItems`, `readyItems`, `publishLabel`, `editor.isPublished`, and `editor.slug` to derive these exact branches:

```tsx
const profileStatus = editor.isPublished
  ? { title: "Your rider card is live", description: "Other riders can now find your bike and recognize you at a meetup." }
  : readyItems.length === readinessItems.length
    ? { title: "Ready for your next meetup", description: "Your rider card is complete. Publish it when you want other riders to see it." }
    : { title: "Show riders what you ride", description: "Your name, home base, bike, and one photo help riders recognize you at the next meetup." };
```

Keep existing publish/view handlers. Do not add a second save or publish path.

- [ ] **Step 4: Render one clear next action and three compact signals**

Replace the current `Not published` badge and readiness bar with a `studioStatus` region containing the status title/description, a contextual existing publish or view link, and a list of exactly three visible signals: `Identity`, `Motorcycle`, and `Photo`. Use checkmarks for ready signals and open circles for incomplete signals. Give the existing profile form a stable id only if the contextual publish button needs it.

- [ ] **Step 5: Run focused tests and lint**

Run the focused UI contract suite and `npm run lint`; both must pass.

- [ ] **Step 6: Commit the status model and copy**

```powershell
git add -- src/features/member-profiles/profile-settings.tsx tests/server/member-profile-ui-contract.test.ts
git diff --cached --check
git commit -m "feat: clarify rider profile next steps"
```

---

### Task 2: Style and verify the rider-first status panel

**Files:**
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Test: `tests/server/member-profile-ui-contract.test.ts`

- [ ] **Step 1: Add failing style assertions**

Extend the existing contract test to require `.studioStatus`, `.studioStatusSignals`, and a mobile rule for the status action. Assert that `.readiness` is absent from the stylesheet.

- [ ] **Step 2: Add focused CSS**

Style the status panel as a compact dark-surface band under the header: copy on the left, one action on the right, and three small signals along the bottom. Use existing studio tokens only. Ready signals use green, incomplete signals use steel, and the primary action uses amber. At `max-width: 640px`, stack copy/action and allow signals to wrap without horizontal overflow.

- [ ] **Step 3: Run focused tests and lint**

Run the focused UI contract suite and `npm run lint`; both must pass.

- [ ] **Step 4: Build and browser-check the three states**

Run `npm run build`. In the existing Codex browser, verify incomplete, complete-private, and published states show the correct title/action without changing Edit/Preview, save, publish, or upload behavior. Confirm `scrollWidth === clientWidth` at desktop and 390px CSS width.

- [ ] **Step 5: Commit the visual status panel**

```powershell
git add -- src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git diff --cached --check
git commit -m "style: focus profile studio on rider actions"
```

## Final Gate

Run the focused UI/upload suites, `npm run lint`, `npm run build`, and `git diff --check`. Existing upload, preview, and public behavior must remain unchanged.
