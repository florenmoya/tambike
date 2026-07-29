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

  const goingCopy = going === 1 ? "1 rider" : `${going} riders`;
  const rosterEnabled = preview?.summary?.rosterEnabled !== false;
  const riders = rosterEnabled ? preview?.attendees.slice(0, 4) ?? [] : [];
  const canOpenRoster = rosterEnabled;
  const [failedBikePhotos, setFailedBikePhotos] = useState<Set<string>>(
    () => new Set(),
  );
  const bikeRiders = riders.filter(
    (rider) => !failedBikePhotos.has(rider.slug),
  );

  return (
    <section className={styles.preview} aria-labelledby="event-attendee-preview-title">
      <div className={styles.heading}>
        <span>Who’s going</span>
        <h2 id="event-attendee-preview-title">{goingCopy}</h2>
        <p>{interested} interested · ~{expected} expected</p>
      </div>

      {bikeRiders.length > 0 ? (
        <div className={styles.riderSummary}>
          <div className={styles.bikeGrid} aria-label="Featured attendee bikes">
            {bikeRiders.map((rider) => (
              <Link
                key={rider.slug}
                className={styles.bikeTile}
                href={`/riders/${rider.slug}`}
                aria-label={`View ${rider.displayName}’s bike and rider profile`}
              >
                <Image
                  src={rider.bikePhoto.url}
                  alt=""
                  width={rider.bikePhoto.width}
                  height={rider.bikePhoto.height}
                  sizes="(max-width: 430px) calc((100vw - 3.7rem) / 2), 170px"
                  unoptimized
                  onError={() => {
                    setFailedBikePhotos((current) => {
                      const next = new Set(current);
                      next.add(rider.slug);
                      return next;
                    });
                  }}
                />
              </Link>
            ))}
          </div>
        </div>
      ) : rosterEnabled && !preview?.unavailable ? (
        <p className={styles.state}>Rider profiles will appear here as they join.</p>
      ) : null}

      {canOpenRoster ? (
        <div className={styles.footer}>
          <Link className={styles.action} href={`/events/${eventId}/attendees`}>
            View all bikes
          </Link>
        </div>
      ) : null}
    </section>
  );
}
