# Login Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give failed password logins a safe, specific message and keep unmistakable loading feedback visible until a successful redirect finishes.

**Architecture:** Convert only expected backend authentication errors into a typed Server Action result, then propagate that discriminated result through the demo provider. Keep the login screen responsible for user-facing copy and navigation, with an injected navigation function so the success transition can be tested without leaving JSDOM.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript, Vitest 4.1.9, JSDOM, Lucide React, global CSS.

## Global Constraints

- Invalid email and invalid password must both render exactly **“Email or password is incorrect.”**
- A correctly authenticated suspended account must render exactly **“This account is suspended. Contact Tambike support.”**
- Unexpected failures must retain exactly **“Something went wrong. Try again.”**
- Expected authentication failures must be serializable results; unexpected failures must still throw.
- Successful login must retain its busy state until document navigation unloads the login page.
- The public UI must not reveal whether an email exists or display backend codes, stack details, or provider details.
- Do not change password rules, session lifetime, destination selection, account recovery, signup, credential verification, or suspension policy.
- Read relevant installed Next.js guidance before code changes; use only the Codex browser surface for browser verification.
- Do not create a branch or worktree, and do not modify or include the unrelated dirty member-profile files in login commits.

---

### Task 1: Typed password-login boundary

**Files:**
- Create: `tests/server/login-actions.test.ts`
- Modify: `src/features/tambike-demo/types.ts`
- Modify: `src/server/actions.ts:45-50`
- Modify: `src/features/tambike-demo/demo-provider.tsx:59-66,165-173`

**Interfaces:**
- Produces: `LoginFailureCode = "INVALID_CREDENTIALS" | "ACCOUNT_SUSPENDED"`.
- Produces: `LoginResult = { ok: true; user: UserProfile } | { ok: false; code: LoginFailureCode }`.
- Produces: `loginWithPasswordAction(email, password): Promise<{ ok: true; state: DemoState } | { ok: false; code: LoginFailureCode }>`.
- Produces: `DemoContextValue.loginWithPassword(email, password): Promise<LoginResult>` for Task 2.

- [ ] **Step 1: Write the failing Server Action tests**

Create `tests/server/login-actions.test.ts` with hoisted mocks for `loginWithPassword`, `getSnapshot`, `setSessionToken`, and `readSessionToken`. Cover success, both expected failures, and an unexpected error:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const loginWithPassword = vi.hoisted(() => vi.fn());
const getSnapshot = vi.hoisted(() => vi.fn());
const setSessionToken = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/backend")>();
  return {
    ...actual,
    getTambikeBackend: vi.fn(async () => ({ loginWithPassword, getSnapshot })),
  };
});

vi.mock("../../src/server/session-cookie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/session-cookie")>();
  return {
    ...actual,
    readSessionToken: vi.fn(async () => undefined),
    setSessionToken,
  };
});

import { loginWithPasswordAction } from "../../src/server/actions";
import { BackendError } from "../../src/server/backend";

beforeEach(() => {
  vi.clearAllMocks();
  getSnapshot.mockResolvedValue({ currentUser: { id: "organizer-1", role: "organizer" } });
});

