import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import { TooltipProvider } from "../../src/components/ui/tooltip";
import { OrganizerConsole } from "../../src/features/organizer/organizer-console";
import { DemoProvider } from "../../src/features/tambike-demo/demo-provider";
import { createTambikeTestBackend } from "../../src/server/testing";
import type { OrganizerGiveawayWorkspace as OrganizerGiveawayWorkspaceData } from "../../src/features/giveaways/types";
import {
  buildGiveawayLifecycleRoute,
  CampaignEntryOperations,
  OrganizerGiveawayWorkspace,
  submitCampaignCode,
  toOrganizerGiveawayEditorDraft,
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

  test("hydrates only the scoped organizer configuration into an editable event-time-zone draft", () => {
    const workspace: OrganizerGiveawayWorkspaceData = {
      id: "giveaway-1",
      eventId: "event-1",
      title: "Rider helmet draw",
      kind: "raffle",
      state: "scheduled",
      complianceStatus: "approved",
      entryMode: "claim_code",
      maxEntriesPerRider: 3,
      mechanics: "One entry per code claim.",
      terms: "Claim by the stated deadline.",
      sponsorDisclosure: "Tambike partners",
      timeZone: "Asia/Manila",
      winnerLimits: { perRider: 1, total: 2 },
      publicVisibility: "eligible_riders",
      presenceVerificationRequired: true,
      entryOpensAt: "2026-08-17T09:30:00.000Z",
      entryClosesAt: "2026-08-17T10:30:00.000Z",
      drawAt: "2026-08-17T11:30:00.000Z",
      claimDeadlineAt: "2026-08-18T11:30:00.000Z",
      eligibilityGroups: [
        {
          id: "group-1",
          label: "Code claim",
          weight: 2,
          conditions: [{ source: "campaign_code" }],
        },
      ],
      prizePools: [
        {
          id: "pool-1",
          title: "Helmet pool",
          awardMode: "random_draw",
          fulfilmentMode: "onsite",
          inventory: { kind: "finite", quantity: 1 },
          items: [{ id: "item-1", title: "Ride helmet" }],
          eligibilityGroupIds: ["group-1"],
          presenceVerificationRequired: true,
        },
      ],
    };

    expect(toOrganizerGiveawayEditorDraft(workspace)).toMatchObject({
      title: "Rider helmet draw",
      entryMode: "claim_code",
      entryOpensAt: "2026-08-17T17:30",
      entryClosesAt: "2026-08-17T18:30",
      drawAt: "2026-08-17T19:30",
      claimDeadlineAt: "2026-08-18T19:30",
      eligibilityGroups: [expect.objectContaining({ id: "group-1", weight: 2 })],
      prizePools: [expect.objectContaining({ id: "pool-1", title: "Helmet pool" })],
    });
  });

  test("places Giveaways beside scanner and report links for the selected event", async () => {
    const backend = await createTambikeTestBackend();
    const organizer = await backend.loginWithPassword("marco.organizer@example.com", "password123");
    const event = await backend.createEventDraft(organizer.sessionToken, {
      title: "Giveaway navigation event",
      type: "Bike Night",
      venueId: "shell-pugon",
      date: "August 18, 2026",
      time: "7:00 PM - 10:00 PM",
      area: "Antipolo",
      expectedRiders: 40,
      perkPreview: "Prize draw",
    });
    const snapshot = await backend.getSnapshot(organizer.sessionToken);
    const consoleMarkup = React.createElement(OrganizerConsole, {
      section: "event",
      eventId: event.id,
    });
    const demoMarkup = React.createElement(
      DemoProvider,
      { initialState: snapshot } as React.ComponentProps<typeof DemoProvider>,
      consoleMarkup,
    );
    const markup = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        {} as React.ComponentProps<typeof TooltipProvider>,
        demoMarkup,
      ),
    );

    expect(markup).toContain("Giveaways");
    expect(markup).toContain(`/organizer/events/${event.id}/giveaways`);
  });

  test("keeps campaign-code and audited-manual entry controls mode-specific and secret-safe", () => {
    const codeMarkup = renderToStaticMarkup(
      React.createElement(CampaignEntryOperations, {
        campaignId: "giveaway-code",
        entryMode: "claim_code",
        state: "open",
        codeSummaries: [
          {
            id: "code-summary-1",
            maxUses: 30,
            usedUses: 12,
            expiresAt: "2026-08-18T12:00:00.000Z",
            createdAt: "2026-08-17T12:00:00.000Z",
            status: "active",
          },
        ],
        manualCandidates: [],
        issuedCode: {
          id: "code-summary-2",
          code: "gwy_visible_once",
          maxUses: 3,
          expiresAt: "2026-08-19T12:00:00.000Z",
        },
        isPending: false,
        onCreateCode: () => undefined,
        onDismissIssuedCode: () => undefined,
        onGrantManualEntry: () => undefined,
        onRevokeManualEntry: () => undefined,
      }),
    );

    expect(codeMarkup).toContain("Campaign-code access");
    expect(codeMarkup).toContain("Create campaign code");
    expect(codeMarkup).toContain("12 of 30 uses");
    expect(codeMarkup).toContain("gwy_visible_once");
    expect(codeMarkup).toContain("cannot be shown again");
    expect(codeMarkup).not.toContain("Audited manual entry");
    expect(codeMarkup).not.toContain("tokenHash");

    const manualMarkup = renderToStaticMarkup(
      React.createElement(CampaignEntryOperations, {
        campaignId: "giveaway-manual",
        entryMode: "manual_only",
        state: "open",
        codeSummaries: [],
        manualCandidates: [{ riderId: "rider-1", label: "Rider One" }],
        issuedCode: null,
        isPending: false,
        onCreateCode: () => undefined,
        onDismissIssuedCode: () => undefined,
        onGrantManualEntry: () => undefined,
        onRevokeManualEntry: () => undefined,
      }),
    );

    expect(manualMarkup).toContain("Audited manual entry");
    expect(manualMarkup).toContain("Rider One");
    expect(manualMarkup).toContain("Grant entry");
    expect(manualMarkup).toContain("Revoke entry");
    expect(manualMarkup).toContain("Reason for the audit trail");
    expect(manualMarkup).not.toContain("Campaign-code access");
    expect(manualMarkup).not.toContain("gwy_visible_once");
  });

  test("rejects a syntactically valid past campaign-code expiry before creating a code", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const onCreateCode = vi.fn();

    try {
      const inputError = submitCampaignCode({
        maxUsesInput: "3",
        expiresAtInput: "2029-12-31T23:59",
        onCreateCode,
      });

      expect(inputError).toBe("Choose a future expiry time.");
      expect(onCreateCode).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps the server-controlled default expiry when a campaign-code expiry is blank", () => {
    const onCreateCode = vi.fn();

    const inputError = submitCampaignCode({
      maxUsesInput: "3",
      expiresAtInput: "",
      onCreateCode,
    });

    expect(inputError).toBeNull();
    expect(onCreateCode).toHaveBeenCalledWith({ maxUses: 3 });
  });
});
