import { notFound } from "next/navigation";

import type { EventAttendeeRosterPage } from "@/features/member-profiles/types";
import { getEventAttendeeSummaryAction, listEventAttendeesAction } from "@/server/actions";
import { BackendError } from "@/server/backend";

type LoadedRoster = { page: EventAttendeeRosterPage; signedIn: boolean };

function backendErrorCode(error: unknown) {
  if (error instanceof BackendError) {
    return error.code;
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export async function loadEventAttendeeRoster(
  eventId: string,
  listRoster: (eventId: string) => Promise<EventAttendeeRosterPage> = listEventAttendeesAction,
  getSummary = getEventAttendeeSummaryAction,
  showNotFound: () => never = () => notFound(),
): Promise<LoadedRoster> {
  try {
    return { page: await listRoster(eventId), signedIn: true };
  } catch (error) {
    const code = backendErrorCode(error);
    if (code === "NOT_FOUND") {
      return showNotFound();
    }
    if (code === "UNAUTHENTICATED") {
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
