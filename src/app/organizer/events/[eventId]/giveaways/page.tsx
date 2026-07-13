import { OrganizerConsole } from "@/features/organizer/organizer-console";
import { demoEvents } from "@/features/tambike-demo/data";

export function generateStaticParams() {
  return demoEvents.map((event) => ({ eventId: event.id }));
}

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <OrganizerConsole section="giveaways" eventId={eventId} />;
}
