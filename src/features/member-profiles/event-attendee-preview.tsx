import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import type { EventAttendeePreviewData } from "./types";
import styles from "./event-attendee-preview.module.css";

export interface EventAttendeePreviewProps {
  eventId: string;
  fallbackGoing: number;
  interested: number;
  expected: number;
  preview?: EventAttendeePreviewData;
}

export function EventAttendeePreview({
  eventId,
  fallbackGoing,
  interested,
  expected,
  preview,
}: EventAttendeePreviewProps) {
  const initialGoing = preview?.summary?.goingCount ?? fallbackGoing;
  const [goingState, setGoingState] = useState(() => ({
    eventId,
    fallbackGoing,
    value: initialGoing,
  }));
  const eventChanged = goingState.eventId !== eventId;
  const liveCountChanged =
    !eventChanged && goingState.fallbackGoing !== fallbackGoing;
  const going = eventChanged
    ? initialGoing
    : liveCountChanged
      ? fallbackGoing
      : goingState.value;

  if (eventChanged || liveCountChanged) {
    setGoingState({
      eventId,
      fallbackGoing,
      value: going,
    });
  }

  const goingCopy =
    going === 1 ? "1 rider is going" : `${going} riders are going`;
  const rosterEnabled = preview?.summary?.rosterEnabled !== false;
  const riders = rosterEnabled ? preview?.attendees.slice(0, 4) ?? [] : [];
  const canOpenRoster = rosterEnabled;
  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(
    () => new Set(),
  );

  return (
    <section className={styles.preview} aria-labelledby="event-attendee-preview-title">
      <div className={styles.heading}>
        <span>Who’s going</span>
        <h2 id="event-attendee-preview-title">{goingCopy}</h2>
        <p>{interested} interested · Around {expected} expected</p>
      </div>

      {riders.length > 0 ? (
        <div className={styles.riderSummary}>
          <div className={styles.facepile} aria-label="Featured attendees">
            {riders.map((rider) => {
              const photoFailed = failedPhotos.has(rider.slug);
              const initial = rider.displayName.trim().charAt(0).toUpperCase() || "R";

              return (
                <Link
                  key={rider.slug}
                  className={styles.rider}
                  href={`/riders/${rider.slug}`}
                  aria-label={`View ${rider.displayName}’s rider profile`}
                >
                  {rider.profilePhotoUrl && !photoFailed ? (
                    <Image
                      src={rider.profilePhotoUrl}
                      alt=""
                      width={52}
                      height={52}
                      sizes="52px"
                      unoptimized
                      onError={() => {
                        setFailedPhotos((current) => {
                          const next = new Set(current);
                          next.add(rider.slug);
                          return next;
                        });
                      }}
                    />
                  ) : (
                    <span aria-hidden="true">{initial}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ) : rosterEnabled && !preview?.unavailable ? (
        <p className={styles.state}>Rider profiles will appear here as they join.</p>
      ) : null}

      <div className={styles.footer}>
        {canOpenRoster ? (
          <Link className={styles.action} href={`/events/${eventId}/attendees`}>
            See who’s going
          </Link>
        ) : null}
      </div>
    </section>
  );
}
