import { AdminConsole } from "@/features/admin/admin-console";
import { AdminUserAccounts } from "@/features/admin/admin-user-accounts";
import { loadAdminUserAccountsForPage } from "@/server/admin/account-actions";

export const metadata = {
  title: "User accounts",
  description: "Manage Tambike rider, organizer, and admin account access.",
};

export default async function Page() {
  const model = await loadAdminUserAccountsForPage();

  return (
    <AdminConsole
      section="users"
      userContent={
        model ? (
          <AdminUserAccounts
            currentUserId={model.currentUserId}
            initialAccounts={model.accounts}
          />
        ) : null
      }
    />
  );
}
