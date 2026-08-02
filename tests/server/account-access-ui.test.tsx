/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { AdminUserAccountView } from "../../src/features/admin/account-access-types";
import { suspendUserAction } from "../../src/server/admin/account-actions";

const suspendedRider: AdminUserAccountView = {
  id: "rider-2",
  displayName: "Bea Santos",
  email: "bea@example.com",
  role: "rider",
  verificationStatus: "APPROVED",
  accountStatus: "SUSPENDED",
  area: "Quezon City",
  updatedAt: "2026-07-31T02:00:00.000Z",
};

vi.mock("../../src/server/admin/account-actions", () => ({
  suspendUserAction: vi.fn(async () => ({
    status: "success" as const,
    code: "SUCCESS" as const,
    message: "Account suspended.",
    data: {
      ...activeRider,
      accountStatus: "SUSPENDED" as const,
      updatedAt: "2026-08-01T01:00:00.000Z",
    },
  })),
  restoreUserAction: vi.fn(async () => ({
    status: "success" as const,
    code: "SUCCESS" as const,
    message: "Account restored.",
    data: {
      ...suspendedRider,
      accountStatus: "ACTIVE" as const,
      updatedAt: "2026-08-01T01:00:00.000Z",
    },
  })),
}));

import { AdminUserAccounts } from "../../src/features/admin/admin-user-accounts";

const currentAdmin: AdminUserAccountView = {
  id: "admin-1",
  displayName: "Tambike Ops",
  email: "ops@tambike.example",
  role: "admin",
  verificationStatus: "APPROVED",
  accountStatus: "ACTIVE",
  area: "Metro Manila",
  updatedAt: "2026-07-31T00:00:00.000Z",
};

const activeRider: AdminUserAccountView = {
  id: "rider-1",
  displayName: "Alex Reyes",
  email: "alex@example.com",
  role: "rider",
  verificationStatus: "PENDING",
  accountStatus: "ACTIVE",
  area: "Makati City",
  updatedAt: "2026-07-31T01:00:00.000Z",
};

const accounts = [currentAdmin, activeRider, suspendedRider];

function renderAccounts(initialAccounts = accounts) {
  return renderToStaticMarkup(
    createElement(AdminUserAccounts, {
      currentUserId: currentAdmin.id,
      initialAccounts,
    }),
  );
}

function renderedAccountIdentity(container: HTMLElement, email: string) {
  const card = [...container.querySelectorAll("article")].find((item) =>
    item.textContent?.includes(email),
  );
  const row = [...container.querySelectorAll("tbody tr")].find((item) =>
    item.textContent?.includes(email),
  );

  expect(card).toBeDefined();
  expect(row).toBeDefined();
  return `${card!.outerHTML}\n${row!.outerHTML}`;
}

