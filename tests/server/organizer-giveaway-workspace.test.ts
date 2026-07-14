import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import { TooltipProvider } from "../../src/components/ui/tooltip";
import { OrganizerConsole } from "../../src/features/organizer/organizer-console";
import { DemoProvider } from "../../src/features/tambike-demo/demo-provider";
import { createTambikeTestBackend } from "../../src/server/testing";
import type {
  OrganizerGiveawayOperations,
  OrganizerGiveawayWorkspace as OrganizerGiveawayWorkspaceData,
} from "../../src/features/giveaways/types";
import {
  buildGiveawayLifecycleRoute,
  CampaignCancellationPanel,
  CampaignEntryOperations,
  CampaignManualSelectionOperations,
  CampaignOperationalHeader,
  OrganizerGiveawayWorkspace,
  RecoveryQueuePanel,
  resolveGiveawaySubmission,
  resolveInitialDrawSubmission,
  resolveManualSelectionSubmission,
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

  test("renders cancellation only when the server grants the current campaign capability", () => {
    const serverAllowedMarkup = renderToStaticMarkup(
      React.createElement(CampaignCancellationPanel, {
        state: "locked",
        canCancel: true,
        reason: "",
        isPending: false,
        onReasonChange: () => undefined,
        onCancel: () => undefined,
      } as unknown as React.ComponentProps<typeof CampaignCancellationPanel>),
    );
    const serverHiddenMarkup = renderToStaticMarkup(
      React.createElement(CampaignCancellationPanel, {
        state: "paused",
        canCancel: false,
        reason: "No longer needed",
        isPending: false,
        onReasonChange: () => undefined,
        onCancel: () => undefined,
      } as unknown as React.ComponentProps<typeof CampaignCancellationPanel>),
    );

    expect(serverAllowedMarkup).toContain("Cancel campaign before awards exist");
    expect(serverAllowedMarkup).toContain("Cancellation reason");
    expect(serverAllowedMarkup).toContain("Cancel campaign");
    expect(serverAllowedMarkup).toMatch(/disabled/);
    expect(serverHiddenMarkup).toBe("");
  });

  test("uses locked snapshot manual selection without offering a random-draw substitute", () => {
    const manualPools = [{ id: "manual-pool", title: "Community recognition", awardMode: "manual_selection" as const }];
    const manualMarkup = renderToStaticMarkup(
      React.createElement(CampaignManualSelectionOperations, {
        campaignId: "giveaway-manual",
        state: "locked",
        prizePools: manualPools,
        candidatesByPool: {
          "manual-pool": [{ snapshotEntryId: "snapshot-entry-1", label: "Locked entry entry_opaque" }],
        },
        inventoryStatusByPool: { "manual-pool": "ready" },
        isPending: false,
        onSelect: async () => false,
      }),
    );
    const preLockMarkup = renderToStaticMarkup(
      React.createElement(CampaignManualSelectionOperations, {
        campaignId: "giveaway-manual",
        state: "open",
        prizePools: manualPools,
        candidatesByPool: {},
        inventoryStatusByPool: {},
        isPending: false,
        onSelect: async () => false,
      }),
    );
    const lockedManualHeader = renderToStaticMarkup(
      React.createElement(CampaignOperationalHeader, {
        campaign: {
          id: "giveaway-manual",
          eventId: "event-1",
          title: "Manual award campaign",
          state: "locked",
          complianceStatus: "approved",
          mechanicsVersion: 1,
        },
        isPending: false,
        operations: {
          giveawayId: "giveaway-manual",
          canCancel: false,
          canRunInitialRandomDraw: false,
          presentationDrawId: null,
          publishableDrawId: null,
          recoverableAwards: [],
        },
        onSubmit: () => undefined,
        onSchedule: () => undefined,
        onOpen: () => undefined,
        onPause: () => undefined,
        onLock: () => undefined,
        onDraw: () => undefined,
        onPublish: () => undefined,
      }),
    );

    expect(manualMarkup).toContain("Manual award selection");
    expect(manualMarkup).toContain("Locked entry entry_opaque");
    expect(manualMarkup).toContain("Selection reason");
    expect(manualMarkup).toContain("Record selection");
    expect(manualMarkup).not.toContain("Run draw");
    expect(preLockMarkup).toBe("");
    expect(lockedManualHeader).not.toContain("Run draw");
  });

  test("keeps initial random draw and reload-safe publication controls server-owned", () => {
    const operations: OrganizerGiveawayOperations = {
      giveawayId: "giveaway-manual",
      canCancel: false,
      canRunInitialRandomDraw: true,
      presentationDrawId: "draw-opaque",
      publishableDrawId: "draw-opaque",
      recoverableAwards: [],
    };
    const publishBlockedProps = {
      campaign: {
        id: "giveaway-manual",
        eventId: "event-1",
        title: "Manual award campaign",
        state: "drawing" as const,
        complianceStatus: "approved" as const,
        mechanicsVersion: 1,
      },
      isPending: false,
      operations,
      hasAwardableManualSelections: true,
      onSubmit: () => undefined,
      onSchedule: () => undefined,
      onOpen: () => undefined,
      onPause: () => undefined,
      onLock: () => undefined,
      onDraw: () => undefined,
      onPublish: () => undefined,
    } as unknown as React.ComponentProps<typeof CampaignOperationalHeader>;

    const markup = renderToStaticMarkup(
      React.createElement(CampaignOperationalHeader, publishBlockedProps),
    );

    expect(markup).toContain("Run draw");
    expect(markup).toContain("Publish result");
    expect(markup).toContain("Complete the remaining manual selections before publishing.");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Publish result/);
  });

  test("uses a server-owned recovery queue without rendering raw terminal award IDs", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RecoveryQueuePanel, {
        recoverableAwards: [
          {
            awardId: "award-opaque-never-display",
            label: "Random redraw for Helmet pool",
            status: "voided",
            recoveryKind: "random_redraw",
            claimDeadlineRequired: true,
          },
        ],
        isPending: false,
        reason: "",
        claimDeadlineAt: "",
        onReasonChange: () => undefined,
        onClaimDeadlineAtChange: () => undefined,
        onRandomRedraw: async () => false,
        onDirectReoffer: () => undefined,
        onLoadManualReplacementOptions: async () => null,
        onReplaceManualAward: async () => false,
      }),
    );

    expect(markup).toContain("Random redraw for Helmet pool");
    expect(markup).toContain("New claim deadline");
    expect(markup).not.toContain("award-opaque-never-display");
    expect(markup).not.toContain("Terminal award ID");

    const manualMarkup = renderToStaticMarkup(
      React.createElement(RecoveryQueuePanel, {
        recoverableAwards: [
          {
            awardId: "manual-award-opaque-never-display",
            label: "Manual replacement for Sponsor pool",
            status: "voided",
            recoveryKind: "manual_replacement",
            claimDeadlineRequired: true,
          },
        ],
        isPending: false,
        reason: "",
        claimDeadlineAt: "",
        onReasonChange: () => undefined,
        onClaimDeadlineAtChange: () => undefined,
        onRandomRedraw: async () => false,
        onDirectReoffer: () => undefined,
        onLoadManualReplacementOptions: async () => null,
        onReplaceManualAward: async () => false,
      }),
    );
    expect(manualMarkup).toContain("Manual replacement");
    expect(manualMarkup).toContain("fresh future claim deadline is required");
    expect(manualMarkup).not.toContain("manual-award-opaque-never-display");
  });

  test("reuses idempotency keys only for identical manual and recovery submissions", () => {
    const manualInput = {
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      snapshotEntryId: "entry-1",
      reason: "Community contribution",
    };
    const firstManual = resolveManualSelectionSubmission(null, manualInput, () => "manual-key-1");

    expect(resolveManualSelectionSubmission(firstManual, manualInput, () => "manual-key-2")).toBe(firstManual);
    expect(
      resolveManualSelectionSubmission(firstManual, { ...manualInput, reason: "Updated reason" }, () => "manual-key-3"),
    ).toMatchObject({ idempotencyKey: "manual-key-3" });

    const firstRecovery = resolveGiveawaySubmission(null, "award|entry|reason|deadline", () => "recovery-key-1");
    expect(resolveGiveawaySubmission(firstRecovery, "award|entry|reason|deadline", () => "recovery-key-2")).toBe(firstRecovery);
    expect(resolveGiveawaySubmission(firstRecovery, "award|entry|new-reason|deadline", () => "recovery-key-3")).toMatchObject({
      idempotencyKey: "recovery-key-3",
    });

    const firstInitialDraw = resolveInitialDrawSubmission(null, "giveaway-1", () => "initial-key-1");
    expect(resolveInitialDrawSubmission(firstInitialDraw, "giveaway-1", () => "initial-key-2")).toBe(firstInitialDraw);
    expect(resolveInitialDrawSubmission(firstInitialDraw, "giveaway-2", () => "initial-key-3")).toMatchObject({
      idempotencyKey: "initial-key-3",
    });
  });
});
