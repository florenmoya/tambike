import Link from "next/link";
import { ArrowRightIcon, GiftIcon, ScanLineIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EventGiveawayOperatorQueueItem } from "@/features/giveaways/types";

type VenueGiveawayQueueProps = {
  eventId: string;
  initialQueue: EventGiveawayOperatorQueueItem[];
  initialError?: string | null;
};

/** Venue-side read-only entry point into the dedicated, independent claim desk. */
export function VenueGiveawayQueue({ eventId, initialQueue, initialError = null }: VenueGiveawayQueueProps) {
  const deskHref = `/giveaway-ops/${encodeURIComponent(eventId)}`;

  return (
    <main className="min-h-dvh bg-background px-4 py-5 text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto grid w-full max-w-4xl gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3"><div><Link href={`/venue/events/${encodeURIComponent(eventId)}`} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Back to venue event</Link><h1 className="mt-1 text-2xl font-semibold tracking-tight">Giveaway claim queue</h1></div><Button asChild><Link href={deskHref}><ScanLineIcon data-icon="inline-start" />Open claim desk</Link></Button></header>

        <Card className="overflow-hidden"><div className="h-1.5 bg-sky-500" aria-hidden="true" /><CardHeader><div className="flex flex-wrap gap-2"><Badge variant="secondary"><GiftIcon data-icon="inline-start" />Venue claim handoff</Badge><Badge variant="outline">Separate from check-in</Badge></div><CardTitle className="mt-2">Active prize claims</CardTitle><CardDescription>Use the dedicated claim desk to resolve a rider credential, verify a claim, and fulfil a prize. It never changes attendance or perk redemption.</CardDescription></CardHeader><CardContent>{initialError ? <QueueNotice title="Queue unavailable" body="This event’s claim queue is unavailable for the current venue or operator account." /> : initialQueue.length === 0 ? <QueueNotice title="No active prize claims" body="There are no claimable or verified awards in this event’s current venue/operator scope." /> : <div className="grid gap-2">{initialQueue.map((item) => <div key={item.awardId} className="grid gap-2 rounded-lg border bg-muted/[0.12] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge variant="outline">{formatLabel(item.status)}</Badge><Badge variant="secondary">{item.giveawayTitle}</Badge></div><div className="mt-2 truncate font-medium">{item.prizePoolTitle}</div><div className="mt-1 text-xs text-muted-foreground">Claim reference {item.claimReference} · {formatLabel(item.fulfilmentMode)}{item.presenceVerificationRequired ? " · Presence required" : ""}</div></div><span className="text-xs text-muted-foreground">{item.claimDeadlineAt ? `Claim by ${formatDeadline(item.claimDeadlineAt)}` : "Claim window open"}</span></div>)}</div>}</CardContent></Card>

        <Button asChild variant="outline" className="justify-between"><Link href={deskHref}>Continue to the independent claim desk <ArrowRightIcon data-icon="inline-end" /></Link></Button>
      </div>
    </main>
  );
}

function QueueNotice({ title, body }: { title: string; body: string }) { return <div className="rounded-lg border border-dashed bg-muted/20 p-5"><div className="font-medium">{title}</div><p className="mt-1 text-sm text-muted-foreground">{body}</p></div>; }
function formatLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDeadline(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Scheduled deadline" : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(date); }
