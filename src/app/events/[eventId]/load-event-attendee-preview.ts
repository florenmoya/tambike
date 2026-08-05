import "server-only";

import { notFound } from "next/navigation";

import type { EventAttendeePreviewData } from "@/features/member-profiles/types";
import { getPublicEventAttendeePreviewAction } from "@/server/actions";
import { BackendError } from "@/server/backend";

function backendErrorCode(error: unknown) {
  if (error instanceof BackendError) return error.code;
  if (!(error instanceof Error) || error.name !== "BackendError" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

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
    if (backendErrorCode(error) === "NOT_FOUND") {
      return showNotFound();
    }
    return { summary: null, attendees: [], unavailable: true };
  }
}
