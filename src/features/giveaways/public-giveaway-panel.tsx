"use client";

import { ChevronDown, CircleCheckBig, LoaderCircle, TicketCheck } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";

import type {
  GiveawayEntryMode,
  GiveawayState,
  PublicEventGiveaway,
} from "@/features/giveaways/types";
import { listPublicGiveawaysForEventAction } from "@/server/giveaway-actions";

import {
  formatGiveawayMoment,
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
        <span>Raffles</span>
        <h2 id={`event-giveaways-${eventId}`}>
          Join the current raffle or see the latest result.
        </h2>
      </header>

      {loadState === "loading" ? (
        <div className={styles.loadingSpotlight} role="status">
          <LoaderCircle aria-hidden="true" />
          Loading raffles…
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
  const entryClose = formatGiveawayMoment(giveaway.entryClosesAt, giveaway.timeZone);
  const drawAt = formatGiveawayMoment(giveaway.drawAt, giveaway.timeZone);
  const presentation = primaryPrizePresentation(campaign);

  return (
    <article className={styles.openCard}>
      <div className={styles.cardBody}>
        <div className={styles.openStatus}>
          <TicketCheck aria-hidden="true" />
          Ongoing
        </div>
        <PrizeImage presentation={presentation} />
        <p className={styles.prizeTitle}>
          <span>Win:</span> {presentation.title}
        </p>
        {presentation.description ? (
          <p className={styles.prizeDescription}>{presentation.description}</p>
        ) : null}
        <h3 className={styles.campaignTitle}>{giveaway.title}</h3>

        {entryClose || drawAt ? (
          <dl className={styles.schedule}>
            {entryClose ? <ScheduleMoment label="Entries close:" value={entryClose} /> : null}
            {drawAt ? <ScheduleMoment label="Draw date:" value={drawAt} /> : null}
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
          label="Raffle details"
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
  const presentation = primaryPrizePresentation(campaign);

  return (
    <article className={styles.winnerCard}>
      <div className={styles.cardBody}>
        <div className={styles.winnerHeader}>
          <CircleCheckBig aria-hidden="true" />
          Completed
        </div>
        <h3 className={styles.campaignTitle}>{giveaway.title}</h3>

        {results.length > 0 ? (
          <div className={styles.winnerList}>
            {results.map((result, index) => (
              <div
                className={styles.result}
                key={`${result.prizeTitle}-${result.winnerAlias}-${index}`}
              >
                <p className={styles.winnerAlias}>
                  <span>Winner:</span> {result.winnerAlias}
                </p>
                <p className={styles.winnerPrize}>
                  <span>Prize won:</span> {result.prizeTitle || presentation.title}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.result}>
            <p className={styles.winnerAlias}>
              <span>Winner:</span> Winner not publicly listed
            </p>
            <p className={styles.winnerPrize}>
              <span>Prize won:</span> {presentation.title}
            </p>
          </div>
        )}

        <CampaignDetails
          label="View result"
          mechanics={giveaway.mechanics}
          terms={giveaway.terms}
          sponsorDisclosure={giveaway.sponsorDisclosure}
          drawVerifications={drawVerifications}
        />
      </div>
    </article>
  );
}

function CompactGiveawayCard({
  campaign,
  eventId,
  viewerRole,
}: CampaignPresentationProps) {
  const { giveaway, results, drawVerifications } = campaign;
  const presentation = primaryPrizePresentation(campaign);
  const isOpen = giveaway.state === "open";
  const isCompleted = giveaway.state === "completed";
  const showPrize = !isCompleted;
  const entryClose = formatGiveawayMoment(giveaway.entryClosesAt, giveaway.timeZone);
  const drawAt = formatGiveawayMoment(giveaway.drawAt, giveaway.timeZone);

  return (
    <article
      className={`${styles.compactCard} ${
        isOpen ? styles.compactOpen : isCompleted ? styles.compactCompleted : ""
      }`}
    >
      <span className={styles.compactStatus}>
        {isOpen ? "Ongoing" : giveawayStateLabel(giveaway.state)}
      </span>
      {showPrize ? <PrizeImage presentation={presentation} /> : null}
      {showPrize ? (
        <p className={styles.compactPrize}>
          <span>Win:</span> {presentation.title}
        </p>
      ) : null}
      <h3 className={styles.campaignTitle}>{giveaway.title}</h3>

      {showPrize && (entryClose || drawAt) ? (
        <dl className={styles.schedule}>
          {entryClose ? <ScheduleMoment label="Entries close:" value={entryClose} /> : null}
          {drawAt ? <ScheduleMoment label="Draw date:" value={drawAt} /> : null}
        </dl>
      ) : null}

      {isOpen &&
      canOfferPublicGiveawayEntryLogin({
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

      {isCompleted ? (
        <div className={styles.result}>
          <p className={styles.winnerAlias}>
            <span>Winner:</span> {results[0]?.winnerAlias ?? "Winner not publicly listed"}
          </p>
          <p className={styles.winnerPrize}>
            <span>Prize won:</span> {results[0]?.prizeTitle || presentation.title}
          </p>
        </div>
      ) : null}

      <CampaignDetails
        label={isCompleted ? "View result" : "Raffle details"}
        mechanics={giveaway.mechanics}
        terms={giveaway.terms}
        sponsorDisclosure={giveaway.sponsorDisclosure}
        drawVerifications={isCompleted ? drawVerifications : undefined}
      />
    </article>
  );
}

function CampaignDetails({
  label,
  mechanics,
  terms,
  sponsorDisclosure,
  drawVerifications,
}: {
  label: string;
  mechanics: string;
  terms: string;
  sponsorDisclosure?: string;
  drawVerifications?: PublicEventGiveaway["drawVerifications"];
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
        {drawVerifications && drawVerifications.length > 0 ? (
          <section className={styles.drawDetails} aria-label="Draw details">
            <h4>Draw details</h4>
            <div className={styles.proofList}>
              {drawVerifications.map((verification, index) => (
                <DrawReceipt
                  key={`${verification.drawDigest}-${verification.seed}`}
                  verification={verification}
                  label={drawVerifications.length > 1 ? `Draw ${index + 1}` : "Published draw"}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}

function PrizeImage({
  presentation,
}: {
  presentation: ReturnType<typeof primaryPrizePresentation>;
}) {
  if (!presentation.image) return null;

  return (
    <div className={styles.prizeImage}>
      <Image
        src={presentation.image.url}
        alt={presentation.title}
        width={presentation.image.width}
        height={presentation.image.height}
        sizes="(max-width: 899px) 100vw, 60vw"
        unoptimized
      />
    </div>
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

function primaryPrizePresentation(campaign: PublicEventGiveaway) {
  const pool = campaign.giveaway.prizePools[0];
  if (!pool) {
    return {
      disclosure: "revealed" as const,
      title: "Prize details coming soon",
    };
  }
  return pool.presentation;
}
