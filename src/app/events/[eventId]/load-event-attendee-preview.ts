import "server-only";

import { notFound } from "next/navigation";

import type {
  EventAttendeePreviewData,
  EventAttendeePreviewRider,
} from "@/features/member-profiles/types";
import {
  getEventAttendeeSummaryAction,
  listEventAttendeesAction,
} from "@/server/actions";
import { BackendError } from "@/server/backend";

const PREVIEW_LIMIT = 4;

function unavailablePreview(): EventAttendeePreviewData {
  return {
    summary: null,
    attendees: [],
    signedIn: false,
    unavailable: true,
  };
}

function toPreviewRider(
  attendee: Awaited<ReturnType<typeof listEventAttendeesAction>>["attendees"][number],
): EventAttendeePreviewRider {
  return {
    slug: attendee.slug,
    displayName: attendee.displayName,
    area: attendee.area,
    profilePhotoUrl: attendee.profilePhotoUrl,
  };
}

export async function loadEventAttendeePreview(
  eventId: string,
  listRoster: typeof listEventAttendeesAction = listEventAttendeesAction,
  getSummary: typeof getEventAttendeeSummaryAction = getEventAttendeeSummaryAction,
  showNotFound: () => never = () => notFound(),
): Promise<EventAttendeePreviewData> {
  try {
    const page = await listRoster(eventId, { limit: PREVIEW_LIMIT });
    return {
      summary: page.summary,
      attendees: page.attendees.slice(0, PREVIEW_LIMIT).map(toPreviewRider),
      signedIn: true,
      unavailable: false,
    };
  } catch (error) {
    if (error instanceof BackendError && error.code === "NOT_FOUND") {
      return showNotFound();
    }

    if (error instanceof BackendError && error.code === "UNAUTHENTICATED") {
      try {
        return {
          summary: await getSummary(eventId),
          attendees: [],
          signedIn: false,
          unavailable: false,
        };
      } catch (summaryError) {
        if (
          summaryError instanceof BackendError &&
          summaryError.code === "NOT_FOUND"
        ) {
          return showNotFound();
        }
        return unavailablePreview();
      }
    }

    return unavailablePreview();
  }
}