describe("admin account access UI", () => {
  test("renders persisted verification and access as separate account controls", () => {
    const markup = renderAccounts();

    expect(markup).toContain("User accounts");
    expect(markup).toContain("Suspend account");
    expect(markup).toContain("Restore account");
    expect(markup).toContain("Verification");
    expect(markup).toContain("Access");
    expect(markup).toContain("Last updated");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("You cannot suspend your own account.");
    expect(markup).not.toContain("RBAC");
    expect(markup).not.toContain("onSetStatus");
    expect(markup.match(/min-h-11/g)?.length).toBe(6);
    expect(markup).not.toContain("sm:min-h-8");
  });

  test("renders complete mobile cards and the desktop data table", () => {
    const markup = renderAccounts();

    expect(markup).toContain("sm:hidden");
    expect(markup).toContain("hidden sm:block");
    expect(markup).toContain("Tambike Ops");
    expect(markup).toContain("ops@tambike.example");
    expect(markup).toContain("Metro Manila");
    expect(markup).toContain("Approved");
    expect(markup).toContain("Active");
  });

  test("explains why the last active admin cannot be suspended", () => {
    const markup = renderToStaticMarkup(
      createElement(AdminUserAccounts, {
        currentUserId: "admin-not-in-list",
        initialAccounts: [currentAdmin],
      }),
    );

    expect(markup).toContain("Keep at least one admin account active.");
    expect(markup).toContain('disabled=""');
  });

  test("requires a reason and concurrency token before confirming suspension", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(AdminUserAccounts, {
            currentUserId: currentAdmin.id,
            initialAccounts: accounts,
          }),
        );
      });

      const suspendButton = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Suspend account" && !button.disabled,
      );
      expect(suspendButton).toBeDefined();

      await act(async () => suspendButton!.click());

      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain("Suspend Alex Reyes’s account?");
      expect(dialog?.textContent).toContain("Suspension reason");
      expect(dialog?.querySelector('input[name="userId"]')?.getAttribute("value")).toBe("rider-1");
      expect(dialog?.querySelector('input[name="expectedUpdatedAt"]')?.getAttribute("value")).toBe(
        activeRider.updatedAt,
      );
      const reason = dialog?.querySelector<HTMLTextAreaElement>(
        'textarea#account-action-reason[name="reason"]',
      );
      expect(reason?.required).toBe(true);
      expect(reason?.minLength).toBe(10);
      expect(reason?.maxLength).toBe(500);
      expect(dialog?.textContent).toContain("Cancel");
      expect(dialog?.textContent).toContain("Suspend account");
      const dialogButtons = dialog?.querySelectorAll<HTMLButtonElement>("button");
      expect(dialogButtons).toHaveLength(2);
      expect([...dialogButtons!].every((button) => button.classList.contains("min-h-11"))).toBe(
        true,
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
      document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove());
    }
  });

  test("replaces only the committed row after the server action succeeds", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(AdminUserAccounts, {
            currentUserId: currentAdmin.id,
            initialAccounts: accounts,
          }),
        );
      });

      const alexBefore = renderedAccountIdentity(container, "alex@example.com");
      const beaBefore = renderedAccountIdentity(container, "bea@example.com");
      const adminBefore = renderedAccountIdentity(container, "ops@tambike.example");

      expect(alexBefore).toContain('datetime="2026-07-31T01:00:00.000Z"');
      expect(alexBefore).toContain("Active");

      const suspendButton = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Suspend account" && !button.disabled,
      );
      await act(async () => suspendButton!.click());

      const form = document.querySelector<HTMLFormElement>('[role="dialog"] form');
      const reason = form?.querySelector<HTMLTextAreaElement>('textarea[name="reason"]');
      expect(form).not.toBeNull();
      expect(reason).not.toBeNull();

      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!;
        valueSetter.call(reason, "Requested by the account owner");
        reason!.dispatchEvent(new Event("input", { bubbles: true }));
        form!.requestSubmit();
      });

      expect(container.textContent).toContain("Account suspended.");
      const alexAfter = renderedAccountIdentity(container, "alex@example.com");
      expect(alexAfter).not.toBe(alexBefore);
      expect(alexAfter).toContain('datetime="2026-08-01T01:00:00.000Z"');
      expect(alexAfter).toContain("Suspended");
      expect(alexAfter).toContain("Restore account");
      expect(renderedAccountIdentity(container, "bea@example.com")).toBe(beaBefore);
      expect(renderedAccountIdentity(container, "ops@tambike.example")).toBe(adminBefore);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove());
    }
  });

  test("locks the originating dialog and row while its deferred action is pending", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let resolveAction!: (value: Awaited<ReturnType<typeof suspendUserAction>>) => void;
    vi.mocked(suspendUserAction).mockImplementationOnce(
      () => new Promise((resolve) => (resolveAction = resolve)),
    );

    try {
      await act(async () => {
        root.render(
          createElement(AdminUserAccounts, {
            currentUserId: currentAdmin.id,
            initialAccounts: accounts,
          }),
        );
      });

      const alexSuspend = [...container.querySelectorAll("button")].find(
        (button) =>
          button.textContent?.trim() === "Suspend account" &&
          button.closest("article")?.textContent?.includes("Alex Reyes"),
      );
      await act(async () => alexSuspend!.click());
      const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
      const reason = form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;

      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          reason,
          "Requested by the account owner",
        );
        reason.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
      });

      const pendingDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(pendingDialog.textContent).toContain("Suspending...");
      const accountActionButtons = [
        ...container.querySelectorAll<HTMLButtonElement>("button"),
      ].filter((button) =>
        /^(Suspend|Restore) account$/.test(button.textContent?.trim() ?? ""),
      );
      expect(
        accountActionButtons
          .filter((button) => !button.disabled)
          .map((button) => button.closest("article")?.textContent ?? button.textContent),
      ).toEqual([]);

      await act(async () => {
        pendingDialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        document.querySelector<HTMLElement>("[data-radix-dialog-overlay]")?.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
      });
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Alex Reyes");

      const beaRestore = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button.textContent?.trim() === "Restore account" &&
          button.closest("article")?.textContent?.includes("Bea Santos"),
      );
      await act(async () => beaRestore!.click());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Alex Reyes");

      await act(async () => {
        resolveAction({
          status: "success",
          code: "SUCCESS",
          message: "Account suspended.",
          data: {
            ...activeRider,
            accountStatus: "SUSPENDED",
            updatedAt: "2026-08-01T01:00:00.000Z",
          },
        });
      });

      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(renderedAccountIdentity(container, "alex@example.com")).toContain(
        'datetime="2026-08-01T01:00:00.000Z"',
      );
      expect(renderedAccountIdentity(container, "bea@example.com")).toContain(
        'datetime="2026-07-31T02:00:00.000Z"',
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
      document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove());
    }
  });

  test("removes the legacy local override path from the admin shell", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/admin/admin-console.tsx"),
      "utf8",
    );

    expect(source).not.toContain("userStatusOverrides");
    expect(source).not.toContain("setUserStatus");
    expect(source).not.toContain("getUserRows");
    expect(source).not.toContain("getUserColumns");
  });

  test("keeps the client-imported action module limited to async server exports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/server/admin/account-actions.ts"),
      "utf8",
    );

    expect(source.trimStart()).toMatch(/^(["'])use server\1/);
    expect(source).not.toContain("export function createAccountAccessActions");
    expect(source).toContain("export async function suspendUserAction(");
    expect(source).toContain("export async function restoreUserAction(");
  });
});
