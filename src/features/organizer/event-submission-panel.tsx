"use client";

import * as React from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  EventReviewHistoryItem,
  OrganizerEventSubmissionView,
} from "@/features/admin/event-review-types";
import type { ActionState } from "@/features/shared/action-state";
import { EventEditorFields } from "@/features/organizer/event-editor-fields";
import type { CreateEventInput, Event } from "@/features/tambike-demo/types";
import { useOptionalDemo } from "@/features/tambike-demo/demo-provider";
import { resubmitEventAction } from "@/server/organizer/event-submission-actions";

const idleActionState: ActionState<OrganizerEventSubmissionView> = {
  status: "idle",
  message: "",
};

export function EventSubmissionPanel({
  initialView,
}: {
  initialView: OrganizerEventSubmissionView;
}) {
  const [view, setView] = React.useState(initialView);
  const synchronizePersistedEvent = useOptionalDemo()?.synchronizePersistedEvent;
  const submitAction = React.useCallback(
    async (
      previous: ActionState<OrganizerEventSubmissionView>,
      formData: FormData,
    ): Promise<ActionState<OrganizerEventSubmissionView>> => {
      const result = await resubmitEventAction(previous, formData);
      if (result.status === "success") {
        setView(result.data);
        synchronizePersistedEvent?.(result.data.event);
      }
      return result;
    },
    [synchronizePersistedEvent],
  );
  const [state, formAction, pending] = React.useActionState(
    submitAction,
    idleActionState,
  );
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (state.status !== "error") return;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [state]);
  const status = view.event.status;
  const latestReason = view.latestDecision?.reason;

  return (
    <div className="grid min-w-0 gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,390px)] lg:px-6">
      <div className="grid min-w-0 gap-4">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Event submission</Badge>
              <Badge variant="outline">{formatStatus(status)}</Badge>
            </div>
            <CardTitle className="break-words text-pretty text-2xl">
              {view.event.title}
            </CardTitle>
            <CardDescription className="break-words">
              {view.event.type} · {view.event.locationName} · {view.event.date}
            </CardDescription>
          </CardHeader>
          {status === "NEEDS_CHANGES" ? (
            <CardContent>
              <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                <h2 className="font-semibold">Changes requested</h2>
                <p className="mt-1 break-words text-sm leading-6">
                  {latestReason ?? "Review the event details and address the requested updates."}
                </p>
              </div>
            </CardContent>
          ) : null}
          {status === "REJECTED" ? (
            <CardContent>
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                <h2 className="font-semibold">Submission rejected</h2>
                <p className="mt-1 break-words text-sm leading-6">
                  {latestReason ?? "This submission is closed."}
                </p>
              </div>
            </CardContent>
          ) : null}
        </Card>

        {status === "NEEDS_CHANGES" ? (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Update event</CardTitle>
              <CardDescription>
                Update the complete event listing, explain what changed, then send it back for review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                key={view.expectedUpdatedAt}
                ref={formRef}
                action={formAction}
                className="grid gap-5"
              >
                <input type="hidden" name="eventId" value={view.event.id} />
                <input
                  type="hidden"
                  name="expectedUpdatedAt"
                  value={view.expectedUpdatedAt}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <EventEditorFields
                    idPrefix="resubmit-event"
                    defaults={eventToEditorDefaults(view.event)}
                    disabled={pending}
                    fieldErrors={state.status === "error" ? state.fieldErrors : undefined}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="resubmit-event-reason">
                    What changed?
                  </label>
                  <textarea
                    id="resubmit-event-reason"
                    name="reason"
                    required
                    minLength={10}
                    maxLength={500}
                    rows={5}
                    disabled={pending}
                    autoComplete="off"
                    aria-invalid={Boolean(
                      state.status === "error" && state.fieldErrors?.reason,
                    )}
                    aria-describedby="resubmit-event-reason-help resubmit-event-result"
                    className="min-h-28 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
                    placeholder="Describe the updates you made"
                  />
                  <p id="resubmit-event-reason-help" className="text-xs text-muted-foreground">
                    Enter 10–500 characters so the reviewer can find the updates quickly.
                  </p>
                </div>
                <p
                  id="resubmit-event-result"
                  aria-live="polite"
                  className={
                    state.status === "error"
                      ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                      : state.status === "success"
                        ? "rounded-lg border border-emerald-300/50 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                        : "sr-only"
                  }
                >
                  {state.message}
                </p>
                {state.status === "error" && state.code === "CONFLICT" ? (
                  <Button asChild className="min-h-11" variant="outline">
                    <a href={`/organizer/events/${view.event.id}`}>Reload event</a>
                  </Button>
                ) : null}
                <div className="grid gap-2 sm:flex sm:items-center">
                  <Button type="submit" className="min-h-11" disabled={pending}>
                    {pending ? "Updating and resubmitting…" : "Update and resubmit"}
                  </Button>
                  <Button asChild className="min-h-11" variant="outline">
                    <Link href="/organizer/events">Back to events</Link>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {status !== "NEEDS_CHANGES" ? (
          <SubmissionStatus
            view={view}
            message={state.status === "success" ? state.message : undefined}
          />
        ) : null}
      </div>

      <div className="grid h-fit min-w-0 gap-4 lg:sticky lg:top-24">
        {status === "REJECTED" ? (
          <Card>
            <CardHeader>
              <CardTitle>Start a new submission</CardTitle>
              <CardDescription>
                Copy the event details into a clean form and review them before creating a new draft.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="min-h-11 w-full">
                <Link
                  className="!text-primary-foreground"
                  href={`/organizer/events/create?copy=${view.event.id}`}
                >
                  Create a new event from these details
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <SubmissionHistory history={view.history} />
      </div>
    </div>
  );
}

function SubmissionStatus({
  message,
  view,
}: {
  message?: string;
  view: OrganizerEventSubmissionView;
}) {
  const status = view.event.status;
  const copy =
    status === "PENDING_ADMIN_REVIEW"
      ? {
          title: "Pending review",
          body: "Tambike is reviewing this submission. Editing is unavailable until a reviewer requests changes.",
        }
      : status === "PUBLISHED"
        ? {
            title: "Published",
            body: "This event is visible to riders.",
          }
        : status === "DISABLED"
          ? {
              title: "Event disabled",
              body: "This event is hidden from riders while Tambike reviews it.",
            }
          : status === "REJECTED"
            ? {
                title: "Submission closed",
                body: "This submission cannot be resubmitted.",
              }
            : {
                title: formatStatus(status),
                body: "No editing action is available for this event.",
              };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.body}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          aria-live="polite"
          className={
            message
              ? "mb-3 rounded-lg border border-emerald-300/50 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
              : "sr-only"
          }
        >
          {message}
        </p>
        <Button asChild className="min-h-11" variant="outline">
          <Link href="/organizer/events">Back to events</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function SubmissionHistory({ history }: { history: EventReviewHistoryItem[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Review history</CardTitle>
        <CardDescription>Submission updates and review decisions.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length ? (
          <ol className="grid gap-3">
            {history.map((item) => (
              <li
                key={`${item.submissionVersion}:${item.submittedAt}`}
                className="min-w-0 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    Version {new Intl.NumberFormat("en-PH").format(item.submissionVersion)} · {formatDecision(item.decision)}
                  </span>
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={item.decidedAt ?? item.submittedAt}
                  >
                    {formatMoment(item.decidedAt ?? item.submittedAt)}
                  </time>
                </div>
                {item.reason ? (
                  <p className="mt-2 break-words text-sm leading-6">{item.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No review decisions yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function eventToEditorDefaults(event: Event): CreateEventInput {
  const timeZone = event.timeZone ?? "Asia/Manila";
  const start = event.startsAt
    ? localParts(event.startsAt, timeZone)
    : { date: "", time: "" };
  const end = event.endsAt
    ? localParts(event.endsAt, timeZone)
    : { date: "", time: "" };
  const recurrenceEnd = event.recurrenceEndsAt
    ? localParts(event.recurrenceEndsAt, timeZone).date
    : undefined;
  return {
    title: event.title,
    type: event.type,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timeZone,
    recurrence: event.recurrence ?? "NONE",
    ...(recurrenceEnd ? { recurrenceEndsOn: recurrenceEnd } : {}),
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    ...(event.locationMapLink ? { locationMapLink: event.locationMapLink } : {}),
    area: event.area,
    expectedRiders: event.expectedRiders,
    perkPreview: event.perkPreview,
  };
}

function localParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

function formatDecision(decision: EventReviewHistoryItem["decision"]) {
  return decision.replaceAll("_", " ");
}

function formatMoment(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recorded";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}
