import { notFound } from "next/navigation";

import type { EventAttendeeRosterPage } from "@/features/member-profiles/types";
import { getEventAttendeeSummaryAction, listEventAttendeesAction } from "@/server/actions";
import { BackendError } from "@/server/backend";

type LoadedRoster = { page: EventAttendeeRosterPage; signedIn: boolean };

export async function loadEventAttendeeRoster(
  eventId: string,
  listRoster: (eventId: string) => Promise<EventAttendeeRosterPage> = listEventAttendeesAction,
  getSummary = getEventAttendeeSummaryAction,
  showNotFound: () => never = () => notFound(),
): Promise<LoadedRoster> {
  try {
    return { page: await listRoster(eventId), signedIn: true };
  } catch (error) {
    if (error instanceof BackendError && error.code === "NOT_FOUND") {
      return showNotFound();
    }
    if (error instanceof BackendError && error.code === "UNAUTHENTICATED") {
      const summary = await getSummary(eventId);
      return {
        signedIn: false,
        page: {
          summary,
          attendees: [],
          pageSize: 24,
        },
      };
    }
    throw error;
  }
}
