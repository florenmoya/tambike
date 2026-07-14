import { connection } from "next/server";

import {
  getGiveawayPresentationChannelName,
  parseGiveawayPresentationChannelName,
} from "@/features/giveaways/giveaway-presentation-channel";
import { GiveawayPresentationStage } from "@/features/giveaways/giveaway-presentation-stage";
import { getOrganizerGiveawayWorkspaceAction } from "@/server/giveaway-actions";

type GiveawayPresentationPageProps = {
  params: Promise<{ eventId: string; giveawayId: string }>;
  searchParams: Promise<{ channel?: string | string[] }>;
};

export default async function GiveawayPresentationPage({
  params,
  searchParams,
}: GiveawayPresentationPageProps) {
  await connection();
  const { eventId, giveawayId } = await params;
  const query = await searchParams;
  const channelId = parseChannelId(query.channel);
  if (!channelId) return <UnavailableStage />;

  let authorized = false;
  try {
    const workspaceResult = await getOrganizerGiveawayWorkspaceAction(giveawayId);
    authorized = workspaceResult.ok && workspaceResult.data.eventId === eventId;
  } catch {
    authorized = false;
  }
  if (!authorized) return <UnavailableStage />;

  return (
    <GiveawayPresentationStage
      eventId={eventId}
      giveawayId={giveawayId}
      channelId={channelId}
    />
  );
}

function parseChannelId(value: string | string[] | undefined) {
  if (typeof value !== "string") return null;
  try {
    return parseGiveawayPresentationChannelName(getGiveawayPresentationChannelName(value));
  } catch {
    return null;
  }
}

function UnavailableStage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#050506] px-6 text-[#F7F4EF]">
      <section className="max-w-md text-center">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[#FFBE45]">
          Tambike Live Draw
        </p>
        <h1 className="mt-4 text-2xl font-semibold">Live draw unavailable</h1>
        <p className="mt-2 text-sm text-[#D7DEE2]">
          Return to the organizer workspace and open the stage again.
        </p>
      </section>
    </main>
  );
}
