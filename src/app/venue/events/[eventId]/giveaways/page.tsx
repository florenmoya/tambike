import { connection } from "next/server";

import { VenueGiveawayQueue } from "@/features/giveaways/venue-giveaway-queue";
import { listEventGiveawayOperatorClaimsAction } from "@/server/giveaway-actions";

/** Venue queue entry point; actual credential handling remains on the separate operator desk. */
export default async function VenueEventGiveawaysPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  await connection();
  const { eventId } = await params;
  const result = await listEventGiveawayOperatorClaimsAction(eventId);

  return (
    <VenueGiveawayQueue
      eventId={eventId}
      initialQueue={result.ok ? result.data : []}
      initialError={result.ok ? null : result.code}
    />
  );
}
