import { demoEvents } from "@/features/tambike-demo/data";
import { AdminConsole } from "@/features/admin/admin-console";

export function generateStaticParams() {
  return demoEvents.map((event) => ({ eventId: event.id }));
}

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <AdminConsole section="reports" reportEventId={eventId} />;
}
