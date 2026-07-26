"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, MapPin, Motorbike, Users } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listEventAttendeesAction } from "@/server/actions";
import type { EventAttendeeRosterPage } from "./types";

type Attendee = EventAttendeeRosterPage["attendees"][number];

function mergeAttendees(current: Attendee[], incoming: Attendee[]) {
  return [...new Map([...current, ...incoming].map((attendee) => [attendee.slug, attendee])).values()];
}

function RiderExcerpt({ attendee }: { attendee: Attendee }) {
  const motorcycle = attendee.motorcycle;
  const hero = motorcycle?.photos.toSorted((left, right) => left.position - right.position)[0];

  return (
    <Link className="roster-rider-card" href={`/riders/${attendee.slug}`}>
      <div className="roster-rider-card__identity">
        <div className="roster-rider-avatar">
          {attendee.profilePhotoUrl ? (
            <Image
              src={attendee.profilePhotoUrl}
              alt={`${attendee.displayName} profile photo`}
              width={128}
              height={128}
              sizes="72px"
              unoptimized
            />
          ) : (
            <span aria-hidden="true">{attendee.displayName.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div>
          <h3>{attendee.displayName}</h3>
          <p><MapPin aria-hidden="true" /> {attendee.area}</p>
        </div>
      </div>
      {motorcycle ? (
        <div className="roster-rider-card__motorcycle">
          {hero ? (
            <Image
              src={hero.url}
              alt={`${attendee.displayName}'s ${motorcycle.make} ${motorcycle.model}`}
              width={640}
              height={360}
              sizes="(max-width: 640px) 100vw, 360px"
              unoptimized
            />
          ) : (
            <div className="roster-rider-card__motorcycle-empty"><Motorbike aria-hidden="true" /></div>
          )}
          <span>{motorcycle.nickname || `${motorcycle.make} ${motorcycle.model}`}</span>
          <strong>{motorcycle.make} {motorcycle.model}</strong>
        </div>
      ) : (
        <div className="roster-rider-card__no-bike">Garage details not added yet</div>
      )}
    </Link>
  );
}

function canonicalAttendeeValue(attendee: Attendee) {
  const motorcycle = attendee.motorcycle;
  return [
    attendee.slug,
    attendee.displayName,
    attendee.area,
    attendee.profilePhotoUrl ?? null,
    motorcycle
      ? [
          motorcycle.make,
          motorcycle.model,
          motorcycle.year ?? null,
          motorcycle.displacementCc ?? null,
          motorcycle.nickname ?? null,
          motorcycle.description ?? null,
          motorcycle.photos
            .toSorted((left, right) => left.position - right.position)
            .map((photo) => [photo.url, photo.position, photo.width, photo.height]),
        ]
      : null,
  ];
}

function rosterResetKey(page: EventAttendeeRosterPage, signedIn: boolean) {
  return JSON.stringify([
    page.summary.eventId,
    page.summary.eventTitle,
    page.summary.rosterEnabled,
    page.summary.goingCount,
    page.summary.visibleCount,
    page.summary.anonymousCount,
    signedIn,
    page.attendees.map(canonicalAttendeeValue),
    page.nextCursor ?? null,
    page.pageSize,
  ]);
}

export function EventAttendeeRoster(props: {
  initialPage: EventAttendeeRosterPage;
  signedIn: boolean;
  loadPage?: typeof listEventAttendeesAction;
}) {
  return (
    <StatefulEventAttendeeRoster
      key={rosterResetKey(props.initialPage, props.signedIn)}
      {...props}
    />
  );
}

function StatefulEventAttendeeRoster({
  initialPage,
  signedIn,
  loadPage = listEventAttendeesAction,
}: {
  initialPage: EventAttendeeRosterPage;
  signedIn: boolean;
  loadPage?: typeof listEventAttendeesAction;
}) {
  const [attendees, setAttendees] = useState(initialPage.attendees);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const summary = initialPage.summary;

  const loadMore = () => {
    if (!nextCursor || isPending) return;
    setStatus("");
    startTransition(async () => {
      try {
        const page = await loadPage(summary.eventId, {
          cursor: nextCursor,
          limit: initialPage.pageSize,
        });
        setAttendees((current) => mergeAttendees(current, page.attendees));
        setNextCursor(page.nextCursor);
        setStatus(page.nextCursor ? "More riders loaded." : "All visible riders are loaded.");
      } catch {
        setStatus("The next riders could not be loaded. Try again.");
      }
    });
  };

  return (
    <section className="event-roster" aria-labelledby="event-roster-title">
      <header className="event-roster__header">
        <Link className="event-roster__back-link" href={`/events/${summary.eventId}`}>
          <ArrowLeft aria-hidden="true" />
          <span>{summary.eventTitle}</span>
        </Link>
        <div className="event-roster__heading-row">
          <h1 id="event-roster-title">Who’s going</h1>
          <span
            className="event-roster__count"
            aria-label={`${summary.goingCount} riders going`}
          >
            <strong>{summary.goingCount}</strong> going
          </span>
        </div>
      </header>

      {!summary.rosterEnabled ? (
        <Card className="event-roster__state">
          <CardHeader>
            <CardTitle>The rider list isn’t available for this event.</CardTitle>
          </CardHeader>
        </Card>
      ) : !signedIn ? (
        <Card className="event-roster__state">
          <CardHeader>
            <CardTitle>Log in to see who’s going</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild><Link className="event-roster__state-action" href={`/login?next=${encodeURIComponent(`/events/${summary.eventId}/attendees`)}`}>Log in</Link></Button>
          </CardContent>
        </Card>
      ) : summary.goingCount === 0 ? (
        <Card className="event-roster__state">
          <CardHeader>
            <CardTitle>No riders yet</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild><Link className="event-roster__state-action" href={`/events/${summary.eventId}/register`}>Join this event</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="event-roster__grid">
            {attendees.map((attendee) => <RiderExcerpt key={attendee.slug} attendee={attendee} />)}
          </div>
          {nextCursor ? (
            <div className="event-roster__more">
              <Button type="button" variant="outline" onClick={loadMore} disabled={isPending}>
                <Users aria-hidden="true" /> {isPending ? "Loading riders…" : "Load more riders"}
              </Button>
            </div>
          ) : null}
        </>
      )}
      <p className="event-roster__status" aria-live="polite">{status}</p>
    </section>
  );
}
