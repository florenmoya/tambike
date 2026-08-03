"use client";

import * as React from "react";
import Link from "next/link";
import { Dialog } from "radix-ui";

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
  AdminEventReviewView,
  EventReviewHistoryItem,
} from "@/features/admin/event-review-types";
import type { ActionState } from "@/features/shared/action-state";
import { useOptionalDemo } from "@/features/tambike-demo/demo-provider";
import {
  disableEventAction,
  restoreEventAction,
  reviewEventAction,
} from "@/server/admin/event-review-actions";

type ReviewAction =
  | "publish"
  | "request-changes"
  | "reject"
  | "disable"
  | "restore";

type SelectedReviewAction = {
  eventId: string;
  expectedUpdatedAt: string;
  key: string;
  kind: ReviewAction;
};

const idleActionState: ActionState<AdminEventReviewView> = {
  status: "idle",
  message: "",
};

export function EventReviewControls({
  initialView,
}: {
  initialView: AdminEventReviewView;
}) {
  const [view, setView] = React.useState(initialView);
  const [selected, setSelected] = React.useState<SelectedReviewAction | null>(null);
  const [feedback, setFeedback] = React.useState("");
  const [requestPending, setRequestPending] = React.useState(false);
  const pendingRef = React.useRef(false);
  const synchronizePersistedEvent = useOptionalDemo()?.synchronizePersistedEvent;

  const selectAction = (kind: ReviewAction) => {
    if (pendingRef.current) return;
    setFeedback("");
    setSelected({
      eventId: view.event.id,
      expectedUpdatedAt: view.expectedUpdatedAt,
      key: `${kind}:${view.event.id}:${view.expectedUpdatedAt}`,
      kind,
    });
  };
  const startRequest = React.useCallback((origin: SelectedReviewAction) => {
    if (selected?.key !== origin.key) return false;
    if (pendingRef.current) return true;
    pendingRef.current = true;
    setRequestPending(true);
    return true;
  }, [selected]);
  const settleRequest = React.useCallback((origin: SelectedReviewAction) => {
    if (selected?.key === origin.key) {
      pendingRef.current = false;
      setRequestPending(false);
    }
  }, [selected]);
  const commitRequest = React.useCallback(
    (origin: SelectedReviewAction, nextView: AdminEventReviewView, message: string) => {
      if (selected?.key !== origin.key) return;
      pendingRef.current = false;
      setRequestPending(false);
      setView(nextView);
      synchronizePersistedEvent?.(nextView.event);
      setFeedback(message);
      setSelected(null);
    },
    [selected, synchronizePersistedEvent],
  );
  const cancelRequest = React.useCallback((origin: SelectedReviewAction) => {
    if (pendingRef.current || selected?.key !== origin.key) return;
    setSelected(null);
  }, [selected]);

  const status = view.event.status;
  const latestReason = [...view.history]
    .reverse()
    .find((item) => item.reason)?.reason;

  return (
    <div className="grid min-w-0 gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,390px)] lg:px-6">
      <div className="grid min-w-0 gap-4">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Event review</Badge>
              <Badge variant="outline">{formatStatus(status)}</Badge>
            </div>
            <CardTitle className="break-words text-pretty text-2xl">
              {view.event.title}
            </CardTitle>
            <CardDescription className="break-words">
              Submitted by {view.organizerName}. Review the event details before choosing an action.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ReviewFact label="Type" value={view.event.type} />
              <ReviewFact label="Date" value={view.event.date} />
              <ReviewFact label="Location" value={view.event.locationName} />
              <ReviewFact
                label="Expected riders"
                value={new Intl.NumberFormat("en-PH").format(view.event.expectedRiders)}
              />
            </dl>
            <div className="grid gap-2">
              <h2 className="text-sm font-semibold">Event details</h2>
              <p className="break-words text-sm leading-6 text-muted-foreground">
                {view.event.shortDescription}
              </p>
              <p className="break-words text-sm leading-6 text-muted-foreground">
                {view.event.locationAddress}
              </p>
            </div>
          </CardContent>
        </Card>
        <ReviewHistory history={view.history} />
      </div>

      <Card className="h-fit min-w-0 lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>{reviewPanelTitle(status)}</CardTitle>
          <CardDescription>{reviewPanelDescription(status)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {status === "PENDING_ADMIN_REVIEW" ? (
            <>
              <Button
                type="button"
                className="min-h-11"
                disabled={requestPending}
                onClick={() => selectAction("publish")}
              >
                Approve and publish
              </Button>
              <Button
                type="button"
                className="min-h-11"
                variant="outline"
                disabled={requestPending}
                onClick={() => selectAction("request-changes")}
              >
                Request changes
              </Button>
              <Button
                type="button"
                className="min-h-11"
                variant="destructive"
                disabled={requestPending}
                onClick={() => selectAction("reject")}
              >
                Reject submission
              </Button>
            </>
          ) : null}
          {status === "PUBLISHED" ? (
            <Button
              type="button"
              className="min-h-11"
              variant="destructive"
              disabled={requestPending}
              onClick={() => selectAction("disable")}
            >
              Disable event
            </Button>
          ) : null}
          {status === "DISABLED" ? (
            <Button
              type="button"
              className="min-h-11"
              disabled={requestPending}
              onClick={() => selectAction("restore")}
            >
              Restore to review
            </Button>
          ) : null}
          {status === "NEEDS_CHANGES" || status === "REJECTED" ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {status === "NEEDS_CHANGES" ? "Changes requested" : "Submission rejected"}
              </p>
              {latestReason ? (
                <p className="mt-1 break-words text-muted-foreground">{latestReason}</p>
              ) : null}
            </div>
          ) : null}
          <Button asChild className="min-h-11" variant="outline">
            <Link href="/admin/events/review">Back to review queue</Link>
          </Button>
          <p
            aria-live="polite"
            className={feedback ? "text-sm text-emerald-700 dark:text-emerald-300" : "sr-only"}
          >
            {feedback}
          </p>
        </CardContent>
      </Card>

      {selected ? (
        <ReviewActionDialog
          key={selected.key}
          onCancel={cancelRequest}
          onCommitted={commitRequest}
          onSettled={settleRequest}
          onStarted={startRequest}
          selected={selected}
        />
      ) : null}
    </div>
  );
}

