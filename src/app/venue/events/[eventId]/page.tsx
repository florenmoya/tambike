import { demoEvents } from "@/features/tambike-demo/data";
import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

export function generateStaticParams() {
  return demoEvents.map((event) => ({ eventId: event.id }));
}

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <TambikeScreen view="venue-checkin" id={eventId} />;
}
