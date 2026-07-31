# Rider Profile Safety and Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing profile workflow accurate and understandable while protecting destructive actions and unsaved changes.

**Architecture:** Preserve the existing `profileSlug`, save, visibility, and roster contracts. Remove the misleading duplicate publish action and describe motorcycle/photos as profile completeness rather than publication gates. Keep the two existing save boundaries, add reusable confirmation and unsaved-navigation UI, and simplify profile copy without changing the shared public preview renderer.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Radix Alert Dialog, CSS Modules, existing server actions.

## Global Constraints

- Work in `D:\Github\personal\tambike` on the current branch; do not create a branch or worktree.
- Preserve unrelated dirty work and stage only files named in a task.
- Follow `node_modules/next/dist/docs/01-app/02-guides/forms.md` and `server-actions.md`.
- Reuse the existing dev server and use only the Codex in-app browser for browser verification.
- Write and run a failing focused test before production changes.
- Do not change server-side publication, visibility, or roster behavior.

---

### Task 1: Align publication wording with existing behavior

**Files:**
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-editor-presentation.ts`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Produces: one profile-details save action and completion copy that does not invent a second publication state.

- [x] **Step 1: Add tests proving the editor does not claim motorcycle data or photos block publication.**
- [x] **Step 2: Run the focused UI tests and verify the expected failure.**
- [x] **Step 3: Remove the duplicate header publish action and misleading requirement chips.**
- [x] **Step 4: Preserve the existing backend publication and visibility behavior.**
- [x] **Step 5: Run the focused tests and verify they pass.**

### Task 2: Clarify viewing, saving, and copy

**Files:**
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-editor-presentation.ts`
- Modify: `src/features/member-profiles/member-media-uploader.tsx`
- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Produces: saved-profile presentation and dirty-state view-action copy.

- [x] **Step 1: Add failing copy/action contract tests for saved preview, removed redundancy, upload immediacy, ordering labels, and mobile single-column cards.**
- [x] **Step 2: Run the focused UI contract and verify the expected failure.**
- [x] **Step 3: Implement the minimal copy and hierarchy changes.**
- [x] **Step 4: Run the focused UI contract and verify it passes.**

### Task 3: Protect destructive and unsaved changes

**Files:**
- Create: `src/features/member-profiles/confirm-media-delete.tsx`
- Create: `src/features/member-profiles/use-unsaved-profile-guard.ts`
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Create: `tests/server/member-profile-safety-contract.test.ts`

**Interfaces:**
- Produces: `ConfirmMediaDelete` and `useUnsavedProfileGuard(dirty: boolean)`.

- [x] **Step 1: Add failing tests for named confirmation actions and unload/navigation guard registration.**
- [x] **Step 2: Run the focused safety contract and verify the expected failure.**
- [x] **Step 3: Add the Radix media confirmation component and dirty-navigation guard.**
- [x] **Step 4: Wire profile and saved motorcycle-photo deletion through confirmation.**
- [x] **Step 5: Run the focused tests and verify they pass.**

### Task 4: Verify the complete change

**Files:**
- Verify the files above only.

- [x] **Step 1: Run focused profile/media test suites.**
- [x] **Step 2: Run targeted ESLint and `git diff --check`.**
- [x] **Step 3: Run `npm run test:server` and `npm run build`; distinguish unrelated dirty-tree failures.**
- [x] **Step 4: Complete in-app browser QA at desktop and 390 px without writing test media to the remote RDS-backed account.**
- [x] **Step 5: Inspect the final diff and keep the implementation scoped to profile files despite unrelated dirty-tree work.**

## Completion Gate

- Existing publication and visibility behavior is unchanged.
- The editor does not present a duplicate or misleading publish action.
- Preview/view remains available with honest saved-state copy.
- Destructive media requires confirmation.
- Unsaved field navigation warns.
- Duplicate and jargon-heavy descriptions are removed.
- Saved-photo ordering and mobile presentation are understandable.
- Focused tests, lint, full server tests, and build have fresh evidence.
