"use client";

import Link from "next/link";
import { CircleCheck, Gift, LoaderCircle, TicketCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  GiveawayEntryMode,
  GiveawayState,
  GiveawayFulfilmentMode,
  GiveawayWinnerPublicationInput,
  RiderEventGiveawayState,
  RiderGiveawayAwardSummary,
  RiderGiveawayDrawProof,
  RiderGiveawayEntryStatus,
  RiderGiveawayState,
} from "@/features/giveaways/types";
import {
  claimGiveawayCampaignCodeAction,
  listRiderGiveawayStatesForEventAction,
  optInToGiveawayAction,
  setGiveawayWinnerPublicationAction,
} from "@/server/giveaway-actions";

import {
  canRiderSubmitGiveawayEntry,
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

type RiderGiveawayEntryActions = {
  optIn: typeof optInToGiveawayAction;
  claimCode: typeof claimGiveawayCampaignCodeAction;
};

/** Keeps mode-specific input handling out of the status-panel state update. */
export async function submitRiderGiveawayEntry(
  input: { giveawayId: string; entryMode: "opt_in" | "claim_code"; code?: string },
  actions: RiderGiveawayEntryActions = {
    optIn: optInToGiveawayAction,
    claimCode: claimGiveawayCampaignCodeAction,
  },
) {
  if (input.entryMode === "opt_in") {
    return actions.optIn(input.giveawayId);
  }

  return actions.claimCode(input.giveawayId, input.code?.trim() ?? "");
}

export function riderGiveawayEntryFailureMessage(code: "UNAUTHENTICATED" | "ERROR") {
  if (code === "UNAUTHENTICATED") {
    return "Log in with your rider account before entering this giveaway.";
  }

  return "We could not record your entry. The giveaway may no longer be open, you may not qualify yet, or the campaign code may be wrong or unavailable.";
}

type RiderGiveawayEntryControlProps = {
  giveawayId: string;
  giveawayState: GiveawayState;
  entryMode: GiveawayEntryMode;
  riderStatus: RiderGiveawayEntryStatus;
  onEntryRecorded: (riderState: RiderGiveawayState) => void;
  onRefresh: (giveawayId: string) => Promise<void>;
};

/**
 * Handles a rider's optional entry without storing a campaign code anywhere
 * beyond this component's transient input state.
 */
export function RiderGiveawayEntryControl({
  giveawayId,
  giveawayState,
  entryMode,
  riderStatus,
  onEntryRecorded,
  onRefresh,
}: RiderGiveawayEntryControlProps) {
  const [campaignCode, setCampaignCode] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const canSubmit = canRiderSubmitGiveawayEntry({
    state: giveawayState,
    entryMode,
    riderStatus,
  });

  if (!canSubmit || (entryMode !== "opt_in" && entryMode !== "claim_code")) {
    return null;
  }

  const selfEntryMode = entryMode === "opt_in" ? "opt_in" : "claim_code";
  const isCampaignCodeEntry = selfEntryMode === "claim_code";

  async function submitEntry() {
    const code = campaignCode.trim();
    if (isCampaignCodeEntry && !code) {
      setFeedback("Enter the campaign code to record your entry.");
      return;
    }

    // Clear the input before awaiting the action so the code is never retained
    // in rendered state, a route, client storage, or follow-up feedback.
    setCampaignCode("");
    setFeedback(null);
    setPending(true);

    try {
      const next = await submitRiderGiveawayEntry({
        giveawayId,
        entryMode: selfEntryMode,
        ...(isCampaignCodeEntry ? { code } : {}),
      });
      if (!next.ok) {
        await onRefresh(giveawayId);
        setFeedback(riderGiveawayEntryFailureMessage(next.code));
        return;
      }

      onEntryRecorded(next.data);
      setFeedback("Your giveaway entry is recorded.");
    } catch {
      await onRefresh(giveawayId);
      setFeedback(riderGiveawayEntryFailureMessage("ERROR"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="grid gap-2 rounded-md border border-[#ffbe45]/30 bg-[#ffbe45]/[0.06] p-3"
      aria-label="Giveaway entry"
    >
      <div>
        <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-[#ffcf74]">
          {isCampaignCodeEntry ? "Code entry" : "Opt-in entry"}
        </span>
        <p className="mt-1 text-xs text-white/65">
          {isCampaignCodeEntry
            ? "Enter the campaign code to ask the server to record your eligible entry."
            : "Choose to enter this giveaway. The server confirms that you qualify."}
        </p>
      </div>

      {isCampaignCodeEntry ? (
        <label className="grid gap-1 text-xs font-bold text-white/72" htmlFor={`giveaway-code-${giveawayId}`}>
          Campaign code
          <input
            id={`giveaway-code-${giveawayId}`}
            autoCapitalize="none"
            autoComplete="off"
            className="min-h-9 rounded border border-white/15 bg-black/20 px-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ffbe45]/60 focus:ring-2 focus:ring-[#ffbe45]/35"
            disabled={pending}
            onChange={(event) => setCampaignCode(event.target.value)}
            placeholder="Enter campaign code"
            spellCheck={false}
            type="text"
            value={campaignCode}
          />
        </label>
      ) : null}

      <button
        className="min-h-9 rounded-md border border-[#ffbe45]/45 bg-[#ffbe45]/10 px-3 text-sm font-bold text-[#ffdc97] transition hover:bg-[#ffbe45]/20 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffbe45]"
        disabled={pending}
        onClick={() => void submitEntry()}
        type="button"
      >
        {pending ? "Recording entry…" : isCampaignCodeEntry ? "Enter code" : "Enter giveaway"}
      </button>

      {feedback ? (
        <p className="m-0 text-xs text-white/72" role="status">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}

export function RiderGiveawayStatusPanel({
  eventId,
  enabled,
}: RiderGiveawayStatusPanelProps) {
  const [result, setResult] = useState<RiderGiveawayLoadResult | null>(null);

  const updateRiderGiveawayState = (giveawayId: string, riderState: RiderGiveawayState) => {
    setResult((previous) => {
      if (!previous || previous.eventId !== eventId) return previous;
      return {
        ...previous,
        giveaways: previous.giveaways.map((giveaway) =>
          giveaway.giveawayId === giveawayId ? { ...giveaway, riderState } : giveaway,
        ),
      };
    });
  };

  const refreshRiderGiveawayState = async (giveawayId: string) => {
    try {
      const next = await listRiderGiveawayStatesForEventAction(eventId);
      if (!next.ok) return;
      const refreshed = next.data.find((giveaway) => giveaway.giveawayId === giveawayId);
      if (refreshed) {
        updateRiderGiveawayState(giveawayId, refreshed.riderState);
      }
    } catch {
      // The generic entry failure remains visible if the scoped reconciliation also fails.
    }
  };

  const updateWinnerPublication = async (
    awardId: string,
    input: GiveawayWinnerPublicationInput,
  ) => {
    const next = await setGiveawayWinnerPublicationAction(awardId, input);
    if (!next.ok) return false;
    setResult((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        giveaways: previous.giveaways.map((giveaway) =>
          giveaway.riderState.award?.awardId === awardId
            ? { ...giveaway, riderState: next.data }
            : giveaway,
        ),
      };
    });
    return true;
  };

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

                {giveaway.riderState.proof ? <RiderDrawProof proof={giveaway.riderState.proof} /> : null}

                <RiderGiveawayEntryControl
                  entryMode={giveaway.entryMode}
                  giveawayId={giveaway.giveawayId}
                  giveawayState={giveaway.giveawayState}
                  onEntryRecorded={(riderState) => updateRiderGiveawayState(giveaway.giveawayId, riderState)}
                  onRefresh={refreshRiderGiveawayState}
                  riderStatus={giveaway.riderState.status}
                />

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

                    {giveaway.riderState.proof ? (
                      <WinnerPublicationControl
                        key={`${award.awardId}:${award.winnerPublication?.alias ?? ""}`}
                        award={award}
                        onUpdate={(input) => updateWinnerPublication(award.awardId, input)}
                      />
                    ) : null}
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

function RiderDrawProof({ proof }: { proof: RiderGiveawayDrawProof }) {
  return (
    <section
      className="grid gap-2 rounded-md border border-sky-300/25 bg-sky-300/[0.06] p-3"
      aria-label="Your draw receipt"
    >
      <div>
        <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-sky-100">
          Your draw receipt
        </span>
        <p className="mt-1 break-all font-mono text-xs text-sky-50/90">{proof.entryReference}</p>
      </div>
      <p className="m-0 text-xs text-white/65">
        This is your own frozen entry reference. The receipt below contains only published draw verification data.
      </p>
      <details className="rounded border border-sky-200/15 bg-black/15 px-2.5 py-2 text-xs">
        <summary className="cursor-pointer font-bold text-sky-50">View published verification</summary>
        <dl className="mt-3 grid gap-2">
          {proof.drawVerifications.map((verification, index) => (
            <div key={`${verification.drawDigest}-${verification.seed}`} className="grid gap-1 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
              <dt className="text-[10px] font-black uppercase tracking-[0.1em] text-white/48">
                {proof.drawVerifications.length > 1 ? `Draw ${index + 1}` : "Published draw"}
              </dt>
              <dd className="m-0 grid gap-1 break-all font-mono text-[11px] text-sky-100/90">
                <span>Commitment: {verification.commitment}</span>
                <span>Snapshot: {verification.snapshotDigest} · {verification.snapshotCount} entries</span>
                <span>Algorithm: {verification.algorithmVersion}</span>
                <span>Draw digest: {verification.drawDigest}</span>
                <span>Revealed seed: {verification.seed}</span>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function WinnerPublicationControl({
  award,
  onUpdate,
}: {
  award: RiderGiveawayAwardSummary;
  onUpdate: (input: GiveawayWinnerPublicationInput) => Promise<boolean>;
}) {
  const [alias, setAlias] = useState(award.winnerPublication?.alias ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPublic = award.winnerPublication?.isPublic ?? false;

  async function publishAlias() {
    setPending(true);
    setError(null);
    try {
      const updated = await onUpdate({ published: true, alias });
      if (!updated) setError("Your public alias could not be updated. Check the alias and try again.");
    } catch {
      setError("Your public alias could not be updated. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function hideAlias() {
    setPending(true);
    setError(null);
    try {
      const updated = await onUpdate({ published: false });
      if (!updated) setError("Your public alias could not be hidden. Please try again.");
    } catch {
      setError("Your public alias could not be hidden. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.025] p-3" aria-label="Public winner alias">
      <div>
        <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-white/54">Public winner alias</span>
        <p className="mt-1 text-xs text-white/65">
          Optional. Your name stays private unless you choose the alias displayed on the public results.
        </p>
      </div>
      <label className="grid gap-1 text-xs font-bold text-white/72" htmlFor={`winner-alias-${award.awardId}`}>
        Alias to show publicly
        <input
          id={`winner-alias-${award.awardId}`}
          className="min-h-9 rounded border border-white/15 bg-black/20 px-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ffbe45]/60 focus:ring-2 focus:ring-[#ffbe45]/35"
          disabled={pending}
          maxLength={40}
          minLength={2}
          onChange={(event) => setAlias(event.target.value)}
          placeholder="e.g. Mina R."
          value={alias}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className="min-h-9 rounded-md border border-[#8ee6b7]/40 bg-[#20b26b]/10 px-3 text-sm font-bold text-[#b9f1ce] transition hover:bg-[#20b26b]/20 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ee6b7]"
          disabled={pending || alias.trim().length < 2}
          onClick={() => void publishAlias()}
          type="button"
        >
          {isPublic ? "Update public alias" : "Publish alias"}
        </button>
        {isPublic ? (
          <button
            className="min-h-9 rounded-md border border-white/20 px-3 text-sm font-bold text-white/75 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            disabled={pending}
            onClick={() => void hideAlias()}
            type="button"
          >
            Hide public alias
          </button>
        ) : null}
      </div>
      {error ? <p className="m-0 text-xs text-[#ff9b94]" role="status">{error}</p> : null}
    </section>
  );
}

function entryCountLabel(count: number) {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

function fulfilmentLabel(value: GiveawayFulfilmentMode) {
  return value.replaceAll("_", " ");
}
