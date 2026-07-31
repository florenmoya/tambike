"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  Loader2Icon,
  LogInIcon,
  MapPinIcon,
  ShieldCheckIcon,
  TicketCheckIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getSelfCheckInContextAction, selfCheckInAction } from "@/server/actions";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import type {
  SelfCheckInActionResult,
  SelfCheckInContext,
} from "@/features/tambike-demo/types";

type RiderSelfCheckInScreenProps = {
  token: string;
};

export function RiderSelfCheckInScreen({ token }: RiderSelfCheckInScreenProps) {
  const { currentUser, applyServerState } = useDemo();
  const [context, setContext] = React.useState<SelfCheckInContext | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [result, setResult] = React.useState<SelfCheckInActionResult | null>(null);
  const [submitError, setSubmitError] = React.useState("");
  const [isSubmitting, startSubmitting] = React.useTransition();

  React.useEffect(() => {
    let cancelled = false;

    void getSelfCheckInContextAction(token)
      .then((nextResult) => {
        if (!cancelled) {
          if (nextResult.ok) {
            setContext(nextResult.context);
            setLoadError("");
          } else {
            setContext(null);
            setLoadError(nextResult.body);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("This check-in link is no longer valid. Ask event staff for help at the entrance.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const submitSelfCheckIn = React.useCallback(() => {
    if (!context?.available || isSubmitting) {
      return;
    }

    setSubmitError("");
    startSubmitting(async () => {
      try {
        const nextResult = await selfCheckInAction(token);
        applyServerState(nextResult.state);
        setResult(nextResult);
      } catch {
        setSubmitError("We could not complete check-in. Keep this page open and ask event staff for help.");
      }
    });
  }, [applyServerState, context?.available, isSubmitting, token]);

  const loginHref = `/login?next=${encodeURIComponent(`/check-in/${encodeURIComponent(token)}`)}`;
  const isComplete = result?.status === "confirmed" || result?.status === "pending";
  const needsLogin = !currentUser || result?.code === "UNAUTHENTICATED";
  const hasNonRiderAccount = Boolean(currentUser && currentUser.role !== "rider");

  return (
    <main className="min-h-dvh bg-muted/30 px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-lg gap-4">
        <div className="flex items-center justify-between px-1 text-sm">
          <Link href="/" className="font-semibold tracking-tight text-foreground">
            Tambike
          </Link>
          <span className="text-muted-foreground">Event check-in</span>
        </div>

        {!context && !loadError ? <LoadingCard /> : null}

        {loadError ? (
          <StatusCard
            tone="error"
            icon={<AlertTriangleIcon className="size-5" />}
            title="Check-in link unavailable"
            body={loadError}
          />
        ) : null}

        {context ? (
          <>
            <Card>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={context.available ? "secondary" : "outline"}>
                    <TicketCheckIcon data-icon="inline-start" />
                    {checkInModeLabel(context.mode)}
                  </Badge>
                  <Badge variant="outline">{checkInStateLabel(context.state)}</Badge>
                </div>
                <div className="grid gap-1">
                  <CardTitle className="text-xl leading-tight">{context.event.title}</CardTitle>
                  <CardDescription>{context.event.type}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Clock3Icon className="size-4 shrink-0" />
                    <span>{context.event.date} · {context.event.time}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPinIcon className="size-4 shrink-0" />
                    <span>{context.event.area}</span>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  You are checking in at the event entry point. Perks remain a separate, staff-led redemption step.
                </p>
              </CardContent>
            </Card>

            {isComplete && result ? <CompletedCheckInCard result={result} /> : null}

            {!isComplete && result?.code === "UNAUTHENTICATED" ? (
              <LoginRequiredCard href={loginHref} body={result.body} />
            ) : null}

            {!isComplete && result && result.code !== "UNAUTHENTICATED" ? (
              <StatusCard
                tone="error"
                icon={<CircleAlertIcon className="size-5" />}
                title={result.title}
                body={result.body}
              />
            ) : null}

            {submitError ? (
              <StatusCard
                tone="error"
                icon={<CircleAlertIcon className="size-5" />}
                title="Check-in could not be completed"
                body={submitError}
              />
            ) : null}

            {!context.available ? <UnavailableCheckInCard context={context} /> : null}

            {context.available && !isComplete && !result && !submitError ? (
              needsLogin ? (
                <LoginRequiredCard
                  href={loginHref}
                  body="Log in with the account that holds this event pass, then return here to confirm your arrival."
                />
              ) : hasNonRiderAccount ? (
                <StatusCard
                  tone="muted"
                  icon={<ShieldCheckIcon className="size-5" />}
                  title="Account required"
                  body="Self check-in is limited to the account that owns the active Tambike Pass."
                />
              ) : (
                <ConfirmCheckInCard
                  mode={context.mode}
                  pending={isSubmitting}
                  onConfirm={submitSelfCheckIn}
                />
              )
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        <div>
          <div className="font-medium">Opening check-in</div>
          <p className="mt-1 text-sm text-muted-foreground">Validating this event QR code.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ConfirmCheckInCard({
  mode,
  pending,
  onConfirm,
}: {
  mode: SelfCheckInContext["mode"];
  pending: boolean;
  onConfirm: () => void;
}) {
  const requiresReview = mode === "self_review";

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle>{requiresReview ? "Request staff confirmation" : "Confirm your arrival"}</CardTitle>
        <CardDescription>
          {requiresReview
            ? "This creates an arrival request. Staff will confirm it after scanning your Tambike Pass."
            : "This confirms that you have arrived at the event entry point."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
          <span>Only use this QR while you are at the event. A check-in cannot be transferred to another rider.</span>
        </div>
        <Button type="button" size="lg" onClick={onConfirm} disabled={pending} className="w-full">
          {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <TicketCheckIcon data-icon="inline-start" />}
          {pending
            ? "Confirming arrival…"
            : requiresReview
              ? "Request staff confirmation"
              : "Confirm my arrival"}
        </Button>
      </CardContent>
    </Card>
  );
}

function LoginRequiredCard({ href, body }: { href: string; body: string }) {
  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle>Log in to check in</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild size="lg" className="w-full">
          <Link href={href}>
            <LogInIcon data-icon="inline-start" />
            Log in to check in
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function UnavailableCheckInCard({ context }: { context: SelfCheckInContext }) {
  const { title, body } = unavailableCopy(context);

  return (
    <StatusCard
      tone="muted"
      icon={<ShieldCheckIcon className="size-5" />}
      title={title}
      body={body}
    />
  );
}

function CompletedCheckInCard({ result }: { result: SelfCheckInActionResult }) {
  const pending = result.status === "pending";

  return (
    <StatusCard
      tone={pending ? "pending" : "success"}
      icon={pending ? <Clock3Icon className="size-5" /> : <CheckCircle2Icon className="size-5" />}
      title={pending ? "Awaiting staff confirmation" : "Checked in"}
      body={
        pending
          ? "Show this screen to staff. They can scan your Tambike Pass to confirm your arrival."
          : "Your arrival is confirmed. Event perks, when available, are redeemed separately with staff."
      }
    />
  );
}

function StatusCard({
  tone,
  icon,
  title,
  body,
}: {
  tone: "success" | "pending" | "error" | "muted";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card
      className={cn(
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-950",
        tone === "pending" && "border-amber-200 bg-amber-50 text-amber-950",
        tone === "error" && "border-destructive/20 bg-destructive/5 text-destructive",
      )}
    >
      <CardContent className="flex gap-3">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div>
          <div className="font-medium" aria-live="polite">{title}</div>
          <p className={cn("mt-1 text-sm", tone === "muted" && "text-muted-foreground")}>{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function unavailableCopy(context: SelfCheckInContext) {
  if (context.mode === "staff_only") {
    return {
      title: "Staff check-in only",
      body: "A staff member must scan your Tambike Pass at the entrance. This QR cannot check riders in.",
    };
  }

  if (context.state === "paused") {
    return {
      title: "Self check-in is paused",
      body: "Keep your Tambike Pass ready. Event staff can still check you in at the entrance.",
    };
  }

  if (context.state === "closed") {
    return {
      title: "Self check-in is closed",
      body: "Event staff can still scan your Tambike Pass at the entrance.",
    };
  }

  return {
    title: "Self check-in is unavailable",
    body: "This event is not accepting rider self check-ins right now. Ask event staff for help at the entrance.",
  };
}

function checkInModeLabel(mode: SelfCheckInContext["mode"]) {
  switch (mode) {
    case "self_review":
      return "Staff review";
    case "self_instant":
      return "Rider check-in";
    default:
      return "Staff only";
  }
}

function checkInStateLabel(state: SelfCheckInContext["state"]) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}
