/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Role, UserProfile } from "../../src/features/tambike-demo/types";

const loginWithPassword = vi.hoisted(() => vi.fn());
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

import {
  LoginScreen,
  TambikeAppShell,
} from "../../src/features/tambike-demo/tambike-screen";

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

type LoginView = {
  container: HTMLDivElement;
  form: HTMLFormElement;
  navigate: ReturnType<typeof vi.fn>;
  root: Root;
};

type ShellView = {
  container: HTMLDivElement;
  desktopLogout: HTMLButtonElement;
  header: HTMLElement;
  menuButton: HTMLButtonElement;
  mobileLogout: HTMLButtonElement;
  navigate: ReturnType<typeof vi.fn>;
  root: Root;
};

async function renderLogin(): Promise<LoginView> {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const navigate = vi.fn();

  await act(async () => {
    root.render(createElement(LoginScreen, { navigate }));
  });

  const form = container.querySelector<HTMLFormElement>("form.login-card");
  const email = container.querySelector<HTMLInputElement>('input[name="email"]');
  const password = container.querySelector<HTMLInputElement>('input[name="password"]');
  if (!form || !email || !password) {
    throw new Error("Login form did not render its required controls");
  }

  email.value = "organizer@bayanko.ph";
  password.value = "password123";

  return { container, form, navigate, root };
}

async function disposeLogin(view: LoginView) {
  await act(async () => view.root.unmount());
  view.container.remove();
}

async function renderShell(): Promise<ShellView> {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  demoSession.currentUser = organizer;
  demoSession.role = "organizer";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const navigate = vi.fn();

  await act(async () => {
    root.render(
      <TambikeAppShell navigate={navigate}>
        <main>Tambike content</main>
      </TambikeAppShell>,
    );
  });

  const desktopLogout = container.querySelector<HTMLButtonElement>(
    ".header-actions .logout-button",
  );
  const mobileLogout = container.querySelector<HTMLButtonElement>(
    '[aria-label="Mobile log out"]',
  );
  const menuButton = container.querySelector<HTMLButtonElement>(".menu-button");
  const header = container.querySelector<HTMLElement>(".site-header");
  if (!desktopLogout || !mobileLogout || !menuButton || !header) {
    throw new Error("Tambike shell did not render its logout controls");
  }

  return {
    container,
    desktopLogout,
    header,
    menuButton,
    mobileLogout,
    navigate,
    root,
  };
}

async function disposeShell(view: ShellView) {
  await act(async () => view.root.unmount());
  view.container.remove();
}

beforeEach(() => {
  vi.clearAllMocks();
  demoSession.currentUser = null;
  demoSession.role = "guest";
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("LoginScreen", () => {
  test.each([
    ["INVALID_CREDENTIALS", "Email or password is incorrect."],
    ["ACCOUNT_SUSPENDED", "This account is suspended. Contact Tambike support."],
  ] as const)(
    "shows safe copy for %s and restores the form",
    async (code, message) => {
      loginWithPassword.mockResolvedValue({ ok: false, code });
      const view = await renderLogin();

      try {
        await act(async () => view.form.requestSubmit());

        expect(view.container.querySelector(".inline-error")?.textContent).toBe(
          message,
        );
        expect(
          view.container.querySelector<HTMLButtonElement>(".login-submit")
            ?.disabled,
        ).toBe(false);
        expect(
          view.container.querySelector<HTMLInputElement>('input[name="email"]')
            ?.value,
        ).toBe("organizer@bayanko.ph");
        expect(
          view.container.querySelector<HTMLInputElement>('input[name="password"]')
            ?.value,
        ).toBe("password123");
        expect(view.navigate).not.toHaveBeenCalled();
      } finally {
        await disposeLogin(view);
      }
    },
  );

  test("keeps the form busy after successful authentication starts navigation", async () => {
    loginWithPassword.mockResolvedValue({ ok: true, user: organizer });
    const view = await renderLogin();

    try {
      await act(async () => view.form.requestSubmit());

      expect(view.navigate).toHaveBeenCalledWith("/organizer/dashboard");
      expect(view.form.getAttribute("aria-busy")).toBe("true");
      expect(
        view.container.querySelector<HTMLButtonElement>(".login-submit")
          ?.disabled,
      ).toBe(true);
      expect(view.container.querySelector(".login-submit")?.textContent).toContain(
        "Signing you in…",
      );
      expect(view.container.querySelector(".login-submit__spinner")).not.toBeNull();
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe(
        "Signing you in and opening your account.",
      );
    } finally {
      await disposeLogin(view);
    }
  });

  test("keeps unexpected failures generic and restores the form", async () => {
    loginWithPassword.mockRejectedValue(new Error("database unavailable"));
    const view = await renderLogin();

    try {
      await act(async () => view.form.requestSubmit());

      expect(view.container.querySelector(".inline-error")?.textContent).toBe(
        "Something went wrong. Try again.",
      );
      expect(
        view.container.querySelector<HTMLButtonElement>(".login-submit")
          ?.disabled,
      ).toBe(false);
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      await disposeLogin(view);
    }
  });
});

describe("TambikeAppShell logout", () => {
  test("shows labeled shared progress and keeps the mobile menu open through success", async () => {
    let finishLogout!: () => void;
    logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = resolve;
        }),
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
      expect(
        view.container.querySelectorAll(".logout-button__spinner"),
      ).toHaveLength(2);

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
