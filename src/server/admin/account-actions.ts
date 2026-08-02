"use server";

import { revalidatePath } from "next/cache";

import type {
  AdminUserAccount,
  AdminUserAccountView,
} from "@/features/admin/account-access-types";
import type { ActionState } from "@/features/shared/action-state";
import { getTambikeBackend } from "@/server/backend";
import { readRequiredSessionToken } from "@/server/session-cookie";

import { createAccountAccessActions } from "./account-actions-core";
import {
  projectAccountActionState,
  projectAdminUserAccount,
} from "./account-action-view";

const accountAccessActions = createAccountAccessActions({
  readRequiredSessionToken,
  getBackend: getTambikeBackend,
  revalidate: (path) => revalidatePath(path),
});

export async function loadAdminUserAccountsForPage() {
  const model = await accountAccessActions.loadAdminUserAccountsForPage();
  if (!model) return null;

  return {
    currentUserId: model.currentUserId,
    accounts: model.accounts.map(projectAdminUserAccount),
  };
}

export async function suspendUserAction(
  previous: ActionState<AdminUserAccountView>,
  formData: FormData,
) {
  const result = await accountAccessActions.suspendUserAction(
    previous as ActionState<AdminUserAccount>,
    formData,
  );
  return projectAccountActionState(result);
}

export async function restoreUserAction(
  previous: ActionState<AdminUserAccountView>,
  formData: FormData,
) {
  const result = await accountAccessActions.restoreUserAction(
    previous as ActionState<AdminUserAccount>,
    formData,
  );
  return projectAccountActionState(result);
}
