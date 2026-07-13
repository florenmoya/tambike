"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  FileLock2Icon,
  GiftIcon,
  Loader2Icon,
  LockKeyholeIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createGiveawayAction,
  createGiveawayCampaignCodeAction,
  getOrganizerGiveawayWorkspaceAction,
  getOrganizerGiveawayReportAction,
  grantManualGiveawayEntryAction,
  listGiveawayCampaignCodesAction,
  listGiveawayManualEntryCandidatesAction,
  listOrganizerGiveawaysAction,
  lockGiveawayAction,
  openGiveawayAction,
  pauseGiveawayAction,
  publishGiveawayDrawAction,
  redrawGiveawayAwardAction,
  revokeManualGiveawayEntryAction,
  runGiveawayDrawAction,
  scheduleGiveawayAction,
  submitGiveawayForReviewAction,
  updateGiveawayAction,
} from "@/server/giveaway-actions";
import type {
  CreateGiveawayCampaignCodeInput,
  CreateGiveawayInput,
  GiveawayAwardMode,
  GiveawayCampaignListItem,
  GiveawayCampaignCodeSummary,
  GiveawayComplianceStatus,
  GiveawayEligibilityConditionInput,
  GiveawayEligibilityGroupInput,
  GiveawayEntryMode,
  GiveawayFulfilmentMode,
  GiveawayKind,
  GiveawayManualEntryCandidate,
  GiveawayPrizePoolInput,
  GiveawayPublicVisibility,
  GiveawayState,
  IssuedGiveawayCampaignCode,
  OrganizerGiveawayWorkspace as OrganizerGiveawayWorkspaceData,
  OrganizerGiveawayReport,
  UpdateGiveawayInput,
} from "./types";

export type GiveawayLifecycleRouteStatus = "complete" | "active" | "hold" | "upcoming";

export type GiveawayLifecycleRouteStep = {
  id: "draft" | "review" | "scheduled" | "open" | "locked" | "drawing" | "claims_open" | "completed";
  label: string;
  status: GiveawayLifecycleRouteStatus;
};

const lifecycleSteps: Array<Pick<GiveawayLifecycleRouteStep, "id" | "label">> = [
  { id: "draft", label: "Draft" },
  { id: "review", label: "Review" },
  { id: "scheduled", label: "Scheduled" },
  { id: "open", label: "Open" },
  { id: "locked", label: "Locked" },
  { id: "drawing", label: "Draw" },
  { id: "claims_open", label: "Claims" },
  { id: "completed", label: "Complete" },
];

const lifecycleRank: Record<Exclude<GiveawayState, "paused" | "cancelled" | "suspended">, number> = {
  draft: 0,
  scheduled: 2,
  open: 3,
  locked: 4,
  drawing: 5,
  claims_open: 6,
  completed: 7,
};

/**
 * Keeps the workspace strip factual: review is a gate, while a pause is an
 * operational hold rather than an invented lifecycle phase.
 */
export function buildGiveawayLifecycleRoute(
  state: GiveawayState,
  complianceStatus: GiveawayComplianceStatus,
): GiveawayLifecycleRouteStep[] {
  const hasApprovedReview = complianceStatus === "approved";
  const currentRank = state === "paused" ? 3 : lifecycleRank[state as keyof typeof lifecycleRank] ?? 0;
  const isReviewActive = state === "draft" && complianceStatus === "pending_review";
  const isPaused = state === "paused";
  const isStopped = state === "cancelled" || state === "suspended";

  return lifecycleSteps.map((step, index) => {
    if (step.id === "review") {
      return {
        ...step,
        status: hasApprovedReview || currentRank > 0
          ? "complete"
          : isReviewActive || complianceStatus === "changes_requested" || complianceStatus === "rejected"
            ? "active"
            : "upcoming",
      };
    }

    if (step.id === "draft" && isReviewActive) {
      return { ...step, status: "complete" };
    }

    if (isPaused && step.id === "open") {
      return { ...step, status: "hold" };
    }

    if (isStopped && index === 0) {
      return { ...step, status: "hold" };
    }

    return {
      ...step,
      status: index < currentRank ? "complete" : index === currentRank ? "active" : "upcoming",
    };
  });
}

export type OrganizerGiveawayCampaign = GiveawayCampaignListItem;

type GiveawayEditorDraft = {
  title: string;
  kind: GiveawayKind;
  entryMode: GiveawayEntryMode;
  maxEntriesPerRider: number;
  mechanics: string;
  terms: string;
  sponsorDisclosure: string;
  timeZone: string;
  publicVisibility: GiveawayPublicVisibility;
  presenceVerificationRequired: boolean;
  winnerLimitPerRider: number;
  winnerLimitTotal: number;
  entryOpensAt: string;
  entryClosesAt: string;
  drawAt: string;
  claimDeadlineAt: string;
  eligibilityGroups: GiveawayEligibilityGroupInput[];
  prizePools: GiveawayPrizePoolInput[];
};

type DrawState = Record<string, string | undefined>;

type EntryOperationsInventoryStatus = "idle" | "loading" | "ready" | "error";

type IssuedCampaignCodeState = {
  campaignId: string;
  value: IssuedGiveawayCampaignCode;
};

type OrganizerGiveawayWorkspaceProps = {
  eventId: string;
  /**
   * A server-loaded scoped DTO may supply this on a future route pass. The
   * workspace never reads giveaway data from DemoState.
   */
  initialCampaigns?: OrganizerGiveawayCampaign[];
};

const entryModeOptions: Array<{ value: GiveawayEntryMode; label: string; detail: string }> = [
  { value: "automatic", label: "Automatic", detail: "Qualifying activity creates entries." },
  { value: "opt_in", label: "Opt in", detail: "Riders actively enter after accepting terms." },
  { value: "claim_code", label: "Campaign code", detail: "A campaign code creates a durable entry." },
  { value: "manual_only", label: "Manual only", detail: "Authorized organizers grant audited entries." },
];

const eligibilitySourceOptions: Array<{
  value: GiveawayEligibilityConditionInput["source"];
  label: string;
}> = [
  { value: "active_rsvp_pass", label: "Active RSVP or pass" },
  { value: "confirmed_check_in", label: "Confirmed check-in" },
  { value: "staff_confirmed_check_in", label: "Staff-confirmed check-in" },
  { value: "perk_redemption", label: "Named perk redemption" },
  { value: "campaign_code", label: "Campaign-code claim" },
  { value: "manual", label: "Audited manual entry" },
];

const awardModeOptions: Array<{ value: GiveawayAwardMode; label: string; detail: string }> = [
  { value: "random_draw", label: "Random draw", detail: "Deterministic ranking from the locked snapshot." },
  { value: "first_come", label: "First come", detail: "Truthful priority based on qualifying time." },
  { value: "guaranteed", label: "Guaranteed", detail: "Unlimited inventory only." },
  { value: "manual_selection", label: "Manual selection", detail: "Authorized selection from the locked snapshot." },
];

const fulfilmentOptions: Array<{ value: GiveawayFulfilmentMode; label: string }> = [
  { value: "onsite", label: "Onsite pickup" },
  { value: "digital_code", label: "Digital code" },
  { value: "delivery", label: "Delivery" },
  { value: "manual_contact", label: "Manual contact" },
];

