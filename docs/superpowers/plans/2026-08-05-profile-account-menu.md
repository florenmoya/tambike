# Profile Account Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the desktop profile and logout controls into one Facebook-style profile-chip disclosure containing **View profile** and **Log out**, while preserving the direct mobile rows.

**Architecture:** `TambikeAppShell` will own the disclosure's open state and DOM refs alongside its existing logout state. The panel will preserve native link/button semantics, use document-level pointer/Escape dismissal only while open, and reuse the current `handleLogout()` flow rather than changing provider or server contracts.

**Tech Stack:** Next.js 16.2.11 App Router, React 19 client component state/effects/refs, TypeScript, Lucide icons, Vitest 4 with jsdom, existing global CSS, Codex in-app browser.

## Global Constraints

- The desktop profile chip is the only desktop account control.
- The disclosure panel contains exactly **View profile** and **Log out**.
- The panel uses native link/button semantics inside `role="group"` with the accessible label **Account options**.
- Trigger click, outside pointer interaction, Escape, and **View profile** selection close the panel; Escape returns focus to the trigger.
- Desktop logout keeps the panel open and shows **Logging out…** with the existing spinner and disabled state.
- Logout failure remains retryable and shows exactly **Could not log out. Try again.**.
- Mobile keeps its existing direct **Profile**, role workspace, and **Log out** rows.
- Keep the provider `logout(): Promise<void>`, server action, `/profile` route, and successful `/` replacement unchanged.
- Do not add dependencies, routes, settings, account switching, a nested mobile menu, a branch, a worktree, or a new test file.
- Browser verification uses only the Codex in-app browser.

---

### Task 1: Desktop account disclosure with shared logout feedback

**Files:**
- Modify: `tests/server/login-screen.test.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:1-25, 445-615`
- Modify: `src/app/globals.css:347-385, 5345-5415, 5540-5560`

**Interfaces:**
- Consumes: `currentUser`, `role`, existing `handleLogout()`, `logoutPending`, and `logoutError` in `TambikeAppShell`.
- Produces: a button `.account-chip` with `aria-controls="desktop-account-options"` and `aria-expanded`; a conditional `#desktop-account-options.account-menu__panel[role="group"]`; native `/profile` link and `.account-menu__logout` button.

- [ ] **Step 1: Update the existing shell-test harness for the wished-for interface**

Replace `desktopLogout` in `ShellView` with `accountTrigger`, query the trigger by `.account-chip`, and keep `mobileLogout` unchanged:

```tsx
type ShellView = {
  accountTrigger: HTMLButtonElement;
  container: HTMLDivElement;
  header: HTMLElement;
  menuButton: HTMLButtonElement;
  mobileLogout: HTMLButtonElement;
  navigate: ReturnType<typeof vi.fn>;
  root: Root;
};
```

Add an `openAccountMenu()` helper that clicks the real trigger and returns the rendered panel, profile link, and logout button. It must throw when any required control is absent so setup errors cannot pass silently.

- [ ] **Step 2: Write failing disclosure and dismissal tests**

Add tests proving the user-observable structure and closing paths:

```tsx
test("opens account options from the profile chip without a standalone logout button", async () => {
  const view = await renderShell();
  try {
    expect(view.accountTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelector(".header-actions > .logout-button")).toBeNull();

    const menu = await openAccountMenu(view);

    expect(view.accountTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.panel.getAttribute("role")).toBe("group");
    expect(menu.panel.getAttribute("aria-label")).toBe("Account options");
    expect(menu.profileLink.textContent).toContain("View profile");
    expect(menu.logoutButton.textContent).toContain("Log out");
  } finally {
    await disposeShell(view);
  }
});

test("dismisses account options with outside interaction and Escape", async () => {
  const view = await renderShell();
  try {
    await openAccountMenu(view);
    await act(async () => view.accountTrigger.click());
    expect(view.container.querySelector(".account-menu__panel")).toBeNull();

    await openAccountMenu(view);
    await act(async () =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(view.container.querySelector(".account-menu__panel")).toBeNull();

    await openAccountMenu(view);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(view.container.querySelector(".account-menu__panel")).toBeNull();
    expect(document.activeElement).toBe(view.accountTrigger);
  } finally {
    await disposeShell(view);
  }
});
```

Add a separate **View profile** selection test. Attach a one-use native `preventDefault` listener before clicking so jsdom does not navigate, then assert the panel closes.

- [ ] **Step 3: Rewrite the existing logout tests for the panel action**

Open the account panel before selecting logout. On pending success, assert the panel remains present, the panel button and mobile row are disabled, both display **Logging out…**, two spinners exist, and `navigate("/")` is called without restoring the idle state. On rejection, assert the panel remains open, its logout button becomes enabled with **Log out**, one panel-scoped alert contains the safe copy, the mobile row is enabled, and navigation is not called.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/server/login-screen.test.tsx
```

Expected: FAIL because `.account-chip` is still a link, no disclosure panel exists, the standalone desktop logout button still renders, and dismissal behavior is absent. Fix only harness errors until failures describe these missing product behaviors.

- [ ] **Step 5: Implement disclosure state, refs, and dismissal**

Read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` before editing. Import `ChevronDown`, then add:

