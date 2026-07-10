import { venueApproval } from "@/features/tambike-demo/data";
import { VenueConsole } from "@/features/venue/venue-console";

export function generateStaticParams() {
  return [{ requestId: venueApproval.id }];
}

export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <VenueConsole section="request" requestId={requestId} />;
}
