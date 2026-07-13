import { readFile } from "node:fs/promises";

import type * as React from "react";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  listAdmin: vi.fn(),
  getWorkspace: vi.fn(),
  getAudit: vi.fn(),
  listCandidates: vi.fn(),
  listOrganizer: vi.fn(),
  listQueue: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("../../src/server/giveaway-actions", () => ({
  getAdminGiveawayAuditAction: mocks.getAudit,
  getOrganizerGiveawayWorkspaceAction: mocks.getWorkspace,
  listAdminGiveawaysAction: mocks.listAdmin,
  listEventGiveawayOperatorClaimsAction: mocks.listQueue,
  listGiveawayOperatorCandidatesAction: mocks.listCandidates,
  listOrganizerGiveawaysAction: mocks.listOrganizer,
}));
vi.mock("../../src/features/admin/admin-console", () => ({
  AdminConsole: ({ giveawayContent }: { giveawayContent?: React.ReactNode }) => giveawayContent ?? null,
}));
vi.mock("../../src/features/giveaways/admin-giveaway-console", () => ({
  AdminGiveawayDetail: () => null,
  AdminGiveawayList: () => null,
}));
vi.mock("../../src/features/giveaways/giveaway-operator-workspace", () => ({
  GiveawayOperatorWorkspace: () => null,
}));
vi.mock("../../src/features/giveaways/venue-giveaway-queue", () => ({
  VenueGiveawayQueue: () => null,
}));

import AdminGiveawayDetailPage from "../../src/app/admin/giveaways/[giveawayId]/page";
import AdminGiveawaysPage from "../../src/app/admin/giveaways/page";
import GiveawayOpsPage from "../../src/app/giveaway-ops/[eventId]/page";
import VenueGiveawaysPage from "../../src/app/venue/events/[eventId]/giveaways/page";

const campaign = {
  id: "giveaway-1",
  eventId: "event-1",
  title: "Helmet draw",
  state: "claims_open" as const,
  complianceStatus: "approved" as const,
  mechanicsVersion: 3,
};

const workspace = {
  ...campaign,
  kind: "giveaway" as const,
  entryMode: "opt_in" as const,
  maxEntriesPerRider: 1,
  mechanics: "One rider receives one helmet.",
  terms: "Use the collection desk.",
  timeZone: "Asia/Manila",
  winnerLimits: { perRider: 1, total: 1 },
  publicVisibility: "event_page" as const,
  presenceVerificationRequired: true,
  eligibilityGroups: [],
  prizePools: [],
};

