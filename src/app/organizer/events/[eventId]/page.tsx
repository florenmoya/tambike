import { demoEvents } from "@/features/tambike-demo/data";
import { OrganizerConsole } from "@/features/organizer/organizer-console";

export function generateStaticParams() {
  return demoEvents.map((event) => ({ eventId: event.id }));
}

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <OrganizerConsole section="event" eventId={eventId} />;
}
