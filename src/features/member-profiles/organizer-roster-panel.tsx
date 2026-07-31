"use client";

import { Eye, EyeOff, Users } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import { EventAttendeeRoster } from "./event-attendee-roster";
import type { EventAttendeeRosterPage } from "./types";

export function OrganizerRosterPanel({
  eventId,
  initialPage,
}: {
  eventId: string;
  initialPage?: EventAttendeeRosterPage;
}) {
  const { configureEventRoster, listEventAttendees } = useDemo();
  const [page, setPage] = useState(initialPage);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (page) return;
    let active = true;
    listEventAttendees(eventId)
      .then((nextPage) => {
        if (active) setPage(nextPage);
      })
      .catch(() => {
        if (active) setStatus("Roster details could not be loaded. Try again.");
      });
    return () => { active = false; };
  }, [eventId, listEventAttendees, page]);

  const toggleRoster = () => {
    if (!page || isPending) return;
    const enabled = !page.summary.rosterEnabled;
    setStatus("");
    startTransition(async () => {
      try {
        await configureEventRoster(eventId, enabled);
        const nextPage = await listEventAttendees(eventId);
        setPage(nextPage);
        setStatus(enabled ? "Member roster is on." : "Member roster is off. Counts remain available.");
      } catch {
        setStatus("Roster visibility was not saved. Try again.");
      }
    });
  };

  if (!page) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Member roster</CardTitle>
          <CardDescription>Loading attendee privacy settings…</CardDescription>
        </CardHeader>
        <CardContent><p aria-live="polite">{status}</p></CardContent>
      </Card>
    );
  }

  return (
    <OrganizerRosterPanelSurface
      page={page}
      status={status}
      pending={isPending}
      onToggle={toggleRoster}
    />
  );
}

export function OrganizerRosterPanelSurface({
  page,
  status,
  pending,
  onToggle,
}: {
  page: EventAttendeeRosterPage;
  status: string;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="organizer-roster-panel">
      <Card>
        <CardHeader className="organizer-roster-panel__heading">
          <div>
            <CardTitle>Member roster</CardTitle>
            <CardDescription>
              You control whether signed-in members can see published profiles for this owned event.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant={page.summary.rosterEnabled ? "default" : "outline"}
            role="switch"
            aria-checked={page.summary.rosterEnabled}
            aria-label="Show attendee roster"
            disabled={pending}
            onClick={onToggle}
          >
            {page.summary.rosterEnabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            {pending ? "Saving…" : page.summary.rosterEnabled ? "Roster on" : "Roster off"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="organizer-roster-panel__totals" aria-label="Roster totals">
            <span><Users aria-hidden="true" /><strong>{page.summary.goingCount}</strong> Going</span>
            <span><Eye aria-hidden="true" /><strong>{page.summary.visibleCount}</strong> Visible</span>
            <span><EyeOff aria-hidden="true" /><strong>{page.summary.anonymousCount}</strong> Anonymous</span>
          </div>
          <p className="organizer-roster-panel__status" aria-live="polite">{status}</p>
        </CardContent>
      </Card>
      <EventAttendeeRoster initialPage={page} signedIn />
    </div>
  );
}
