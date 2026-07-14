"use client";

import * as React from "react";

import {
  getGiveawayPresentationChannelName,
  GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
  GIVEAWAY_PRESENTATION_HEARTBEAT_INTERVAL_MS,
  GIVEAWAY_PRESENTATION_STAGE_DISCONNECT_AFTER_MS,
  parseGiveawayPresentationControllerStateMessage,
  type GiveawayPresentationControllerStateMessage,
  type GiveawayPresentationStageMessage,
} from "./giveaway-presentation-channel";
import {
  getPrefersReducedGiveawayMotion,
  tryGiveawayPresentationFullscreen,
} from "./giveaway-presentation-browser";
import { GiveawayPresentationReel } from "./giveaway-presentation-reel";
import styles from "./giveaway-presentation-stage.module.css";

export type GiveawayPresentationStageProps = {
  eventId: string;
  giveawayId: string;
  channelId: string;
};

type StageViewProps = {
  message: GiveawayPresentationControllerStateMessage | null;
  disconnected: boolean;
  settledWhileDisconnected: boolean;
  fullscreenRequested: boolean;
  reducedMotion: boolean;
  onSettled: () => void;
  onFullscreen: () => void;
};

export function GiveawayPresentationStageView({
  message,
  disconnected,
  settledWhileDisconnected,
  fullscreenRequested,
  reducedMotion,
  onSettled,
  onFullscreen,
}: StageViewProps) {
  const presentation = message?.presentation;
  const runtime = message?.state;
  const slide = presentation && runtime ? presentation.slides[runtime.slideIndex] : undefined;
  const settled = Boolean(
    slide &&
      runtime &&
      (["winner", "complete", "published"].includes(runtime.phase) || settledWhileDisconnected),
  );
  const futureWinnerLabels = new Set(
    presentation && runtime
      ? presentation.slides.slice(runtime.slideIndex + 1).map((item) => item.winnerLabel)
      : [],
  );
  const reelLabels = presentation
    ? presentation.labelBank.filter((label) => !futureWinnerLabels.has(label))
    : [];

  return (
    <main className={styles.stage}>
      <div className={styles.stageShell}>
        <header className={styles.marker}>Tambike Live Draw</header>
        <section className={styles.stageMain}>
          {!presentation || !runtime || !slide ? (
            <>
              <p className={styles.campaignTitle}>Projector stage</p>
              <div className={styles.reelFrame}>
                <div className={styles.reelIdle}>Waiting for controller</div>
              </div>
            </>
          ) : (
            <>
              <p className={styles.campaignTitle}>{presentation.giveawayTitle}</p>
              <p className={styles.prizePool}>{slide.prizePoolTitle}</p>
              <h1 className={styles.prizeTitle}>{slide.prizeItemTitle}</h1>
              <div className={styles.reelFrame}>
                <GiveawayPresentationReel
                  labelBank={reelLabels}
                  resultDigest={presentation.resultDigest}
                  slidePosition={slide.position}
                  winnerLabel={slide.winnerLabel}
                  phase={settledWhileDisconnected ? "winner" : runtime.phase}
                  reducedMotion={reducedMotion}
                  onSettled={onSettled}
                />
              </div>
              <p className={styles.progress}>
                Prize {slide.position} of {presentation.slides.length}
              </p>
              <p className="sr-only" aria-live="polite" aria-atomic="true">
                {settled ? `Winner: ${slide.winnerLabel}` : ""}
              </p>
            </>
          )}
        </section>
        <footer className={styles.statusBar}>
          {runtime?.phase === "complete" ? (
            <span className={styles.complete}>All winners revealed.</span>
          ) : null}
          {runtime?.phase === "published" ? (
            <span className={styles.complete}>Winners published</span>
          ) : null}
          {disconnected && message ? (
            <span className={styles.disconnected}>Controller disconnected</span>
          ) : null}
          {fullscreenRequested ? (
            <button type="button" className={styles.fullscreenButton} onClick={onFullscreen}>
              Enter fullscreen
            </button>
          ) : null}
        </footer>
      </div>
    </main>
  );
}

