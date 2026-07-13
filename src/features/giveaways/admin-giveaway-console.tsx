"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileWarningIcon,
  GiftIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldAlertIcon,
  UserRoundPlusIcon,
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
import type {
  AdminGiveawayAudit,
  GiveawayCampaignListItem,
  GiveawayComplianceStatus,
  GiveawayOperatorCandidate,
  GiveawayState,
  OrganizerGiveawayWorkspace,
} from "@/features/giveaways/types";
import {
  disqualifyGiveawayAwardAction,
  grantGiveawayOperatorAction,
  revokeGiveawayOperatorAction,
  reviewGiveawayComplianceAction,
  suspendGiveawayAction,
  voidGiveawayAwardAction,
} from "@/server/giveaway-actions";
import { cn } from "@/lib/utils";

type Notice = { tone: "success" | "error"; message: string } | null;
type ActionEnvelope = { ok: boolean; code?: string };
type ComplianceDecision = Extract<GiveawayComplianceStatus, "approved" | "changes_requested" | "rejected">;

type AdminGiveawayListProps = {
  initialCampaigns: GiveawayCampaignListItem[];
  initialError?: string | null;
};

type AdminGiveawayDetailProps = {
  giveawayId: string;
  initialWorkspace: OrganizerGiveawayWorkspace | null;
  initialAudit: AdminGiveawayAudit | null;
  initialCandidates: GiveawayOperatorCandidate[];
  initialError?: string | null;
  initialAuditError?: string | null;
};

const reviewOptions: Array<{ value: ComplianceDecision; label: string }> = [
  { value: "approved", label: "Approve mechanics" },
  { value: "changes_requested", label: "Request changes" },
  { value: "rejected", label: "Reject mechanics" },
];

