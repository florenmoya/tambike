"use client";

import { useLinkStatus } from "next/link";
import type { MouseEvent, ReactNode } from "react";

import styles from "./tambike-loading-feedback.module.css";

export function TambikeLoadingWheel() {
  return (
    <span className={styles.wheel} data-tambike-loading-wheel="true" aria-hidden="true">
      <span className={styles.spoke} data-wheel-spoke="horizontal" />
      <span className={`${styles.spoke} ${styles.spokeVertical}`} data-wheel-spoke="vertical" />
      <span className={`${styles.spoke} ${styles.spokeDiagonalA}`} data-wheel-spoke="diagonal-a" />
      <span className={`${styles.spoke} ${styles.spokeDiagonalB}`} data-wheel-spoke="diagonal-b" />
      <span className={styles.hub} data-wheel-hub="true" />
    </span>
  );
}

export function ProfileLoadingFeedback() {
  return (
    <div className={styles.profileStatus} role="status" aria-live="polite" aria-busy="true">
      <TambikeLoadingWheel />
      <strong>Getting your garage ready…</strong>
      <span>Loading your profile and motorcycle details.</span>
    </div>
  );
}

export function EventLoadingModal({ eventTitle }: { eventTitle: string }) {
  const blockRepeatedNavigation = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className={styles.eventBackdrop}
      data-event-loading-modal="true"
      role="status"
      aria-live="polite"
      aria-busy="true"
      onClick={blockRepeatedNavigation}
    >
      <div className={styles.eventPanel}>
        <TambikeLoadingWheel />
        <strong>Opening event…</strong>
        <span>{eventTitle}</span>
      </div>
    </div>
  );
}

export function EventNavigationFeedback({
  eventTitle,
  children,
}: {
  eventTitle: string;
  children: (pending: boolean) => ReactNode;
}) {
  const { pending } = useLinkStatus();

  return (
    <>
      {children(pending)}
      {pending ? <EventLoadingModal eventTitle={eventTitle} /> : null}
    </>
  );
}
