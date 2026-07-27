"use client";

import { ChevronDown, CircleCheckBig, LoaderCircle, TicketCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  GiveawayEntryMode,
  GiveawayState,
  PublicEventGiveaway,
} from "@/features/giveaways/types";
import { listPublicGiveawaysForEventAction } from "@/server/giveaway-actions";

import {
  formatGiveawayMoment,
  giveawayEntryModeLabel,
  giveawayStateLabel,
} from "./giveaway-surface-state";
import { groupPublicGiveawaysForSpotlight } from "./public-giveaway-spotlight-state";
import styles from "./public-giveaway-panel.module.css";

type PublicGiveawayPanelProps = {
  eventId: string;
  viewerRole?: PublicGiveawayViewerRole;
};

type PublicGiveawayViewerRole = "guest" | "rider" | "organizer" | "admin";

type PublicGiveawayLoadState = "loading" | "ready" | "unavailable";

type PublicGiveawayLoadResult = {
  eventId: string;
  state: Exclude<PublicGiveawayLoadState, "loading">;
  campaigns: PublicEventGiveaway[];
};

type CampaignPresentationProps = {
  campaign: PublicEventGiveaway;
  eventId: string;
  viewerRole: PublicGiveawayViewerRole;
};

export function giveawayEntryLoginHref(eventId: string) {
  return `/login?next=${encodeURIComponent(`/events/${encodeURIComponent(eventId)}`)}`;
}

/** Guests only receive a route back to this event; eligibility stays rider-scoped. */
export function canOfferPublicGiveawayEntryLogin(input: {
  state: GiveawayState;
  entryMode: GiveawayEntryMode;
  viewerRole: PublicGiveawayViewerRole;
}) {
  return (
    input.viewerRole === "guest" &&
    input.state === "open" &&
    (input.entryMode === "opt_in" || input.entryMode === "claim_code")
  );
}

