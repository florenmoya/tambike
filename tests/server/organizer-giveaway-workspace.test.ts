import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import {
  buildGiveawayLifecycleRoute,
  OrganizerGiveawayWorkspace,
} from "../../src/features/giveaways/organizer-giveaway-workspace";

describe("organizer giveaway lifecycle route", () => {
  test("shows the factual lifecycle and treats pause as an operational hold", () => {
    expect(buildGiveawayLifecycleRoute("paused", "approved")).toEqual([
      { id: "draft", label: "Draft", status: "complete" },
      { id: "review", label: "Review", status: "complete" },
      { id: "scheduled", label: "Scheduled", status: "complete" },
      { id: "open", label: "Open", status: "hold" },
      { id: "locked", label: "Locked", status: "upcoming" },
      { id: "drawing", label: "Draw", status: "upcoming" },
      { id: "claims_open", label: "Claims", status: "upcoming" },
      { id: "completed", label: "Complete", status: "upcoming" },
    ]);
  });

  test("makes compliance review visible before an approved campaign can be scheduled", () => {
    expect(buildGiveawayLifecycleRoute("draft", "pending_review").slice(0, 3)).toEqual([
      { id: "draft", label: "Draft", status: "complete" },
      { id: "review", label: "Review", status: "active" },
      { id: "scheduled", label: "Scheduled", status: "upcoming" },
    ]);
  });

  test("renders an organizer-only operational workspace with a factual lifecycle strip", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OrganizerGiveawayWorkspace, {
        eventId: "event-1",
        initialCampaigns: [
          {
            id: "giveaway-1",
            eventId: "event-1",
            title: "Rider helmet draw",
            state: "paused",
            complianceStatus: "approved",
            mechanicsVersion: 2,
          },
        ],
      }),
    );

    expect(markup).toContain("Giveaway operations");
    expect(markup).toContain("Rider helmet draw");
    expect(markup).toContain("Paused at open");
    expect(markup).toContain("Compliance approved");
    expect(markup).toContain("Policy details are loading");
  });
});
