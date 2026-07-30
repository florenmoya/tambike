# Rider Profile Safety and Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make profile drafts remain private until an explicit validated publish action, while simplifying editor copy and protecting destructive/unsaved changes.

**Architecture:** Preserve `profileSlug` as the existing publication marker, but stop allocating it during ordinary profile saves. Add an authenticated backend publish method that validates saved identity, motorcycle, and photo data before allocating the slug. Keep the two existing draft save boundaries, add reusable confirmation/unsaved-navigation UI, and simplify profile copy without changing the shared public preview renderer.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma, Vitest, Radix Alert Dialog, CSS Modules, existing server actions.

## Global Constraints

- Work in `D:\Github\personal\tambike` on the current branch; do not create a branch or worktree.
- Preserve unrelated dirty work and stage only files named in a task.
- Follow `node_modules/next/dist/docs/01-app/02-guides/forms.md` and `server-actions.md`.
- Reuse the existing dev server and use only the Codex in-app browser for browser verification.
- Write and run a failing focused test before production changes.
- Existing profiles with non-null `profileSlug` must remain published.

---

### Task 1: Enforce explicit publication

**Files:**
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/actions.ts`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `tests/server/member-profile-domain.test.ts`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Produces: `publishMemberProfile(sessionToken: string): Promise<MemberProfileEditorView>` on both backend implementations.
- Produces: `publishMemberProfileAction(): Promise<MemberProfileEditorView>` and matching provider method.

- [ ] **Step 1: Add tests proving ordinary saves keep `profileSlug` null and incomplete publication is rejected.**
- [ ] **Step 2: Run the focused domain tests and verify the expected failure.**
- [ ] **Step 3: Stop slug allocation in `updateMemberProfile`; add authenticated server-side completeness validation and slug allocation to `publishMemberProfile`.**
- [ ] **Step 4: Wire the server action/provider and change the header publish button to call it.**
- [ ] **Step 5: Run the focused tests and verify they pass.**

### Task 2: Clarify viewing, saving, and copy

**Files:**
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/profile-editor-presentation.ts`
- Modify: `src/features/member-profiles/member-media-uploader.tsx`
- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Produces: saved-data publication presentation and dirty-state view-action copy.

- [ ] **Step 1: Add failing copy/action contract tests for saved preview, removed redundancy, upload immediacy, ordering labels, and mobile single-column cards.**
- [ ] **Step 2: Run the focused UI contract and verify the expected failure.**
- [ ] **Step 3: Implement the minimal copy and hierarchy changes.**
- [ ] **Step 4: Run the focused UI contract and verify it passes.**

### Task 3: Protect destructive and unsaved changes

**Files:**
- Create: `src/components/ui/alert-dialog.tsx`
- Create: `src/features/member-profiles/confirm-media-delete.tsx`
- Create: `src/features/member-profiles/use-unsaved-profile-guard.ts`
- Modify: `src/features/member-profiles/profile-settings.tsx`
- Modify: `src/features/member-profiles/motorcycle-photo-workspace.tsx`
- Modify: `src/features/member-profiles/profile-studio.module.css`
- Modify: `tests/server/member-profile-ui-contract.test.ts`

**Interfaces:**
- Produces: `ConfirmMediaDelete` and `useUnsavedProfileGuard(dirty: boolean)`.

- [ ] **Step 1: Add failing tests for named confirmation actions and unload/navigation guard registration.**
- [ ] **Step 2: Run the focused UI test and verify the expected failure.**
- [ ] **Step 3: Add the Radix alert-dialog wrapper, media confirmation component, and dirty-navigation guard.**
- [ ] **Step 4: Wire avatar and saved motorcycle-photo deletion through confirmation.**
- [ ] **Step 5: Run the focused tests and verify they pass.**

### Task 4: Verify the complete change

**Files:**
- Verify the files above only.

- [ ] **Step 1: Run focused profile/media test suites.**
- [ ] **Step 2: Run targeted ESLint and `git diff --check`.**
- [ ] **Step 3: Run `npm run test:server` and `npm run build`; distinguish unrelated dirty-tree failures.**
- [ ] **Step 4: Attempt in-app browser QA at desktop and 390 px; report the browser-policy blocker if it remains.**
- [ ] **Step 5: Inspect the final diff and confirm no unrelated files are included.**

## Completion Gate

- Draft saves never publish.
- Publishing is explicit and server-validated.
- Preview/view remains available with honest saved-state copy.
- Destructive media requires confirmation.
- Unsaved field navigation warns.
- Duplicate and jargon-heavy descriptions are removed.
- Saved-photo ordering and mobile presentation are understandable.
- Focused tests, lint, full server tests, and build have fresh evidence.