export function PublicGiveawayPanel({ eventId, viewerRole = "guest" }: PublicGiveawayPanelProps) {
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

  const groups = groupPublicGiveawaysForSpotlight(campaigns);
  const featuredCompleted = groups.completed[0];
  const additionalOpenCampaigns = groups.additional.filter(
    ({ giveaway }) => giveaway.state === "open",
  );
  const compactCampaigns = [
    ...groups.additional.filter(({ giveaway }) => giveaway.state !== "open"),
    ...groups.completed.slice(featuredCompleted ? 1 : 0),
  ];

  return (
    <section
      className={styles.section}
      aria-busy={loadState === "loading"}
      aria-labelledby={`event-giveaways-${eventId}`}
    >
      <header className={styles.heading}>
        <span>Raffles &amp; prizes</span>
        <h2 id={`event-giveaways-${eventId}`}>See what is open and who won recently.</h2>
      </header>

      {loadState === "loading" ? (
        <div className={styles.loadingSpotlight} role="status">
          <div className={styles.loadingOpenCard} aria-hidden="true" />
          <div className={styles.loadingWinnerCard} aria-hidden="true" />
          <span className={styles.loadingLabel}>
            <LoaderCircle aria-hidden="true" />
            Loading raffles…
          </span>
        </div>
      ) : (
        <>
          <div className={styles.spotlightGrid}>
            {groups.primaryOpen ? (
              <OpenGiveawaySpotlight
                campaign={groups.primaryOpen}
                eventId={eventId}
                viewerRole={viewerRole}
              />
            ) : null}
            {featuredCompleted && additionalOpenCampaigns.length === 0 ? (
              <CompletedGiveawayResult
                campaign={featuredCompleted}
                eventId={eventId}
                viewerRole={viewerRole}
              />
            ) : null}
          </div>
          {additionalOpenCampaigns.length > 0 ? (
            <div className={styles.compactGrid}>
              {additionalOpenCampaigns.map((campaign) => (
                <CompactGiveawayCard
                  key={campaign.giveaway.id}
                  campaign={campaign}
                  eventId={eventId}
                  viewerRole={viewerRole}
                />
              ))}
            </div>
          ) : null}
          {featuredCompleted && additionalOpenCampaigns.length > 0 ? (
            <div className={styles.spotlightGrid}>
              <CompletedGiveawayResult
                campaign={featuredCompleted}
                eventId={eventId}
                viewerRole={viewerRole}
              />
            </div>
          ) : null}
          {compactCampaigns.length > 0 ? (
            <div className={styles.compactGrid}>
              {compactCampaigns.map((campaign) => (
                <CompactGiveawayCard
                  key={campaign.giveaway.id}
                  campaign={campaign}
                  eventId={eventId}
                  viewerRole={viewerRole}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function OpenGiveawaySpotlight({
  campaign,
  eventId,
  viewerRole,
}: CampaignPresentationProps) {
  const { giveaway } = campaign;
  const entryOpen = formatGiveawayMoment(giveaway.entryOpensAt, giveaway.timeZone);
  const entryClose = formatGiveawayMoment(giveaway.entryClosesAt, giveaway.timeZone);
  const drawAt = formatGiveawayMoment(giveaway.drawAt, giveaway.timeZone);

  return (
    <article className={styles.openCard}>
      <div className={styles.cardBody}>
        <div className={styles.openStatus}>
          <TicketCheck aria-hidden="true" />
          Open now
        </div>
        <h3 className={styles.campaignTitle}>{giveaway.title}</h3>
        <div>
          <span className={styles.prizeLabel}>Featured prize</span>
          <p className={styles.prizeTitle}>{primaryPrizeSummary(campaign)}</p>
        </div>
        <div className={styles.metadata}>
          <span>{giveawayEntryModeLabel(giveaway.entryMode)}</span>
        </div>

        {entryOpen || entryClose || drawAt ? (
          <dl className={styles.schedule}>
            {entryOpen ? <ScheduleMoment label="Entry opens" value={entryOpen} /> : null}
            {entryClose ? <ScheduleMoment label="Entry closes" value={entryClose} /> : null}
            {drawAt ? <ScheduleMoment label="Draw" value={drawAt} /> : null}
          </dl>
        ) : null}

        {canOfferPublicGiveawayEntryLogin({
          state: giveaway.state,
          entryMode: giveaway.entryMode,
          viewerRole,
        }) ? (
          <div className={styles.entryRow}>
            <Link className={styles.entryAction} href={giveawayEntryLoginHref(eventId)}>
              Log in to enter
            </Link>
          </div>
        ) : null}

        <CampaignDetails
          label="How it works"
          mechanics={giveaway.mechanics}
          terms={giveaway.terms}
          sponsorDisclosure={giveaway.sponsorDisclosure}
        />
      </div>
    </article>
  );
}

function CompletedGiveawayResult({
  campaign,
}: CampaignPresentationProps) {
  const { giveaway, results, drawVerifications } = campaign;

  return (
    <article className={styles.winnerCard}>
      <div className={styles.cardBody}>
        <div className={styles.winnerHeader}>
          <CircleCheckBig aria-hidden="true" />
          Recent winner
        </div>
        <h3 className={styles.campaignTitle}>{giveaway.title}</h3>
        <p className={styles.winnerPrize}>{primaryPrizeSummary(campaign)}</p>

        {results.length > 0 ? (
          <div className={styles.winnerList}>
            {results.map((result, index) => (
              <p
                className={styles.winnerAlias}
                key={`${result.prizePoolTitle}-${result.winnerAlias}-${index}`}
              >
                {result.winnerAlias}
              </p>
            ))}
            <p className={styles.winnerPrivacy}>Winner chose to share this alias.</p>
          </div>
        ) : (
          <p className={styles.winnerPrivacy}>Winner not publicly listed</p>
        )}

        <CampaignDetails
          label="How it worked"
          mechanics={giveaway.mechanics}
          terms={giveaway.terms}
          sponsorDisclosure={giveaway.sponsorDisclosure}
        />

        {drawVerifications.length > 0 ? (
          <details className={styles.details}>
            <summary>
              Verify the draw
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className={styles.proofList}>
              {drawVerifications.map((verification, index) => (
                <DrawReceipt
                  key={`${verification.drawDigest}-${verification.seed}`}
                  verification={verification}
                  label={drawVerifications.length > 1 ? `Draw ${index + 1}` : "Published draw"}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function CompactGiveawayCard({
  campaign,
}: CampaignPresentationProps) {
  const { giveaway, results } = campaign;

  return (
    <article className={styles.compactCard}>
      <span className={styles.compactStatus}>
        {giveaway.state === "open" ? "Open now" : giveawayStateLabel(giveaway.state)}
      </span>
      <h3 className={styles.campaignTitle}>{giveaway.title}</h3>
      <p className={styles.compactPrize}>{primaryPrizeSummary(campaign)}</p>
      <div className={styles.metadata}>
        <span>{giveawayEntryModeLabel(giveaway.entryMode)}</span>
      </div>

      {giveaway.state === "completed" && results[0] ? (
        <div className={styles.compactWinner}>
          <p className={styles.winnerAlias}>{results[0].winnerAlias}</p>
          <p className={styles.winnerPrivacy}>Winner chose to share this alias.</p>
        </div>
      ) : null}

      <CampaignDetails
        label="How it works"
        mechanics={giveaway.mechanics}
        terms={giveaway.terms}
        sponsorDisclosure={giveaway.sponsorDisclosure}
      />
    </article>
  );
}

function CampaignDetails({
  label,
  mechanics,
  terms,
  sponsorDisclosure,
}: {
  label: string;
  mechanics: string;
  terms: string;
  sponsorDisclosure?: string;
}) {
  const disclosure = sponsorDisclosure?.trim();

  return (
    <details className={styles.details}>
      <summary>
        {label}
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={styles.detailsBody}>
        {disclosure ? <p className={styles.sponsorDisclosure}>{disclosure}</p> : null}
        <p>{mechanics}</p>
        <p>{terms}</p>
      </div>
    </details>
  );
}

function DrawReceipt({
  label,
  verification,
}: {
  label: string;
  verification: PublicEventGiveaway["drawVerifications"][number];
}) {
  const rows = [
    ["Commitment", verification.commitment],
    ["Snapshot", `${verification.snapshotDigest} · ${verification.snapshotCount} entries`],
    ["Algorithm", verification.algorithmVersion],
    ["Draw digest", verification.drawDigest],
    ["Revealed seed", verification.seed],
  ] as const;

  return (
    <details className={styles.receipt}>
      <summary>
        {label}
        <ChevronDown aria-hidden="true" />
      </summary>
      <dl>
        {rows.map(([rowLabel, value]) => (
          <div key={rowLabel}>
            <dt>{rowLabel}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ScheduleMoment({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function primaryPrizeSummary(campaign: PublicEventGiveaway) {
  const pool = campaign.giveaway.prizePools[0];
  if (!pool) return "Prize details coming soon";
  return pool.items[0]?.title ?? pool.title ?? prizePoolSummary(pool);
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
