import { connection } from "next/server";

import { GiveawayClaimScreen } from "@/features/giveaways/giveaway-claim-screen";
import { getRiderGiveawayClaimContextAction } from "@/server/giveaway-actions";

/**
 * Award IDs are opaque route locators, not claim credentials. The request-time
 * action supplies the logged-in winner's narrow context; the QR secret is only
 * issued later after an explicit client-side tap.
 */
export default async function GiveawayClaimPage({
  params,
}: {
  params: Promise<{ awardId: string }>;
}) {
  await connection();
  const { awardId } = await params;
  const result = await getRiderGiveawayClaimContextAction(awardId);

  return (
    <GiveawayClaimScreen
      key={awardId}
      awardId={awardId}
      initialContext={result.ok ? result.data : null}
      initialError={result.ok ? null : result.code}
    />
  );
}
