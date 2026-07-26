import Image from "next/image";
import Link from "next/link";

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
  const going = preview?.summary?.goingCount ?? fallbackGoing;
  const rosterEnabled = preview?.summary?.rosterEnabled !== false;
  const riders =
    preview?.signedIn && rosterEnabled ? preview.attendees.slice(0, 4) : [];
  const memberCanBrowse = preview?.signedIn && rosterEnabled;
  const guestCanLogIn =
    preview?.signedIn === false && !preview.unavailable && rosterEnabled;
  const canOpenRoster = rosterEnabled && !guestCanLogIn;

  return (
    <section className={styles.preview} aria-labelledby="event-attendee-preview-title">
      <div className={styles.heading}>
        <span>Who’s going</span>
        <h2 id="event-attendee-preview-title">{going} riders are going</h2>
        <p>{interested} interested · Around {expected} expected</p>
      </div>

      {riders.length > 0 ? (
        <div className={styles.riderSummary}>
          <div className={styles.facepile} aria-label="Featured attendees">
            {riders.map((rider) => (
              <Link
                key={rider.slug}
                className={styles.rider}
                href={`/riders/${rider.slug}`}
                aria-label={`View ${rider.displayName}’s rider profile`}
              >
                {rider.profilePhotoUrl ? (
                  <Image
                    src={rider.profilePhotoUrl}
                    alt=""
                    width={52}
                    height={52}
                    sizes="52px"
                    unoptimized
                  />
                ) : (
                  <span aria-hidden="true">
                    {rider.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <p className={styles.names}>
            {riders.map((rider) => rider.displayName).join(", ")}
          </p>
        </div>
      ) : memberCanBrowse ? (
        <p className={styles.state}>Rider profiles will appear here as they join.</p>
      ) : null}

      <div className={styles.footer}>
        {guestCanLogIn ? (
          <Link
            className={styles.action}
            href={`/login?next=${encodeURIComponent(`/events/${eventId}`)}`}
          >
            Log in to see riders
          </Link>
        ) : canOpenRoster ? (
          <Link className={styles.action} href={`/events/${eventId}/attendees`}>
            See who’s going
          </Link>
        ) : null}
      </div>
    </section>
  );
}
