"use client";

import * as React from "react";
import Link from "next/link";
import {
  ClipboardCheckIcon,
  GiftIcon,
  Loader2Icon,
  RefreshCwIcon,
  ScanLineIcon,
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
import { GiveawayClaimScannerPanel } from "@/features/giveaways/giveaway-claim-scanner-panel";
import type {
  EventGiveawayOperatorQueueItem,
  GiveawayCampaignListItem,
  GiveawayOperatorCandidate,
} from "@/features/giveaways/types";
import {
  grantGiveawayOperatorAction,
  listEventGiveawayOperatorClaimsAction,
} from "@/server/giveaway-actions";
import { cn } from "@/lib/utils";

type OperatorWorkspaceProps = {
  eventId: string;
  initialQueue: EventGiveawayOperatorQueueItem[];
  initialCampaigns?: GiveawayCampaignListItem[];
  initialCandidates?: GiveawayOperatorCandidate[];
  initialError?: string | null;
};

type Notice = { tone: "success" | "error"; message: string } | null;

/**
 * Event-day claim desk. Queue entries contain only opaque claim references;
 * the embedded scanner owns transient credential resolution and the separate
 * verify/fulfil actions.
 */
export function GiveawayOperatorWorkspace({
  eventId,
  initialQueue,
  initialCampaigns = [],
  initialCandidates = [],
  initialError = null,
}: OperatorWorkspaceProps) {
  const [queue, setQueue] = React.useState(initialQueue);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [isRefreshing, startRefresh] = React.useTransition();
  const [isAssigning, startAssigning] = React.useTransition();
  const [campaignId, setCampaignId] = React.useState(initialCampaigns[0]?.id ?? "");
  const [candidateId, setCandidateId] = React.useState(initialCandidates[0]?.id ?? "");

  const refreshQueue = React.useCallback(() => {
    setNotice(null);
    startRefresh(async () => {
      try {
        const result = await listEventGiveawayOperatorClaimsAction(eventId);
        if (!result.ok) {
          setNotice({ tone: "error", message: result.code === "UNAUTHENTICATED" ? "Operator sign-in is required to refresh this desk." : "The claim queue could not be refreshed for this event." });
          return;
        }
        setQueue(result.data);
        setNotice({ tone: "success", message: "Claim queue refreshed." });
      } catch {
        setNotice({ tone: "error", message: "The claim queue could not be refreshed for this event." });
      }
    });
  }, [eventId, startRefresh]);

  const grantOperator = React.useCallback(() => {
    if (!campaignId || !candidateId) return;
    setNotice(null);
    startAssigning(async () => {
      try {
        const result = await grantGiveawayOperatorAction(campaignId, candidateId);
        if (!result.ok) {
          setNotice({ tone: "error", message: "This operator assignment was not recorded. Only an event owner or admin can grant access." });
          return;
        }
        setNotice({ tone: "success", message: "Operator claim-desk access recorded." });
      } catch {
        setNotice({ tone: "error", message: "This operator assignment was not recorded. Only an event owner or admin can grant access." });
      }
    });
  }, [candidateId, campaignId, startAssigning]);

  const waiting = queue.filter((item) => item.status === "pending_verification" || item.status === "claimable").length;
  const verified = queue.filter((item) => item.status === "verified").length;

  if (initialError) {
    return <OperatorUnavailable eventId={eventId} />;
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/venue/events/${encodeURIComponent(eventId)}/giveaways`} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Event claim queue</Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Giveaway claim desk</h1>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={refreshQueue} disabled={isRefreshing}>
            {isRefreshing ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}Refresh queue
          </Button>
        </header>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="border-l-4 border-sky-500 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="flex flex-wrap gap-2"><Badge variant="secondary"><ScanLineIcon data-icon="inline-start" />Claim operations</Badge><Badge variant="outline">Attendance-independent</Badge></div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Resolve a dedicated giveaway credential, verify the prize claim, then fulfil it. None of these steps checks in a rider or redeems a perk.</p>
              </div>
              <div className="grid min-w-48 grid-cols-2 divide-x rounded-lg border bg-muted/20 text-center"><div className="p-3"><div className="text-2xl font-semibold tabular-nums">{waiting}</div><div className="text-xs text-muted-foreground">Awaiting verify</div></div><div className="p-3"><div className="text-2xl font-semibold tabular-nums">{verified}</div><div className="text-xs text-muted-foreground">Ready to fulfil</div></div></div>
            </div>
          </div>
          <div className="grid border-t bg-muted/20 sm:grid-cols-3"><DeskRail label="1. Resolve" detail="Credential reveals one safe claim view" /><DeskRail label="2. Verify" detail="Record presence separately when required" /><DeskRail label="3. Fulfil" detail="Mark only after handover or arrangement" /></div>
        </section>

        {notice ? <NoticeCard notice={notice} /> : null}
        <GiveawayClaimScannerPanel />

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader className="gap-2 md:flex-row md:items-end md:justify-between"><div><CardTitle>Safe claim queue</CardTitle><CardDescription>Opaque references and prize operations only. No rider contact or delivery data is included.</CardDescription></div><Badge variant="outline" className="w-fit tabular-nums">{queue.length} active</Badge></CardHeader>
            <CardContent>
              {queue.length === 0 ? <EmptyQueue /> : <div className="grid gap-2">{queue.map((item) => <QueueItem key={item.awardId} item={item} />)}</div>}
            </CardContent>
          </Card>

          {initialCampaigns.length > 0 && initialCandidates.length > 0 ? (
            <Card className="h-fit">
              <CardHeader><CardTitle>Assign a claim operator</CardTitle><CardDescription>Event owners and admins can add an approved candidate to one campaign. Other operators only see the claim desk.</CardDescription></CardHeader>
              <CardContent className="grid gap-3">
                <label className="grid gap-1 text-sm font-medium">Campaign<select className="h-9 rounded-md border bg-background px-2 text-sm" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} disabled={isAssigning}>{initialCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</select></label>
                <label className="grid gap-1 text-sm font-medium">Candidate<select className="h-9 rounded-md border bg-background px-2 text-sm" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={isAssigning}>{initialCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>
                <Button type="button" variant="outline" disabled={isAssigning || !campaignId || !candidateId} onClick={grantOperator}>{isAssigning ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <UserRoundPlusIcon data-icon="inline-start" />}Grant claim-desk access</Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-fit"><CardHeader><CardTitle>Access scope</CardTitle><CardDescription>This account can operate only the campaigns assigned to it. Campaign owners and admins manage claim-desk assignments.</CardDescription></CardHeader></Card>
          )}
        </section>
      </div>
    </main>
  );
}

function QueueItem({ item }: { item: EventGiveawayOperatorQueueItem }) {
  return <div className="grid gap-2 rounded-lg border bg-muted/[0.12] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge variant="outline">{formatLabel(item.status)}</Badge><Badge variant="secondary">{item.giveawayTitle}</Badge></div><div className="mt-2 truncate font-medium">{item.prizePoolTitle}</div><div className="mt-1 text-xs text-muted-foreground">Claim reference {item.claimReference} · {formatLabel(item.fulfilmentMode)}{item.presenceVerificationRequired ? " · Presence required" : ""}</div></div>{item.claimDeadlineAt ? <div className="text-xs text-muted-foreground">Claim by<br /><span className="font-medium text-foreground">{formatDeadline(item.claimDeadlineAt)}</span></div> : null}</div>;
}

function DeskRail({ label, detail }: { label: string; detail: string }) {
  return <div className="p-3 sm:px-5"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div><div className="mt-1 text-sm">{detail}</div></div>;
}

function NoticeCard({ notice }: { notice: Exclude<Notice, null> }) {
  return <div className={cn("flex gap-2 rounded-lg border p-3 text-sm", notice.tone === "success" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100" : "border-destructive/25 bg-destructive/5 text-destructive")} aria-live="polite"><ClipboardCheckIcon className="mt-0.5 size-4 shrink-0" /><span>{notice.message}</span></div>;
}

function EmptyQueue() {
  return <div className="rounded-lg border border-dashed bg-muted/20 p-5"><GiftIcon className="size-5 text-muted-foreground" /><div className="mt-2 font-medium">No active claims at this desk</div><p className="mt-1 text-sm text-muted-foreground">Claims appear after an award reaches the claim window and is assigned to this operator scope.</p></div>;
}

function OperatorUnavailable({ eventId }: { eventId: string }) {
  return <main className="grid min-h-dvh place-items-center bg-background px-4 py-8 text-foreground"><Card className="w-full max-w-md"><CardHeader><CardTitle>Claim desk unavailable</CardTitle><CardDescription>This event’s giveaway claim desk is not assigned to the current venue or operator account.</CardDescription></CardHeader><CardContent><Button asChild variant="outline" className="w-full"><Link href={`/venue/events/${encodeURIComponent(eventId)}/giveaways`}>Back to venue claim queue</Link></Button></CardContent></Card></main>;
}

function formatLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

function formatDeadline(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Scheduled deadline" : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(date); }
