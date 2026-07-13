"use client";

import { Gift, LoaderCircle, Trophy } from "lucide-react";
import { useEffect, useState } from "react";

import type { PublicEventGiveaway } from "@/features/giveaways/types";
import { listPublicGiveawaysForEventAction } from "@/server/giveaway-actions";

import {
  formatGiveawayMoment,
  giveawayEntryModeLabel,
  giveawayStateLabel,
} from "./giveaway-surface-state";

type PublicGiveawayPanelProps = {
  eventId: string;
};

type PublicGiveawayLoadState = "loading" | "ready" | "unavailable";

type PublicGiveawayLoadResult = {
  eventId: string;
  state: Exclude<PublicGiveawayLoadState, "loading">;
  campaigns: PublicEventGiveaway[];
};

const awardModeLabels = {
  random_draw: "Random draw",
  first_come: "First come",
  guaranteed: "Guaranteed",
  manual_selection: "Organizer selection",
} as const;

export function PublicGiveawayPanel({ eventId }: PublicGiveawayPanelProps) {
  const [result, setResult] = useState<PublicGiveawayLoadResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    void listPublicGiveawaysForEventAction(eventId)
      .then((nextResult) => {
        if (cancelled) return;
        setResult({
          eventId,
          campaigns: nextResult.ok ? nextResult.data : [],
          state: nextResult.ok ? "ready" : "unavailable",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ eventId, campaigns: [], state: "unavailable" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const loadState: PublicGiveawayLoadState = result?.eventId === eventId ? result.state : "loading";
  const campaigns = result?.eventId === eventId ? result.campaigns : [];

  if (loadState === "unavailable" || (loadState === "ready" && campaigns.length === 0)) {
    return null;
  }

  return (
    <section
      className="buy-panel"
      aria-busy={loadState === "loading"}
      aria-labelledby={`event-giveaways-${eventId}`}
    >
      <div className="buy-section-title">
        <span>Event giveaways</span>
        <h2 id={`event-giveaways-${eventId}`}>Prize route</h2>
      </div>

      {loadState === "loading" ? (
        <div className="flex items-center gap-2 py-2 text-sm text-white/72" role="status">
          <LoaderCircle className="size-4 animate-spin text-[#ffbe45]" aria-hidden="true" />
          Loading giveaway details…
        </div>
      ) : (
        <div className="grid gap-3">
          {campaigns.map(({ giveaway, results }) => {
            const entryOpen = formatGiveawayMoment(giveaway.entryOpensAt, giveaway.timeZone);
            const entryClose = formatGiveawayMoment(giveaway.entryClosesAt, giveaway.timeZone);
            const drawAt = formatGiveawayMoment(giveaway.drawAt, giveaway.timeZone);

            return (
              <article
                key={giveaway.id}
                className="overflow-hidden rounded-xl border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.13em] text-[#ffcf74]">
                      <Gift className="size-3.5" aria-hidden="true" />
                      {giveaway.kind}
                    </div>
                    <h3 className="m-0 text-lg font-black tracking-tight text-white">{giveaway.title}</h3>
                    {giveaway.sponsorDisclosure ? (
                      <p className="mt-2 text-sm text-white/70">{giveaway.sponsorDisclosure}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.1em]">
                    <span className="rounded-full border border-[#ffbe45]/35 bg-[#ffbe45]/10 px-2.5 py-1 text-[#ffcf74]">
                      {giveawayStateLabel(giveaway.state)}
                    </span>
                    <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-white/72">
                      {giveawayEntryModeLabel(giveaway.entryMode)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 px-4 py-4">
                  {entryOpen || entryClose || drawAt ? (
                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                      {entryOpen ? <ScheduleMoment label="Entry opens" value={entryOpen} /> : null}
                      {entryClose ? <ScheduleMoment label="Entry closes" value={entryClose} /> : null}
                      {drawAt ? <ScheduleMoment label="Draw" value={drawAt} /> : null}
                    </dl>
                  ) : null}

                  <div className="grid gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.13em] text-white/56">
                      Prize pools
                    </span>
                    <ul className="grid list-none gap-2 p-0 sm:grid-cols-2">
                      {giveaway.prizePools.map((pool) => (
                        <li
                          key={pool.id}
                          className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-sm font-extrabold text-white">{pool.title}</strong>
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-white/52">
                              {awardModeLabels[pool.awardMode]}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-white/66">{prizePoolSummary(pool)}</p>
                          {pool.presenceVerificationRequired ? (
                            <span className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white/55">
                              Presence check required
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {results.length > 0 ? (
                    <div className="rounded-lg border border-[#20b26b]/30 bg-[#20b26b]/[0.08] px-3 py-3">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.13em] text-[#8ee6b7]">
                        <Trophy className="size-3.5" aria-hidden="true" />
                        Published winner aliases
                      </div>
                      <p className="mb-3 text-sm text-white/68">
                        Each alias is an opaque entry reference, not a rider name.
                      </p>
                      <ul className="grid list-none gap-2 p-0">
                        {results.map((result) => (
                          <li
                            key={`${result.prizePoolTitle}-${result.winnerAlias}`}
                            className="flex flex-wrap items-center justify-between gap-2 border-t border-[#20b26b]/20 pt-2 text-sm"
                          >
                            <span className="text-white/72">{result.prizePoolTitle}</span>
                            <strong className="font-mono text-xs text-[#b9f1ce]">{result.winnerAlias}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <details className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-bold text-white/82">Mechanics and terms</summary>
                    <div className="grid gap-3 pb-1 pt-3 text-white/70">
                      <p>{giveaway.mechanics}</p>
                      <p>{giveaway.terms}</p>
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ScheduleMoment({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
      <dt className="text-[10px] font-black uppercase tracking-[0.1em] text-white/54">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-white/86">{value}</dd>
    </div>
  );
}

function prizePoolSummary(
  pool: PublicEventGiveaway["giveaway"]["prizePools"][number],
) {
  if (pool.items.length > 0) {
    return pool.items.map((item) => item.title).join(" · ");
  }

  if (pool.inventoryKind === "unlimited") {
    return "Unlimited prize availability";
  }

  const quantity = pool.itemQuantity ?? 0;
  return `${quantity} prize ${quantity === 1 ? "item" : "items"}`;
}
