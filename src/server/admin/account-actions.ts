"use server";

import { revalidatePath } from "next/cache";

import type { AdminUserAccount } from "@/features/admin/account-access-types";
import type { ActionState } from "@/features/shared/action-state";
import { getTambikeBackend } from "@/server/backend";
import { readRequiredSessionToken } from "@/server/session-cookie";

import { createAccountAccessActions } from "./account-actions-core";

const accountAccessActions = createAccountAccessActions({
  readRequiredSessionToken,
  getBackend: getTambikeBackend,
  revalidate: (path) => revalidatePath(path),
});

export async function loadAdminUserAccountsForPage() {
  return accountAccessActions.loadAdminUserAccountsForPage();
}

export async function suspendUserAction(
  previous: ActionState<AdminUserAccount>,
  formData: FormData,
) {
  return accountAccessActions.suspendUserAction(previous, formData);
}

export async function restoreUserAction(
  previous: ActionState<AdminUserAccount>,
  formData: FormData,
) {
  return accountAccessActions.restoreUserAction(previous, formData);
}