describe("giveaway operations routes", () => {
  test("loads the admin campaign rail through the scoped action and keeps action failure generic", async () => {
    mocks.listAdmin.mockResolvedValueOnce({ ok: true, code: "OK", data: [campaign] });

    const element = await AdminGiveawaysPage();

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.listAdmin).toHaveBeenCalledOnce();
    expect(element.props.giveawayContent.props).toMatchObject({
      initialCampaigns: [campaign],
      initialError: null,
    });
  });

  test("loads only the safe admin detail, audit, and assignment candidates for one campaign", async () => {
    mocks.getWorkspace.mockResolvedValueOnce({ ok: true, code: "OK", data: workspace });
    mocks.getAudit.mockResolvedValueOnce({
      ok: true,
      code: "OK",
      data: { giveawayId: campaign.id, events: [] },
    });
    mocks.listCandidates.mockResolvedValueOnce({
      ok: true,
      code: "OK",
      data: [{ id: "operator-1", label: "Claim desk" }],
    });

    const element = await AdminGiveawayDetailPage({
      params: Promise.resolve({ giveawayId: campaign.id }),
    });

    expect(mocks.getWorkspace).toHaveBeenCalledWith(campaign.id);
    expect(mocks.getAudit).toHaveBeenCalledWith(campaign.id);
    expect(mocks.listCandidates).toHaveBeenCalledWith(campaign.eventId);
    expect(element.props.giveawayContent.props).toMatchObject({
      giveawayId: campaign.id,
      initialWorkspace: workspace,
      initialAudit: { giveawayId: campaign.id, events: [] },
      initialCandidates: [{ id: "operator-1", label: "Claim desk" }],
    });
  });

  test("opens an event-scoped operator desk with queue data and optional safe assignment choices", async () => {
    mocks.listQueue.mockResolvedValueOnce({
      ok: true,
      code: "OK",
      data: [
        {
          awardId: "award-1",
          giveawayId: campaign.id,
          giveawayTitle: campaign.title,
          claimReference: "claim-01",
          prizePoolTitle: "Helmet",
          fulfilmentMode: "onsite",
          presenceVerificationRequired: true,
          status: "claimable",
        },
      ],
    });
    mocks.listOrganizer.mockResolvedValueOnce({ ok: true, code: "OK", data: [campaign] });
    mocks.listCandidates.mockResolvedValueOnce({
      ok: true,
      code: "OK",
      data: [{ id: "operator-1", label: "Claim desk" }],
    });

    const element = await GiveawayOpsPage({ params: Promise.resolve({ eventId: campaign.eventId }) });

    expect(mocks.listQueue).toHaveBeenCalledWith(campaign.eventId);
    expect(mocks.listOrganizer).toHaveBeenCalledWith(campaign.eventId);
    expect(mocks.listCandidates).toHaveBeenCalledWith(campaign.eventId);
    expect(element.props).toMatchObject({
      eventId: campaign.eventId,
      initialQueue: [expect.objectContaining({ awardId: "award-1" })],
      initialCampaigns: [campaign],
      initialCandidates: [{ id: "operator-1", label: "Claim desk" }],
    });
  });

  test("keeps the venue route to its safe event queue and an operator-desk link", async () => {
    mocks.listQueue.mockResolvedValueOnce({
      ok: true,
      code: "OK",
      data: [],
    });

    const element = await VenueGiveawaysPage({ params: Promise.resolve({ eventId: campaign.eventId }) });

    expect(mocks.listQueue).toHaveBeenCalledWith(campaign.eventId);
    expect(element.props).toMatchObject({
      eventId: campaign.eventId,
      initialQueue: [],
      initialError: null,
    });
  });
});

describe("giveaway operations UI boundaries", () => {
  test("uses real scoped actions and never reads the global demo snapshot or private delivery data", async () => {
    const sources = await Promise.all(
      [
        "../../src/features/giveaways/admin-giveaway-console.tsx",
        "../../src/features/giveaways/giveaway-operator-workspace.tsx",
        "../../src/features/giveaways/venue-giveaway-queue.tsx",
        "../../src/app/admin/giveaways/[giveawayId]/page.tsx",
        "../../src/app/giveaway-ops/[eventId]/page.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    const source = sources.join("\n");

    for (const action of [
      "reviewGiveawayComplianceAction",
      "suspendGiveawayAction",
      "voidGiveawayAwardAction",
      "disqualifyGiveawayAwardAction",
      "redrawGiveawayAwardAction",
      "getAdminGiveawayAuditAction",
      "listEventGiveawayOperatorClaimsAction",
      "grantGiveawayOperatorAction",
      "revokeGiveawayOperatorAction",
      "GiveawayClaimScannerPanel",
    ]) {
      expect(source).toContain(action);
    }

    expect(source).not.toMatch(/useDemo|DemoState|readGiveawayDeliveryDetailsAction|PrivateGiveawayDeliveryDetails|IssuedGiveawayClaimToken|sourceFact/i);
  });

  test("links the scoped giveaway workspaces from the existing admin and venue consoles", async () => {
    const [sidebarSource, adminSource, venueSource, operatorSource] = await Promise.all(
      [
        "../../src/components/app-sidebar.tsx",
        "../../src/features/admin/admin-console.tsx",
        "../../src/features/venue/venue-console.tsx",
        "../../src/features/giveaways/giveaway-operator-workspace.tsx",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

    expect(sidebarSource).toContain('href: "/admin/giveaways"');
    expect(sidebarSource).toContain('section: "giveaways"');
    expect(adminSource).toContain('section === "giveaways"');
    expect(venueSource).toContain("/venue/events/${activeEventId}/giveaways");
    expect(venueSource).toContain("Open giveaway claims");
    expect(operatorSource).toContain("/venue/events/${encodeURIComponent(eventId)}/giveaways");
    expect(operatorSource).not.toContain('href="/venue/events"');
  });
});
