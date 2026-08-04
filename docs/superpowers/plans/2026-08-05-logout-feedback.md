# Logout Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tambike's icon-only, silent logout action with labeled desktop/mobile controls that show pending feedback, recover safely from errors, and redirect to `/` after success.

**Architecture:** Keep the existing provider `logout(): Promise<void>` contract and own the transient interaction state in `TambikeAppShell`, where both responsive controls already live. One guarded async handler drives both controls; an optional navigation callback makes the full-page redirect observable in the existing jsdom component-test suite while production falls back to `window.location.replace("/")` inside the click handler.

**Tech Stack:** Next.js 16.2.11 App Router, React 19 client components, TypeScript, Vitest 4 with jsdom, existing global CSS, Codex in-app browser.

## Global Constraints

- The idle user-facing label is exactly **Log out**.
- The pending user-facing label is exactly **Logging out…**.
- The safe failure copy is exactly **Could not log out. Try again.**.
- Successful logout performs a full-page replacement to `/` and never restores the idle state before unload.
- The mobile navigation remains open during the pending request.
- Keep server-side session invalidation and the provider `logout(): Promise<void>` contract unchanged.
- Do not add dependencies, a confirmation dialog, an account menu, a branch, a worktree, or a new test file.
- Browser verification uses only the Codex in-app browser.

---

### Task 1: Shared logout feedback in the application header

**Files:**
- Modify: `tests/server/login-screen.test.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:422-557`
- Modify: `src/app/globals.css:235-320, 3367-3415, 5089-5125, 5456-5500`

**Interfaces:**
- Consumes: existing `useDemo().logout: () => Promise<void>` and `useDemo().currentUser`.
- Produces: `TambikeAppShell({ children, navigate? })`, where `navigate?: (href: string) => void`; both logout buttons consume shared `logoutPending`, `logoutError`, and `handleLogout()` state.

- [ ] **Step 1: Extend the existing component test harness with shell dependencies**

Add a hoisted logout double and mutable demo session to the existing provider mock, mock only the unrelated notification bell, and return a minimal real router boundary:

```tsx
const logout = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const demoSession = vi.hoisted(() => ({
  currentUser: null as UserProfile | null,
  role: "guest" as Role,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("../../src/features/giveaways/giveaway-notification-bell", () => ({
  GiveawayNotificationBell: () => null,
}));

vi.mock("../../src/features/tambike-demo/demo-provider", () => ({
  useDemo: () => ({ loginWithPassword, logout, ...demoSession }),
}));
```

Import `Role`, `TambikeAppShell`, and keep the existing `LoginScreen` coverage unchanged. Add a `renderShell()` helper that assigns the organizer fixture, renders `TambikeAppShell` with a `navigate` spy and a simple child, and returns the two logout buttons, menu button, header, container, root, and spy. Reset `demoSession` to guest/null in `beforeEach`.

- [ ] **Step 2: Write failing tests for pending, success, and failure behavior**

Add tests to the existing file; the production changes that make these tests fail are a missing shared busy state, an incorrect destination, an early idle reset, closing the mobile menu, or leaking exception details:

```tsx
describe("TambikeAppShell logout", () => {
  test("shows labeled shared progress and keeps the mobile menu open through success", async () => {
    let finishLogout!: () => void;
    logout.mockImplementation(
      () => new Promise<void>((resolve) => { finishLogout = resolve; }),
    );
    const view = await renderShell();

    try {
      expect(view.desktopLogout.textContent).toContain("Log out");
      await act(async () => view.menuButton.click());
      await act(async () => {
        view.mobileLogout.click();
        await Promise.resolve();
      });

      expect(view.header.classList.contains("is-nav-open")).toBe(true);
      expect(view.desktopLogout.disabled).toBe(true);
      expect(view.mobileLogout.disabled).toBe(true);
      expect(view.desktopLogout.textContent).toContain("Logging out…");
      expect(view.mobileLogout.textContent).toContain("Logging out…");
      expect(view.container.querySelectorAll(".logout-button__spinner")).toHaveLength(2);

      await act(async () => finishLogout());

      expect(view.navigate).toHaveBeenCalledWith("/");
      expect(view.desktopLogout.disabled).toBe(true);
      expect(view.mobileLogout.disabled).toBe(true);
    } finally {
      await disposeShell(view);
    }
  });

  test("restores logout and shows safe feedback when the request fails", async () => {
    logout.mockRejectedValue(new Error("session store unavailable"));
    const view = await renderShell();

    try {
      await act(async () => view.desktopLogout.click());

      expect(view.desktopLogout.disabled).toBe(false);
      expect(view.mobileLogout.disabled).toBe(false);
      expect(view.desktopLogout.textContent).toContain("Log out");
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not log out. Try again.",
      );
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      await disposeShell(view);
    }
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/login-screen.test.tsx
```

