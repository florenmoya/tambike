import { z } from "zod";

import type { AdminUserAccount } from "@/features/admin/account-access-types";
import type { ActionState } from "@/features/shared/action-state";
import { actionError } from "@/server/action-result";
import { BackendError } from "@/server/backend";

const accountMutationSchema = z
  .object({
    userId: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(10).max(500),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

type AccountAccessBackend = {
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
  getBackend(): Promise<AccountAccessBackend>;
  revalidate(path: string): void;
};

const accountErrorMessages = {
  CONFLICT: "This account changed in another session. Reload and try again.",
  NOT_FOUND: "This account is no longer available.",
} as const;

function invalidInputState(
  fieldErrors: Record<string, string[] | undefined>,
): ActionState<AdminUserAccount> {
  const normalizedFieldErrors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages) normalizedFieldErrors[field] = messages;
  }

  return {
    status: "error",
    code: "INVALID_INPUT",
    message: "Review the highlighted fields and try again.",
    fieldErrors: normalizedFieldErrors,
  };
}

export function createAccountAccessActions(
  dependencies: AccountActionDependencies,
) {
  async function loadAdminUserAccountsForPage() {
    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      const currentUser = await backend.getCurrentUser(sessionToken);
      if (!currentUser) return null;

      const accounts = await backend.listAdminUserAccounts(sessionToken);
      return { currentUserId: currentUser.id, accounts };
    } catch (error) {
      if (
        error instanceof BackendError &&
        (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")
      ) {
        return null;
      }
      throw error;
    }
  }

  async function mutateAccount(
    formData: FormData,
    mutation: (
      backend: AccountAccessBackend,
      sessionToken: string,
      input: z.infer<typeof accountMutationSchema>,
    ) => Promise<AdminUserAccount>,
    successMessage: string,
  ): Promise<ActionState<AdminUserAccount>> {
    const parsed = accountMutationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return invalidInputState(parsed.error.flatten().fieldErrors);
    }

    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      const account = await mutation(backend, sessionToken, parsed.data);
      dependencies.revalidate("/admin");
      dependencies.revalidate("/admin/users");
      dependencies.revalidate("/login");
      return {
        status: "success",
        code: "SUCCESS",
        message: successMessage,
        data: account,
      };
    } catch (error) {
      return actionError(
        error,
        accountErrorMessages,
      ) as ActionState<AdminUserAccount>;
    }
  }

  async function suspendUserAction(
    _previous: ActionState<AdminUserAccount>,
    formData: FormData,
  ) {
    return mutateAccount(
      formData,
      (backend, sessionToken, input) =>
        backend.suspendUser(sessionToken, input.userId, {
          reason: input.reason,
          expectedUpdatedAt: input.expectedUpdatedAt,
        }),
      "Account suspended.",
    );
  }

  async function restoreUserAction(
    _previous: ActionState<AdminUserAccount>,
    formData: FormData,
  ) {
    return mutateAccount(
      formData,
      (backend, sessionToken, input) =>
        backend.restoreUser(sessionToken, input.userId, {
          reason: input.reason,
          expectedUpdatedAt: input.expectedUpdatedAt,
        }),
      "Account restored.",
    );
  }

  return {
    loadAdminUserAccountsForPage,
    suspendUserAction,
    restoreUserAction,
  };
}
