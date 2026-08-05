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
  accountTrigger: HTMLButtonElement;
  container: HTMLDivElement;
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

  const accountTrigger = container.querySelector<HTMLButtonElement>(
    "button.account-menu__trigger",
  );
  const mobileLogout = container.querySelector<HTMLButtonElement>(
    '[aria-label="Mobile log out"]',
  );
  if (!accountTrigger || !mobileLogout) {
    throw new Error("Tambike shell did not render its account controls");
  }

  return {
    accountTrigger,
    container,
    mobileLogout,
    navigate,
    root,
  };
}

async function disposeShell(view: ShellView) {
  await act(async () => view.root.unmount());
  view.container.remove();
}

async function openAccountMenu(view: ShellView) {
  await act(async () => view.accountTrigger.click());

  const panel = view.container.querySelector<HTMLElement>(
    ".account-menu__panel",
  );
  const profileLink = panel?.querySelector<HTMLAnchorElement>(
    'a[href="/profile"]',
  );
  const logoutButton = panel?.querySelector<HTMLButtonElement>(
    ".account-menu__logout",
  );
  if (!panel || !profileLink || !logoutButton) {
    throw new Error("Account menu did not render its required actions");
  }

  return { logoutButton, panel, profileLink };
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
  test("opens account options without a standalone desktop logout control", async () => {
    const view = await renderShell();

    try {
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
      expect(
        view.container.querySelector(".header-actions > .logout-button"),
      ).toBeNull();

      const menu = await openAccountMenu(view);

      expect(view.accountTrigger.getAttribute("aria-expanded")).toBe("true");
      expect(menu.panel.getAttribute("role")).toBe("group");
      expect(menu.panel.getAttribute("aria-label")).toBe("Account options");
      expect(menu.profileLink.textContent).toContain("View profile");
      expect(menu.profileLink.getAttribute("href")).toBe("/profile");
      expect(menu.logoutButton.textContent).toContain("Log out");
      expect(view.mobileLogout.textContent).toContain("Log out");
      expect(
        view.container.querySelector('.mobile-nav-session a[href="/profile"]'),
      ).not.toBeNull();
    } finally {
      await disposeShell(view);
    }
  });

  test("dismisses account options with its trigger, outside interaction, and Escape", async () => {
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

  test("closes account options after choosing View profile", async () => {
    const view = await renderShell();

    try {
      const menu = await openAccountMenu(view);
      menu.profileLink.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });

      await act(async () => menu.profileLink.click());

      expect(view.container.querySelector(".account-menu__panel")).toBeNull();
    } finally {
      await disposeShell(view);
    }
  });

  test("shows shared progress in the open account menu through success", async () => {
    let finishLogout!: () => void;
    logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = resolve;
        }),
    );
    const view = await renderShell();

    try {
      const menu = await openAccountMenu(view);
      await act(async () => {
        menu.logoutButton.click();
        await Promise.resolve();
      });

      expect(view.container.querySelector(".account-menu__panel")).not.toBeNull();
      expect(view.accountTrigger.getAttribute("aria-expanded")).toBe("true");
      expect(menu.logoutButton.disabled).toBe(true);
      expect(view.mobileLogout.disabled).toBe(true);
      expect(menu.logoutButton.textContent).toContain("Logging out…");
      expect(view.mobileLogout.textContent).toContain("Logging out…");
      expect(
        view.container.querySelectorAll(".logout-button__spinner"),
      ).toHaveLength(2);

      await act(async () => finishLogout());

      expect(view.navigate).toHaveBeenCalledWith("/");
      expect(menu.logoutButton.disabled).toBe(true);
      expect(view.mobileLogout.disabled).toBe(true);
    } finally {
      await disposeShell(view);
    }
  });

  test("restores logout and shows safe feedback when the request fails", async () => {
    logout.mockRejectedValue(new Error("session store unavailable"));
    const view = await renderShell();

    try {
      const menu = await openAccountMenu(view);
      await act(async () => menu.logoutButton.click());

      expect(view.container.querySelector(".account-menu__panel")).not.toBeNull();
      expect(menu.logoutButton.disabled).toBe(false);
      expect(view.mobileLogout.disabled).toBe(false);
      expect(menu.logoutButton.textContent).toContain("Log out");
      expect(menu.panel.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not log out. Try again.",
      );
      expect(view.navigate).not.toHaveBeenCalled();
    } finally {
      await disposeShell(view);
    }
  });
});
