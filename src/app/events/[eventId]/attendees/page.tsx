import { EventAttendeeRoster } from "@/features/member-profiles/event-attendee-roster";
import { TambikeAppShell } from "@/features/tambike-demo/tambike-screen";
import { loadEventAttendeeRoster } from "./load-event-attendee-roster";

export default async function EventAttendeesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const loaded = await loadEventAttendeeRoster(eventId);

  return (
    <TambikeAppShell>
      <div className="event-roster-page-shell">
        <EventAttendeeRoster initialPage={loaded.page} signedIn={loaded.signedIn} />
      </div>
    </TambikeAppShell>
  );
}
