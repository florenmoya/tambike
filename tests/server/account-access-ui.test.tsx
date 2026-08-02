/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { AdminUserAccount } from "../../src/features/admin/account-access-types";

const suspendedRider: AdminUserAccount = {
  id: "rider-2",
  displayName: "Bea Santos",
  email: "bea@example.com",
  role: "rider",
  verificationStatus: "APPROVED",
  accountStatus: "SUSPENDED",
  area: "Quezon City",
  suspendedAt: "2026-07-31T02:00:00.000Z",
  suspendedReason: "Repeated unsafe account activity",
  updatedAt: "2026-07-31T02:00:00.000Z",
};

vi.mock("../../src/server/admin/account-actions", () => ({
  suspendUserAction: async () => ({
    status: "success" as const,
    code: "SUCCESS" as const,
    message: "Account suspended.",
    data: {
      ...activeRider,
      accountStatus: "SUSPENDED" as const,
      suspendedAt: "2026-08-01T01:00:00.000Z",
      suspendedReason: "Requested by the account owner",
      updatedAt: "2026-08-01T01:00:00.000Z",
    },
  }),
  restoreUserAction: async () => ({
    status: "success" as const,
    code: "SUCCESS" as const,
    message: "Account restored.",
    data: {
      ...suspendedRider,
      accountStatus: "ACTIVE" as const,
      suspendedAt: undefined,
      suspendedReason: undefined,
      updatedAt: "2026-08-01T01:00:00.000Z",
    },
  }),
}));

import { AdminUserAccounts } from "../../src/features/admin/admin-user-accounts";

const currentAdmin: AdminUserAccount = {
  id: "admin-1",
  displayName: "Tambike Ops",
  email: "ops@tambike.example",
  role: "admin",
  verificationStatus: "APPROVED",
  accountStatus: "ACTIVE",
  area: "Metro Manila",
  updatedAt: "2026-07-31T00:00:00.000Z",
};

const activeRider: AdminUserAccount = {
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
      expect(container.textContent).toContain("Alex Reyes");
      expect(container.textContent).toContain("Bea Santos");
      expect(container.textContent).toContain("Restore account");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
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
