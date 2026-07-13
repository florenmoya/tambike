"use client";

import Link from "next/link";
import { CircleCheck, Gift, LoaderCircle, TicketCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type { GiveawayFulfilmentMode, RiderEventGiveawayState } from "@/features/giveaways/types";
import { listRiderGiveawayStatesForEventAction } from "@/server/giveaway-actions";

import {
  formatGiveawayMoment,
  giveawayEntryModeLabel,
  giveawayStateLabel,
  isGiveawayClaimActionable,
  riderGiveawayStatusLabel,
} from "./giveaway-surface-state";

type RiderGiveawayStatusPanelProps = {
  eventId: string;
  enabled: boolean;
};

type RiderGiveawayLoadState = "loading" | "ready" | "error";

type RiderGiveawayLoadResult = {
  eventId: string;
  state: Exclude<RiderGiveawayLoadState, "loading">;
  giveaways: RiderEventGiveawayState[];
};

export function RiderGiveawayStatusPanel({
  eventId,
  enabled,
}: RiderGiveawayStatusPanelProps) {
  const [result, setResult] = useState<RiderGiveawayLoadResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      return () => {
        cancelled = true;
      };
    }

    void listRiderGiveawayStatesForEventAction(eventId)
      .then((nextResult) => {
        if (cancelled) return;
        setResult({
          eventId,
          giveaways: nextResult.ok ? nextResult.data : [],
          state: nextResult.ok ? "ready" : "error",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ eventId, giveaways: [], state: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, eventId]);

  const loadState: RiderGiveawayLoadState =
    enabled && result?.eventId === eventId ? result.state : "loading";
  const giveaways = enabled && result?.eventId === eventId ? result.giveaways : [];

  if (!enabled) {
    return null;
  }

  return (
    <section className="grid gap-3 border-t border-white/10 pt-4" aria-labelledby={`pass-giveaways-${eventId}`}>
      <div className="grid gap-1">
        <span className="text-[10px] font-black uppercase tracking-[0.13em] text-[#ffbe45]">Giveaways</span>
        <h2 id={`pass-giveaways-${eventId}`} className="m-0 text-lg font-extrabold text-white">
          Your prize status
        </h2>
      </div>

      {loadState === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-white/70" role="status">
          <LoaderCircle className="size-4 animate-spin text-[#ffbe45]" aria-hidden="true" />
          Checking your entries…
        </div>
      ) : null}

      {loadState === "error" ? (
        <p className="text-sm text-white/70" role="status">
          Your giveaway status is unavailable right now. Please try again shortly.
        </p>
      ) : null}

      {loadState === "ready" && giveaways.length === 0 ? (
        <p className="text-sm text-white/70">
          No giveaway entry is showing for this pass yet. Eligible entries will appear here.
        </p>
      ) : null}

      {loadState === "ready" && giveaways.length > 0 ? (
        <div className="grid gap-2">
          {giveaways.map((giveaway) => {
            const award = giveaway.riderState.award;
            const status = award?.status ?? giveaway.riderState.status;
            const claimDeadline = formatGiveawayMoment(award?.claimDeadlineAt);

            return (
              <article
                key={giveaway.giveawayId}
                className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.11em] text-white/54">
                      <Gift className="size-3.5 text-[#ffbe45]" aria-hidden="true" />
                      {giveawayEntryModeLabel(giveaway.entryMode)}
                    </div>
                    <h3 className="m-0 text-sm font-extrabold text-white">{giveaway.giveawayTitle}</h3>
                    <p className="mt-1 text-xs text-white/60">
                      {giveawayStateLabel(giveaway.giveawayState)}
                      {giveaway.riderState.entryCount > 0
                        ? ` · ${entryCountLabel(giveaway.riderState.entryCount)}`
                        : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#ffbe45]/30 bg-[#ffbe45]/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#ffcf74]">
                    {riderGiveawayStatusLabel(status)}
                  </span>
                </div>

                {award ? (
                  <div className="grid gap-2 border-t border-white/10 pt-3">
                    <div className="flex items-start gap-2">
                      <TicketCheck className="mt-0.5 size-4 shrink-0 text-[#8ee6b7]" aria-hidden="true" />
                      <div>
                        <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-white/54">
                          Award
                        </span>
                        <strong className="text-sm text-white">{award.prizePoolTitle}</strong>
                        <p className="mt-1 text-xs text-white/65">
                          {fulfilmentLabel(award.fulfilmentMode)} fulfilment
                          {claimDeadline ? ` · Claim by ${claimDeadline}` : ""}
                        </p>
                      </div>
                    </div>

                    {isGiveawayClaimActionable(award.status) ? (
                      <Link
                        className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#ffbe45]/45 bg-[#ffbe45]/10 px-3 text-sm font-bold text-[#ffdc97] transition hover:bg-[#ffbe45]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffbe45]"
                        href={`/giveaway-claims/${encodeURIComponent(award.awardId)}`}
                      >
                        Open claim
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-white/62">
                        <CircleCheck className="size-3.5 text-[#8ee6b7]" aria-hidden="true" />
                        This award status is up to date.
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function entryCountLabel(count: number) {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

function fulfilmentLabel(value: GiveawayFulfilmentMode) {
  return value.replaceAll("_", " ");
}
