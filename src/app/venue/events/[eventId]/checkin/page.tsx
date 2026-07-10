import { demoEvents } from "@/features/tambike-demo/data";
import { VenueConsole } from "@/features/venue/venue-console";

export function generateStaticParams() {
  return demoEvents.map((event) => ({ eventId: event.id }));
}

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <VenueConsole section="checkin" eventId={eventId} />;
}
