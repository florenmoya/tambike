"use client";

import { ChevronDown, CircleCheckBig, LoaderCircle, TicketCheck } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";

import type {
  GiveawayEntryMode,
  GiveawayState,
  PublicEventGiveaway,
  PublicPrizePresentation,
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

  const groups = groupPublicGiveawaysForSpotlight(campaigns);
  const openCampaigns = [
    ...(groups.primaryOpen ? [groups.primaryOpen] : []),
    ...groups.additional.filter(
      ({ giveaway }) => giveaway.state === "open",
    ),
  ];
  const winnerCampaigns = groups.completed.filter(
    ({ results }) => results.length > 0,
  );
  const otherCampaigns = groups.additional.filter(
    ({ giveaway }) => giveaway.state !== "open",
  );
  const hasDisplayableCampaigns =
    openCampaigns.length > 0 ||
    winnerCampaigns.length > 0 ||
    otherCampaigns.length > 0;

  if (
    loadState === "unavailable" ||
    (loadState === "ready" && !hasDisplayableCampaigns)
  ) {
    return null;
  }

  const primaryOpen = openCampaigns[0];
  const additionalOpenCampaigns = openCampaigns.slice(1);
  const latestWinner = winnerCampaigns[0];
  const additionalWinnerCampaigns = winnerCampaigns.slice(1);
  const compactCampaigns = otherCampaigns;

  return (
    <section
      className={styles.section}
      aria-busy={loadState === "loading"}
      aria-labelledby={`event-giveaways-${eventId}`}
    >
      <header className={styles.heading}>
        <span>Raffles</span>
        <h2 id={`event-giveaways-${eventId}`}>Event raffles</h2>
      </header>

      {loadState === "loading" ? (
        <div className={styles.loadingSpotlight} role="status">
          <LoaderCircle aria-hidden="true" />
          Loading raffles…
        </div>
      ) : (
        <>
          {primaryOpen ? (
            <section
              className={styles.campaignGroup}
              aria-labelledby={`open-raffles-${eventId}`}
            >
              <h3 className={styles.groupHeading} id={`open-raffles-${eventId}`}>
                Open raffles
              </h3>
              <div className={styles.spotlightGrid}>
                <OpenGiveawaySpotlight
                  campaign={primaryOpen}
                  eventId={eventId}
                  viewerRole={viewerRole}
                />
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
            </section>
          ) : null}
          {latestWinner ? (
            <section
              className={styles.campaignGroup}
              aria-labelledby={`recent-winners-${eventId}`}
            >
              <h3 className={styles.groupHeading} id={`recent-winners-${eventId}`}>
                Recent winners
              </h3>
              <div className={styles.spotlightGrid}>
                <CompletedGiveawayResult
                  campaign={latestWinner}
                  eventId={eventId}
                  viewerRole={viewerRole}
                />
              </div>
              {additionalWinnerCampaigns.length > 0 ? (
                <div className={styles.compactGrid}>
                  {additionalWinnerCampaigns.map((campaign) => (
                    <CompactGiveawayCard
                      key={campaign.giveaway.id}
                      campaign={campaign}
                      eventId={eventId}
                      viewerRole={viewerRole}
                    />
                  ))}
                </div>
              ) : null}
            </section>
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
          Open now
        </div>
        <PublicPrizeImage presentation={presentation} />
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

        <PublicRaffleInformation
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
  const drawAt = formatGiveawayMoment(giveaway.drawAt, giveaway.timeZone);

  return (
    <article className={styles.winnerCard}>
      <div className={styles.cardBody}>
        <div className={styles.winnerHeader}>
          <CircleCheckBig aria-hidden="true" />
          Latest winner
        </div>
        <PublicPrizeImage presentation={presentation} />
        <h3 className={styles.campaignTitle}>{giveaway.title}</h3>

        <PublicGiveawayResultList
          results={results}
          presentationTitle={presentation.title}
        />

        {drawAt ? (
          <dl className={styles.schedule}>
            <ScheduleMoment label="Draw date:" value={drawAt} />
          </dl>
        ) : null}

        <PublicRaffleInformation
          mechanics={giveaway.mechanics}
          terms={giveaway.terms}
          sponsorDisclosure={giveaway.sponsorDisclosure}
        />
        <DrawVerificationDetails drawVerifications={drawVerifications} />
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
        {isOpen ? "Open now" : isCompleted ? "Winner" : giveawayStateLabel(giveaway.state)}
      </span>
      <PublicPrizeImage presentation={presentation} />
      {showPrize ? (
        <p className={styles.compactPrize}>
          <span>Win:</span> {presentation.title}
        </p>
      ) : null}
      {presentation.description ? (
        <p className={styles.prizeDescription}>{presentation.description}</p>
      ) : null}
      <h3 className={styles.campaignTitle}>{giveaway.title}</h3>

      {(showPrize && entryClose) || drawAt ? (
        <dl className={styles.schedule}>
          {showPrize && entryClose ? (
            <ScheduleMoment label="Entries close:" value={entryClose} />
          ) : null}
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

      <PublicRaffleInformation
        mechanics={giveaway.mechanics}
        terms={giveaway.terms}
        sponsorDisclosure={giveaway.sponsorDisclosure}
      />
      {isCompleted ? (
        <DrawVerificationDetails drawVerifications={drawVerifications} />
      ) : null}
    </article>
  );
}

function PublicRaffleInformation({
  mechanics,
  terms,
  sponsorDisclosure,
}: {
  mechanics: string;
  terms: string;
  sponsorDisclosure?: string;
}) {
  const disclosure = sponsorDisclosure?.trim();

  return (
    <div className={styles.publicInfo}>
      {disclosure ? <p className={styles.sponsorDisclosure}>{disclosure}</p> : null}
      <p>{mechanics}</p>
      <p className={styles.terms}>{terms}</p>
    </div>
  );
}

function DrawVerificationDetails({
  drawVerifications,
}: {
  drawVerifications: PublicEventGiveaway["drawVerifications"];
}) {
  if (drawVerifications.length === 0) return null;

  return (
    <details className={styles.details}>
      <summary>
        Draw verification
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={styles.detailsBody}>
        <div className={styles.proofList}>
          {drawVerifications.map((verification, index) => (
            <DrawReceipt
              key={`${verification.drawDigest}-${verification.seed}`}
              verification={verification}
              label={drawVerifications.length > 1 ? `Draw ${index + 1}` : "Published draw"}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

export function PublicPrizeImage({
  presentation,
}: {
  presentation: ReturnType<typeof primaryPrizePresentation>;
}) {
  const image = toValidPublicPrizeImage(presentation.image);
  const imageIdentity = image ? `${image.mediaId}\u0000${image.url}` : undefined;
  const [failedImageIdentity, setFailedImageIdentity] = useState<string>();

  if (!image || failedImageIdentity === imageIdentity) return null;

  return (
    <div className={styles.prizeImage}>
      <Image
        key={imageIdentity}
        src={image.url}
        alt={presentation.title}
        width={image.width}
        height={image.height}
        sizes="(max-width: 899px) 100vw, 60vw"
        unoptimized
        onError={() => setFailedImageIdentity(imageIdentity)}
      />
    </div>
  );
}

function publicGiveawayResultKeys(
  results: PublicEventGiveaway["results"],
) {
  const occurrenceByIdentity = new Map<string, number>();

  return results.map((result) => {
    const identity = JSON.stringify([result.prizeTitle, result.winnerAlias]);
    const occurrence = occurrenceByIdentity.get(identity) ?? 0;
    occurrenceByIdentity.set(identity, occurrence + 1);
    return `${identity}:${occurrence}`;
  });
}

export function PublicGiveawayResultList({
  results,
  presentationTitle,
}: {
  results: PublicEventGiveaway["results"];
  presentationTitle: string;
}) {
  if (results.length === 0) {
    return (
      <div className={styles.result}>
        <p className={styles.winnerAlias}>
          <span>Winner:</span> Winner not publicly listed
        </p>
        <p className={styles.winnerPrize}>
          <span>Prize won:</span> {presentationTitle}
        </p>
      </div>
    );
  }

  const resultKeys = publicGiveawayResultKeys(results);

  return (
    <div className={styles.winnerList}>
      {results.map((result, index) => (
        <div className={styles.result} key={resultKeys[index]}>
          <p className={styles.winnerAlias}>
            <span>Winner:</span> {result.winnerAlias}
          </p>
          <p className={styles.winnerPrize}>
            <span>Prize won:</span> {result.prizeTitle || presentationTitle}
          </p>
        </div>
      ))}
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

function primaryPrizePresentation(
  campaign: PublicEventGiveaway,
): PublicPrizePresentation {
  const pool = campaign.giveaway.prizePools[0];
  const presentation = pool?.presentation as unknown;
  const unavailable: PublicPrizePresentation = {
    disclosure: "revealed",
    title: "Prize details unavailable",
  };

  if (!presentation || typeof presentation !== "object") {
    return unavailable;
  }

  const publicFields = presentation as Record<string, unknown>;
  if (publicFields.disclosure === "surprise") {
    return {
      disclosure: "surprise",
      title: "Surprise prize",
    };
  }

  if (
    publicFields.disclosure !== "revealed" ||
    typeof publicFields.title !== "string" ||
    !publicFields.title.trim()
  ) {
    return unavailable;
  }

  const description =
    typeof publicFields.description === "string"
      ? publicFields.description.trim()
      : "";
  const image = toValidPublicPrizeImage(publicFields.image);

  return {
    disclosure: "revealed",
    title: publicFields.title.trim(),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  };
}

function toValidPublicPrizeImage(
  value: unknown,
): PublicPrizePresentation["image"] {
  if (!value || typeof value !== "object") return undefined;

  const image = value as Record<string, unknown>;
  const mediaId =
    typeof image.mediaId === "string" ? image.mediaId.trim() : "";
  if (
    !mediaId ||
    mediaId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(mediaId) ||
    typeof image.url !== "string" ||
    typeof image.width !== "number" ||
    !Number.isSafeInteger(image.width) ||
    image.width <= 0 ||
    image.width > 32_768 ||
    typeof image.height !== "number" ||
    !Number.isSafeInteger(image.height) ||
    image.height <= 0 ||
    image.height > 32_768
  ) {
    return undefined;
  }

  let encodedMediaId: string;
  try {
    encodedMediaId = encodeURIComponent(mediaId);
  } catch {
    return undefined;
  }

  const canonicalUrl = `/giveaway-prize-media/${encodedMediaId}`;
  const apiAlias = `/api/giveaway-prize-media/${encodedMediaId}`;
  if (image.url !== canonicalUrl && image.url !== apiAlias) {
    return undefined;
  }

  return {
    mediaId,
    url: canonicalUrl,
    width: image.width,
    height: image.height,
  };
}
