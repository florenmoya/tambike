"use server";

import { revalidatePath } from "next/cache";

import type { AdminEventReviewView } from "@/features/admin/event-review-types";
import type { ActionState } from "@/features/shared/action-state";
import { getTambikeBackend } from "@/server/backend";
import { readRequiredSessionToken } from "@/server/session-cookie";

import { createAdminEventReviewActions } from "./event-review-actions-core";

const actions = createAdminEventReviewActions({
  readRequiredSessionToken,
  getBackend: getTambikeBackend,
  revalidate: (path) => revalidatePath(path),
});

export async function loadAdminEventReviewForPage(eventId: string) {
  return actions.loadAdminEventReviewForPage(eventId);
}

export async function reviewEventAction(
  previous: ActionState<AdminEventReviewView>,
  formData: FormData,
) {
  return actions.reviewEventAction(previous, formData);
}

export async function disableEventAction(
  previous: ActionState<AdminEventReviewView>,
  formData: FormData,
) {
  return actions.disableEventAction(previous, formData);
}

export async function restoreEventAction(
  previous: ActionState<AdminEventReviewView>,
  formData: FormData,
) {
  return actions.restoreEventAction(previous, formData);
}
