"use client";

import * as React from "react";
import {
  ExternalLinkIcon,
  FastForwardIcon,
  Maximize2Icon,
  MonitorUpIcon,
  RotateCcwIcon,
  SkipForwardIcon,
  Volume2Icon,
  VolumeXIcon,
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
import {
  GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
  GIVEAWAY_PRESENTATION_HEARTBEAT_INTERVAL_MS,
  getGiveawayPresentationChannelName,
  isGiveawayPresentationStageDisconnected,
  parseGiveawayPresentationControllerStateMessage,
  type GiveawayPresentationControllerStateMessage,
} from "./giveaway-presentation-channel";
import {
  GIVEAWAY_PRESENTATION_STAGE_WINDOW_NAME,
  buildGiveawayPresentationStageUrl,
  createGiveawayPresentationWinnerChimePlayer,
  getGiveawayPresentationKeyboardEventIntent,
  getMatchingGiveawayPresentationChannelId,
  getPrefersReducedGiveawayMotion,
  openOrFocusGiveawayPresentationStage,
  resolveGiveawayPresentationControllerConnection,
  resolveGiveawayPresentationStagePulse,
  tryGiveawayPresentationFullscreen,
  type GiveawayPresentationWindowProxy,
  type GiveawayPresentationWinnerChimePlayer,
  type GiveawayPresentationChannelIdentity,
} from "./giveaway-presentation-browser";
import {
  GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS,
  getGiveawayPresentationSessionKey,
  reduceGiveawayPresentationRuntime,
  restoreGiveawayPresentationSessionState,
  serializeGiveawayPresentationSessionState,
  type GiveawayPresentationRuntimeEvent,
  type GiveawayPresentationRuntimeState,
} from "./giveaway-presentation-runtime";
import type { OrganizerGiveawayPresentation } from "./types";

export type GiveawayPresentationManualSelectionGate = "checking" | "blocked" | "clear";

export type GiveawayPresentationControllerProps = {
  eventId: string;
  giveawayId: string;
  presentation: OrganizerGiveawayPresentation;
  manualSelectionGate: GiveawayPresentationManualSelectionGate;
  completedDrawPublishable: boolean;
  pending: boolean;
  onPublish: () => Promise<boolean>;
  onRuntimeStateChange?: (state: GiveawayPresentationRuntimeState) => void;
};

type PublicationGateInput = Pick<
  GiveawayPresentationControllerProps,
  "presentation" | "manualSelectionGate" | "completedDrawPublishable" | "pending"
> & {
  state: GiveawayPresentationRuntimeState;
  publicationSucceeded: boolean;
};

export function canPublishGiveawayPresentation(input: PublicationGateInput) {
  return (
    input.presentation.drawStatus === "completed" &&
    input.state.phase === "complete" &&
    input.manualSelectionGate === "clear" &&
    input.completedDrawPublishable &&
    !input.publicationSucceeded &&
    !input.pending
  );
}

export function canResetGiveawayPresentation(state: GiveawayPresentationRuntimeState) {
  return state.phase !== "spinning";
}

export type GiveawayPresentationOperationIdentity = {
  identity: string;
  token: number;
};

export function isGiveawayPresentationOperationCurrent(
  started: GiveawayPresentationOperationIdentity,
  current: GiveawayPresentationOperationIdentity | null,
) {
  return (
    current !== null &&
    started.identity === current.identity &&
    started.token === current.token
  );
}

export function getGiveawayPresentationControllerViewModel(
  state: GiveawayPresentationRuntimeState,
  slideCount: number,
) {
  const canReveal = state.phase === "ready" && slideCount > 0;
  const canSkip = state.phase === "spinning";
  const canNext = state.phase === "winner" && state.slideIndex < slideCount - 1;
  return {
    mode: state.mode,
    canReveal,
    canSkip,
    canNext,
    complete: state.phase === "complete",
    published: state.phase === "published",
    primaryAction: canReveal ? "reveal" : canSkip ? "skip" : canNext ? "next" : null,
  } as const;
}

export type GiveawayPresentationControllerViewProps = PublicationGateInput & {
  connected: boolean;
  popupBlocked: boolean;
  stageUrl: string;
  publishError: string | null;
  onOpenStage: () => boolean | void;
  onModeChange: (mode: GiveawayPresentationRuntimeState["mode"]) => void;
  onSoundChange: (enabled: boolean) => void;
  onFullscreen: () => void;
  onReveal: () => void;
  onSkip: () => void;
  onNext: () => void;
  onRestart: () => void;
  onInstantReplay: () => void;
  onPublish: () => void;
};

export function GiveawayPresentationControllerView({
  presentation,
  state,
  connected,
  popupBlocked,
  stageUrl,
  manualSelectionGate,
  completedDrawPublishable,
  pending,
  publicationSucceeded,
  publishError,
  onOpenStage,
  onModeChange,
  onSoundChange,
  onFullscreen,
  onReveal,
  onSkip,
  onNext,
  onRestart,
  onInstantReplay,
  onPublish,
}: GiveawayPresentationControllerViewProps) {
  const viewModel = getGiveawayPresentationControllerViewModel(
    state,
    presentation.slides.length,
  );
  const canPublish = canPublishGiveawayPresentation({
    presentation,
    state,
    manualSelectionGate,
    completedDrawPublishable,
    pending,
    publicationSucceeded,
  });
  const lastRevealedIndex =
    state.phase === "complete" || state.phase === "published"
      ? presentation.slides.length - 1
      : state.phase === "winner"
        ? state.slideIndex
        : state.slideIndex - 1;
  const revealed = presentation.slides.slice(0, Math.max(0, lastRevealedIndex + 1));
  const upcoming = presentation.slides.slice(state.slideIndex + 1);
  const currentSlide = presentation.slides[state.slideIndex];
  const canReset = canResetGiveawayPresentation(state);

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>Live raffle presentation</CardTitle>
            <CardDescription>
              Reveal {presentation.slides.length} server-selected winner
              {presentation.slides.length === 1 ? "" : "s"} without rerunning the draw.
            </CardDescription>
          </div>
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected ? "Stage connected" : "Stage disconnected"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onOpenStage} disabled={!stageUrl || pending}>
            <MonitorUpIcon data-icon="inline-start" />
            Open stage
          </Button>
          <Button type="button" variant="outline" onClick={onFullscreen} disabled={!stageUrl || pending}>
            <Maximize2Icon data-icon="inline-start" />
            Fullscreen stage
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onSoundChange(!state.soundEnabled)}
            aria-pressed={state.soundEnabled}
            disabled={pending}
          >
            {state.soundEnabled ? (
              <Volume2Icon data-icon="inline-start" />
            ) : (
              <VolumeXIcon data-icon="inline-start" />
            )}
            Sound {state.soundEnabled ? "on" : "off"}
          </Button>
        </div>

        {popupBlocked && stageUrl ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            The stage popup was blocked.{" "}
            <GiveawayPresentationStageFallbackLink
              stageUrl={stageUrl}
              onOpenStage={onOpenStage}
            />
          </div>
        ) : null}

        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="mb-2 text-sm font-medium">Reveal speed</legend>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={state.mode === "normal" ? "default" : "outline"}
              aria-pressed={state.mode === "normal"}
              onClick={() => onModeChange("normal")}
            >
              Normal · 6 seconds
            </Button>
            <Button
              type="button"
              variant={state.mode === "instant" ? "default" : "outline"}
              aria-pressed={state.mode === "instant"}
              onClick={() => onModeChange("instant")}
            >
              <FastForwardIcon data-icon="inline-start" />
              Instant
            </Button>
          </div>
        </fieldset>

        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {state.phase === "published"
                ? "Presentation published"
                : `Prize ${Math.min(state.slideIndex + 1, presentation.slides.length)} of ${presentation.slides.length}`}
            </p>
            <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {state.phase.replaceAll("_", " ")}
            </span>
          </div>
          {currentSlide ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{currentSlide.prizePoolTitle}</span>
              <span aria-hidden="true"> · </span>
              <strong>{currentSlide.prizeItemTitle}</strong>
            </p>
          ) : null}
          {viewModel.canReveal ? (
            <Button type="button" onClick={onReveal} disabled={!connected || pending}>
              Reveal winner
            </Button>
          ) : null}
          {viewModel.canSkip ? (
            <Button type="button" onClick={onSkip} disabled={pending}>
              <SkipForwardIcon data-icon="inline-start" />
              Skip Current
            </Button>
          ) : null}
          {viewModel.canNext ? (
            <Button type="button" onClick={onNext} disabled={!connected || pending}>
              Next prize
            </Button>
          ) : null}
          {!connected && (viewModel.canReveal || viewModel.canNext) ? (
            <p className="text-sm text-destructive">
              Reconnect the stage before starting the next reveal.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="grid content-start gap-2">
            <h3 className="text-sm font-medium">Revealed winners</h3>
            {revealed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No winner has been revealed yet.</p>
            ) : (
              <ol className="grid gap-2 text-sm">
                {revealed.map((slide) => (
                  <li key={slide.position} className="rounded-md border p-2.5">
                    <span className="block text-xs text-muted-foreground">
                      {slide.prizePoolTitle} · {slide.prizeItemTitle}
                    </span>
                    <strong>{slide.winnerLabel}</strong>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="grid content-start gap-2">
            <h3 className="text-sm font-medium">Upcoming prizes</h3>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No prize remains after the current reveal.</p>
            ) : (
              <ol className="grid gap-2 text-sm text-muted-foreground">
                {upcoming.map((slide) => (
                  <li key={slide.position} className="rounded-md border p-2.5">
                    {slide.prizePoolTitle} · {slide.prizeItemTitle}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onRestart} disabled={pending || !canReset}>
            <RotateCcwIcon data-icon="inline-start" />
            Restart Presentation
          </Button>
          <Button type="button" variant="outline" onClick={onInstantReplay} disabled={pending || !canReset}>
            <FastForwardIcon data-icon="inline-start" />
            Instant replay
          </Button>
          <Button type="button" className="sm:ml-auto" onClick={onPublish} disabled={!canPublish}>
            Publish &amp; Notify
          </Button>
        </div>

        {manualSelectionGate === "checking" ? (
          <p className="text-sm text-muted-foreground">Checking required manual selections before publishing.</p>
        ) : null}
        {manualSelectionGate === "blocked" ? (
          <p className="text-sm text-amber-700">
            Complete required manual selections before publishing.
          </p>
        ) : null}
        {!completedDrawPublishable && presentation.drawStatus === "completed" ? (
          <p className="text-sm text-muted-foreground">This completed draw is not currently publishable.</p>
        ) : null}
        {publishError ? (
          <p role="alert" className="text-sm text-destructive">
            {publishError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function GiveawayPresentationStageFallbackLink({
  stageUrl,
  onOpenStage,
}: {
  stageUrl: string;
  onOpenStage: () => boolean | void;
}) {
  return (
    <a
      className="font-medium underline underline-offset-4"
      href={stageUrl}
      target={GIVEAWAY_PRESENTATION_STAGE_WINDOW_NAME}
      onClick={(event) => {
        if (onOpenStage() === true) event.preventDefault();
      }}
    >
      Open stage directly
      <ExternalLinkIcon className="ml-1 inline size-3.5" />
    </a>
  );
}

export function GiveawayPresentationController({
  eventId,
  giveawayId,
  presentation,
  manualSelectionGate,
  completedDrawPublishable,
  pending,
  onPublish,
  onRuntimeStateChange,
}: GiveawayPresentationControllerProps) {
  const slideCount = presentation.slides.length;
  const identity = `${presentation.drawId}:${presentation.resultDigest}`;
  const [state, setState] = React.useState<GiveawayPresentationRuntimeState>(() =>
    createNeutralState(presentation.drawStatus, slideCount),
  );
  const [hydratedIdentity, setHydratedIdentity] = React.useState<string | null>(null);
  const [connectionIdentity, setConnectionIdentity] =
    React.useState<GiveawayPresentationChannelIdentity | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [popupBlock, setPopupBlock] = React.useState<{ identity: string; blocked: boolean } | null>(
    null,
  );
  const [fullscreenRequest, setFullscreenRequest] = React.useState<{
    identity: string;
    value: number;
  } | null>(null);
  const [publishedIdentity, setPublishedIdentity] = React.useState<string | null>(null);
  const [publishErrorState, setPublishErrorState] = React.useState<{
    identity: string;
    text: string;
  } | null>(null);
  const [publishingOperation, setPublishingOperation] =
    React.useState<GiveawayPresentationOperationIdentity | null>(null);
  const stageWindowRef = React.useRef<{
    identity: string;
    windowProxy: GiveawayPresentationWindowProxy;
  } | null>(null);
  const channelRef = React.useRef<BroadcastChannel | null>(null);
  const latestMessageRef = React.useRef<GiveawayPresentationControllerStateMessage | null>(null);
  const lastHeartbeatAtRef = React.useRef<number | null>(null);
  const previousPhaseRef = React.useRef({ identity, phase: state.phase });
  const chimePlayerRef = React.useRef<GiveawayPresentationWinnerChimePlayer | null>(null);
  const activePublishOperationRef = React.useRef<GiveawayPresentationOperationIdentity | null>(
    null,
  );
  const publishOperationSequenceRef = React.useRef(0);

  const runtimeState =
    hydratedIdentity === identity
      ? state
      : createNeutralState(presentation.drawStatus, slideCount);
  const channelId = getMatchingGiveawayPresentationChannelId(
    connectionIdentity,
    presentation.drawId,
    presentation.resultDigest,
  );
  const connectedForIdentity = channelId !== null && connected;
  const popupBlocked = popupBlock?.identity === identity && popupBlock.blocked;
  const fullscreenRequestId =
    fullscreenRequest?.identity === identity ? fullscreenRequest.value : null;
  const publicationSucceeded =
    presentation.drawStatus === "published" || publishedIdentity === identity;
  const publishing = publishingOperation?.identity === identity;
  const publishError =
    publishErrorState?.identity === identity ? publishErrorState.text : null;
  const stageUrl = channelId
    ? buildGiveawayPresentationStageUrl({ eventId, giveawayId, channelId })
    : "";
  const effectivePending = pending || publishing;

  React.useEffect(() => {
    let storageKey: string;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        storageKey = getGiveawayPresentationSessionKey(
          presentation.drawId,
          presentation.resultDigest,
        );
      } catch {
        setState(createNeutralState(presentation.drawStatus, slideCount));
        setHydratedIdentity(identity);
        return;
      }
      let serialized: string | null = null;
      try {
        serialized = globalThis.sessionStorage?.getItem(storageKey) ?? null;
      } catch {
        serialized = null;
      }
      setState(
        restoreGiveawayPresentationSessionState({
          serialized,
          storageKey,
          drawId: presentation.drawId,
          resultDigest: presentation.resultDigest,
          slideCount,
          drawStatus: presentation.drawStatus,
        }),
      );
      setHydratedIdentity(identity);
    });
    return () => {
      cancelled = true;
    };
  }, [
    identity,
    presentation.drawId,
    presentation.drawStatus,
    presentation.resultDigest,
    slideCount,
  ]);

  React.useEffect(() => {
    if (hydratedIdentity !== identity) return;
    try {
      const storageKey = getGiveawayPresentationSessionKey(
        presentation.drawId,
        presentation.resultDigest,
      );
      globalThis.sessionStorage?.setItem(
        storageKey,
        serializeGiveawayPresentationSessionState(state),
      );
    } catch {
      // Recovery storage is optional; the fixed server payload remains authoritative.
    }
    onRuntimeStateChange?.(state);
  }, [hydratedIdentity, identity, onRuntimeStateChange, presentation, state]);

  React.useEffect(() => {
    if (
      typeof globalThis.location === "undefined" ||
      typeof globalThis.crypto?.randomUUID !== "function"
    ) {
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      let connection;
      try {
        connection = resolveGiveawayPresentationControllerConnection({
          fragment: globalThis.location.hash,
          drawId: presentation.drawId,
          resultDigest: presentation.resultDigest,
          createChannelId: () => globalThis.crypto.randomUUID(),
        });
      } catch {
        return;
      }
      setConnectionIdentity({
        channelId: connection.channelId,
        drawId: presentation.drawId,
        resultDigest: presentation.resultDigest,
      });
      if (!connection.reused || globalThis.location.hash !== connection.fragment) {
        globalThis.history?.replaceState(
          null,
          "",
          `${globalThis.location.pathname}${globalThis.location.search}${connection.fragment}`,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [identity, presentation.drawId, presentation.resultDigest]);

  React.useLayoutEffect(() => {
    latestMessageRef.current = null;
    lastHeartbeatAtRef.current = null;
    stageWindowRef.current = null;
    activePublishOperationRef.current = null;
    previousPhaseRef.current = { identity, phase: "standby" };
    return () => {
      activePublishOperationRef.current = null;
    };
  }, [identity]);

  const sendSnapshot = React.useCallback(() => {
    const message = latestMessageRef.current;
    if (message) channelRef.current?.postMessage(message);
  }, []);

  React.useEffect(() => {
    if (!channelId || typeof globalThis.BroadcastChannel !== "function") return;
    const channel = new BroadcastChannel(getGiveawayPresentationChannelName(channelId));
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const pulse = resolveGiveawayPresentationStagePulse(event.data, channelId, Date.now());
      if (!pulse) return;
      lastHeartbeatAtRef.current = pulse.lastHeartbeatAt;
      setConnected(pulse.connected);
      if (pulse.shouldSendSnapshot) sendSnapshot();
    };
    const cadence = globalThis.setInterval(() => {
      const now = Date.now();
      if (isGiveawayPresentationStageDisconnected(lastHeartbeatAtRef.current, now)) {
        setConnected(false);
      }
      sendSnapshot();
    }, GIVEAWAY_PRESENTATION_HEARTBEAT_INTERVAL_MS);
    return () => {
      globalThis.clearInterval(cadence);
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
      lastHeartbeatAtRef.current = null;
      setConnected(false);
    };
  }, [channelId, sendSnapshot]);

  React.useEffect(() => {
    if (!channelId || hydratedIdentity !== identity) return;
    const candidate: GiveawayPresentationControllerStateMessage = {
      version: GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
      type: "controller-state",
      channelId,
      eventId,
      giveawayId,
      drawId: presentation.drawId,
      resultDigest: presentation.resultDigest,
      state: runtimeState,
      presentation,
      fullscreenRequestId,
    };
    const safeMessage = parseGiveawayPresentationControllerStateMessage(candidate, {
      channelId,
      eventId,
      giveawayId,
      drawId: presentation.drawId,
      resultDigest: presentation.resultDigest,
    });
    latestMessageRef.current = safeMessage;
    if (safeMessage) channelRef.current?.postMessage(safeMessage);
  }, [
    channelId,
    eventId,
    fullscreenRequestId,
    giveawayId,
    hydratedIdentity,
    identity,
    presentation,
    runtimeState,
  ]);

  const dispatch = React.useCallback(
    (event: GiveawayPresentationRuntimeEvent) => {
      setState((current) => reduceGiveawayPresentationRuntime(current, event));
    },
    [],
  );

  React.useEffect(() => {
    if (hydratedIdentity !== identity || runtimeState.phase !== "spinning") return;
    const timeout = globalThis.setTimeout(
      () => dispatch({ type: "settle", slideCount }),
      GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS,
    );
    return () => globalThis.clearTimeout(timeout);
  }, [dispatch, hydratedIdentity, identity, runtimeState.phase, runtimeState.slideIndex, slideCount]);

  React.useEffect(() => {
    const previous = previousPhaseRef.current;
    if (previous.identity !== identity) {
      previousPhaseRef.current = { identity, phase: runtimeState.phase };
      return;
    }
    if (
      runtimeState.soundEnabled &&
      ["ready", "spinning"].includes(previous.phase) &&
      ["winner", "complete"].includes(runtimeState.phase)
    ) {
      chimePlayerRef.current?.play();
    }
    previousPhaseRef.current = { identity, phase: runtimeState.phase };
  }, [identity, runtimeState.phase, runtimeState.soundEnabled]);

  React.useEffect(
    () => () => {
      chimePlayerRef.current?.close();
      chimePlayerRef.current = null;
    },
    [],
  );

  const reveal = React.useCallback(() => {
    if (!connectedForIdentity) return;
    if (runtimeState.soundEnabled && !chimePlayerRef.current) {
      chimePlayerRef.current = createGiveawayPresentationWinnerChimePlayer();
    }
    dispatch({
      type: "reveal",
      slideCount,
      reducedMotion: getPrefersReducedGiveawayMotion(),
    });
  }, [connectedForIdentity, dispatch, runtimeState.soundEnabled, slideCount]);
  const skip = React.useCallback(
    () => dispatch({ type: "skip-current", slideCount }),
    [dispatch, slideCount],
  );
  const next = React.useCallback(() => {
    if (!connectedForIdentity) return;
    dispatch({ type: "next", slideCount });
  }, [connectedForIdentity, dispatch, slideCount]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const intent = getGiveawayPresentationKeyboardEventIntent(event);
      if (intent === "skip-current" && runtimeState.phase === "spinning") {
        event.preventDefault();
        skip();
      } else if (
        intent === "reveal-or-next" &&
        connectedForIdentity &&
        runtimeState.phase === "ready"
      ) {
        event.preventDefault();
        reveal();
      } else if (
        intent === "reveal-or-next" &&
        connectedForIdentity &&
        runtimeState.phase === "winner"
      ) {
        event.preventDefault();
        next();
      }
    };
    globalThis.addEventListener?.("keydown", handleKeyDown);
    return () => globalThis.removeEventListener?.("keydown", handleKeyDown);
  }, [connectedForIdentity, next, reveal, runtimeState.phase, skip]);

  const openStage = React.useCallback(() => {
    if (!stageUrl || typeof globalThis.open !== "function") return false;
    const retainedWindow =
      stageWindowRef.current?.identity === identity
        ? stageWindowRef.current.windowProxy
        : null;
    const result = openOrFocusGiveawayPresentationStage({
      existingWindow: retainedWindow,
      stageUrl,
      openWindow: (url, target) => globalThis.open(url, target),
    });
    stageWindowRef.current = result.windowProxy
      ? { identity, windowProxy: result.windowProxy }
      : null;
    setPopupBlock({ identity, blocked: result.blocked });
    return !result.blocked;
  }, [identity, stageUrl]);

  const changeSound = React.useCallback(
    (soundEnabled: boolean) => {
      if (soundEnabled && !chimePlayerRef.current) {
        chimePlayerRef.current = createGiveawayPresentationWinnerChimePlayer();
      }
      dispatch({ type: "set-sound", soundEnabled });
    },
    [dispatch],
  );

  const requestFullscreen = React.useCallback(() => {
    const retainedWindow =
      stageWindowRef.current?.identity === identity
        ? stageWindowRef.current.windowProxy
        : null;
    void tryGiveawayPresentationFullscreen(retainedWindow).then((succeeded) => {
      if (!succeeded) {
        setFullscreenRequest((current) => ({
          identity,
          value: current?.identity === identity ? current.value + 1 : 1,
        }));
      }
    });
  }, [identity]);

  const restartPresentation = React.useCallback(() => {
    if (!canResetGiveawayPresentation(runtimeState)) return;
    dispatch({ type: "restart", slideCount });
  }, [dispatch, runtimeState, slideCount]);

  const instantReplay = React.useCallback(() => {
    if (!canResetGiveawayPresentation(runtimeState)) return;
    dispatch({ type: "instant-replay", slideCount });
  }, [dispatch, runtimeState, slideCount]);

  const publish = React.useCallback(() => {
    if (
      !canPublishGiveawayPresentation({
        presentation,
        state: runtimeState,
        manualSelectionGate,
        completedDrawPublishable,
        pending: effectivePending,
        publicationSucceeded,
      })
    ) {
      return;
    }
    const operation = {
      identity,
      token: publishOperationSequenceRef.current + 1,
    };
    publishOperationSequenceRef.current = operation.token;
    activePublishOperationRef.current = operation;
    setPublishingOperation(operation);
    setPublishErrorState(null);
    void onPublish().then(
      (succeeded) => {
        if (
          !isGiveawayPresentationOperationCurrent(
            operation,
            activePublishOperationRef.current,
          )
        ) {
          setPublishingOperation((current) =>
            isGiveawayPresentationOperationCurrent(operation, current) ? null : current,
          );
          return;
        }
        activePublishOperationRef.current = null;
        setPublishingOperation((current) =>
          isGiveawayPresentationOperationCurrent(operation, current) ? null : current,
        );
        if (succeeded) {
          setPublishedIdentity(operation.identity);
          dispatch({ type: "published", slideCount });
        } else {
          setPublishErrorState({
            identity: operation.identity,
            text: "Winners were not published. Check the connection and try again.",
          });
        }
      },
      () => {
        if (
          !isGiveawayPresentationOperationCurrent(
            operation,
            activePublishOperationRef.current,
          )
        ) {
          setPublishingOperation((current) =>
            isGiveawayPresentationOperationCurrent(operation, current) ? null : current,
          );
          return;
        }
        activePublishOperationRef.current = null;
        setPublishingOperation((current) =>
          isGiveawayPresentationOperationCurrent(operation, current) ? null : current,
        );
        setPublishErrorState({
          identity: operation.identity,
          text: "Winners were not published. Check the connection and try again.",
        });
      },
    );
  }, [
    completedDrawPublishable,
    dispatch,
    effectivePending,
    identity,
    manualSelectionGate,
    onPublish,
    presentation,
    publicationSucceeded,
    runtimeState,
    slideCount,
  ]);

  return (
    <GiveawayPresentationControllerView
      presentation={presentation}
      state={runtimeState}
      connected={connectedForIdentity}
      popupBlocked={popupBlocked}
      stageUrl={stageUrl}
      manualSelectionGate={manualSelectionGate}
      completedDrawPublishable={completedDrawPublishable}
      pending={effectivePending}
      publicationSucceeded={publicationSucceeded}
      publishError={publishError}
      onOpenStage={openStage}
      onModeChange={(mode) => dispatch({ type: "set-mode", mode })}
      onSoundChange={changeSound}
      onFullscreen={requestFullscreen}
      onReveal={reveal}
      onSkip={skip}
      onNext={next}
      onRestart={restartPresentation}
      onInstantReplay={instantReplay}
      onPublish={publish}
    />
  );
}

function createNeutralState(
  drawStatus: OrganizerGiveawayPresentation["drawStatus"],
  slideCount: number,
): GiveawayPresentationRuntimeState {
  return {
    phase:
      drawStatus === "published"
        ? "published"
        : slideCount === 0
          ? "complete"
          : "ready",
    slideIndex:
      drawStatus === "published"
        ? Math.max(0, slideCount - 1)
        : 0,
    mode: "normal",
    soundEnabled: false,
  };
}
