import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrganizerConsole } from "@/features/organizer/organizer-console";
import { EventSubmissionPanel } from "@/features/organizer/event-submission-panel";
import { loadOrganizerEventSubmissionForPage } from "@/server/organizer/event-submission-actions";

const loadSubmission = cache(loadOrganizerEventSubmissionForPage);

export async function generateMetadata(
  props: PageProps<"/organizer/events/[eventId]">,
): Promise<Metadata> {
  const { eventId } = await props.params;
  const view = await loadSubmission(eventId);
  return {
    title: view ? `${view.event.title} submission` : "Event submission",
    description: "Review and update a Tambike event submission.",
  };
}

export default async function Page(
  props: PageProps<"/organizer/events/[eventId]">,
) {
  const { eventId } = await props.params;
  const view = await loadSubmission(eventId);
  const submissionContent = view ? (
    <EventSubmissionPanel initialView={view} />
  ) : (
    <Card className="mx-4 lg:mx-6">
      <CardHeader>
        <CardTitle>Event unavailable</CardTitle>
        <CardDescription>
          The event could not be found or it is not part of this organizer account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="min-h-11" variant="outline">
          <Link href="/organizer/events">Back to events</Link>
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <OrganizerConsole
      section="event"
      eventId={eventId}
      submissionContent={submissionContent}
    />
  );
}
