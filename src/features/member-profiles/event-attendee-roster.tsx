"use client";

import Image from "next/image";
import Link from "next/link";
import { EyeOff, MapPin, Motorbike, Users } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listEventAttendeesAction } from "@/server/actions";
import type { EventAttendeeRosterPage } from "./types";

type Attendee = EventAttendeeRosterPage["attendees"][number];

function mergeAttendees(current: Attendee[], incoming: Attendee[]) {
  return [...new Map([...current, ...incoming].map((attendee) => [attendee.slug, attendee])).values()];
}

function RosterMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="roster-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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

function rosterResetKey(page: EventAttendeeRosterPage) {
  return JSON.stringify([
    page.summary.eventId,
    page.summary.rosterEnabled,
    page.attendees.map((attendee) => attendee.slug),
    page.nextCursor ?? null,
    page.pageSize,
  ]);
}

export function EventAttendeeRoster(props: {
  initialPage: EventAttendeeRosterPage;
  signedIn: boolean;
  loadPage?: typeof listEventAttendeesAction;
}) {
  return <StatefulEventAttendeeRoster key={rosterResetKey(props.initialPage)} {...props} />;
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
        <span className="event-roster__eyebrow">Ride roll-call</span>
        <h1 id="event-roster-title">{summary.eventTitle}</h1>
        <p>Attendance choices belong to each rider. Private and unpublished profiles stay anonymous.</p>
        <div className="event-roster__metrics" aria-label="Roster totals">
          <RosterMetric label="Going" value={summary.goingCount} />
          <RosterMetric label="Visible riders" value={summary.visibleCount} />
          <RosterMetric label="Anonymous riders" value={summary.anonymousCount} />
        </div>
      </header>

      {!summary.rosterEnabled ? (
        <Card className="event-roster__state">
          <CardHeader>
            <CardTitle>Roster is counts only</CardTitle>
            <CardDescription>
              Rider cards stay hidden until the event organizer turns on the member roster.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : !signedIn ? (
        <Card className="event-roster__state">
          <CardHeader>
            <CardTitle>Log in to view riders</CardTitle>
            <CardDescription>This roster is shared only with signed-in Tambike members.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href={`/login?next=${encodeURIComponent(`/events/${summary.eventId}/attendees`)}`}>Log in</Link></Button>
          </CardContent>
        </Card>
      ) : summary.goingCount === 0 ? (
        <Card className="event-roster__state">
          <CardHeader>
            <CardTitle>No one is going yet</CardTitle>
            <CardDescription>Register for this event to become its first rider.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href={`/events/${summary.eventId}/register`}>Register for this event</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="event-roster__grid">
            {attendees.map((attendee) => <RiderExcerpt key={attendee.slug} attendee={attendee} />)}
            {summary.anonymousCount > 0 ? (
              <article className="roster-anonymous-card">
                <EyeOff aria-hidden="true" />
                <span>Privacy respected</span>
                <strong>{summary.anonymousCount} riders chose privacy</strong>
                <p>Anonymous RSVPs and private or unpublished profiles are counted here once.</p>
              </article>
            ) : null}
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