export function GiveawayPresentationStage({
  eventId,
  giveawayId,
  channelId,
}: GiveawayPresentationStageProps) {
  const [message, setMessage] = React.useState<GiveawayPresentationControllerStateMessage | null>(
    null,
  );
  const [disconnected, setDisconnected] = React.useState(false);
  const [settledWhileDisconnected, setSettledWhileDisconnected] = React.useState(false);
  const [fullscreenRequested, setFullscreenRequested] = React.useState(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const lastControllerAtRef = React.useRef<number | null>(null);
  const lockedIdentityRef = React.useRef<{ drawId: string; resultDigest: string } | null>(null);
  const previousSnapshotRef = React.useRef<{ phase: string; slideIndex: number } | null>(null);
  const lastFullscreenRequestRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const query = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(getPrefersReducedGiveawayMotion(() => query));
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  React.useEffect(() => {
    if (typeof globalThis.BroadcastChannel !== "function") return;
    let channelName: string;
    try {
      channelName = getGiveawayPresentationChannelName(channelId);
    } catch {
      return;
    }
    const channel = new BroadcastChannel(channelName);
    const stageMessage = (type: GiveawayPresentationStageMessage["type"]) => ({
      version: GIVEAWAY_PRESENTATION_CHANNEL_VERSION,
      type,
      channelId,
    }) satisfies GiveawayPresentationStageMessage;
    channel.postMessage(stageMessage("stage-ready"));
    const heartbeat = globalThis.setInterval(() => {
      channel.postMessage(stageMessage("stage-heartbeat"));
      const lastControllerAt = lastControllerAtRef.current;
      if (
        lastControllerAt !== null &&
        Date.now() - lastControllerAt >= GIVEAWAY_PRESENTATION_STAGE_DISCONNECT_AFTER_MS
      ) {
        setDisconnected(true);
      }
    }, GIVEAWAY_PRESENTATION_HEARTBEAT_INTERVAL_MS);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const lockedIdentity = lockedIdentityRef.current;
      const parsed = parseGiveawayPresentationControllerStateMessage(event.data, {
        channelId,
        eventId,
        giveawayId,
        ...(lockedIdentity ?? {}),
      });
      if (!parsed) return;
      if (!lockedIdentity) {
        lockedIdentityRef.current = {
          drawId: parsed.drawId,
          resultDigest: parsed.resultDigest,
        };
      }
      const previous = previousSnapshotRef.current;
      if (
        !previous ||
        previous.phase !== parsed.state.phase ||
        previous.slideIndex !== parsed.state.slideIndex
      ) {
        setSettledWhileDisconnected(false);
      }
      previousSnapshotRef.current = {
        phase: parsed.state.phase,
        slideIndex: parsed.state.slideIndex,
      };
      if (
        typeof parsed.fullscreenRequestId === "number" &&
        parsed.fullscreenRequestId !== lastFullscreenRequestRef.current
      ) {
        lastFullscreenRequestRef.current = parsed.fullscreenRequestId;
        setFullscreenRequested(true);
      }
      lastControllerAtRef.current = Date.now();
      setDisconnected(false);
      setMessage(parsed);
    };
    return () => {
      globalThis.clearInterval(heartbeat);
      channel.close();
    };
  }, [channelId, eventId, giveawayId]);

  const enterFullscreen = React.useCallback(() => {
    void tryGiveawayPresentationFullscreen(
      typeof document === "undefined" ? null : { document },
    ).then((succeeded) => {
      if (succeeded) setFullscreenRequested(false);
    });
  }, []);
  const settleLocally = React.useCallback(() => setSettledWhileDisconnected(true), []);

  return (
    <GiveawayPresentationStageView
      message={message}
      disconnected={disconnected}
      settledWhileDisconnected={settledWhileDisconnected}
      fullscreenRequested={fullscreenRequested}
      reducedMotion={reducedMotion}
      onSettled={settleLocally}
      onFullscreen={enterFullscreen}
    />
  );
}
