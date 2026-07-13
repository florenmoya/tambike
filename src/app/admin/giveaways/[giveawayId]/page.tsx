import { connection } from "next/server";

import { AdminConsole } from "@/features/admin/admin-console";
import { AdminGiveawayDetail } from "@/features/giveaways/admin-giveaway-console";
import {
  getAdminGiveawayAuditAction,
  getOrganizerGiveawayWorkspaceAction,
  listGiveawayOperatorCandidatesAction,
} from "@/server/giveaway-actions";

/** The detail route keeps all server reads scoped to one campaign and event. */
export default async function AdminGiveawayDetailPage({
  params,
}: {
  params: Promise<{ giveawayId: string }>;
}) {
  await connection();
  const { giveawayId } = await params;
  const [workspaceResult, auditResult] = await Promise.all([
    getOrganizerGiveawayWorkspaceAction(giveawayId),
    getAdminGiveawayAuditAction(giveawayId),
  ]);

  if (!workspaceResult.ok) {
    return (
      <AdminConsole
        section="giveaways"
        giveawayContent={<AdminGiveawayDetail giveawayId={giveawayId} initialWorkspace={null} initialAudit={null} initialCandidates={[]} initialError={workspaceResult.code} />}
      />
    );
  }

  const candidatesResult = await listGiveawayOperatorCandidatesAction(workspaceResult.data.eventId);

  return (
    <AdminConsole
      section="giveaways"
      giveawayContent={
        <AdminGiveawayDetail
          giveawayId={giveawayId}
          initialWorkspace={workspaceResult.data}
          initialAudit={auditResult.ok ? auditResult.data : null}
          initialCandidates={candidatesResult.ok ? candidatesResult.data : []}
          initialError={null}
          initialAuditError={auditResult.ok ? null : auditResult.code}
        />
      }
    />
  );
}
