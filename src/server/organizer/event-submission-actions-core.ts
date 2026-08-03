import { z } from "zod";

import type { OrganizerEventSubmissionView } from "@/features/admin/event-review-types";
import type { ActionState } from "@/features/shared/action-state";
import {
  EVENT_LOCATION_LIMITS,
  normalizeEventLocation,
} from "@/features/tambike-demo/event-location";
import {
  EventScheduleValidationError,
  parseEventScheduleInput,
} from "@/features/tambike-demo/event-schedule";
import type { CreateEventInput } from "@/features/tambike-demo/types";
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
const eventTypeSchema = z.enum([
  "Tambike",
  "Bike Night",
  "Coffee Ride",
  "Club EB",
  "Brand Event",
  "Test Ride",
  "Charity Ride",
  "Track Day",
  "Endurance Ride",
  "Moto Expo",
  "Race",
]);

export const resubmitEventSchema = z
  .object({
    eventId: eventIdSchema,
    reason: z.string().trim().min(10).max(500),
    expectedUpdatedAt: expectedUpdatedAtSchema,
    title: z.string().trim().min(1).max(160),
    type: eventTypeSchema,
    startDate: z.string().trim().min(1).max(10),
    startTime: z.string().trim().min(1).max(5),
    endDate: z.string().trim().min(1).max(10),
    endTime: z.string().trim().min(1).max(5),
    timeZone: z.string().trim().min(1).max(100),
    recurrence: z.enum(["NONE", "WEEKLY"]),
    recurrenceEndsOn: z.string().trim().max(10).optional(),
    locationName: z.string().trim().min(1).max(EVENT_LOCATION_LIMITS.name),
    locationAddress: z
      .string()
      .trim()
      .min(1)
      .max(EVENT_LOCATION_LIMITS.address),
    locationMapLink: z
      .string()
      .trim()
      .max(EVENT_LOCATION_LIMITS.mapLink)
      .optional(),
    area: z.string().trim().min(1).max(EVENT_LOCATION_LIMITS.area),
    expectedRiders: z.coerce.number().int().positive().max(100_000),
    perkPreview: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (!normalizeEventLocation(value)) {
      context.addIssue({
        code: "custom",
        path: ["locationMapLink"],
        message: "Enter a valid event location.",
      });
    }
    try {
      parseEventScheduleInput(value);
    } catch (error) {
      if (error instanceof EventScheduleValidationError) {
        context.addIssue({
          code: "custom",
          path: ["startDate"],
          message: error.message,
        });
        return;
      }
      throw error;
    }
  });

type OrganizerEventSubmissionBackend = {
  getOrganizerEventSubmission(
    sessionToken: string,
    eventId: string,
  ): Promise<OrganizerEventSubmissionView>;
  getRejectedEventCopySource(
    sessionToken: string,
    eventId: string,
  ): Promise<CreateEventInput>;
  resubmitEvent(
    sessionToken: string,
    eventId: string,
    input: {
      event: CreateEventInput;
      reason: string;
      expectedUpdatedAt: string;
    },
  ): Promise<OrganizerEventSubmissionView>;
};

type OrganizerEventSubmissionActionDependencies = {
  readRequiredSessionToken(): Promise<string>;
  getBackend(): Promise<OrganizerEventSubmissionBackend>;
  revalidate(path: string): void;
};

const eventErrorMessages = {
  CONFLICT: "This event changed in another session. Reload and try again.",
  NOT_FOUND: "This event is no longer available.",
} as const;

function invalidInputState(
  error: z.ZodError,
): ActionState<OrganizerEventSubmissionView> {
  const flattened = error.flatten();
  const fieldErrors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    if (Array.isArray(messages)) fieldErrors[field] = messages;
  }
  if (flattened.formErrors.length) fieldErrors._form = flattened.formErrors;
  return {
    status: "error",
    code: "INVALID_INPUT",
    message: "Review the highlighted fields and try again.",
    fieldErrors,
  };
}

function isSafeLoaderError(error: unknown) {
  const isBackendError =
    error instanceof BackendError ||
    (error instanceof Error && error.name === "BackendError");
  return (
    isBackendError &&
    "code" in error &&
    (error.code === "UNAUTHENTICATED" ||
      error.code === "FORBIDDEN" ||
      error.code === "NOT_FOUND" ||
      error.code === "CONFLICT")
  );
}

function toCreateEventInput(
  parsed: z.infer<typeof resubmitEventSchema>,
): CreateEventInput {
  const location = normalizeEventLocation(parsed);
  if (!location) throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  return {
    title: parsed.title,
    type: parsed.type,
    startDate: parsed.startDate,
    startTime: parsed.startTime,
    endDate: parsed.endDate,
    endTime: parsed.endTime,
    timeZone: parsed.timeZone,
    recurrence: parsed.recurrence,
    ...(parsed.recurrenceEndsOn
      ? { recurrenceEndsOn: parsed.recurrenceEndsOn }
      : {}),
    ...location,
    expectedRiders: parsed.expectedRiders,
    perkPreview: parsed.perkPreview,
  };
}

export function createOrganizerEventSubmissionActions(
  dependencies: OrganizerEventSubmissionActionDependencies,
) {
  async function loadOrganizerEventSubmissionForPage(eventId: string) {
    const parsedEventId = eventIdSchema.safeParse(eventId);
    if (!parsedEventId.success) return null;
    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      return await backend.getOrganizerEventSubmission(
        sessionToken,
        parsedEventId.data,
      );
    } catch (error) {
      if (isSafeLoaderError(error)) return null;
      throw error;
    }
  }

  async function loadRejectedEventCopySource(eventId: string) {
    const parsedEventId = eventIdSchema.safeParse(eventId);
    if (!parsedEventId.success) return null;
    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      return await backend.getRejectedEventCopySource(
        sessionToken,
        parsedEventId.data,
      );
    } catch (error) {
      if (isSafeLoaderError(error)) return null;
      throw error;
    }
  }

  async function resubmitEventAction(
    _previous: ActionState<OrganizerEventSubmissionView>,
    formData: FormData,
  ): Promise<ActionState<OrganizerEventSubmissionView>> {
    const parsed = resubmitEventSchema.safeParse(
      formDataToStrictInput(formData),
    );
    if (!parsed.success) return invalidInputState(parsed.error);

    try {
      const sessionToken = await dependencies.readRequiredSessionToken();
      const backend = await dependencies.getBackend();
      const view = await backend.resubmitEvent(
        sessionToken,
        parsed.data.eventId,
        {
          event: toCreateEventInput(parsed.data),
          reason: parsed.data.reason,
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        },
      );
      dependencies.revalidate(`/organizer/events/${parsed.data.eventId}`);
      dependencies.revalidate("/admin/events/review");
      dependencies.revalidate(`/events/${parsed.data.eventId}`);
      return {
        status: "success",
        code: "SUCCESS",
        message: "Event resubmitted for review.",
        data: view,
      };
    } catch (error) {
      return actionError(
        error,
        eventErrorMessages,
      ) as ActionState<OrganizerEventSubmissionView>;
    }
  }

  return {
    loadOrganizerEventSubmissionForPage,
    loadRejectedEventCopySource,
    resubmitEventAction,
  };
}
