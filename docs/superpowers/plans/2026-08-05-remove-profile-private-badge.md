# Remove Profile Private Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Private status badge from the profile settings header while retaining Preview profile and every privacy control.

**Architecture:** Keep the profile presentation model and privacy data flow unchanged. Update the synchronous `ProfileStudioHeader` rendering contract first, then remove the badge markup and its now-unused CSS Module selectors.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Vitest 4

## Global Constraints

- Keep **Preview profile** in its current header action group.
- Preserve profile visibility, publication, roster privacy, and attendance-privacy behavior.
- Do not add replacement status copy or hide the badge with CSS.
- Do not modify or include unrelated dirty worktree files.

---

### Task 1: Remove the Profile Header Status Badge

**Files:**
- Modify: `tests/server/member-profile-ui-contract.test.ts:475-493`
- Modify: `src/features/member-profiles/profile-settings.tsx:238-264`
- Modify: `src/features/member-profiles/profile-studio.module.css:135-159`

**Interfaces:**
- Consumes: `getProfileEditorPresentation(profile)` and `presentation.viewAction`
- Produces: `ProfileStudioHeader` markup containing `Your profile` and `Preview profile` without the presentation status label

- [x] **Step 1: Write the failing rendering contract**

Change the existing header expectation from:

```ts
expect(markup).toContain("Private");
```

to:

```ts
expect(markup).not.toContain("Private");
```

Keep the adjacent `expect(markup).toContain("Preview profile")` assertion unchanged so the useful action cannot be removed accidentally.

- [x] **Step 2: Run the focused test and verify the new contract fails**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts -t "keeps the profile header controls without the redundant status notice"
```

Expected: FAIL because the rendered markup still contains `Private`.

- [x] **Step 3: Remove the badge markup and its unused styles**

Delete this element from `ProfileStudioHeader`:

```tsx
<span className={styles.studioState} data-state={presentation.state}>
  {presentation.label}
</span>
```

Leave `ProfileViewAction` unchanged. Delete the `.studioState`, `.studioState[data-state="live"]`, `.studioState[data-state="ready"]`, and `.studioState[data-state="private"]` rules from `profile-studio.module.css`, because no component will reference them afterward.

- [x] **Step 4: Run focused automated verification**

Run:

```powershell
npx vitest run tests/server/member-profile-ui-contract.test.ts
npx eslint src/features/member-profiles/profile-settings.tsx tests/server/member-profile-ui-contract.test.ts
rg -n "studioState" src
```

Expected: the Vitest file passes, ESLint exits successfully, and `rg` finds no `studioState` references.

- [x] **Step 5: Verify the rendered profile page**

Reuse the existing development server if it is running. Open the authenticated `/profile` page with the Codex browser and confirm:

- `Private` is absent from the top header;
- `Preview profile` remains visible and actionable;
- profile visibility and attendance-privacy controls remain present;
- the page has no new horizontal overflow or browser console errors.

If authentication is unavailable, report the login gate and rely only on the automated rendering contract; do not claim authenticated visual verification.

- [x] **Step 6: Review and commit only the scoped implementation files**

Review:

```powershell
git diff --check -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git diff -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
```

Commit only after the diff contains the badge removal, unused-style cleanup, and focused test update:

```powershell
git add -- src/features/member-profiles/profile-settings.tsx src/features/member-profiles/profile-studio.module.css tests/server/member-profile-ui-contract.test.ts
git commit -m "fix: remove profile private badge"
```
