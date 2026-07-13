import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("../../src/server/giveaway-actions", () => ({
  disqualifyGiveawayAwardAction: vi.fn(),
  grantGiveawayOperatorAction: vi.fn(),
  revokeGiveawayOperatorAction: vi.fn(),
  reviewGiveawayComplianceAction: vi.fn(),
  suspendGiveawayAction: vi.fn(),
  voidGiveawayAwardAction: vi.fn(),
}));

import { AdminGiveawayDetail, AdminGiveawayList } from "../../src/features/giveaways/admin-giveaway-console";

const workspace = {
  id: "giveaway-1",
  eventId: "event-1",
  title: "Helmet draw",
  kind: "giveaway" as const,
  state: "claims_open" as const,
  complianceStatus: "approved" as const,
  mechanicsVersion: 1,
  entryMode: "opt_in" as const,
  maxEntriesPerRider: 1,
  mechanics: "One entry per rider.",
  terms: "Collection desk terms.",
  timeZone: "Asia/Manila",
  winnerLimits: { perRider: 1, total: 1 },
  publicVisibility: "event_page" as const,
  presenceVerificationRequired: false,
  eligibilityGroups: [],
  prizePools: [],
};

describe("admin giveaway recovery routing", () => {
  test("routes recovery to the event organizer workspace instead of exposing a raw redraw control", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AdminGiveawayDetail, {
        giveawayId: workspace.id,
        initialWorkspace: workspace,
        initialAudit: { giveawayId: workspace.id, events: [] },
        initialCandidates: [],
      }),
    );

    expect(markup).toContain(`/organizer/events/${workspace.eventId}/giveaways`);
    expect(markup).toContain("Open safe recovery workspace");
    expect(markup).not.toContain("Redraw next candidate");
    expect(markup).not.toContain("redraw by award reference");
  });

  test("does not advertise recovery from an admin award reference", () => {
    const markup = renderToStaticMarkup(React.createElement(AdminGiveawayList, { initialCampaigns: [] }));

    expect(markup).toContain("Open the event recovery workspace");
    expect(markup).not.toContain("redraw by award reference");
  });
});
