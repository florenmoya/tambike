"use client";

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircle2Icon,
  Clock3Icon,
  LockKeyholeIcon,
  PauseCircleIcon,
  QrCodeIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  SmartphoneIcon,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  CheckInConfiguration,
  CheckInMode,
  CheckInState,
  Event,
  OrganizerQrMode,
  SelfCheckInQr,
} from "@/features/tambike-demo/types";

export type CheckInPolicyPanelSettings = CheckInConfiguration & {
  fixedQrAcknowledged?: boolean;
};

export type CheckInPolicyPanelSaveInput = Omit<CheckInConfiguration, "fixedQrAcknowledged"> & {
  fixedQrAcknowledged: boolean;
};

type CheckInPolicyPanelProps = {
  event: Event;
  settings: CheckInPolicyPanelSettings;
  pending?: boolean;
  issuedQr?: SelfCheckInQr | null;
  onSave: (input: CheckInPolicyPanelSaveInput) => Promise<void> | void;
  onIssueQr: () => Promise<SelfCheckInQr | null | undefined> | SelfCheckInQr | null | undefined;
};

const modeOptions: Array<{
  value: CheckInMode;
  label: string;
  description: string;
}> = [
  {
    value: "staff_only",
    label: "Staff only",
    description: "Only an authorized organizer, venue operator, or admin can record arrival.",
  },
  {
    value: "self_review",
    label: "Rider request + staff review",
    description: "Riders request arrival; staff scans the rider pass to confirm it.",
  },
  {
    value: "self_instant",
    label: "Rider self-check-in",
    description: "A rider with an active pass is confirmed immediately after scanning the organizer QR.",
  },
];

const stateOptions: Array<{
  value: CheckInState;
  label: string;
  description: string;
  icon: typeof LockKeyholeIcon;
}> = [
  {
    value: "closed",
    label: "Closed",
    description: "Rider QR is unavailable.",
    icon: LockKeyholeIcon,
  },
  {
    value: "open",
    label: "Open",
    description: "Riders can use the organizer QR.",
    icon: CheckCircle2Icon,
  },
  {
    value: "paused",
    label: "Paused",
    description: "Temporarily stop rider QR arrivals.",
    icon: PauseCircleIcon,
  },
];

function toDraft(settings: CheckInPolicyPanelSettings): CheckInPolicyPanelSaveInput {
  return {
    mode: settings.mode,
    state: settings.state,
    qrMode: settings.qrMode,
    fixedQrAcknowledged: Boolean(settings.fixedQrAcknowledged),
  };
}

function isSelfCheckInMode(mode: CheckInMode) {
  return mode !== "staff_only";
}

function subscribeToOrigin() {
  return () => undefined;
}

function getClientOrigin() {
  return window.location.origin;
}

function getServerOrigin() {
  return null;
}

/**
 * Organizer-only controls for the one event entry-point check-in policy.
 * Server authorization and policy enforcement remain the responsibility of the
 * callbacks wired by the event workspace.
 */
