import type {
  AdminUserAccount,
  AdminUserAccountView,
} from "@/features/admin/account-access-types";
import type { ActionState } from "@/features/shared/action-state";

export function projectAdminUserAccount(
  account: AdminUserAccount,
): AdminUserAccountView {
  return {
    id: account.id,
    displayName: account.displayName,
    email: account.email,
    role: account.role,
    verificationStatus: account.verificationStatus,
    accountStatus: account.accountStatus,
    area: account.area,
    updatedAt: account.updatedAt,
  };
}

export function projectAccountActionState(
  state: ActionState<AdminUserAccount>,
): ActionState<AdminUserAccountView> {
  if (state.status !== "success") return state;

  return {
    ...state,
    data: projectAdminUserAccount(state.data),
  };
}