describe("loginWithPasswordAction", () => {
  test("returns authenticated state after setting the new session", async () => {
    loginWithPassword.mockResolvedValue({ sessionToken: "session-1" });

    await expect(loginWithPasswordAction("organizer@bayanko.ph", "password123"))
      .resolves.toMatchObject({ ok: true, state: { currentUser: { role: "organizer" } } });
    expect(setSessionToken).toHaveBeenCalledWith("session-1");
    expect(getSnapshot).toHaveBeenCalledWith("session-1");
  });

  test.each([
    ["UNAUTHENTICATED", "INVALID_CREDENTIALS"],
    ["FORBIDDEN", "ACCOUNT_SUSPENDED"],
  ] as const)("maps %s to %s without creating a session", async (backendCode, code) => {
    loginWithPassword.mockRejectedValue(new BackendError(backendCode));

    await expect(loginWithPasswordAction("rider@example.com", "password123"))
      .resolves.toEqual({ ok: false, code });
    expect(setSessionToken).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  test("rethrows unexpected failures", async () => {
    const unexpected = new Error("database unavailable");
    loginWithPassword.mockRejectedValue(unexpected);

    await expect(loginWithPasswordAction("rider@example.com", "password123"))
      .rejects.toBe(unexpected);
  });
});
```

- [ ] **Step 2: Run the action test and verify RED**

Run: `npx vitest run tests/server/login-actions.test.ts`

Expected: FAIL because the current action returns `DemoState` on success and rejects for `BackendError` failures.

- [ ] **Step 3: Add shared login result types**

Add beside the existing authentication-related types in `src/features/tambike-demo/types.ts`:

```ts
export type LoginFailureCode = "INVALID_CREDENTIALS" | "ACCOUNT_SUSPENDED";

export type LoginResult =
  | { ok: true; user: UserProfile }
  | { ok: false; code: LoginFailureCode };
```

- [ ] **Step 4: Implement the minimal typed Server Action**

In `src/server/actions.ts`, import `LoginFailureCode` and wrap only `backend.loginWithPassword`; do not catch cookie or snapshot failures:

```ts
export async function loginWithPasswordAction(email: string, password: string) {
  const backend = await getTambikeBackend();
  let result: Awaited<ReturnType<typeof backend.loginWithPassword>>;

  try {
    result = await backend.loginWithPassword(email, password);
  } catch (error) {
    if (error instanceof BackendError) {
      const code: LoginFailureCode | undefined =
        error.code === "UNAUTHENTICATED"
          ? "INVALID_CREDENTIALS"
          : error.code === "FORBIDDEN"
            ? "ACCOUNT_SUSPENDED"
            : undefined;
      if (code) return { ok: false as const, code };
    }
    throw error;
  }

  await setSessionToken(result.sessionToken);
  return { ok: true as const, state: await snapshot(result.sessionToken) };
}
```

- [ ] **Step 5: Propagate the discriminated result through the provider**

Import `LoginResult`, change the context signature to `Promise<LoginResult>`, and replace the callback body in `src/features/tambike-demo/demo-provider.tsx`:

```ts
const loginWithPassword = useCallback(
  async (email: string, password: string): Promise<LoginResult> => {
    const result = await loginWithPasswordAction(email, password);
    if (!result.ok) return result;

    applyState(result.state);
    setAuthNotice("");
    if (!result.state.currentUser) throw new Error("LOGIN_FAILED");
    return { ok: true, user: result.state.currentUser };
  },
  [applyState],
);
```

- [ ] **Step 6: Run focused and type verification**

Run: `npx vitest run tests/server/login-actions.test.ts tests/server/backend-domain.test.ts tests/server/account-access-domain.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS, with all call sites narrowed through `result.ok`.

- [ ] **Step 7: Commit the boundary change only**

```powershell
git add -- tests/server/login-actions.test.ts src/features/tambike-demo/types.ts src/server/actions.ts src/features/tambike-demo/demo-provider.tsx
git commit -m "fix: return safe login failures"
```

Confirm `git diff --cached --name-only` does not include any member-profile file before committing.

---

### Task 2: Persistent login loading and safe inline copy

**Files:**
- Create: `tests/server/login-screen.test.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:1-30,143-149,1648-1752`
- Modify: `src/app/globals.css:5089-5127`
- Modify: `tests/server/login-page.test.ts`

**Interfaces:**
- Consumes: `LoginFailureCode` and `LoginResult` from Task 1.
- Consumes: `useDemo().loginWithPassword(email, password): Promise<LoginResult>` from Task 1.
- Produces: exported `LoginScreen({ nextHref?, navigate? })`, where `navigate` defaults to `window.location.replace` and exists as an explicit browser-navigation dependency.
- Produces: `loginErrorMessage(code: LoginFailureCode): string` with exact approved public copy.

- [ ] **Step 1: Write failing interactive login-screen tests**

Create `tests/server/login-screen.test.tsx` under the JSDOM environment. Mock `useDemo`, render the exported `LoginScreen`, set the uncontrolled email/password values, and submit with `form.requestSubmit()`:

```tsx
/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

const loginWithPassword = vi.hoisted(() => vi.fn());

vi.mock("../../src/features/tambike-demo/demo-provider", () => ({
  useDemo: () => ({ loginWithPassword }),
}));

import {
  LoginScreen,
  loginErrorMessage,
} from "../../src/features/tambike-demo/tambike-screen";
import type { UserProfile } from "../../src/features/tambike-demo/types";

const organizer: UserProfile = {
  id: "organizer-1",
  displayName: "Tambike Organizer",
  email: "organizer@bayanko.ph",
  role: "organizer",
  verificationStatus: "APPROVED",
  accountStatus: "ACTIVE",
  area: "Metro Manila",
  joinedAt: "2026-01-01T00:00:00.000Z",
  organizerProfileId: "organizer-profile-1",
};

async function renderLogin() {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const navigate = vi.fn();
  await act(async () => root.render(createElement(LoginScreen, { navigate })));

  const form = container.querySelector<HTMLFormElement>("form.login-card")!;
  container.querySelector<HTMLInputElement>('input[name="email"]')!.value = "organizer@bayanko.ph";
  container.querySelector<HTMLInputElement>('input[name="password"]')!.value = "password123";
  return { container, form, navigate, root };
}

beforeEach(() => vi.clearAllMocks());

describe("LoginScreen", () => {
  test.each([
    ["INVALID_CREDENTIALS", "Email or password is incorrect."],
    ["ACCOUNT_SUSPENDED", "This account is suspended. Contact Tambike support."],
  ] as const)("shows safe copy for %s and restores the form", async (code, message) => {
    loginWithPassword.mockResolvedValue({ ok: false, code });
    const view = await renderLogin();
    try {
      await act(async () => view.form.requestSubmit());
      expect(view.container.querySelector(".inline-error")?.textContent).toBe(message);
      expect(view.container.querySelector<HTMLButtonElement>(".login-submit")?.disabled).toBe(false);
      expect(view.container.querySelector<HTMLInputElement>('input[name="email"]')?.value)
        .toBe("organizer@bayanko.ph");
      expect(view.container.querySelector<HTMLInputElement>('input[name="password"]')?.value)
        .toBe("password123");
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      await act(async () => view.root.unmount());
      view.container.remove();
    }
  });

  test("keeps the form busy after successful authentication starts navigation", async () => {
    loginWithPassword.mockResolvedValue({ ok: true, user: organizer });
    const view = await renderLogin();
    try {
      await act(async () => view.form.requestSubmit());
      expect(view.navigate).toHaveBeenCalledWith("/organizer/dashboard");
      expect(view.form.getAttribute("aria-busy")).toBe("true");
      expect(view.container.querySelector<HTMLButtonElement>(".login-submit")?.disabled).toBe(true);
      expect(view.container.querySelector(".login-submit")?.textContent).toContain("Signing you in…");
      expect(view.container.querySelector(".login-submit__spinner")).not.toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.container.remove();
    }
  });

  test("keeps unexpected failures generic and restores the form", async () => {
    loginWithPassword.mockRejectedValue(new Error("database unavailable"));
    const view = await renderLogin();
    try {
      await act(async () => view.form.requestSubmit());
      expect(view.container.querySelector(".inline-error")?.textContent)
        .toBe("Something went wrong. Try again.");
      expect(view.container.querySelector<HTMLButtonElement>(".login-submit")?.disabled)
        .toBe(false);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      await act(async () => view.root.unmount());
      view.container.remove();
    }
  });
});

test("maps expected login failures without exposing internal codes", () => {
  expect(loginErrorMessage("INVALID_CREDENTIALS")).toBe("Email or password is incorrect.");
  expect(loginErrorMessage("ACCOUNT_SUSPENDED")).toBe(
    "This account is suspended. Contact Tambike support.",
  );
});
```

- [ ] **Step 2: Strengthen the existing source contract before implementation**

Add this test to `tests/server/login-page.test.ts` so the component contract explicitly retains pending state on success:

```ts
test("keeps visible progress active while successful navigation starts", () => {
  expect(loginScreenSource).toContain('aria-busy={pending}');
  expect(loginScreenSource).toContain('className="login-submit__spinner"');
  expect(loginScreenSource).toContain('pending ? "Signing you in…" : "Log in"');

  const successfulNavigation = loginScreenSource.slice(
    loginScreenSource.indexOf("navigate(nextHref ?? destinationFor(result.user.role));"),
  );
  expect(successfulNavigation).not.toContain("finally {");
});
```

Update the existing successful-navigation assertion in the same file to expect the injected dependency:

```ts
expect(loginScreenSource).toContain(
  "navigate(nextHref ?? destinationFor(result.user.role));",
);
```

- [ ] **Step 3: Run the login UI tests and verify RED**

Run: `npx vitest run tests/server/login-screen.test.tsx tests/server/login-page.test.ts`

Expected: FAIL because `LoginScreen` and `loginErrorMessage` are not exported, login still expects a nullable user, and success currently clears `pending` in `finally`.

- [ ] **Step 4: Implement the login result mapping and persistent pending state**

In `src/features/tambike-demo/tambike-screen.tsx`:

```tsx
import type { LoginFailureCode } from "./types";

export function loginErrorMessage(code: LoginFailureCode) {
  return code === "INVALID_CREDENTIALS"
    ? "Email or password is incorrect."
    : "This account is suspended. Contact Tambike support.";
}

const replaceLocation = (href: string) => window.location.replace(href);

export function LoginScreen({
  nextHref,
  navigate = replaceLocation,
}: {
  nextHref?: string;
  navigate?: (href: string) => void;
}) {
```

Add `LoaderCircle` to the existing named imports from `lucide-react`. Keep the current login state declarations and hydration guard inside the exported component body.
```

Replace the submit `try/catch/finally` with:

```tsx
try {
  const result = await loginWithPassword(
    String(formData.get("email") ?? ""),
    String(formData.get("password") ?? ""),
  );
  if (!result.ok) {
    setError(loginErrorMessage(result.code));
    setPending(false);
    return;
  }
  navigate(nextHref ?? destinationFor(result.user.role));
} catch (actionError) {
  setError(actionErrorMessage(actionError));
  setPending(false);
}
```

Add `aria-busy={pending}` to the existing `form.login-card`. Replace the submit-button contents and add the live status immediately after the button:

```tsx
<button className="login-submit" type="submit" disabled={pending || !isHydrated}>
  {pending ? (
    <LoaderCircle className="login-submit__spinner" aria-hidden="true" />
  ) : (
    <LogIn aria-hidden="true" />
  )}
  {pending ? "Signing you in…" : "Log in"}
</button>
<span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {pending ? "Signing you in and opening your account." : ""}
</span>
```

- [ ] **Step 5: Add spinner motion with reduced-motion support**

In `src/app/globals.css`, add a login-specific animation without changing other buttons:

```css
.login-submit__spinner {
  animation: login-submit-spin 700ms linear infinite;
}

@keyframes login-submit-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-submit__spinner {
    animation: none;
  }
}
```

- [ ] **Step 6: Run focused UI tests and refactor only while green**

Run: `npx vitest run tests/server/login-actions.test.ts tests/server/login-screen.test.tsx tests/server/login-page.test.ts`

Expected: PASS with no React `act` warnings or unhandled JSDOM navigation errors.

- [ ] **Step 7: Run the complete relevant automated checks**

Run: `npm run test:server`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm run lint -- src/server/actions.ts src/features/tambike-demo/types.ts src/features/tambike-demo/demo-provider.tsx src/features/tambike-demo/tambike-screen.tsx tests/server/login-actions.test.ts tests/server/login-screen.test.tsx tests/server/login-page.test.ts`

Expected: PASS with no warnings introduced by the login change.

- [ ] **Step 8: Verify both flows in the Codex browser**

Reuse the existing dev server if port 3000 is listening. In the Codex in-app browser:

1. Open `http://localhost:3000/login`.
2. Submit an invalid email/password and verify the visible inline error is **“Email or password is incorrect.”**, the password remains editable, and the button returns to **“Log in.”**
3. Submit the known organizer test account and verify the button immediately shows a rotating indicator plus **“Signing you in…”**, remains disabled until navigation, and lands on `/organizer/dashboard`.
4. Log out to restore the browser session.
5. Do not claim production verification until this commit is deployed.

- [ ] **Step 9: Commit the UI change only**

```powershell
git add -- tests/server/login-screen.test.tsx tests/server/login-page.test.ts src/features/tambike-demo/tambike-screen.tsx src/app/globals.css
git commit -m "fix: clarify login progress"
```

Before committing, confirm `git diff --cached --name-only` contains only the four login-related files above and excludes the unrelated member-profile edits.