export function CheckInPolicyPanel({
  event,
  settings,
  pending = false,
  issuedQr = null,
  onSave,
  onIssueQr,
}: CheckInPolicyPanelProps) {
  const [draft, setDraft] = React.useState<CheckInPolicyPanelSaveInput>(() => toDraft(settings));
  const [localQr, setLocalQr] = React.useState<SelfCheckInQr | null>(null);
  const [issuingQr, setIssuingQr] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [qrError, setQrError] = React.useState<string | null>(null);
  const onIssueQrRef = React.useRef(onIssueQr);
  const issuingQrRef = React.useRef(false);
  const origin = React.useSyncExternalStore(subscribeToOrigin, getClientOrigin, getServerOrigin);

  React.useEffect(() => {
    onIssueQrRef.current = onIssueQr;
  }, [onIssueQr]);

  const requestQr = React.useCallback(async () => {
    if (issuingQrRef.current) {
      return;
    }

    issuingQrRef.current = true;
    setIssuingQr(true);
    setQrError(null);

    try {
      const nextQr = await onIssueQrRef.current();
      if (nextQr) {
        setLocalQr(nextQr);
        return;
      }

      setQrError("The QR could not be issued. Save the policy, then try again.");
    } catch {
      setQrError("The QR could not be issued. Check the event settings and try again.");
    } finally {
      issuingQrRef.current = false;
      setIssuingQr(false);
    }
  }, []);

  const liveSelfCheckIn =
    isSelfCheckInMode(settings.mode) &&
    settings.state === "open" &&
    (settings.qrMode !== "fixed" || Boolean(settings.fixedQrAcknowledged)) &&
    (event.status === "PUBLISHED" || event.status === "ONGOING");

  React.useEffect(() => {
    if (!liveSelfCheckIn) {
      return;
    }

    void requestQr();

    if (settings.qrMode !== "rotating") {
      return;
    }

    const refreshId = window.setInterval(() => {
      void requestQr();
    }, 60_000);

    return () => window.clearInterval(refreshId);
  }, [liveSelfCheckIn, requestQr, settings.qrMode]);

  const activeQr = localQr ?? issuedQr;
  const riderCheckInUrl = React.useMemo(() => {
    if (!origin || !activeQr) {
      return null;
    }

    return `${origin}/check-in/${encodeURIComponent(activeQr.token)}`;
  }, [activeQr, origin]);

  const updateMode = (mode: CheckInMode) => {
    setDraft((current) => {
      if (mode !== "staff_only") {
        return { ...current, mode };
      }

      return {
        ...current,
        mode,
        state: "closed",
        qrMode: "rotating",
        fixedQrAcknowledged: false,
      };
    });
  };

  const updateQrMode = (qrMode: OrganizerQrMode) => {
    setDraft((current) => ({
      ...current,
      qrMode,
      fixedQrAcknowledged: qrMode === "fixed" ? current.fixedQrAcknowledged : false,
    }));
  };

  const savePolicy = async (formEvent: React.FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (pending || (draft.qrMode === "fixed" && !draft.fixedQrAcknowledged)) {
      return;
    }

    setSaveError(null);
    try {
      await onSave({
        ...draft,
        state: draft.mode === "staff_only" ? "closed" : draft.state,
      });
    } catch {
      setSaveError("The check-in policy was not saved. Review the settings and try again.");
    }
  };

  const saveDisabled = pending || (draft.qrMode === "fixed" && !draft.fixedQrAcknowledged);
  const selectedMode = modeOptions.find((option) => option.value === draft.mode);
  const liveMode = modeOptions.find((option) => option.value === settings.mode);

  return (
    <Card className="border-primary/20">
      <CardHeader className="gap-3 border-b bg-muted/20">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <QrCodeIcon data-icon="inline-start" />
            Entry-point check-in
          </Badge>
          <Badge variant={liveSelfCheckIn ? "default" : "outline"}>
            {liveSelfCheckIn ? "Rider QR live" : "Staff scanner ready"}
          </Badge>
        </div>
        <CardTitle>Arrival policy for {event.title}</CardTitle>
        <CardDescription>
          Staff can always scan rider passes. These controls only decide whether riders can request or confirm their own arrival.
        </CardDescription>
      </CardHeader>

      <form onSubmit={savePolicy}>
        <CardContent className="grid gap-6 pt-4">
          <div className="grid gap-2">
            <Label htmlFor={`check-in-mode-${event.id}`}>Who can record arrival?</Label>
            <Select value={draft.mode} onValueChange={(value) => updateMode(value as CheckInMode)} disabled={pending}>
              <SelectTrigger id={`check-in-mode-${event.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex flex-col items-start gap-0.5 py-0.5">
                      <span>{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedMode ? <p className="text-sm text-muted-foreground">{selectedMode.description}</p> : null}
          </div>

          {isSelfCheckInMode(draft.mode) ? (
            <>
              <fieldset className="grid gap-2" disabled={pending}>
                <legend className="text-sm font-medium">Rider QR availability</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {stateOptions.map((option) => {
                    const Icon = option.icon;
                    const selected = draft.state === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setDraft((current) => ({ ...current, state: option.value }))}
                        className={cn(
                          "grid min-h-28 content-start gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                          selected ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50",
                        )}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Icon className="size-4" />
                          {option.label}
                        </span>
                        <span className="text-xs leading-5 text-muted-foreground">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pausing or closing self-check-in never blocks the staff camera, QR upload, or manual-token fallback.
                </p>
              </fieldset>

              <fieldset className="grid gap-2" disabled={pending}>
                <legend className="text-sm font-medium">Organizer QR</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={draft.qrMode === "rotating"}
                    onClick={() => updateQrMode("rotating")}
                    className={cn(
                      "grid gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      draft.qrMode === "rotating" ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <RefreshCwIcon className="size-4" />
                      Rotating QR
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      A new QR is issued every minute and expires shortly after. Best for the event entry point.
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.qrMode === "fixed"}
                    onClick={() => updateQrMode("fixed")}
                    className={cn(
                      "grid gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      draft.qrMode === "fixed" ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <SmartphoneIcon className="size-4" />
                      Fixed QR
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      One shareable event URL. Use only when a forwarded code is acceptable for this event.
                    </span>
                  </button>
                </div>

                {draft.qrMode === "fixed" ? (
                  <div className="flex gap-3 rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <ShieldAlertIcon className="mt-0.5 size-5 shrink-0" />
                    <div className="grid gap-2">
                      <p className="font-medium">A fixed QR can be forwarded.</p>
                      <p className="text-xs leading-5 opacity-90">
                        Anyone holding this code can attempt self-check-in while the policy is open. It cannot prove that a rider is physically at the entry point.
                      </p>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id={`fixed-qr-risk-${event.id}`}
                          checked={draft.fixedQrAcknowledged}
                          onCheckedChange={(checked) =>
                            setDraft((current) => ({ ...current, fixedQrAcknowledged: checked === true }))
                          }
                        />
                        <Label htmlFor={`fixed-qr-risk-${event.id}`} className="cursor-pointer text-xs leading-5">
                          I understand the sharing risk and want to enable a fixed organizer QR.
                        </Label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </fieldset>
            </>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              Rider self-check-in is disabled. Do not display an organizer QR; staff can still scan with the camera, QR image upload, or a manual pass token.
            </div>
          )}

          {saveError ? <p className="text-sm text-destructive" aria-live="polite">{saveError}</p> : null}

          {isSelfCheckInMode(settings.mode) &&
          settings.state === "open" &&
          event.status !== "PUBLISHED" &&
          event.status !== "ONGOING" ? (
            <p className="text-sm text-muted-foreground">
              Rider self-check-in will stay unavailable until this event is published or ongoing. Staff scanning remains available.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saveDisabled}>
              {pending ? "Saving policy..." : "Save check-in policy"}
            </Button>
            {draft.qrMode === "fixed" && !draft.fixedQrAcknowledged ? (
              <p className="text-xs text-muted-foreground">Acknowledge the fixed-QR risk before saving.</p>
            ) : null}
          </div>
        </CardContent>
      </form>

      {liveSelfCheckIn ? (
        <CardContent className="border-t bg-muted/15 pt-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  <Clock3Icon data-icon="inline-start" />
                  {settings.qrMode === "rotating" ? "Refreshes every minute" : "Fixed public event QR"}
                </Badge>
                <Badge variant="outline">{liveMode?.label}</Badge>
              </div>
              <div>
                <h3 className="font-medium">Organizer QR is live</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {settings.mode === "self_review"
                    ? "Riders create a pending arrival request. Staff confirms it by scanning the rider pass."
                    : "Riders with an active pass are confirmed immediately after the explicit check-in tap."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void requestQr()} disabled={pending || issuingQr}>
                  <RefreshCwIcon data-icon="inline-start" className={cn(issuingQr && "animate-spin")} />
                  {issuingQr ? "Refreshing..." : "Refresh QR"}
                </Button>
                {settings.mode !== draft.mode || settings.state !== draft.state || settings.qrMode !== draft.qrMode ? (
                  <p className="text-xs text-muted-foreground">The displayed QR follows the currently saved policy until changes are saved.</p>
                ) : null}
              </div>
              {qrError ? <p className="text-sm text-destructive" aria-live="polite">{qrError}</p> : null}
            </div>

            <div className="grid place-items-center rounded-xl border bg-background p-3 shadow-sm">
              {riderCheckInUrl ? (
                <QRCodeSVG value={riderCheckInUrl} size={184} level="M" includeMargin />
              ) : (
                <div className="grid size-[184px] place-items-center text-center text-xs text-muted-foreground">
                  {issuingQr ? "Issuing QR…" : "QR unavailable"}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