```tsx
const [accountMenuOpen, setAccountMenuOpen] = useState(false);
const accountMenuRef = useRef<HTMLDivElement>(null);
const accountTriggerRef = useRef<HTMLButtonElement>(null);

useEffect(() => {
  if (!accountMenuOpen) return;

  const handlePointerDown = (event: globalThis.PointerEvent) => {
    if (
      event.target instanceof Node &&
      !accountMenuRef.current?.contains(event.target)
    ) {
      setAccountMenuOpen(false);
    }
  };
  const handleKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    setAccountMenuOpen(false);
    accountTriggerRef.current?.focus();
  };

  document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("keydown", handleKeyDown);
  return () => {
    document.removeEventListener("pointerdown", handlePointerDown);
    document.removeEventListener("keydown", handleKeyDown);
  };
}, [accountMenuOpen]);
```

The effect is client-only, installs listeners only while open, and cleans them up after every close/unmount.

- [ ] **Step 6: Replace the desktop controls with the disclosure markup**

Wrap the trigger and conditional panel in `<div className="account-menu" ref={accountMenuRef}>`. Convert `.account-chip` from `Link` to `button`, add the fixed ARIA contract, and preserve the name and role:

```tsx
<button
  ref={accountTriggerRef}
  className="account-chip"
  type="button"
  aria-label="Account menu"
  aria-controls="desktop-account-options"
  aria-expanded={accountMenuOpen}
  onClick={() => setAccountMenuOpen((open) => !open)}
>
  <User aria-hidden="true" />
  <span>{currentUser.displayName}</span>
  <strong>{roleLabels[role]}</strong>
  <ChevronDown className="account-menu__chevron" aria-hidden="true" />
</button>
```

Render the conditional panel with `role="group" aria-label="Account options"`. Its `/profile` link closes the panel. Its logout button calls `void handleLogout()`, uses `aria-busy`/`disabled`, and renders `LogoutButtonContent`. Render `logoutError` as `.account-menu__error[role="alert"]` inside the open panel; render the existing header `.logout-error` only when `logoutError && !accountMenuOpen` so mobile retains one alert without desktop duplication.

- [ ] **Step 7: Replace standalone logout CSS with anchored panel styling**

Keep `.logout-button__spinner` because both responsive logout actions still use it. Remove the obsolete desktop `.logout-button` pill rules and mobile hide rule.

Add `.account-menu { position: relative; }`, button normalization for `.account-chip`, open chevron rotation, and an absolute right-aligned `.account-menu__panel` below the trigger. Give the panel a constrained width, dark opaque background, border, shadow, and `z-index` above the header. Style `.account-menu__item` and `.account-menu__logout` as full-width, left-aligned native controls with clear hover/focus and disabled states. Style `.account-menu__error` as compact safe feedback inside the panel.

At `max-width: 760px`, the existing `.account-chip { display: none; }` keeps the entire `.account-menu` visually absent only if the wrapper is also hidden. Add `.header-actions .account-menu { display: none; }` at that breakpoint so no empty wrapper affects layout. Preserve `.mobile-nav-session` rows unchanged.

- [ ] **Step 8: Run focused and complete automated checks**

Run:

```powershell
npx vitest run tests/server/login-screen.test.tsx
npx vitest run tests/server --maxWorkers=1
npx tsc --noEmit
npm run lint
```

Expected: all auth component tests pass, all 1,086+ server tests pass without the known parallel-worker timeout, TypeScript exits 0, and ESLint exits 0.

- [ ] **Step 9: Verify authenticated desktop and mobile flows in the Codex browser**

Reuse the existing port-3000 dev server. At 1440×900:

1. Sign in with the approved organizer fixture and open `/`.
2. Confirm one visible **Account menu** trigger and no standalone **Log out** button.
3. Open the panel and confirm **View profile** and **Log out**.
4. Verify trigger toggle, outside interaction, and Escape close the panel; Escape returns focus.
5. Follow **View profile** and confirm `/profile`, then return to `/`.
6. Open the panel, select **Log out**, immediately confirm disabled **Logging out…**, then confirm `/` with **Log in** and **Sign up**.

At 390×844, sign in again, open the hamburger navigation, and confirm direct **Profile** and **Log out** rows remain. Repeat mobile logout and confirm pending feedback, signed-out homepage, `scrollWidth === clientWidth`, and no browser console errors.

- [ ] **Step 10: Review and commit**

Run `git diff --check`, inspect the scoped diff, and commit only the component, CSS, and existing test changes:

```powershell
git add -- tests/server/login-screen.test.tsx src/features/tambike-demo/tambike-screen.tsx src/app/globals.css
git commit -m "feat: add profile account menu"
```
