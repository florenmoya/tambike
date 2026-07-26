import "server-only";

import { notFound } from "next/navigation";

import type { EventAttendeePreviewData } from "@/features/member-profiles/types";
import { getPublicEventAttendeePreviewAction } from "@/server/actions";
import { BackendError } from "@/server/backend";

export async function loadEventAttendeePreview(
  eventId: string,
  getPublicPreview: typeof getPublicEventAttendeePreviewAction =
    getPublicEventAttendeePreviewAction,
  showNotFound: () => never = () => notFound(),
): Promise<EventAttendeePreviewData> {
  try {
    const preview = await getPublicPreview(eventId);
    return { ...preview, unavailable: false };
  } catch (error) {
    if (error instanceof BackendError && error.code === "NOT_FOUND") {
      return showNotFound();
    }
    return { summary: null, attendees: [], unavailable: true };
  }
}
