import { connection } from "next/server";

import { AdminConsole } from "@/features/admin/admin-console";
import { AdminGiveawayList } from "@/features/giveaways/admin-giveaway-console";
import { listAdminGiveawaysAction } from "@/server/giveaway-actions";

/** Campaign data is server-loaded through the admin-scoped action before it enters the console shell. */
export default async function AdminGiveawaysPage() {
  await connection();
  const result = await listAdminGiveawaysAction();

  return (
    <AdminConsole
      section="giveaways"
      giveawayContent={
        <AdminGiveawayList
          initialCampaigns={result.ok ? result.data : []}
          initialError={result.ok ? null : result.code}
        />
      }
    />
  );
}