function ReviewActionDialog({
  onCancel,
  onCommitted,
  onSettled,
  onStarted,
  selected,
}: {
  onCancel(origin: SelectedReviewAction): void;
  onCommitted(
    origin: SelectedReviewAction,
    view: AdminEventReviewView,
    message: string,
  ): void;
  onSettled(origin: SelectedReviewAction): void;
  onStarted(origin: SelectedReviewAction): boolean;
  selected: SelectedReviewAction;
}) {
  const action = getServerAction(selected.kind);
  const submitAction = React.useCallback(
    async (
      previous: ActionState<AdminEventReviewView>,
      formData: FormData,
    ): Promise<ActionState<AdminEventReviewView>> => {
      if (!onStarted(selected)) return previous;
      try {
        const result = await action(previous, formData);
        if (result.status === "success") {
          onCommitted(selected, result.data, result.message);
        } else {
          onSettled(selected);
        }
        return result;
      } catch (error) {
        onSettled(selected);
        throw error;
      }
    },
    [action, onCommitted, onSettled, onStarted, selected],
  );
  const [state, formAction, pending] = React.useActionState(
    submitAction,
    idleActionState,
  );
  const config = actionDialogConfig(selected.kind);
  const needsReason = selected.kind !== "publish";
  const reasonError =
    state.status === "error" ? state.fieldErrors?.reason?.[0] : undefined;
  const reasonRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (reasonError) reasonRef.current?.focus();
  }, [reasonError]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel(selected)}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-radix-dialog-overlay
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl border bg-background p-5 text-foreground shadow-2xl outline-none sm:p-6"
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          onInteractOutside={(event) => pending && event.preventDefault()}
          onPointerDownOutside={(event) => pending && event.preventDefault()}
        >
          <Dialog.Title className="text-pretty text-lg font-semibold">
            {config.title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {config.description}
          </Dialog.Description>
          <form
            action={formAction}
            className="mt-5 grid gap-4"
            onSubmitCapture={() => onStarted(selected)}
          >
            <input type="hidden" name="eventId" value={selected.eventId} />
            <input
              type="hidden"
              name="expectedUpdatedAt"
              value={selected.expectedUpdatedAt}
            />
            {config.decision ? (
              <input type="hidden" name="decision" value={config.decision} />
            ) : null}
            {needsReason ? (
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="event-review-reason">
                  {config.reasonLabel}
                </label>
                <textarea
                  ref={reasonRef}
                  id="event-review-reason"
                  name="reason"
                  required
                  minLength={10}
                  maxLength={500}
                  rows={5}
                  disabled={pending}
                  autoComplete="off"
                  aria-invalid={Boolean(reasonError)}
                  aria-describedby={
                    reasonError
                      ? "event-review-reason-help event-review-reason-error event-review-result"
                      : "event-review-reason-help event-review-result"
                  }
                  className="min-h-28 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
                  placeholder={config.placeholder}
                />
                <p id="event-review-reason-help" className="text-xs text-muted-foreground">
                  Enter 10–500 characters. This note appears in the event review history.
                </p>
                {reasonError ? (
                  <p id="event-review-reason-error" className="text-sm text-destructive">
                    {reasonError}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p
              id="event-review-result"
              aria-live="polite"
              className={
                state.status === "error"
                  ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  : "sr-only"
              }
            >
              {state.message}
            </p>
            {state.status === "error" && state.code === "CONFLICT" ? (
              <Button asChild className="min-h-11" variant="outline">
                <a href={`/admin/events/review/${selected.eventId}`}>Reload event</a>
              </Button>
            ) : null}
            <div className="grid gap-2 sm:flex sm:justify-end">
              <Button
                type="button"
                className="min-h-11"
                variant="outline"
                disabled={pending}
                onClick={() => onCancel(selected)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                variant={config.destructive ? "destructive" : "default"}
                disabled={pending}
              >
                {pending ? config.pendingLabel : config.submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function getServerAction(kind: ReviewAction) {
  if (kind === "disable") return disableEventAction;
  if (kind === "restore") return restoreEventAction;
  return reviewEventAction;
}

function actionDialogConfig(kind: ReviewAction) {
  if (kind === "publish") {
    return {
      decision: "PUBLISH" as const,
      description: "The event will appear publicly and riders can register.",
      destructive: false,
      pendingLabel: "Publishing…",
      placeholder: "",
      reasonLabel: "",
      submitLabel: "Approve and publish",
      title: "Publish this event?",
    };
  }
  if (kind === "request-changes") {
    return {
      decision: "REQUEST_CHANGES" as const,
      description: "Tell the organizer exactly what to update before another review.",
      destructive: false,
      pendingLabel: "Requesting changes…",
      placeholder: "Explain what the organizer must update",
      reasonLabel: "Requested changes",
      submitLabel: "Request changes",
      title: "Request changes",
    };
  }
  if (kind === "reject") {
    return {
      decision: "REJECT" as const,
      description: "This submission cannot be resubmitted. The organizer can copy its details into a new event.",
      destructive: true,
      pendingLabel: "Rejecting…",
      placeholder: "Explain why this submission cannot proceed",
      reasonLabel: "Rejection reason",
      submitLabel: "Reject submission",
      title: "Reject this submission?",
    };
  }
  if (kind === "disable") {
    return {
      decision: undefined,
      description: "The public listing will be hidden and new registrations will stop.",
      destructive: true,
      pendingLabel: "Disabling…",
      placeholder: "Explain why the event must be hidden",
      reasonLabel: "Disable reason",
      submitLabel: "Disable event",
      title: "Disable this event?",
    };
  }
  return {
    decision: undefined,
    description: "The event returns to admin review and stays hidden until it is approved again.",
    destructive: false,
    pendingLabel: "Restoring…",
    placeholder: "Explain why the event can return to review",
    reasonLabel: "Restore reason",
    submitLabel: "Restore to review",
    title: "Restore this event to review?",
  };
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function ReviewHistory({ history }: { history: EventReviewHistoryItem[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Review history</CardTitle>
        <CardDescription>Submission decisions for this event.</CardDescription>
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
                {item.reviewerName ? (
                  <p className="mt-1 text-sm text-muted-foreground">By {item.reviewerName}</p>
                ) : null}
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

function reviewPanelTitle(status: AdminEventReviewView["event"]["status"]) {
  if (status === "PENDING_ADMIN_REVIEW") return "Review decision";
  if (status === "PUBLISHED") return "Published event";
  if (status === "DISABLED") return "Disabled event";
  if (status === "NEEDS_CHANGES") return "Changes requested";
  if (status === "REJECTED") return "Submission rejected";
  return "Event status";
}

function reviewPanelDescription(status: AdminEventReviewView["event"]["status"]) {
  if (status === "PENDING_ADMIN_REVIEW") return "Choose one decision after reviewing the event.";
  if (status === "PUBLISHED") return "This event is visible to riders.";
  if (status === "DISABLED") return "This event is hidden from riders.";
  if (status === "NEEDS_CHANGES") return "The organizer must update and resubmit the event.";
  if (status === "REJECTED") return "This submission is closed.";
  return "No review action is available.";
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
