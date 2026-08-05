# Header Account Trigger Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicate desktop account controls with one far-right icon menu and remove shared-header search entry points without changing event-page search.

**Architecture:** Keep account-menu state and logout handling inside `TambikeAppShell`, but move the disclosure behavior onto a compact `icon-button` trigger. Remove only the shell-owned search state, handlers, controls, popover, and CSS; event discovery components and routes remain untouched.

**Tech Stack:** Next.js App Router, React 19 client components, TypeScript, CSS, Vitest with jsdom, Codex in-app browser.

## Global Constraints

- The far-right user icon is the only authenticated desktop account trigger.
- The account menu contains exactly **View profile** and **Log out**.
- Desktop and mobile shared-header search controls are removed; event-page search and filtering remain unchanged.
- Mobile keeps direct **Profile** and **Log out** rows without a nested account menu.
- Preserve `Logging out…`, disabled, `aria-busy`, redirect, and safe failure behavior.
- Do not create a branch or worktree.
- Preserve the unrelated untracked `docs/testing/role-process-flow-browser-smoke.md` file.

---

### Task 1: Correct Account Ownership and Remove Header Search

**Files:**
- Modify: `tests/server/login-screen.test.tsx:53-151,245-373`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:3-36,445-683`
- Modify: `src/app/globals.css:234-384,5344-5495,5561-5567`

**Interfaces:**
- Consumes: `TambikeAppShell`, the existing `handleLogout(): Promise<void>`, and the existing `accountMenuOpen`, `accountMenuRef`, and `accountTriggerRef` state.
- Produces: one `button.icon-button.account-menu__trigger` with accessible name `Account menu`, controlling `#desktop-account-options`; no shell-owned search controls or popover.

- [ ] **Step 1: Read the installed Next.js client-component guide**

Run:

```powershell
Get-Content -Raw node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Confirm that the existing `"use client"` boundary remains appropriate for state, refs, event listeners, and logout interaction. No new boundary or component split is required.

- [ ] **Step 2: Update the shell test harness and add the failing regression assertions**

Change `renderShell()` to resolve the intended trigger:

```tsx
const accountTrigger = container.querySelector<HTMLButtonElement>(
  "button.account-menu__trigger",
);
```

In the first account-menu test, assert the corrected ownership and removed search entry points before opening the menu:

```tsx
expect(view.container.querySelector(".account-chip")).toBeNull();
expect(
  view.container.querySelector('.header-actions > a[href="/profile"]'),
).toBeNull();
expect(
  view.container.querySelector('[aria-label="Search events"]'),
).toBeNull();
expect(
  view.container.querySelector('[aria-label="Open event search"]'),
).toBeNull();
expect(view.container.querySelector(".header-search-popover")).toBeNull();
expect(view.accountTrigger.getAttribute("aria-expanded")).toBe("false");
```

Keep the existing menu-action, dismissal, focus-restoration, pending logout, failure, and mobile Profile/Log out assertions.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/login-screen.test.tsx
```

Expected: FAIL because `button.account-menu__trigger` does not exist, `.account-chip` still renders, and desktop/mobile search controls still exist.

- [ ] **Step 4: Implement the compact icon trigger and remove shell search state**

In `TambikeAppShell`, delete the local `router`, `searchOpen`, and `searchQuery` declarations and delete the complete `openSearch()` and `submitSearch()` functions. These identifiers are used only by the shell-owned controls being removed.

Remove the mobile `Open event search` button, the desktop `Search events` icon button, the separate authenticated `/profile` icon link, and the `header-search-popover` form. Keep `Search`, `FormEvent`, and `useRouter` imports if they remain used by other components in this large module; remove only `ChevronDown`, which becomes unused.

Replace the name-and-role trigger with the compact account icon while preserving the existing panel and logout handler:

