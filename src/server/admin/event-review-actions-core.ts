import { z } from "zod";

import type {
  AdminEventReviewView,
  EventReviewDecision,
} from "@/features/admin/event-review-types";
import type { ActionState } from "@/features/shared/action-state";
import { actionError } from "@/server/action-result";
import { BackendError } from "@/server/backend";
import { formDataToStrictInput } from "@/server/form-data";

const eventIdSchema = z.string().trim().min(1).max(200);
function isCanonicalIsoTimestamp(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
const expectedUpdatedAtSchema = z
  .string()
  .datetime({ offset: true })
  .refine(isCanonicalIsoTimestamp, {
    message: "Use the current event revision.",
  });

export const reviewSchema = z
  .object({
    eventId: eventIdSchema,
    decision: z.enum(["PUBLISH", "REQUEST_CHANGES", "REJECT"]),
    reason: z.string().trim().max(1000).optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.decision !== "PUBLISH" &&
      (!value.reason || value.reason.length < 10)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Enter at least 10 characters.",
      });
    }
  });

export const eventStatusMutationSchema = z
  .object({
    eventId: eventIdSchema,
    reason: z.string().trim().min(10).max(500),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .strict();

type AdminEventReviewBackend = {
  getAdminEventReview(
    sessionToken: string,
    eventId: string,
  ): Promise<AdminEventReviewView>;
  reviewEvent(
    sessionToken: string,
    eventId: string,
    input: {
      decision: EventReviewDecision;
      reason?: string;
      expectedUpdatedAt: string;
    },
  ): Promise<AdminEventReviewView>;
  disableEvent(
    sessionToken: string,
    eventId: string,
    input: { reason: string; expectedUpdatedAt: string },
  ): Promise<AdminEventReviewView>;
  restoreEventToReview(
    sessionToken: string,
    eventId: string,
    input: { reason: string; expectedUpdatedAt: string },
  ): Promise<AdminEventReviewView>;
};

type AdminEventReviewActionDependencies = {
  readRequiredSessionToken(): Promise<string>;
  getBackend(): Promise<AdminEventReviewBackend>;
  revalidate(path: string): void;
};

const eventErrorMessages = {
  CONFLICT: "This event changed in another session. Reload and try again.",
  NOT_FOUND: "This event is no longer available.",
} as const;

function invalidInputState(
  error: z.ZodError,
): ActionState<AdminEventReviewView> {
  const flattened = error.flatten();
  const fieldErrors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    if (Array.isArray(messages)) fieldErrors[field] = messages;
  }
  if (flattened.formErrors.length) {
    fieldErrors._form = flattened.formErrors;
  }
  return {
    status: "error",
    code: "INVALID_INPUT",
    message: "Review the highlighted fields and try again.",
    fieldErrors,
  };
}

function revalidateEventReview(
  dependencies: AdminEventReviewActionDependencies,
  eventId: string,
) {
  dependencies.revalidate(`/admin/events/review/${eventId}`);
  dependencies.revalidate("/admin/events/review");
  dependencies.revalidate(`/events/${eventId}`);
  dependencies.revalidate(`/organizer/events/${eventId}`);
}

function reviewSuccessMessage(decision: EventReviewDecision) {
  if (decision === "PUBLISH") return "Event published.";
  if (decision === "REQUEST_CHANGES") return "Event changes requested.";
  return "Event submission rejected.";
}

export function createAdminEventReviewActions(
  dependencies: AdminEventReviewActionDependencies,
) {
  async function loadAdminEventReviewForPage(eventId: string) {
    const parsedEventId = eventIdSchema.safeParse(eventId);
    if (!parsedEventId.success) return null;

    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      return await backend.getAdminEventReview(
        sessionToken,
        parsedEventId.data,
      );
    } catch (error) {
      if (
        error instanceof BackendError &&
        (error.code === "UNAUTHENTICATED" ||
          error.code === "FORBIDDEN" ||
          error.code === "NOT_FOUND")
      ) {
        return null;
      }
      throw error;
    }
  }

  async function reviewEventAction(
    _previous: ActionState<AdminEventReviewView>,
    formData: FormData,
  ): Promise<ActionState<AdminEventReviewView>> {
    const parsed = reviewSchema.safeParse(formDataToStrictInput(formData));
    if (!parsed.success) return invalidInputState(parsed.error);

    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      const view = await backend.reviewEvent(
        sessionToken,
        parsed.data.eventId,
        {
          decision: parsed.data.decision,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        },
      );
      revalidateEventReview(dependencies, parsed.data.eventId);
      return {
        status: "success",
        code: "SUCCESS",
        message: reviewSuccessMessage(parsed.data.decision),
        data: view,
      };
    } catch (error) {
      return actionError(
        error,
        eventErrorMessages,
      ) as ActionState<AdminEventReviewView>;
    }
  }

  async function mutateEventStatus(
    formData: FormData,
    mutation: (
      backend: AdminEventReviewBackend,
      sessionToken: string,
      eventId: string,
      input: { reason: string; expectedUpdatedAt: string },
    ) => Promise<AdminEventReviewView>,
    successMessage: string,
  ): Promise<ActionState<AdminEventReviewView>> {
    const parsed = eventStatusMutationSchema.safeParse(
      formDataToStrictInput(formData),
    );
    if (!parsed.success) return invalidInputState(parsed.error);

    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      const view = await mutation(
        backend,
        sessionToken,
        parsed.data.eventId,
        {
          reason: parsed.data.reason,
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        },
      );
      revalidateEventReview(dependencies, parsed.data.eventId);
      return {
        status: "success",
        code: "SUCCESS",
        message: successMessage,
        data: view,
      };
    } catch (error) {
      return actionError(
        error,
        eventErrorMessages,
      ) as ActionState<AdminEventReviewView>;
    }
  }

  async function disableEventAction(
    _previous: ActionState<AdminEventReviewView>,
    formData: FormData,
  ) {
    return mutateEventStatus(
      formData,
      (backend, sessionToken, eventId, input) =>
        backend.disableEvent(sessionToken, eventId, input),
      "Event disabled.",
    );
  }

  async function restoreEventAction(
    _previous: ActionState<AdminEventReviewView>,
    formData: FormData,
  ) {
    return mutateEventStatus(
      formData,
      (backend, sessionToken, eventId, input) =>
        backend.restoreEventToReview(sessionToken, eventId, input),
      "Event restored to review.",
    );
  }

  return {
    loadAdminEventReviewForPage,
    reviewEventAction,
    disableEventAction,
    restoreEventAction,
  };
}
