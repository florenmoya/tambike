import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  EVENT_BRIEF_HEADINGS,
  EventBrief,
} from "@/features/tambike-demo/event-brief";
import type { EventType } from "@/features/tambike-demo/types";

const expectedHeadings = {
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

describe("EventBrief", () => {
  test("shows a compact rider-facing plan with subtle rules", () => {
    const markup = renderToStaticMarkup(
      <EventBrief
        eventType="Tambike"
        description="Park with the group, grab a drink, and meet other riders."
        rules={["Helmet required", "No revving"]}
      />,
    );

    expect(markup).toContain("The plan");
    expect(markup).toContain("Coffee, bikes, and conversation");
    expect(markup).toContain(
      "Park with the group, grab a drink, and meet other riders.",
    );
    expect(markup).toContain("Good to know");
    expect(markup).toContain("Helmet required");
    expect(markup).toContain("No revving");
    expect(markup).not.toContain("What to expect");
    expect(markup).not.toContain("A relaxed rider meetup");
    expect(markup).not.toContain(">Rules<");
    expect(markup).not.toContain("Safety and venue notes");
  });

  test("defines a useful heading for every event type", () => {
    expect(EVENT_BRIEF_HEADINGS).toEqual(expectedHeadings);
  });
});