Expected: FAIL because `TambikeAppShell` does not accept `navigate`, desktop logout has no text, neither button enters a busy state, mobile closes the menu, and no safe failure alert exists. Fix only test setup errors until the failures are caused by these missing behaviors.

- [ ] **Step 4: Implement the minimal shared logout state and handler**

Extend the shell props without evaluating `window` during render, then add the shared state and guarded event handler:

```tsx
interface TambikeAppShellProps {
  children: React.ReactNode;
  navigate?: (href: string) => void;
}

export function TambikeAppShell({ children, navigate }: TambikeAppShellProps) {
  const { role, currentUser, logout } = useDemo();
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const handleLogout = async () => {
    if (logoutPending) return;
    setLogoutError("");
    setLogoutPending(true);

    try {
      await logout();
      if (navigate) navigate("/");
      else window.location.replace("/");
    } catch {
      setLogoutPending(false);
      setLogoutError("Could not log out. Try again.");
    }
  };
```

Both controls call `void handleLogout()`, use `disabled={logoutPending}` and `aria-busy={logoutPending}`, and render identical stateful content:

```tsx
{logoutPending ? (
  <>
    <LoaderCircle className="logout-button__spinner" aria-hidden="true" />
    <span>Logging out…</span>
  </>
) : (
  <>
    <LogOut aria-hidden="true" />
    <span>Log out</span>
  </>
)}
```

Give the desktop button `className="logout-button"` and mobile button `className="mobile-logout-button"`. Remove `setNavOpen(false)` from the mobile logout click. Render one conditional `<p className="logout-error" role="alert">` inside the header so assistive technology receives only one error announcement.

- [ ] **Step 5: Add focused responsive styling**

Add a compact pill treatment for `.logout-button`, including visible hover/focus, disabled/wait, and 16px icon states. Reuse the existing `login-submit-spin` keyframes for `.logout-button__spinner` and include it in the existing reduced-motion rule. Add a small anchored `.logout-error` surface below the header and a mobile `right: 16px` adjustment.

At `max-width: 760px`, hide `.header-actions .logout-button` alongside the desktop icon buttons. Add `.mobile-nav-session button:disabled` so the menu row visibly remains busy without hover movement. Do not hide the text label at desktop/tablet widths.

- [ ] **Step 6: Run focused and full automated verification**

Run:

```powershell
npx vitest run tests/server/login-screen.test.tsx
npm run test:server
npx tsc --noEmit
npm run lint
```

Expected: the focused auth-feedback tests pass, all server tests pass, TypeScript exits 0, and ESLint exits 0 without new warnings.

- [ ] **Step 7: Verify the real flow in the Codex browser**

Reuse the existing development server on port 3000. Through the Codex in-app browser only:

1. Log in as the approved organizer fixture.
2. At a desktop viewport, confirm the header visibly says **Log out**.
3. Click it and immediately confirm **Logging out…**, a spinner, and a disabled button before the request completes.
4. Confirm the final URL is `/` and the signed-out header exposes **Log in** and **Sign up**.
5. Log in again, switch to a mobile viewport, open the navigation, and repeat logout.
6. Confirm the menu stays open while pending, then the homepage is signed out with no horizontal overflow (`scrollWidth === clientWidth`).

- [ ] **Step 8: Review and commit the implementation**

Run `git diff --check`, inspect the scoped diff, and commit only the implementation and test changes:

```powershell
git add -- tests/server/login-screen.test.tsx src/features/tambike-demo/tambike-screen.tsx src/app/globals.css
git commit -m "fix: improve logout feedback"
```