/** Admin list data is deliberately the narrow campaign rail, never entrants or awards. */
export function AdminGiveawayList({ initialCampaigns, initialError = null }: AdminGiveawayListProps) {
  const reviewCount = initialCampaigns.filter((campaign) => campaign.complianceStatus === "pending_review").length;
  const activeCount = initialCampaigns.filter((campaign) => ["open", "paused", "locked", "drawing", "claims_open"].includes(campaign.state)).length;

  if (initialError) {
    return <AdminUnavailableState title="Giveaway review unavailable" body="The campaign list could not be loaded for this admin account." />;
  }

  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-l-4 border-amber-500 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary"><GiftIcon data-icon="inline-start" />Giveaway control</Badge>
                <Badge variant="outline">Policy before prizes</Badge>
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">Campaign review board</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Review mechanics, preserve the audit trail, and send operators only to the claim desk. Entrant and delivery data are not shown here.
              </p>
            </div>
            <div className="grid min-w-48 grid-cols-2 divide-x rounded-lg border bg-muted/20 text-center">
              <div className="p-3"><div className="text-2xl font-semibold tabular-nums">{reviewCount}</div><div className="text-xs text-muted-foreground">Need review</div></div>
              <div className="p-3"><div className="text-2xl font-semibold tabular-nums">{activeCount}</div><div className="text-xs text-muted-foreground">In operation</div></div>
            </div>
          </div>
        </div>
        <div className="grid border-t bg-muted/20 sm:grid-cols-3">
          <OpsRail label="Review" detail="Approve or return mechanics" />
          <OpsRail label="Protect" detail="Suspend with a recorded reason" />
          <OpsRail label="Resolve" detail="Void or disqualify from the audit record. Open the event recovery workspace for eligible replacements." />
        </div>
      </section>

      <Card>
        <CardHeader className="gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>All campaigns</CardTitle>
            <CardDescription>Campaign-level status only. Open a campaign to work from its safe audit record.</CardDescription>
          </div>
          <Badge variant="outline" className="w-fit tabular-nums">{initialCampaigns.length} total</Badge>
        </CardHeader>
        <CardContent>
          {initialCampaigns.length === 0 ? (
            <EmptyPanel title="No campaigns yet" body="Campaigns appear here after an organizer creates them for an event." />
          ) : (
            <div className="grid gap-3">
              {initialCampaigns.map((campaign) => (
                <Link
                  key={campaign.id}
                  href={`/admin/giveaways/${encodeURIComponent(campaign.id)}`}
                  className="group grid gap-3 rounded-lg border bg-background p-4 transition-colors hover:border-amber-500/45 hover:bg-amber-500/[0.03] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CampaignStateBadge state={campaign.state} />
                      <ComplianceBadge status={campaign.complianceStatus} />
                    </div>
                    <div className="mt-2 truncate font-medium group-hover:text-amber-700 dark:group-hover:text-amber-300">{campaign.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Event reference {campaign.eventId} · Mechanics v{campaign.mechanicsVersion}</div>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground">Open review →</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Admin campaign detail. Every mutation remains a server action and receives
 * an explicit reason/reference; the UI does not receive entrants, claim
 * credentials, source facts, delivery details, or audit payloads.
 */
export function AdminGiveawayDetail({
  giveawayId,
  initialWorkspace,
  initialAudit,
  initialCandidates,
  initialError = null,
  initialAuditError = null,
}: AdminGiveawayDetailProps) {
  const router = useRouter();
  const [notice, setNotice] = React.useState<Notice>(null);
  const [isPending, startTransition] = React.useTransition();
  const [reviewDecision, setReviewDecision] = React.useState<ComplianceDecision>("approved");
  const [reviewReason, setReviewReason] = React.useState("");
  const [suspensionReason, setSuspensionReason] = React.useState("");
  const [awardReference, setAwardReference] = React.useState("");
  const [awardReason, setAwardReason] = React.useState("");
  const [candidateId, setCandidateId] = React.useState(initialCandidates[0]?.id ?? "");
  const [operatorAssignmentReference, setOperatorAssignmentReference] = React.useState("");
  const [operatorRevocationReason, setOperatorRevocationReason] = React.useState("");

  const runAction = React.useCallback(
    (successMessage: string, action: () => Promise<ActionEnvelope>) => {
      setNotice(null);
      startTransition(async () => {
        try {
          const result = await action();
          if (!result.ok) {
            setNotice({ tone: "error", message: result.code === "UNAUTHENTICATED" ? "Admin sign-in is required for this operation." : "This operation was not recorded. Confirm the campaign stage, reference, and admin permission." });
            return;
          }
          setNotice({ tone: "success", message: successMessage });
          router.refresh();
        } catch {
          setNotice({ tone: "error", message: "This operation was not recorded. Confirm the campaign stage, reference, and admin permission." });
        }
      });
    },
    [router, startTransition],
  );

  if (!initialWorkspace || initialError) {
    return <AdminUnavailableState title="Campaign unavailable" body="This campaign detail cannot be opened for the current admin account." />;
  }

  const workspace = initialWorkspace;
  const auditEvents = initialAudit?.events ?? [];
  const auditAwardReferences = getAuditAwardReferences(auditEvents);
  const auditOperatorReferences = getAuditOperatorReferences(auditEvents);
  const canReview = workspace.complianceStatus === "pending_review";
  const exportHref = `/api/admin/exports/giveaways/${encodeURIComponent(giveawayId)}`;

  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm"><Link href="/admin/giveaways">Back to campaigns</Link></Button>
        <Button asChild variant="outline" size="sm"><a href={exportHref}><DownloadIcon data-icon="inline-start" />Download admin CSV</a></Button>
      </div>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <div className="h-1.5 bg-[linear-gradient(90deg,#f59e0b_0%,#f59e0b_31%,#e5e7eb_31%,#e5e7eb_100%)]" aria-hidden="true" />
          <CardHeader className="gap-3">
            <div className="flex flex-wrap gap-2"><CampaignStateBadge state={workspace.state} /><ComplianceBadge status={workspace.complianceStatus} /><Badge variant="outline">Policy configuration</Badge></div>
            <CardTitle className="text-2xl">{workspace.title}</CardTitle>
            <CardDescription>Event reference {workspace.eventId} · {formatOpsLabel(workspace.entryMode)} entry · {workspace.timeZone}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="Entry mode" value={formatOpsLabel(workspace.entryMode)} />
              <Fact label="Presence check" value={workspace.presenceVerificationRequired ? "Required" : "Not required"} />
              <Fact label="Prize pools" value={String(workspace.prizePools.length)} />
            </div>
            <PolicyBlock label="Mechanics" value={workspace.mechanics} />
            <PolicyBlock label="Terms" value={workspace.terms} />
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader>
            <CardTitle>Admin controls</CardTitle>
            <CardDescription>Every intervention writes a new audit event. Operations never overwrite history.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {notice ? <NoticeCard notice={notice} /> : null}
            {canReview ? (
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                <div><div className="font-medium">Compliance review</div><p className="mt-1 text-sm text-muted-foreground">Choose a decision and record why it is appropriate.</p></div>
                <label className="grid gap-1 text-sm font-medium">Decision
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value as ComplianceDecision)} disabled={isPending}>
                    {reviewOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium">Review reason
                  <Input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Short policy decision note" disabled={isPending} />
                </label>
                <Button type="button" disabled={isPending || !reviewReason.trim()} onClick={() => runAction("Compliance decision recorded.", () => reviewGiveawayComplianceAction(workspace.id, { decision: reviewDecision, reason: reviewReason.trim() }))}>
                  {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <CheckCircle2Icon data-icon="inline-start" />}Record decision
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">Compliance is {formatOpsLabel(workspace.complianceStatus).toLowerCase()}. The next permitted campaign action remains server-enforced.</div>
            )}

            <div className="grid gap-3 rounded-lg border border-destructive/20 bg-destructive/[0.03] p-3">
              <div><div className="font-medium">Suspend campaign</div><p className="mt-1 text-sm text-muted-foreground">Stops operational activity without erasing awards or audit history.</p></div>
              <label className="grid gap-1 text-sm font-medium">Suspension reason
                <Input value={suspensionReason} onChange={(event) => setSuspensionReason(event.target.value)} placeholder="Why this campaign must stop" disabled={isPending} />
              </label>
              <Button type="button" variant="destructive" disabled={isPending || !suspensionReason.trim()} onClick={() => runAction("Campaign suspended and audit recorded.", () => suspendGiveawayAction(workspace.id, suspensionReason.trim()))}>
                {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <ShieldAlertIcon data-icon="inline-start" />}Suspend campaign
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Audit-safe award resolution</CardTitle>
            <CardDescription>Use an opaque award reference for an audit intervention. Replacement paths stay in the event’s server-owned recovery workspace.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">Award reference
                <Input list="giveaway-audit-awards" value={awardReference} onChange={(event) => setAwardReference(event.target.value)} placeholder="award-…" disabled={isPending} autoComplete="off" />
                <datalist id="giveaway-audit-awards">{auditAwardReferences.map((reference) => <option key={reference} value={reference} />)}</datalist>
              </label>
              <label className="grid gap-1 text-sm font-medium">Resolution reason
                <Input value={awardReason} onChange={(event) => setAwardReason(event.target.value)} placeholder="Why this award changes" disabled={isPending} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={isPending || !awardReference.trim() || !awardReason.trim()} onClick={() => runAction("Award voided and audit recorded.", () => voidGiveawayAwardAction(awardReference.trim(), awardReason.trim()))}><FileWarningIcon data-icon="inline-start" />Void award</Button>
              <Button type="button" variant="outline" disabled={isPending || !awardReference.trim() || !awardReason.trim()} onClick={() => runAction("Award disqualified and audit recorded.", () => disqualifyGiveawayAwardAction(awardReference.trim(), awardReason.trim()))}><ShieldAlertIcon data-icon="inline-start" />Disqualify</Button>
              <Button asChild>
                <Link href={`/organizer/events/${encodeURIComponent(workspace.eventId)}/giveaways`}><RefreshCwIcon data-icon="inline-start" />Open safe recovery workspace</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Claim-desk assignment</CardTitle>
            <CardDescription>Grant or remove access using only safe candidate labels and opaque assignment references.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {initialCandidates.length === 0 ? <p className="text-sm text-muted-foreground">No safe assignment candidates are available for this event.</p> : <>
              <label className="grid gap-1 text-sm font-medium">Operator
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={isPending}>
                  {initialCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
              </label>
              <Button type="button" variant="outline" disabled={isPending || !candidateId} onClick={() => runAction("Operator assignment recorded.", () => grantGiveawayOperatorAction(workspace.id, candidateId))}><UserRoundPlusIcon data-icon="inline-start" />Grant claim-desk access</Button>
            </>}
            <div className="grid gap-3 border-t pt-3">
              <div><div className="text-sm font-medium">Remove assignment</div><p className="mt-1 text-xs text-muted-foreground">Use the opaque assignment reference from this campaign’s sanitized audit trail.</p></div>
              <label className="grid gap-1 text-sm font-medium">Assignment reference
                <Input list="giveaway-audit-operators" value={operatorAssignmentReference} onChange={(event) => setOperatorAssignmentReference(event.target.value)} placeholder="operator-…" disabled={isPending} autoComplete="off" />
                <datalist id="giveaway-audit-operators">{auditOperatorReferences.map((reference) => <option key={reference} value={reference} />)}</datalist>
              </label>
              <label className="grid gap-1 text-sm font-medium">Removal reason
                <Input value={operatorRevocationReason} onChange={(event) => setOperatorRevocationReason(event.target.value)} placeholder="Why access must end" disabled={isPending} />
              </label>
              <Button type="button" variant="destructive" disabled={isPending || !operatorAssignmentReference.trim() || !operatorRevocationReason.trim()} onClick={() => runAction("Operator access removed and audit recorded.", () => revokeGiveawayOperatorAction(operatorAssignmentReference.trim(), operatorRevocationReason.trim()))}>Remove claim-desk access</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="gap-2 md:flex-row md:items-end md:justify-between">
          <div><CardTitle>Sanitized audit trail</CardTitle><CardDescription>Sequence, action, target class, and integrity hash only. Internal audit payloads are not rendered.</CardDescription></div>
          <Badge variant="outline" className="w-fit tabular-nums">{auditEvents.length} events</Badge>
        </CardHeader>
        <CardContent>
          {initialAuditError ? <EmptyPanel title="Audit temporarily unavailable" body="The campaign controls remain server-enforced. Refresh this page before relying on the audit history." /> : auditEvents.length === 0 ? <EmptyPanel title="No audit events yet" body="The first campaign action will create a new append-only audit event." /> : <ol className="grid gap-2" aria-label="Giveaway audit events">
            {auditEvents.map((event) => <li key={event.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-center">
              <span className="font-mono text-xs text-muted-foreground">#{event.sequence}</span>
              <div className="min-w-0"><div className="truncate text-sm font-medium">{formatOpsLabel(event.action)}</div><div className="mt-1 text-xs text-muted-foreground">{formatOpsLabel(event.targetType)}{event.targetId ? ` · ${event.targetId}` : ""} · {formatAuditTime(event.createdAt)}</div></div>
              <span className="font-mono text-[10px] text-muted-foreground" title={event.hash}>#{event.hash.slice(0, 10)}</span>
            </li>)}
          </ol>}
        </CardContent>
      </Card>
    </div>
  );
}

function AdminUnavailableState({ title, body }: { title: string; body: string }) {
  return <div className="px-4 lg:px-6"><Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{body}</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href="/admin/giveaways">Back to giveaway review</Link></Button></CardContent></Card></div>;
}

function CampaignStateBadge({ state }: { state: GiveawayState }) {
  const tone = state === "suspended" || state === "cancelled" ? "destructive" : state === "open" || state === "claims_open" ? "secondary" : "outline";
  return <Badge variant={tone} className={cn(state === "paused" && "border-amber-500/40 text-amber-700 dark:text-amber-300")}>{formatOpsLabel(state)}</Badge>;
}

function ComplianceBadge({ status }: { status: GiveawayComplianceStatus }) {
  const tone = status === "approved" ? "secondary" : status === "rejected" ? "destructive" : "outline";
  return <Badge variant={tone}>Compliance {formatOpsLabel(status).toLowerCase()}</Badge>;
}

function OpsRail({ label, detail }: { label: string; detail: string }) {
  return <div className="p-3 sm:px-5"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div><div className="mt-1 text-sm">{detail}</div></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm font-medium">{value}</div></div>;
}

function PolicyBlock({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{value}</p></div>;
}

function NoticeCard({ notice }: { notice: Exclude<Notice, null> }) {
  const Icon = notice.tone === "success" ? CheckCircle2Icon : AlertTriangleIcon;
  return <div className={cn("flex gap-2 rounded-lg border p-3 text-sm", notice.tone === "success" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100" : "border-destructive/25 bg-destructive/5 text-destructive")} aria-live="polite"><Icon className="mt-0.5 size-4 shrink-0" /><span>{notice.message}</span></div>;
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return <div className="rounded-lg border border-dashed bg-muted/20 p-5"><div className="font-medium">{title}</div><p className="mt-1 text-sm text-muted-foreground">{body}</p></div>;
}

export function formatOpsLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getAuditAwardReferences(events: AdminGiveawayAudit["events"]) {
  return Array.from(new Set(events.filter((event) => event.targetType === "award" && event.targetId).map((event) => event.targetId!)));
}

export function getAuditOperatorReferences(events: AdminGiveawayAudit["events"]) {
  return Array.from(new Set(events.filter((event) => event.targetType === "operator" && event.targetId).map((event) => event.targetId!)));
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recorded time" : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(date);
}
