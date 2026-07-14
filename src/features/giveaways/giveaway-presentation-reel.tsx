"use client";

import * as React from "react";

import {
  GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS,
  buildGiveawayPresentationReelLabels,
  type GiveawayPresentationPhase,
} from "./giveaway-presentation-runtime";
import styles from "./giveaway-presentation-stage.module.css";

type GiveawayPresentationReelProps = {
  labelBank: readonly string[];
  resultDigest: string;
  slidePosition: number;
  winnerLabel: string;
  phase: GiveawayPresentationPhase;
  reducedMotion: boolean;
  onSettled: () => void;
};

export function GiveawayPresentationReel({
  labelBank,
  resultDigest,
  slidePosition,
  winnerLabel,
  phase,
  reducedMotion,
  onSettled,
}: GiveawayPresentationReelProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const labels = buildGiveawayPresentationReelLabels({
    labelBank,
    resultDigest,
    slidePosition,
    winnerLabel,
  });
  const animationKey = getGiveawayPresentationReelAnimationKey(labels);
  const labelCount = labels.length;

  React.useEffect(() => {
    if (phase !== "spinning") return;
    if (reducedMotion) {
      onSettled();
      return;
    }
    const track = trackRef.current;
    const firstRow = track?.firstElementChild as HTMLElement | null;
    if (!track || !firstRow || labelCount === 0) {
      onSettled();
      return;
    }
    const distance = -Math.max(0, labelCount - 1) * firstRow.offsetHeight;
    const animation = track.animate(
      [
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(0, ${distance}px, 0)` },
      ],
      {
        duration: GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS,
        easing: "cubic-bezier(0.08, 0.72, 0.16, 1)",
        fill: "forwards",
      },
    );
    animation.onfinish = onSettled;
    return () => animation.cancel();
  }, [animationKey, labelCount, onSettled, phase, reducedMotion]);

  if (phase === "ready" || phase === "standby") {
    return <div className={styles.reelIdle}>Ready at the gate</div>;
  }

  if (phase !== "spinning" || reducedMotion) {
    return <div className={styles.reelWinner}>{winnerLabel}</div>;
  }

  return (
    <div className={styles.reelTrack} ref={trackRef} aria-hidden="true">
      {labels.map((label, index) => (
        <div className={styles.reelRow} key={`${index}:${label}`}>
          {label}
        </div>
      ))}
    </div>
  );
}

/** Content-derived identity keeps the same six-second animation alive across heartbeat renders. */
export function getGiveawayPresentationReelAnimationKey(labels: readonly string[]) {
  return labels.join("\u001f");
}
