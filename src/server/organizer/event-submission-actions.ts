"use server";

import { revalidatePath } from "next/cache";

import type { OrganizerEventSubmissionView } from "@/features/admin/event-review-types";
import type { ActionState } from "@/features/shared/action-state";
import { getTambikeBackend } from "@/server/backend";
import { readRequiredSessionToken } from "@/server/session-cookie";

import { createOrganizerEventSubmissionActions } from "./event-submission-actions-core";

const actions = createOrganizerEventSubmissionActions({
  readRequiredSessionToken,
  getBackend: getTambikeBackend,
  revalidate: (path) => revalidatePath(path),
});

export async function loadOrganizerEventSubmissionForPage(eventId: string) {
  return actions.loadOrganizerEventSubmissionForPage(eventId);
}

export async function loadRejectedEventCopySource(eventId: string) {
  return actions.loadRejectedEventCopySource(eventId);
}

export async function resubmitEventAction(
  previous: ActionState<OrganizerEventSubmissionView>,
  formData: FormData,
) {
  return actions.resubmitEventAction(previous, formData);
}