export function OrganizerGiveawayWorkspace({
  eventId,
  initialCampaigns = [],
}: OrganizerGiveawayWorkspaceProps) {
  const [campaigns, setCampaigns] = React.useState<OrganizerGiveawayCampaign[]>(initialCampaigns);
  const [selectedCampaignId, setSelectedCampaignId] = React.useState<string | null>(
    initialCampaigns[0]?.id ?? null,
  );
  const [draftsByCampaignId, setDraftsByCampaignId] = React.useState<Record<string, GiveawayEditorDraft>>({});
  const [configurationFailures, setConfigurationFailures] = React.useState<Record<string, true>>({});
  const [editorDraft, setEditorDraft] = React.useState<GiveawayEditorDraft>(() => createEmptyDraft());
  const [report, setReport] = React.useState<{
    campaignId: string;
    value: OrganizerGiveawayReport;
  } | null>(null);
  const [draws, setDraws] = React.useState<DrawState>({});
  const [redrawAwardId, setRedrawAwardId] = React.useState("");
  const [redrawReason, setRedrawReason] = React.useState("");
  const [notice, setNotice] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [operationalEntryModes, setOperationalEntryModes] = React.useState<Record<string, GiveawayEntryMode>>({});
  const [campaignCodes, setCampaignCodes] = React.useState<Record<string, GiveawayCampaignCodeSummary[]>>({});
  const [manualEntryCandidates, setManualEntryCandidates] = React.useState<Record<string, GiveawayManualEntryCandidate[]>>({});
  const [entryOperationsInventoryStatus, setEntryOperationsInventoryStatus] = React.useState<
    Record<string, EntryOperationsInventoryStatus>
  >({});
  const [issuedCampaignCode, setIssuedCampaignCode] = React.useState<IssuedCampaignCodeState | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const selectedDraft = selectedCampaign ? draftsByCampaignId[selectedCampaign.id] : undefined;
  const selectedOperationalEntryMode = selectedCampaign
    ? operationalEntryModes[selectedCampaign.id]
    : undefined;

  const refreshCampaigns = React.useCallback(async () => {
    const result = await listOrganizerGiveawaysAction(eventId);
    if (!result.ok) {
      throw new Error("GIVEAWAY_LIST_UNAVAILABLE");
    }
    const nextCampaigns = result.data as OrganizerGiveawayCampaign[];
    setCampaigns(nextCampaigns);
    setSelectedCampaignId((current) =>
      current && nextCampaigns.some((campaign) => campaign.id === current)
        ? current
        : nextCampaigns[0]?.id ?? null,
    );
    setConfigurationFailures({});
    return nextCampaigns;
  }, [eventId]);

  React.useEffect(() => {
    if (initialCampaigns.length > 0) return;
    let cancelled = false;
    const loadCampaigns = async () => {
      try {
        const result = await listOrganizerGiveawaysAction(eventId);
        if (!result.ok) throw new Error("GIVEAWAY_LIST_UNAVAILABLE");
        if (cancelled) return;
        const nextCampaigns = result.data as OrganizerGiveawayCampaign[];
        setCampaigns(nextCampaigns);
        setSelectedCampaignId((current) =>
          current && nextCampaigns.some((campaign) => campaign.id === current)
            ? current
            : nextCampaigns[0]?.id ?? null,
        );
      } catch {
        if (!cancelled) {
        setNotice({
          tone: "error",
          text: "Giveaway campaigns could not be loaded. Confirm organizer access and try again.",
        });
        }
      }
    };
    void Promise.resolve().then(loadCampaigns);
    return () => {
      cancelled = true;
    };
  }, [eventId, initialCampaigns.length]);

  const selectedCampaignIdForConfiguration = selectedCampaign?.id;
  React.useEffect(() => {
    if (
      !selectedCampaignIdForConfiguration ||
      selectedDraft ||
      configurationFailures[selectedCampaignIdForConfiguration]
    ) {
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const result = await getOrganizerGiveawayWorkspaceAction(selectedCampaignIdForConfiguration);
        if (!result.ok) throw new Error("GIVEAWAY_WORKSPACE_UNAVAILABLE");
        if (cancelled) return;
        const workspace = result.data as OrganizerGiveawayWorkspaceData;
        setDraftsByCampaignId((current) => ({
          ...current,
          [selectedCampaignIdForConfiguration]: toOrganizerGiveawayEditorDraft(workspace),
        }));
        setOperationalEntryModes((current) => ({
          ...current,
          [selectedCampaignIdForConfiguration]: workspace.entryMode,
        }));
      } catch {
        if (!cancelled) {
          setConfigurationFailures((current) => ({
            ...current,
            [selectedCampaignIdForConfiguration]: true,
          }));
          setNotice({
            tone: "error",
            text: "This campaign's policy details are unavailable. Refresh after confirming organizer access.",
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [configurationFailures, selectedCampaignIdForConfiguration, selectedDraft]);

  const selectedCampaignIdForReport = selectedCampaign?.id;
  React.useEffect(() => {
    if (!selectedCampaignIdForReport) return;
    let cancelled = false;
    void getOrganizerGiveawayReportAction(selectedCampaignIdForReport).then((result) => {
      if (!cancelled && result.ok) {
        setReport({ campaignId: selectedCampaignIdForReport, value: result.data });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCampaignIdForReport]);

  const refreshEntryOperationsInventory = React.useCallback(
    async (giveawayId: string, entryMode: GiveawayEntryMode) => {
      if (entryMode !== "claim_code" && entryMode !== "manual_only") return;
      setEntryOperationsInventoryStatus((current) => ({ ...current, [giveawayId]: "loading" }));
      try {
        if (entryMode === "claim_code") {
          const result = await listGiveawayCampaignCodesAction(giveawayId);
          if (!result.ok) throw new Error("GIVEAWAY_CODE_INVENTORY_UNAVAILABLE");
          setCampaignCodes((current) => ({
            ...current,
            [giveawayId]: result.data as GiveawayCampaignCodeSummary[],
          }));
        } else {
          const result = await listGiveawayManualEntryCandidatesAction(giveawayId);
          if (!result.ok) throw new Error("GIVEAWAY_MANUAL_CANDIDATES_UNAVAILABLE");
          setManualEntryCandidates((current) => ({
            ...current,
            [giveawayId]: result.data as GiveawayManualEntryCandidate[],
          }));
        }
        setEntryOperationsInventoryStatus((current) => ({ ...current, [giveawayId]: "ready" }));
      } catch (error) {
        setEntryOperationsInventoryStatus((current) => ({ ...current, [giveawayId]: "error" }));
        throw error;
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!selectedCampaign || !selectedOperationalEntryMode) return;
    if (selectedOperationalEntryMode !== "claim_code" && selectedOperationalEntryMode !== "manual_only") {
      return;
    }
    void Promise.resolve()
      .then(() => refreshEntryOperationsInventory(selectedCampaign.id, selectedOperationalEntryMode))
      .catch(() => undefined);
  }, [refreshEntryOperationsInventory, selectedCampaign, selectedOperationalEntryMode]);

  const runWorkspaceAction = React.useCallback(
    (successText: string, action: () => Promise<{ ok: boolean }>) => {
      setNotice(null);
      startTransition(async () => {
        try {
          const result = await action();
          if (!result.ok) throw new Error("GIVEAWAY_ACTION_UNAVAILABLE");
          await refreshCampaigns();
          setNotice({ tone: "success", text: successText });
        } catch {
          setNotice({
            tone: "error",
            text: "That operation could not be completed. Check the campaign stage and organizer permissions, then try again.",
          });
        }
      });
    },
    [refreshCampaigns, startTransition],
  );

  const createCampaignCode = React.useCallback(
    (input: CreateGiveawayCampaignCodeInput) => {
      if (!selectedCampaign || selectedOperationalEntryMode !== "claim_code") return;
      setNotice(null);
      startTransition(async () => {
        try {
          const result = await createGiveawayCampaignCodeAction(selectedCampaign.id, input);
          if (!result.ok) throw new Error("GIVEAWAY_CODE_CREATE_UNAVAILABLE");
          const issued = result.data as IssuedGiveawayCampaignCode;
          setIssuedCampaignCode({ campaignId: selectedCampaign.id, value: issued });
          await refreshEntryOperationsInventory(selectedCampaign.id, "claim_code").catch(() => undefined);
          setNotice({
            tone: "success",
            text: "Campaign code created. Copy it from the confirmation now; it cannot be shown again after dismissal.",
          });
        } catch {
          setNotice({
            tone: "error",
            text: "Campaign code was not created. Confirm this campaign uses campaign-code entry, is in an allowed stage, and that you have organizer access.",
          });
        }
      });
    },
    [refreshEntryOperationsInventory, selectedCampaign, selectedOperationalEntryMode, startTransition],
  );

  const changeManualEntry = React.useCallback(
    (operation: "grant" | "revoke", riderId: string, reason: string) => {
      if (!selectedCampaign || selectedOperationalEntryMode !== "manual_only") return;
      setNotice(null);
      startTransition(async () => {
        try {
          const result = operation === "grant"
            ? await grantManualGiveawayEntryAction({
                giveawayId: selectedCampaign.id,
                riderId,
                reason,
              })
            : await revokeManualGiveawayEntryAction({
                giveawayId: selectedCampaign.id,
                riderId,
                reason,
              });
          if (!result.ok) throw new Error("GIVEAWAY_MANUAL_ENTRY_UNAVAILABLE");
          await refreshEntryOperationsInventory(selectedCampaign.id, "manual_only").catch(() => undefined);
          setNotice({
            tone: "success",
            text: operation === "grant"
              ? "Audited manual entry granted. The campaign record has been updated."
              : "Audited manual entry revoked. The campaign record has been updated.",
          });
        } catch {
          setNotice({
            tone: "error",
            text: "Manual entry was not changed. It is available only while this campaign is open and you have organizer access.",
          });
        }
      });
    },
    [refreshEntryOperationsInventory, selectedCampaign, selectedOperationalEntryMode, startTransition],
  );

  const selectCampaign = React.useCallback(
    (campaign: OrganizerGiveawayCampaign) => {
      setSelectedCampaignId(campaign.id);
      setEditorDraft(draftsByCampaignId[campaign.id] ?? createEmptyDraft());
      setIssuedCampaignCode(null);
      setNotice(null);
    },
    [draftsByCampaignId],
  );

  const createOrSaveCampaign = React.useCallback(() => {
    setNotice(null);
    startTransition(async () => {
      try {
        if (!selectedCampaign) {
          const input = toCreateGiveawayInput(eventId, editorDraft);
          const result = await createGiveawayAction(input);
          if (!result.ok) throw new Error("GIVEAWAY_CREATE_UNAVAILABLE");
          const campaign = result.data as OrganizerGiveawayCampaign;
          setDraftsByCampaignId((current) => ({ ...current, [campaign.id]: editorDraft }));
          setOperationalEntryModes((current) => ({ ...current, [campaign.id]: editorDraft.entryMode }));
          setSelectedCampaignId(campaign.id);
          await refreshCampaigns();
          setNotice({ tone: "success", text: "Campaign saved as a draft. Submit it for compliance review when the policy is final." });
          return;
        }

        if (!selectedDraft) {
          setNotice({
            tone: "error",
            text: "This campaign's policy details have not loaded yet, so no changes were saved.",
          });
          return;
        }

        const input = toUpdateGiveawayInput(selectedCampaign.id, selectedDraft);
        const result = await updateGiveawayAction(input);
        if (!result.ok) throw new Error("GIVEAWAY_UPDATE_UNAVAILABLE");
        setDraftsByCampaignId((current) => ({ ...current, [selectedCampaign.id]: selectedDraft }));
        setOperationalEntryModes((current) => ({
          ...current,
          [selectedCampaign.id]: selectedDraft.entryMode,
        }));
        if (selectedDraft.entryMode !== "claim_code") setIssuedCampaignCode(null);
        await refreshCampaigns();
        setNotice({ tone: "success", text: "Campaign policy and terms were saved. Compliance review is required again after policy changes." });
      } catch (error) {
        setNotice({
          tone: "error",
          text: error instanceof Error && error.message === "SCHEDULE_REQUIRED"
            ? "Enter all four schedule timestamps or leave the schedule blank for manual operation."
            : "Campaign policy was not saved. Check required fields, prize inventory, and allowed campaign stage.",
        });
      }
    });
  }, [editorDraft, eventId, refreshCampaigns, selectedCampaign, selectedDraft, startTransition]);

  const runInitialDraw = React.useCallback(() => {
    if (!selectedCampaign) return;
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await runGiveawayDrawAction({
          giveawayId: selectedCampaign.id,
          idempotencyKey: makeIdempotencyKey("initial-draw"),
          reason: "Organizer initiated initial draw",
        });
        if (!result.ok) throw new Error("GIVEAWAY_DRAW_UNAVAILABLE");
        const drawId = (result.data as { drawId?: string }).drawId;
        if (!drawId) throw new Error("GIVEAWAY_DRAW_UNAVAILABLE");
        setDraws((current) => ({ ...current, [selectedCampaign.id]: drawId }));
        await refreshCampaigns();
        setNotice({ tone: "success", text: "The initial draw is ready for review. Publish only after you have checked the result." });
      } catch {
        setNotice({ tone: "error", text: "The draw could not run. Lock the campaign first and try again." });
      }
    });
  }, [refreshCampaigns, selectedCampaign, startTransition]);

  const publishInitialDraw = React.useCallback(() => {
    if (!selectedCampaign || !draws[selectedCampaign.id]) return;
    runWorkspaceAction("Draw published. Winners can now see their claim status.", () =>
      publishGiveawayDrawAction(selectedCampaign.id, draws[selectedCampaign.id]!),
    );
  }, [draws, runWorkspaceAction, selectedCampaign]);

  const redrawAward = React.useCallback(() => {
    if (!selectedCampaign || !redrawAwardId.trim() || !redrawReason.trim()) return;
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await redrawGiveawayAwardAction({
          awardId: redrawAwardId.trim(),
          idempotencyKey: makeIdempotencyKey("redraw"),
          reason: redrawReason.trim(),
        });
        if (!result.ok) throw new Error("GIVEAWAY_REDRAW_UNAVAILABLE");
        await refreshCampaigns();
        setRedrawAwardId("");
        setRedrawReason("");
        setNotice({ tone: "success", text: "Redraw recorded from the original locked snapshot." });
      } catch {
        setNotice({ tone: "error", text: "The redraw was not accepted. Use a current, terminal award and a new idempotency key." });
      }
    });
  }, [redrawAwardId, redrawReason, refreshCampaigns, selectedCampaign, startTransition]);

  return (
    <div className="grid gap-4 px-4 pb-8 lg:px-6">
      <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-1">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <GiftIcon className="size-4" />
            Giveaway operations
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Fair campaign control for this event</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Configure mechanics before entries exist, then use the route below to make each policy, draw, and claim step deliberate.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refreshCampaigns()} disabled={isPending}>
          <RefreshCwIcon data-icon="inline-start" className={cn(isPending && "animate-spin")} />
          Refresh
        </Button>
      </section>

      {notice ? <WorkspaceNotice {...notice} /> : null}

      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <CampaignRail
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          onCreate={() => {
            setSelectedCampaignId(null);
            setEditorDraft(createEmptyDraft());
            setReport(null);
            setIssuedCampaignCode(null);
            setNotice(null);
          }}
          onSelect={selectCampaign}
        />

        <div className="grid min-w-0 gap-4">
          {selectedCampaign ? (
            <CampaignOperationalHeader
              campaign={selectedCampaign}
              isPending={isPending}
              drawId={draws[selectedCampaign.id]}
              onSubmit={() => runWorkspaceAction("Campaign sent for compliance review.", () => submitGiveawayForReviewAction(selectedCampaign.id))}
              onSchedule={() => runWorkspaceAction("Campaign scheduled. Automatic lifecycle work remains server-controlled.", () => scheduleGiveawayAction(selectedCampaign.id))}
              onOpen={() => runWorkspaceAction("Campaign is open for qualifying entries.", () => openGiveawayAction(selectedCampaign.id))}
              onPause={() => runWorkspaceAction("Campaign paused. Staff and organizer recovery controls remain available.", () => pauseGiveawayAction(selectedCampaign.id))}
              onLock={() => runWorkspaceAction("Candidate snapshot locked. Configuration is now frozen.", () => lockGiveawayAction(selectedCampaign.id))}
              onDraw={runInitialDraw}
              onPublish={publishInitialDraw}
            />
          ) : (
            <NewCampaignHeader />
          )}

          <CampaignEditor
            draft={selectedDraft ?? editorDraft}
            onChange={setEditorDraft}
            onSave={createOrSaveCampaign}
            isPending={isPending}
            isExisting={Boolean(selectedCampaign)}
            configurationStatus={
              !selectedCampaign || selectedDraft
                ? "ready"
                : configurationFailures[selectedCampaign.id]
                  ? "unavailable"
                  : "loading"
            }
          />

          {selectedCampaign && selectedOperationalEntryMode ? (
            <CampaignEntryOperations
              key={`${selectedCampaign.id}:${selectedOperationalEntryMode}`}
              campaignId={selectedCampaign.id}
              entryMode={selectedOperationalEntryMode}
              state={selectedCampaign.state}
              codeSummaries={campaignCodes[selectedCampaign.id] ?? []}
              manualCandidates={manualEntryCandidates[selectedCampaign.id] ?? []}
              issuedCode={
                issuedCampaignCode?.campaignId === selectedCampaign.id
                  ? issuedCampaignCode.value
                  : null
              }
              inventoryStatus={entryOperationsInventoryStatus[selectedCampaign.id] ?? "idle"}
              isPending={isPending}
              onCreateCode={createCampaignCode}
              onDismissIssuedCode={() => setIssuedCampaignCode(null)}
              onGrantManualEntry={(riderId, reason) => changeManualEntry("grant", riderId, reason)}
              onRevokeManualEntry={(riderId, reason) => changeManualEntry("revoke", riderId, reason)}
            />
          ) : null}

          {selectedCampaign ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <CampaignReport
                report={report?.campaignId === selectedCampaign.id ? report.value : null}
              />
              <RedrawPanel
                disabled={isPending || selectedCampaign.state !== "claims_open"}
                awardId={redrawAwardId}
                reason={redrawReason}
                onAwardIdChange={setRedrawAwardId}
                onReasonChange={setRedrawReason}
                onRedraw={redrawAward}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CampaignRail({
  campaigns,
  selectedCampaignId,
  onCreate,
  onSelect,
}: {
  campaigns: OrganizerGiveawayCampaign[];
  selectedCampaignId: string | null;
  onCreate: () => void;
  onSelect: (campaign: OrganizerGiveawayCampaign) => void;
}) {
  return (
    <Card className="h-fit">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Campaigns</CardTitle>
            <CardDescription>Each campaign has its own locked candidate set and audit trail.</CardDescription>
          </div>
          <Button type="button" size="icon" variant="outline" aria-label="Create campaign" onClick={onCreate}>
            <PlusIcon />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
            Create the first campaign when its terms and prize policy are ready.
          </div>
        ) : (
          campaigns.map((campaign) => (
            <button
              key={campaign.id}
              type="button"
              onClick={() => onSelect(campaign)}
              className={cn(
                "grid w-full gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selectedCampaignId === campaign.id ? "border-primary bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <span className="truncate font-medium">{campaign.title}</span>
              <span className="flex flex-wrap gap-1.5">
                <StateBadge state={campaign.state} />
                <ComplianceBadge complianceStatus={campaign.complianceStatus} />
              </span>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function CampaignOperationalHeader({
  campaign,
  isPending,
  drawId,
  onSubmit,
  onSchedule,
  onOpen,
  onPause,
  onLock,
  onDraw,
  onPublish,
}: {
  campaign: OrganizerGiveawayCampaign;
  isPending: boolean;
  drawId?: string;
  onSubmit: () => void;
  onSchedule: () => void;
  onOpen: () => void;
  onPause: () => void;
  onLock: () => void;
  onDraw: () => void;
  onPublish: () => void;
}) {
  const lifecycle = buildGiveawayLifecycleRoute(campaign.state, campaign.complianceStatus);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 border-b bg-muted/20">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{campaign.title}</CardTitle>
              <StateBadge state={campaign.state} />
              <ComplianceBadge complianceStatus={campaign.complianceStatus} />
            </div>
            <CardDescription>Mechanics version {campaign.mechanicsVersion}. The route reflects the campaign’s factual server state.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {campaign.state === "draft" && ["draft", "changes_requested", "rejected"].includes(campaign.complianceStatus) ? (
              <Button type="button" size="sm" onClick={onSubmit} disabled={isPending}>
                <SendIcon data-icon="inline-start" />
                Submit review
              </Button>
            ) : null}
            {campaign.state === "draft" && campaign.complianceStatus === "approved" ? (
              <Button type="button" size="sm" onClick={onSchedule} disabled={isPending}>
                <Clock3Icon data-icon="inline-start" />
                Schedule
              </Button>
            ) : null}
            {campaign.state === "scheduled" || campaign.state === "paused" ? (
              <Button type="button" size="sm" onClick={onOpen} disabled={isPending}>
                <PlayCircleIcon data-icon="inline-start" />
                {campaign.state === "paused" ? "Resume" : "Open now"}
              </Button>
            ) : null}
            {["scheduled", "open"].includes(campaign.state) ? (
              <Button type="button" size="sm" variant="outline" onClick={onPause} disabled={isPending}>
                <PauseCircleIcon data-icon="inline-start" />
                Pause
              </Button>
            ) : null}
            {campaign.state === "open" ? (
              <Button type="button" size="sm" variant="outline" onClick={onLock} disabled={isPending}>
                <LockKeyholeIcon data-icon="inline-start" />
                Lock candidates
              </Button>
            ) : null}
            {campaign.state === "locked" ? (
              <Button type="button" size="sm" onClick={onDraw} disabled={isPending}>
                <SparklesIcon data-icon="inline-start" />
                Run draw
              </Button>
            ) : null}
            {campaign.state === "drawing" && drawId ? (
              <Button type="button" size="sm" onClick={onPublish} disabled={isPending}>
                <CheckCircle2Icon data-icon="inline-start" />
                Publish result
              </Button>
            ) : null}
          </div>
        </div>
        <LifecycleRouteStrip lifecycle={lifecycle} />
      </CardHeader>
    </Card>
  );
}

function NewCampaignHeader() {
  return (
    <Card className="border-dashed bg-muted/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <PlusIcon className="size-5 text-primary" />
          <CardTitle>New giveaway campaign</CardTitle>
        </div>
        <CardDescription>
          Define the policy, prize inventory, and terms as one configuration. Saving an existing campaign resets compliance review when mechanics change.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function LifecycleRouteStrip({ lifecycle }: { lifecycle: GiveawayLifecycleRouteStep[] }) {
  return (
    <ol aria-label="Campaign lifecycle" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {lifecycle.map((step, index) => (
        <li key={step.id} className="min-w-0">
          <div
            className={cn(
              "flex min-h-12 items-center gap-2 rounded-md border px-2.5 text-xs",
              step.status === "complete" && "border-emerald-200 bg-emerald-50 text-emerald-950",
              step.status === "active" && "border-primary/30 bg-primary/10 text-foreground",
              step.status === "hold" && "border-amber-200 bg-amber-50 text-amber-950",
              step.status === "upcoming" && "bg-background text-muted-foreground",
            )}
          >
            <span className="font-mono text-[10px] opacity-70">{String(index + 1).padStart(2, "0")}</span>
            <span className="truncate font-medium">{step.status === "hold" ? `Paused at ${step.label.toLowerCase()}` : step.label}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CampaignEditor({
  draft,
  onChange,
  onSave,
  isPending,
  isExisting,
  configurationStatus,
}: {
  draft: GiveawayEditorDraft;
  onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>;
  onSave: () => void;
  isPending: boolean;
  isExisting: boolean;
  configurationStatus: "ready" | "loading" | "unavailable";
}) {
  if (configurationStatus !== "ready") {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>
            {configurationStatus === "loading" ? "Policy details are loading" : "Policy details are unavailable"}
          </CardTitle>
          <CardDescription>
            {configurationStatus === "loading"
              ? "This workspace has the campaign summary, but not its scoped policy data. Its mechanics and terms stay protected until the organizer-only configuration is available."
              : "No policy fields can be changed until this organizer-only configuration is available. Refresh to try again."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Policy and terms</CardTitle>
          <CardDescription>
            Set exactly how riders qualify, whether they need to opt in, and what organizers attest to before review.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Campaign title">
              <Input value={draft.title} onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))} placeholder="Helmet draw" />
            </Field>
            <Field label="Campaign type">
              <select className={selectClassName} value={draft.kind} onChange={(event) => onChange((current) => ({ ...current, kind: event.target.value as GiveawayKind }))}>
                <option value="raffle">Raffle</option>
                <option value="giveaway">Giveaway</option>
              </select>
            </Field>
            <Field label="Entry mode">
              <select className={selectClassName} value={draft.entryMode} onChange={(event) => onChange((current) => ({ ...current, entryMode: event.target.value as GiveawayEntryMode }))}>
                {entryModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">{entryModeOptions.find((option) => option.value === draft.entryMode)?.detail}</p>
            </Field>
            <Field label="Visibility">
              <select className={selectClassName} value={draft.publicVisibility} onChange={(event) => onChange((current) => ({ ...current, publicVisibility: event.target.value as GiveawayPublicVisibility }))}>
                <option value="hidden">Hidden until ready</option>
                <option value="event_page">Event page</option>
                <option value="registered_riders">Registered riders</option>
                <option value="eligible_riders">Eligible riders</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Mechanics">
              <textarea className={textareaClassName} value={draft.mechanics} onChange={(event) => onChange((current) => ({ ...current, mechanics: event.target.value }))} placeholder="Describe how entries and winner limits work." />
            </Field>
            <Field label="Terms">
              <textarea className={textareaClassName} value={draft.terms} onChange={(event) => onChange((current) => ({ ...current, terms: event.target.value }))} placeholder="State eligibility, timing, claims, and fulfilment terms." />
            </Field>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field label="Sponsor disclosure (optional)">
              <Input value={draft.sponsorDisclosure} onChange={(event) => onChange((current) => ({ ...current, sponsorDisclosure: event.target.value }))} placeholder="Provided by …" />
            </Field>
            <Field label="Campaign time zone">
              <Input value={draft.timeZone} onChange={(event) => onChange((current) => ({ ...current, timeZone: event.target.value }))} placeholder="Asia/Manila" />
            </Field>
            <label className="flex min-h-9 items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={draft.presenceVerificationRequired} onChange={(event) => onChange((current) => ({ ...current, presenceVerificationRequired: event.target.checked }))} />
              Verify presence
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Max entries per rider"><Input min={1} type="number" value={draft.maxEntriesPerRider} onChange={(event) => onChange((current) => ({ ...current, maxEntriesPerRider: numberOr(current.maxEntriesPerRider, event.target.value) }))} /></Field>
            <Field label="Winner limit per rider"><Input min={1} type="number" value={draft.winnerLimitPerRider} onChange={(event) => onChange((current) => ({ ...current, winnerLimitPerRider: numberOr(current.winnerLimitPerRider, event.target.value) }))} /></Field>
            <Field label="Winner limit total"><Input min={1} type="number" value={draft.winnerLimitTotal} onChange={(event) => onChange((current) => ({ ...current, winnerLimitTotal: numberOr(current.winnerLimitTotal, event.target.value) }))} /></Field>
          </div>
        </CardContent>
      </Card>

      <EligibilityBuilder draft={draft} onChange={onChange} />
      <PrizePoolBuilder draft={draft} onChange={onChange} />
      <ScheduleBuilder draft={draft} onChange={onChange} />

      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean((draft as GiveawayEditorDraft & { organizerAttestation?: boolean }).organizerAttestation ?? true)}
              onChange={() => undefined}
              aria-label="Organizer attestation"
              disabled
            />
            <span>I attest that the mechanics, inventory, eligibility, and claim terms are accurate for this event.</span>
          </label>
          <Button type="button" onClick={onSave} disabled={isPending}>
            {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <FileLock2Icon data-icon="inline-start" />}
            {isExisting ? "Save policy" : "Create campaign"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Entry-mode-specific organizer controls. The raw campaign code exists only
 * in the creation response held by the client; the inventory below accepts
 * safe summaries and never has access to a code hash or claimant facts.
 */
export function CampaignEntryOperations({
  campaignId,
  entryMode,
  state,
  codeSummaries,
  manualCandidates,
  issuedCode,
  inventoryStatus = "idle",
  isPending,
  onCreateCode,
  onDismissIssuedCode,
  onGrantManualEntry,
  onRevokeManualEntry,
}: {
  campaignId: string;
  entryMode: GiveawayEntryMode;
  state: GiveawayState;
  codeSummaries: GiveawayCampaignCodeSummary[];
  manualCandidates: GiveawayManualEntryCandidate[];
  issuedCode: IssuedGiveawayCampaignCode | null;
  inventoryStatus?: EntryOperationsInventoryStatus;
  isPending: boolean;
  onCreateCode: (input: CreateGiveawayCampaignCodeInput) => void;
  onDismissIssuedCode: () => void;
  onGrantManualEntry: (riderId: string, reason: string) => void;
  onRevokeManualEntry: (riderId: string, reason: string) => void;
}) {
  if (entryMode === "claim_code") {
    return (
      <CampaignCodeControls
        campaignId={campaignId}
        state={state}
        codeSummaries={codeSummaries}
        issuedCode={issuedCode}
        inventoryStatus={inventoryStatus}
        isPending={isPending}
        onCreateCode={onCreateCode}
        onDismissIssuedCode={onDismissIssuedCode}
      />
    );
  }

  if (entryMode === "manual_only") {
    return (
      <ManualEntryControls
        campaignId={campaignId}
        state={state}
        candidates={manualCandidates}
        inventoryStatus={inventoryStatus}
        isPending={isPending}
        onGrant={onGrantManualEntry}
        onRevoke={onRevokeManualEntry}
      />
    );
  }

  return null;
}

function CampaignCodeControls({
  campaignId,
  state,
  codeSummaries,
  issuedCode,
  inventoryStatus,
  isPending,
  onCreateCode,
  onDismissIssuedCode,
}: {
  campaignId: string;
  state: GiveawayState;
  codeSummaries: GiveawayCampaignCodeSummary[];
  issuedCode: IssuedGiveawayCampaignCode | null;
  inventoryStatus: EntryOperationsInventoryStatus;
  isPending: boolean;
  onCreateCode: (input: CreateGiveawayCampaignCodeInput) => void;
  onDismissIssuedCode: () => void;
}) {
  const [maxUsesInput, setMaxUsesInput] = React.useState("1");
  const [expiresAtInput, setExpiresAtInput] = React.useState("");
  const [inputError, setInputError] = React.useState<string | null>(null);
  const canCreate = ["draft", "scheduled", "open", "paused"].includes(state);

  const createCode = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInputError(submitCampaignCode({ maxUsesInput, expiresAtInput, onCreateCode }));
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle>Campaign-code access</CardTitle>
        <CardDescription>
          Create a rider-facing campaign code and monitor only its safe capacity and expiry. Existing code values are never recovered from this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {issuedCode ? (
          <section
            aria-live="polite"
            className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950"
          >
            <div className="grid gap-1">
              <span className="text-sm font-semibold">Copy this new code now</span>
              <p className="text-sm">
                It is shown only in this confirmation and cannot be shown again after dismissal.
              </p>
            </div>
            <Field label="New code (shown once)">
              <Input
                aria-label="New campaign code shown once"
                value={issuedCode.code}
                readOnly
                className="font-mono text-xs"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>{issuedCode.maxUses} allowed uses</span>
              <span aria-hidden="true">•</span>
              <span>Expires {formatEntryOperationsDateTime(issuedCode.expiresAt)}</span>
            </div>
            <Button type="button" variant="outline" className="w-fit" onClick={onDismissIssuedCode}>
              I copied this code
            </Button>
          </section>
        ) : null}

        <form className="grid gap-3 rounded-lg border bg-muted/20 p-3" onSubmit={createCode}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] md:items-end">
            <Field label="Maximum uses">
              <Input
                min={1}
                inputMode="numeric"
                type="number"
                value={maxUsesInput}
                onChange={(event) => setMaxUsesInput(event.target.value)}
                disabled={isPending || !canCreate}
              />
            </Field>
            <Field label="Expiry (your local time, optional)">
              <Input
                type="datetime-local"
                value={expiresAtInput}
                onChange={(event) => setExpiresAtInput(event.target.value)}
                disabled={isPending || !canCreate}
              />
            </Field>
            <Button type="submit" disabled={isPending || !canCreate}>
              {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              Create campaign code
            </Button>
          </div>
          {inputError ? <p role="alert" className="text-sm text-destructive">{inputError}</p> : null}
          {!canCreate ? (
            <p className="text-xs text-muted-foreground">
              Campaign codes can be created only in draft, scheduled, open, or paused campaigns. This campaign is {formatState(state)}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Leave expiry blank to use the server-controlled 24-hour default.</p>
          )}
        </form>

        <section aria-labelledby={`${campaignId}-code-status`} className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${campaignId}-code-status`} className="text-sm font-semibold">Safe code status</h3>
            <span className="text-xs text-muted-foreground">No code values, hashes, or claimant details are listed.</span>
          </div>
          {inventoryStatus === "loading" || inventoryStatus === "idle" ? (
            <p className="text-sm text-muted-foreground">Loading code capacity and expiry…</p>
          ) : null}
          {inventoryStatus === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              Code status could not be loaded. Confirm organizer access and that this campaign still uses campaign-code entry.
            </p>
          ) : null}
          {inventoryStatus === "ready" && codeSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No campaign codes have been created yet.</p>
          ) : null}
          {codeSummaries.length > 0 ? (
            <ul className="grid gap-2">
              {codeSummaries.map((code, index) => (
                <li key={code.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                  <span className="font-medium">Code {index + 1} · {formatState(code.status)}</span>
                  <span className="text-muted-foreground">
                    {code.usedUses} of {code.maxUses} uses · Expires {formatEntryOperationsDateTime(code.expiresAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

export function submitCampaignCode({
  maxUsesInput,
  expiresAtInput,
  onCreateCode,
}: {
  maxUsesInput: string;
  expiresAtInput: string;
  onCreateCode: (input: CreateGiveawayCampaignCodeInput) => void;
}): string | null {
  const maxUses = Number(maxUsesInput);
  const expiresAt = optionalLocalDateTimeToIso(expiresAtInput);
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    return "Enter a whole number of uses greater than zero.";
  }
  if (expiresAtInput && !expiresAt) {
    return "Enter a valid future expiry time or leave it blank for the 24-hour default.";
  }
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return "Choose a future expiry time.";
  }

  onCreateCode({ maxUses, ...(expiresAt ? { expiresAt } : {}) });
  return null;
}

function ManualEntryControls({
  campaignId,
  state,
  candidates,
  inventoryStatus,
  isPending,
  onGrant,
  onRevoke,
}: {
  campaignId: string;
  state: GiveawayState;
  candidates: GiveawayManualEntryCandidate[];
  inventoryStatus: EntryOperationsInventoryStatus;
  isPending: boolean;
  onGrant: (riderId: string, reason: string) => void;
  onRevoke: (riderId: string, reason: string) => void;
}) {
  const [riderId, setRiderId] = React.useState(candidates[0]?.riderId ?? "");
  const [reason, setReason] = React.useState("");
  const canManage = state === "open";
  const selectedRiderId = candidates.some((candidate) => candidate.riderId === riderId)
    ? riderId
    : candidates[0]?.riderId ?? "";
  const canSubmit = canManage && !isPending && Boolean(selectedRiderId) && Boolean(reason.trim());

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle>Audited manual entry</CardTitle>
        <CardDescription>
          Select an eligible rider by display label, record a reason, then grant or revoke a manual campaign entry. This does not check anyone in or redeem a perk.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!canManage ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Manual entry is available only while the campaign is open. Current state: {formatState(state)}.
          </p>
        ) : null}
        {inventoryStatus === "loading" || inventoryStatus === "idle" ? (
          <p className="text-sm text-muted-foreground">Loading eligible rider labels…</p>
        ) : null}
        {inventoryStatus === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            Eligible rider labels could not be loaded. Confirm organizer access and that this campaign is manual-only.
          </p>
        ) : null}
        {inventoryStatus === "ready" && candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No eligible rider labels are available for manual entry right now.</p>
        ) : null}

        <fieldset className="grid gap-3 rounded-lg border bg-muted/20 p-3" disabled={!canManage || isPending || candidates.length === 0}>
          <Field label="Eligible rider">
            <select
              id={`${campaignId}-manual-rider`}
              className={selectClassName}
              value={selectedRiderId}
              onChange={(event) => setRiderId(event.target.value)}
            >
              {candidates.map((candidate) => (
                <option key={candidate.riderId} value={candidate.riderId}>{candidate.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Reason for the audit trail">
            <textarea
              className={textareaClassName}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this manual entry should change."
            />
          </Field>
          <p className="text-xs text-muted-foreground">A non-empty reason is required for both grant and revoke actions.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onGrant(selectedRiderId, reason.trim())} disabled={!canSubmit}>
              {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <CheckCircle2Icon data-icon="inline-start" />}
              Grant entry
            </Button>
            <Button type="button" variant="outline" onClick={() => onRevoke(selectedRiderId, reason.trim())} disabled={!canSubmit}>
              <RotateCcwIcon data-icon="inline-start" />
              Revoke entry
            </Button>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

function EligibilityBuilder({ draft, onChange }: { draft: GiveawayEditorDraft; onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>> }) {
  return (
    <Card>
      <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Eligibility groups</CardTitle>
          <CardDescription>Conditions in a group must all match. Groups are alternative paths into the campaign.</CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange((current) => ({
          ...current,
          eligibilityGroups: [...current.eligibilityGroups, createEligibilityGroup(current.eligibilityGroups.length + 1)],
        }))}>
          <PlusIcon data-icon="inline-start" /> Add group
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {draft.eligibilityGroups.map((group, groupIndex) => (
          <div key={group.id} className="grid gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_7rem_auto] md:items-end">
              <Field label="Group label"><Input value={group.label} onChange={(event) => updateEligibilityGroup(onChange, groupIndex, (current) => ({ ...current, label: event.target.value }))} /></Field>
              <Field label="Draw weight"><Input min={1} type="number" value={group.weight} onChange={(event) => updateEligibilityGroup(onChange, groupIndex, (current) => ({ ...current, weight: numberOr(current.weight, event.target.value) }))} /></Field>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${group.label}`} disabled={draft.eligibilityGroups.length === 1} onClick={() => onChange((current) => ({ ...current, eligibilityGroups: current.eligibilityGroups.filter((_, index) => index !== groupIndex) }))}><Trash2Icon /></Button>
            </div>
            <div className="grid gap-2">
              {group.conditions.map((condition, conditionIndex) => (
                <div key={`${group.id}-${conditionIndex}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                  <Field label={conditionIndex === 0 ? "Required condition" : "And condition"}>
                    <select className={selectClassName} value={condition.source} onChange={(event) => updateEligibilityCondition(onChange, groupIndex, conditionIndex, sourceToCondition(event.target.value as GiveawayEligibilityConditionInput["source"]))}>
                      {eligibilitySourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                  {condition.source === "perk_redemption" ? <Field label="Perk ID"><Input value={condition.perkId} onChange={(event) => updateEligibilityCondition(onChange, groupIndex, conditionIndex, { source: "perk_redemption", perkId: event.target.value })} placeholder="perk_…" /></Field> : <div />}
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove condition" disabled={group.conditions.length === 1} onClick={() => removeEligibilityCondition(onChange, groupIndex, conditionIndex)}><Trash2Icon /></Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => addEligibilityCondition(onChange, groupIndex)}><PlusIcon data-icon="inline-start" /> Add condition</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PrizePoolBuilder({ draft, onChange }: { draft: GiveawayEditorDraft; onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>> }) {
  return (
    <Card>
      <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Prize pools</CardTitle>
          <CardDescription>Finite pools hold one truthful item per available prize. Guaranteed pools must remain unlimited.</CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange((current) => ({ ...current, prizePools: [...current.prizePools, createPrizePool(current.prizePools.length + 1, current.eligibilityGroups)] }))}><PlusIcon data-icon="inline-start" /> Add pool</Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {draft.prizePools.map((pool, poolIndex) => {
          const isGuaranteed = pool.awardMode === "guaranteed";
          const quantity = pool.inventory.kind === "finite" ? pool.inventory.quantity : 0;
          return (
            <div key={pool.id} className="grid gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] lg:items-end">
                <Field label="Pool title"><Input value={pool.title} onChange={(event) => updatePrizePool(onChange, poolIndex, (current) => ({ ...current, title: event.target.value }))} /></Field>
                <Field label="Award method"><select className={selectClassName} value={pool.awardMode} onChange={(event) => setPrizePoolAwardMode(onChange, poolIndex, event.target.value as GiveawayAwardMode)}>{awardModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                <Field label="Fulfilment"><select className={selectClassName} value={pool.fulfilmentMode} onChange={(event) => updatePrizePool(onChange, poolIndex, (current) => ({ ...current, fulfilmentMode: event.target.value as GiveawayFulfilmentMode }))}>{fulfilmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${pool.title}`} disabled={draft.prizePools.length === 1} onClick={() => onChange((current) => ({ ...current, prizePools: current.prizePools.filter((_, index) => index !== poolIndex) }))}><Trash2Icon /></Button>
              </div>
              <p className="text-xs text-muted-foreground">{awardModeOptions.find((option) => option.value === pool.awardMode)?.detail}</p>
              <div className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)_auto] md:items-end">
                <Field label={isGuaranteed ? "Inventory" : "Finite quantity"}>{isGuaranteed ? <Input value="Unlimited" readOnly /> : <Input min={1} type="number" value={quantity} onChange={(event) => setPrizePoolQuantity(onChange, poolIndex, numberOr(quantity, event.target.value))} />}</Field>
                <Field label="Eligible groups"><GroupCheckboxes pool={pool} groups={draft.eligibilityGroups} onChange={(groupIds) => updatePrizePool(onChange, poolIndex, (current) => ({ ...current, eligibilityGroupIds: groupIds.length ? groupIds : undefined }))} /></Field>
                <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(pool.presenceVerificationRequired)} onChange={(event) => updatePrizePool(onChange, poolIndex, (current) => ({ ...current, presenceVerificationRequired: event.target.checked }))} /> Presence check</label>
              </div>
              {!isGuaranteed ? <div className="grid gap-2"><span className="text-sm font-medium">Prize items</span>{pool.items.map((item, itemIndex) => <Input key={item.id ?? itemIndex} value={item.title} onChange={(event) => updatePrizeItem(onChange, poolIndex, itemIndex, event.target.value)} placeholder={`Prize item ${itemIndex + 1}`} />)}</div> : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ScheduleBuilder({ draft, onChange }: { draft: GiveawayEditorDraft; onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule and claims</CardTitle>
        <CardDescription>Leave every time blank for manual operation. If you schedule one time, set all four in chronological order.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DateTimeField label="Entries open" value={draft.entryOpensAt} onChange={(value) => onChange((current) => ({ ...current, entryOpensAt: value }))} />
        <DateTimeField label="Entries lock" value={draft.entryClosesAt} onChange={(value) => onChange((current) => ({ ...current, entryClosesAt: value }))} />
        <DateTimeField label="Scheduled draw" value={draft.drawAt} onChange={(value) => onChange((current) => ({ ...current, drawAt: value }))} />
        <DateTimeField label="Claim deadline" value={draft.claimDeadlineAt} onChange={(value) => onChange((current) => ({ ...current, claimDeadlineAt: value }))} />
      </CardContent>
    </Card>
  );
}

function CampaignReport({ report }: { report: OrganizerGiveawayReport | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aggregate campaign report</CardTitle>
        <CardDescription>Counts only — entrant identities and source facts stay outside this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        {report ? <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{[
          ["Eligible", report.entries.eligible],
          ["Locked", report.entries.locked],
          ["Claimable", report.awards.claimable],
          ["Fulfilled", report.awards.fulfilled],
        ].map(([label, value]) => <div key={String(label)} className="rounded-lg border bg-muted/20 p-3"><div className="text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>)}</div> : <p className="text-sm text-muted-foreground">Select a campaign to load its aggregate report.</p>}
      </CardContent>
    </Card>
  );
}

function RedrawPanel({ disabled, awardId, reason, onAwardIdChange, onReasonChange, onRedraw }: { disabled: boolean; awardId: string; reason: string; onAwardIdChange: (value: string) => void; onReasonChange: (value: string) => void; onRedraw: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Redraw from the frozen order</CardTitle>
        <CardDescription>A redraw never rerolls. It takes the next valid candidate from the original snapshot and seed.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="Terminal award ID"><Input value={awardId} onChange={(event) => onAwardIdChange(event.target.value)} disabled={disabled} placeholder="giveaway-award-…" /></Field>
        <Field label="Reason"><Input value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={disabled} placeholder="Winner declined" /></Field>
        <Button type="button" variant="outline" onClick={onRedraw} disabled={disabled || !awardId.trim() || !reason.trim()}><RotateCcwIcon data-icon="inline-start" /> Redraw next candidate</Button>
      </CardContent>
    </Card>
  );
}

function WorkspaceNotice({ tone, text }: { tone: "error" | "success"; text: string }) {
  return <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", tone === "error" ? "border-destructive/25 bg-destructive/5 text-destructive" : "border-emerald-200 bg-emerald-50 text-emerald-950")}><span className="mt-0.5">{tone === "error" ? <CircleAlertIcon className="size-4" /> : <CheckCircle2Icon className="size-4" />}</span><span>{text}</span></div>;
}

function StateBadge({ state }: { state: GiveawayState }) {
  return <Badge variant={state === "claims_open" || state === "open" ? "secondary" : "outline"}>{formatState(state)}</Badge>;
}

function ComplianceBadge({ complianceStatus }: { complianceStatus: GiveawayComplianceStatus }) {
  return <Badge variant={complianceStatus === "approved" ? "secondary" : "outline"}>Compliance {formatState(complianceStatus)}</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label>;
}

function DateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><Input type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function GroupCheckboxes({ pool, groups, onChange }: { pool: GiveawayPrizePoolInput; groups: GiveawayEligibilityGroupInput[]; onChange: (groupIds: string[]) => void }) {
  const selected = new Set(pool.eligibilityGroupIds ?? []);
  return <div className="flex flex-wrap gap-x-3 gap-y-2 pt-1">{groups.map((group) => <label key={group.id} className="flex items-center gap-1.5 text-xs font-normal"><input type="checkbox" checked={selected.has(group.id)} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(group.id); else next.delete(group.id); onChange([...next]); }} />{group.label}</label>)}</div>;
}

export function toOrganizerGiveawayEditorDraft(
  workspace: OrganizerGiveawayWorkspaceData,
): GiveawayEditorDraft {
  return {
    title: workspace.title,
    kind: workspace.kind,
    entryMode: workspace.entryMode,
    maxEntriesPerRider: workspace.maxEntriesPerRider,
    mechanics: workspace.mechanics,
    terms: workspace.terms,
    sponsorDisclosure: workspace.sponsorDisclosure ?? "",
    timeZone: workspace.timeZone,
    publicVisibility: workspace.publicVisibility,
    presenceVerificationRequired: workspace.presenceVerificationRequired,
    winnerLimitPerRider: workspace.winnerLimits.perRider,
    winnerLimitTotal: workspace.winnerLimits.total,
    entryOpensAt: toDateTimeLocal(workspace.entryOpensAt, workspace.timeZone),
    entryClosesAt: toDateTimeLocal(workspace.entryClosesAt, workspace.timeZone),
    drawAt: toDateTimeLocal(workspace.drawAt, workspace.timeZone),
    claimDeadlineAt: toDateTimeLocal(workspace.claimDeadlineAt, workspace.timeZone),
    eligibilityGroups: workspace.eligibilityGroups.map((group) => ({
      ...group,
      conditions: group.conditions.map((condition) => ({ ...condition })),
    })),
    prizePools: workspace.prizePools.map((pool) => clonePrizePool(pool)),
  };
}

function clonePrizePool(pool: GiveawayPrizePoolInput): GiveawayPrizePoolInput {
  const base = {
    id: pool.id,
    title: pool.title,
    fulfilmentMode: pool.fulfilmentMode,
    ...(pool.eligibilityGroupIds ? { eligibilityGroupIds: [...pool.eligibilityGroupIds] } : {}),
    ...(pool.perRiderLimit ? { perRiderLimit: pool.perRiderLimit } : {}),
    ...(pool.presenceVerificationRequired !== undefined
      ? { presenceVerificationRequired: pool.presenceVerificationRequired }
      : {}),
  };
  if (pool.inventory.kind === "unlimited") {
    return { ...base, awardMode: "guaranteed", inventory: { kind: "unlimited" }, items: [] };
  }
  return {
    ...base,
    awardMode: pool.awardMode,
    inventory: { kind: "finite", quantity: pool.inventory.quantity },
    items: pool.items.map((item) => ({ ...item })) as GiveawayPrizePoolInput["items"],
  } as GiveawayPrizePoolInput;
}

function toDateTimeLocal(value: string | undefined, timeZone: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const [year, month, day, hour, minute] = [
      valueFor("year"),
      valueFor("month"),
      valueFor("day"),
      valueFor("hour"),
      valueFor("minute"),
    ];
    return year && month && day && hour && minute
      ? `${year}-${month}-${day}T${hour}:${minute}`
      : "";
  } catch {
    return value.slice(0, 16);
  }
}

function createEmptyDraft(): GiveawayEditorDraft {
  const group = createEligibilityGroup(1);
  return {
    title: "",
    kind: "raffle",
    entryMode: "automatic",
    maxEntriesPerRider: 10,
    mechanics: "",
    terms: "",
    sponsorDisclosure: "",
    timeZone: "Asia/Manila",
    publicVisibility: "hidden",
    presenceVerificationRequired: false,
    winnerLimitPerRider: 1,
    winnerLimitTotal: 1,
    entryOpensAt: "",
    entryClosesAt: "",
    drawAt: "",
    claimDeadlineAt: "",
    eligibilityGroups: [group],
    prizePools: [createPrizePool(1, [group])],
  };
}

function createEligibilityGroup(position: number): GiveawayEligibilityGroupInput {
  return { id: `group-${position}-${shortId()}`, label: `Eligibility group ${position}`, weight: 1, conditions: [{ source: "active_rsvp_pass" }] };
}

function createPrizePool(position: number, groups: GiveawayEligibilityGroupInput[]): GiveawayPrizePoolInput {
  return {
    id: `pool-${position}-${shortId()}`,
    title: `Prize pool ${position}`,
    awardMode: "random_draw",
    fulfilmentMode: "onsite",
    inventory: { kind: "finite", quantity: 1 },
    items: [{ title: `Prize item ${position}` }],
    eligibilityGroupIds: groups[0] ? [groups[0].id] : undefined,
    perRiderLimit: 1,
  };
}

function updateEligibilityGroup(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, groupIndex: number, update: (group: GiveawayEligibilityGroupInput) => GiveawayEligibilityGroupInput) {
  onChange((current) => ({ ...current, eligibilityGroups: current.eligibilityGroups.map((group, index) => index === groupIndex ? update(group) : group) }));
}

function updateEligibilityCondition(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, groupIndex: number, conditionIndex: number, nextCondition: GiveawayEligibilityConditionInput) {
  updateEligibilityGroup(onChange, groupIndex, (group) => ({ ...group, conditions: group.conditions.map((condition, index) => index === conditionIndex ? nextCondition : condition) }));
}

function addEligibilityCondition(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, groupIndex: number) {
  updateEligibilityGroup(onChange, groupIndex, (group) => ({ ...group, conditions: [...group.conditions, { source: "active_rsvp_pass" }] }));
}

function removeEligibilityCondition(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, groupIndex: number, conditionIndex: number) {
  updateEligibilityGroup(onChange, groupIndex, (group) => ({ ...group, conditions: group.conditions.filter((_, index) => index !== conditionIndex) }));
}

function updatePrizePool(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, poolIndex: number, update: (pool: GiveawayPrizePoolInput) => GiveawayPrizePoolInput) {
  onChange((current) => ({ ...current, prizePools: current.prizePools.map((pool, index) => index === poolIndex ? update(pool) : pool) }));
}

function setPrizePoolAwardMode(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, poolIndex: number, awardMode: GiveawayAwardMode) {
  updatePrizePool(onChange, poolIndex, (pool) => awardMode === "guaranteed" ? { ...pool, awardMode, inventory: { kind: "unlimited" }, items: [] } : { ...pool, awardMode, inventory: { kind: "finite", quantity: Math.max(1, pool.inventory.kind === "finite" ? pool.inventory.quantity : 1) }, items: normalizePrizeItems(pool.items, Math.max(1, pool.inventory.kind === "finite" ? pool.inventory.quantity : 1)) } as GiveawayPrizePoolInput);
}

function setPrizePoolQuantity(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, poolIndex: number, quantity: number) {
  updatePrizePool(onChange, poolIndex, (pool) => ({ ...pool, inventory: { kind: "finite", quantity }, items: normalizePrizeItems(pool.items, quantity) } as GiveawayPrizePoolInput));
}

function updatePrizeItem(onChange: React.Dispatch<React.SetStateAction<GiveawayEditorDraft>>, poolIndex: number, itemIndex: number, title: string) {
  updatePrizePool(onChange, poolIndex, (pool) => ({ ...pool, items: pool.items.map((item, index) => index === itemIndex ? { ...item, title } : item) } as GiveawayPrizePoolInput));
}

function normalizePrizeItems(existing: GiveawayPrizePoolInput["items"], quantity: number) {
  return Array.from({ length: quantity }, (_, index) => existing[index] ?? { title: `Prize item ${index + 1}` });
}

function sourceToCondition(source: GiveawayEligibilityConditionInput["source"]): GiveawayEligibilityConditionInput {
  return source === "perk_redemption" ? { source, perkId: "" } : { source };
}

function toCreateGiveawayInput(eventId: string, draft: GiveawayEditorDraft): CreateGiveawayInput {
  return {
    eventId,
    title: draft.title.trim(),
    kind: draft.kind,
    entryMode: draft.entryMode,
    maxEntriesPerRider: draft.maxEntriesPerRider,
    eligibilityGroups: draft.eligibilityGroups,
    mechanics: draft.mechanics.trim(),
    terms: draft.terms.trim(),
    timeZone: draft.timeZone.trim(),
    winnerLimits: { perRider: draft.winnerLimitPerRider, total: draft.winnerLimitTotal },
    organizerAttestation: true,
    prizePools: draft.prizePools,
    publicVisibility: draft.publicVisibility,
    ...(draft.sponsorDisclosure.trim() ? { sponsorDisclosure: draft.sponsorDisclosure.trim() } : {}),
    presenceVerificationRequired: draft.presenceVerificationRequired,
    ...toScheduleInput(draft),
  };
}

function toUpdateGiveawayInput(id: string, draft: GiveawayEditorDraft): UpdateGiveawayInput {
  const { eventId, ...input } = toCreateGiveawayInput("unused", draft);
  void eventId;
  return { id, ...input } as UpdateGiveawayInput;
}

function toScheduleInput(draft: GiveawayEditorDraft) {
  const values = [draft.entryOpensAt, draft.entryClosesAt, draft.drawAt, draft.claimDeadlineAt];
  if (values.every((value) => !value)) return {};
  if (values.some((value) => !value)) throw new Error("SCHEDULE_REQUIRED");
  return {
    entryOpensAt: new Date(draft.entryOpensAt).toISOString(),
    entryClosesAt: new Date(draft.entryClosesAt).toISOString(),
    drawAt: new Date(draft.drawAt).toISOString(),
    claimDeadlineAt: new Date(draft.claimDeadlineAt).toISOString(),
  };
}

let fallbackUiId = 0;

function shortId() {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
  }

  fallbackUiId += 1;
  return `${Date.now().toString(36)}${fallbackUiId.toString(36)}`;
}

function makeIdempotencyKey(prefix: string) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${shortId()}`}`;
}

function numberOr(fallback: number, value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function formatState(value: string) {
  return value.replaceAll("_", " ");
}

function optionalLocalDateTimeToIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function formatEntryOperationsDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "an invalid time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const selectClassName = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const textareaClassName = "min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
