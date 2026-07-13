import { connection } from "next/server";

import { GiveawayOperatorWorkspace } from "@/features/giveaways/giveaway-operator-workspace";
import {
  listEventGiveawayOperatorClaimsAction,
  listGiveawayOperatorCandidatesAction,
  listOrganizerGiveawaysAction,
} from "@/server/giveaway-actions";

/**
 * An event-scoped desk for venue owners and explicitly assigned operators.
 * Configurer-only campaign/candidate reads fail closed and simply omit the
 * assignment controls for ordinary claim-desk operators.
 */
export default async function GiveawayOpsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  await connection();
  const { eventId } = await params;
  const [queueResult, campaignsResult, candidatesResult] = await Promise.all([
    listEventGiveawayOperatorClaimsAction(eventId),
    listOrganizerGiveawaysAction(eventId),
    listGiveawayOperatorCandidatesAction(eventId),
  ]);

  return (
    <GiveawayOperatorWorkspace
      eventId={eventId}
      initialQueue={queueResult.ok ? queueResult.data : []}
      initialCampaigns={campaignsResult.ok ? campaignsResult.data : []}
      initialCandidates={candidatesResult.ok ? candidatesResult.data : []}
      initialError={queueResult.ok ? null : queueResult.code}
    />
  );
}
