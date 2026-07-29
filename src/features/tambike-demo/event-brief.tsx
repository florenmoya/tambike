import { useId } from "react";

import styles from "./event-brief.module.css";
import type { EventType } from "./types";

export const EVENT_BRIEF_HEADINGS = {
  Tambike: "Coffee, bikes, and conversation",
  "Bike Night": "An easy night with fellow riders",
  "Coffee Ride": "A social ride with a coffee stop",
  "Club EB": "Time with the club and riding community",
  "Brand Event": "Meet riders and see what is happening",
  "Test Ride": "Try the bikes and understand the process",
  "Charity Ride": "Ride together for a cause",
  "Track Day": "Track sessions and paddock time",
  "Endurance Ride": "A long ride with planned checkpoints",
  "Moto Expo": "Bikes, booths, and community",
  Race: "Race-day viewing and rider support",
} satisfies Record<EventType, string>;

interface EventBriefProps {
  eventType: EventType;
  description: string;
  rules: readonly string[];
}

export function EventBrief({
  eventType,
  description,
  rules,
}: EventBriefProps) {
  const headingId = useId();

  return (
    <section className={styles.brief} aria-labelledby={headingId}>
      <span className={styles.eyebrow}>The plan</span>
      <h2 className={styles.heading} id={headingId}>
        {EVENT_BRIEF_HEADINGS[eventType]}
      </h2>
      <p className={styles.description}>{description}</p>
      {rules.length > 0 ? (
        <div className={styles.notes} aria-label="Good to know">
          <span className={styles.notesLabel}>Good to know</span>
          <ul className={styles.rules}>
            {rules.map((rule) => (
              <li className={styles.rule} key={rule}>
                {rule}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