```tsx
<div className="account-menu" ref={accountMenuRef}>
  <button
    ref={accountTriggerRef}
    className="icon-button account-menu__trigger"
    type="button"
    aria-label="Account menu"
    aria-controls="desktop-account-options"
    aria-expanded={accountMenuOpen}
    onClick={() => setAccountMenuOpen((open) => !open)}
  >
    <User aria-hidden="true" />
  </button>
  {accountMenuOpen ? (
    <div
      id="desktop-account-options"
      className="account-menu__panel"
      role="group"
      aria-label="Account options"
    >
      <Link
        className="account-menu__item"
        href="/profile"
        onClick={() => setAccountMenuOpen(false)}
      >
        <User aria-hidden="true" />
        <span>View profile</span>
      </Link>
      <button
        className="account-menu__item account-menu__logout"
        type="button"
        aria-label="Log out"
        aria-busy={logoutPending}
        disabled={logoutPending}
        onClick={() => void handleLogout()}
      >
        <LogoutButtonContent pending={logoutPending} />
      </button>
      {logoutError ? (
        <p className="account-menu__error" role="alert">
          {logoutError}
        </p>
      ) : null}
    </div>
  ) : null}
</div>
```

Do not change event-page search controls elsewhere in `tambike-screen.tsx`.

- [ ] **Step 5: Tighten CSS around the icon menu and remove dead header-search styles**

Remove `.account-chip` from shared selector groups and delete its dedicated name, role, and chevron rules. Keep `.account-menu { position: relative; }`, and add an explicit expanded state for the icon trigger:

```css
.account-menu__trigger[aria-expanded="true"] {
  border-color: rgba(255, 190, 69, 0.42);
  background: rgba(255, 190, 69, 0.14);
  color: #fff;
}

.account-menu__panel {
  right: 0;
  width: min(220px, calc(100vw - 32px));
}
```

Delete `.header-search-popover` and its descendant rules, including its mobile media override. Retain the existing mobile rule that hides `.header-actions .account-menu` at `max-width: 760px`.

- [ ] **Step 6: Run focused GREEN and static checks**

Run:

```powershell
npx vitest run tests/server/login-screen.test.tsx
npx tsc --noEmit
npm run lint
git diff --check
```

Expected: the focused file passes all tests; TypeScript, ESLint, and whitespace checks exit 0.

- [ ] **Step 7: Review the scoped diff**

Run:

```powershell
git diff -- src/features/tambike-demo/tambike-screen.tsx src/app/globals.css tests/server/login-screen.test.tsx
git status --short
```

Confirm the unrelated untracked browser-smoke document remains untouched and only the three implementation/test files changed.

### Task 2: Verify the Exact Committed Experience

**Files:**
- Verify: `src/features/tambike-demo/tambike-screen.tsx`
- Verify: `src/app/globals.css`
- Verify: `tests/server/login-screen.test.tsx`

**Interfaces:**
- Consumes: the corrected `Account menu` button and existing mobile hamburger navigation.
- Produces: automated and browser evidence that the rendered header matches the approved design.

- [ ] **Step 1: Run the full serial server suite**

Run:

```powershell
npx vitest run tests/server --maxWorkers=1
```

Expected: all 105 server test files and all tests pass. Single-worker execution avoids the repository's known unrelated `event-review-ui.test.tsx` parallel timing failure.

- [ ] **Step 2: Browser-check authenticated desktop at 1440x900**

Reuse the existing `http://localhost:3000` development server. In the Codex in-app browser, verify:

- exactly one `Account menu` button is visible;
- no large name-and-role `.account-chip` is rendered;
- no `Search events` header button is rendered;
- clicking the user icon opens a compact, right-aligned **Account options** panel;
- the panel contains exactly **View profile** and **Log out**;
- Escape closes the panel and restores focus to the icon trigger;
- **View profile** navigates to `/profile`.

- [ ] **Step 3: Browser-check mobile at 390x844**

Verify:

- the hamburger navigation contains direct **Profile** and **Mobile log out** actions;
- no **Search events** row appears;
- the desktop account trigger is hidden;
- logout displays **Logging out…**, remains disabled while pending, and completes on `/`;
- `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
- browser error logs are empty.

Reset the temporary viewport override and finalize browser tabs after the checks.

- [ ] **Step 4: Commit the verified correction**

Run:

```powershell
git add -- src/features/tambike-demo/tambike-screen.tsx src/app/globals.css tests/server/login-screen.test.tsx
git diff --cached --check
git commit -m "fix: correct header account controls"
git status --short
```

Expected: the three scoped files are committed; only the pre-existing untracked `docs/testing/role-process-flow-browser-smoke.md` remains.
