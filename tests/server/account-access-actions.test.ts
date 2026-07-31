import { BackendError } from "../../src/server/backend";
import type { AdminUserAccount } from "../../src/features/admin/account-access-types";
import { describe, expect, test, vi } from "vitest";

type AccountBackend = {
  getCurrentUser(sessionToken: string): Promise<{ id: string } | null>;
  listAdminUserAccounts(sessionToken: string): Promise<AdminUserAccount[]>;
  suspendUser(
    sessionToken: string,
    userId: string,
    input: { reason: string; expectedUpdatedAt: string },
  ): Promise<AdminUserAccount>;
  restoreUser(
    sessionToken: string,
    userId: string,
    input: { reason: string; expectedUpdatedAt: string },
  ): Promise<AdminUserAccount>;
};

type AccountActionDependencies = {
  readRequiredSessionToken(): Promise<string>;
  getBackend(): Promise<AccountBackend>;
  revalidate(path: string): void;
};

type AccountActionState<T = undefined> =
  | { status: "idle"; message: "" }
  | { status: "success"; code: "SUCCESS"; message: string; data: T }
  | {
      status: "error";
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

type AccountAccessActions = {
  loadAdminUserAccountsForPage(): Promise<
    { currentUserId: string; accounts: AdminUserAccount[] } | null
  >;
  suspendUserAction(
    previous: AccountActionState<AdminUserAccount>,
    formData: FormData,
  ): Promise<AccountActionState<AdminUserAccount>>;
  restoreUserAction(
    previous: AccountActionState<AdminUserAccount>,
    formData: FormData,
  ): Promise<AccountActionState<AdminUserAccount>>;
};

type CreateAccountAccessActions = (
  dependencies: AccountActionDependencies,
) => AccountAccessActions;

async function loadAccountActions() {
  // This remains runnable for the RED phase while the action module does not
  // yet exist. The action factory itself is the public behavior under test.
  const modulePath = `../../src/server/admin/${"account-actions"}`;
  const loaded = await import(modulePath);
  return loaded as { createAccountAccessActions: CreateAccountAccessActions };
}

const idle: AccountActionState<AdminUserAccount> = { status: "idle", message: "" };

const account: AdminUserAccount = {
  id: "rider-1",
  displayName: "Rider One",
  email: "rider@example.test",
  role: "rider",
  verificationStatus: "UNVERIFIED",
  accountStatus: "SUSPENDED",
  area: "Pasig City",
  suspendedAt: "2026-07-31T01:05:00.000Z",
  suspendedReason: "A sufficiently clear moderation reason.",
  updatedAt: "2026-07-31T01:05:00.000Z",
};

function validForm() {
  const form = new FormData();
  form.set("userId", "rider-1");
  form.set("reason", "A sufficiently clear moderation reason.");
  form.set("expectedUpdatedAt", "2026-07-31T01:00:00.000Z");
  return form;
}

function dependencies(overrides: Partial<AccountActionDependencies> = {}): AccountActionDependencies {
  return {
    readRequiredSessionToken: async () => "admin-session",
    getBackend: async () => ({
      getCurrentUser: async () => ({ id: "admin-1" }),
      listAdminUserAccounts: async () => [account],
      suspendUser: async () => account,
      restoreUser: async () => account,
    }),
    revalidate: () => undefined,
    ...overrides,
  };
}

describe("admin account access actions", () => {
  test("returns field errors before a malformed suspension reaches the backend", async () => {
    const { createAccountAccessActions } = await loadAccountActions();
    const getBackend = vi.fn(async () => {
      throw new Error("backend must not load for invalid form input");
    });
    const form = validForm();
    form.set("reason", "short");

    const result = await createAccountAccessActions(dependencies({ getBackend }))
      .suspendUserAction(idle, form);

    expect(result).toMatchObject({
      status: "error",
      code: "INVALID_INPUT",
      message: "Review the highlighted fields and try again.",
      fieldErrors: { reason: expect.any(Array) },
    });
    expect(getBackend).not.toHaveBeenCalled();
  });

  test("maps a missing admin session to a safe result", async () => {
    const { createAccountAccessActions } = await loadAccountActions();
    const action = createAccountAccessActions(
      dependencies({
        readRequiredSessionToken: async () => {
          throw new BackendError("UNAUTHENTICATED");
        },
      }),
    );

    await expect(action.suspendUserAction(idle, validForm())).resolves.toEqual({
      status: "error",
      code: "UNAUTHENTICATED",
      message: "Log in with an admin account and try again.",
    });
  });

  test("maps stale writes to an account-specific safe conflict result", async () => {
    const { createAccountAccessActions } = await loadAccountActions();
    const action = createAccountAccessActions(
      dependencies({
        getBackend: async () => ({
          getCurrentUser: async () => ({ id: "admin-1" }),
          listAdminUserAccounts: async () => [account],
          suspendUser: async () => {
            throw new BackendError("CONFLICT");
          },
          restoreUser: async () => account,
        }),
      }),
    );

    await expect(action.suspendUserAction(idle, validForm())).resolves.toEqual({
      status: "error",
      code: "CONFLICT",
      message: "This account changed in another session. Reload and try again.",
    });
  });

  test.each([
    ["FORBIDDEN", "Your account cannot perform this action."],
    ["NOT_FOUND", "This account is no longer available."],
  ] as const)("maps %s backend errors without exposing backend details", async (code, message) => {
    const { createAccountAccessActions } = await loadAccountActions();
    const action = createAccountAccessActions(
      dependencies({
        getBackend: async () => ({
          getCurrentUser: async () => ({ id: "admin-1" }),
          listAdminUserAccounts: async () => [account],
          suspendUser: async () => {
            throw new BackendError(code);
          },
          restoreUser: async () => account,
        }),
      }),
    );

    await expect(action.suspendUserAction(idle, validForm())).resolves.toEqual({
      status: "error",
      code,
      message,
    });
  });

  test("returns the committed account and revalidates only affected routes", async () => {
    const { createAccountAccessActions } = await loadAccountActions();
    const revalidate = vi.fn();
    const suspendUser = vi.fn(async () => account);
    const action = createAccountAccessActions(
      dependencies({
        getBackend: async () => ({
          getCurrentUser: async () => ({ id: "admin-1" }),
          listAdminUserAccounts: async () => [account],
          suspendUser,
          restoreUser: async () => account,
        }),
        revalidate,
      }),
    );

    await expect(action.suspendUserAction(idle, validForm())).resolves.toEqual({
      status: "success",
      code: "SUCCESS",
      message: "Account suspended.",
      data: account,
    });
    expect(suspendUser).toHaveBeenCalledWith("admin-session", "rider-1", {
      reason: "A sufficiently clear moderation reason.",
      expectedUpdatedAt: "2026-07-31T01:00:00.000Z",
    });
    expect(revalidate.mock.calls).toEqual([["/admin"], ["/admin/users"], ["/login"]]);
  });

  test("does not revalidate or convert unexpected action failures", async () => {
    const { createAccountAccessActions } = await loadAccountActions();
    const revalidate = vi.fn();
    const unexpected = new Error("database connection secret");
    const action = createAccountAccessActions(
      dependencies({
        getBackend: async () => ({
          getCurrentUser: async () => ({ id: "admin-1" }),
          listAdminUserAccounts: async () => [account],
          suspendUser: async () => {
            throw unexpected;
          },
          restoreUser: async () => account,
        }),
        revalidate,
      }),
    );

    await expect(action.suspendUserAction(idle, validForm())).rejects.toBe(unexpected);
    expect(revalidate).not.toHaveBeenCalled();
  });

  test("loads the current admin identity with the account list", async () => {
    const { createAccountAccessActions } = await loadAccountActions();
    const action = createAccountAccessActions(dependencies());

    await expect(action.loadAdminUserAccountsForPage()).resolves.toEqual({
      currentUserId: "admin-1",
      accounts: [account],
    });
  });

  test("keeps expected loader access failures out of the page error boundary", async () => {
    const { createAccountAccessActions } = await loadAccountActions();
    const unauthenticated = createAccountAccessActions(
      dependencies({
        readRequiredSessionToken: async () => {
          throw new BackendError("UNAUTHENTICATED");
        },
      }),
    );
    const forbidden = createAccountAccessActions(
      dependencies({
        getBackend: async () => ({
          getCurrentUser: async () => ({ id: "rider-1" }),
          listAdminUserAccounts: async () => {
            throw new BackendError("FORBIDDEN");
          },
          suspendUser: async () => account,
          restoreUser: async () => account,
        }),
      }),
    );

    await expect(unauthenticated.loadAdminUserAccountsForPage()).resolves.toBeNull();
    await expect(forbidden.loadAdminUserAccountsForPage()).resolves.toBeNull();
  });
});
