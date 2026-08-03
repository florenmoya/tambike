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
import { AdminConsole } from "@/features/admin/admin-console";
import { EventReviewControls } from "@/features/admin/event-review-controls";
import { loadAdminEventReviewForPage } from "@/server/admin/event-review-actions";

const loadReview = cache(loadAdminEventReviewForPage);

export async function generateMetadata(
  props: PageProps<"/admin/events/review/[reviewId]">,
): Promise<Metadata> {
  const { reviewId } = await props.params;
  const view = await loadReview(reviewId);
  return {
    title: view ? `Review ${view.event.title}` : "Event review",
    description: "Review a Tambike event submission.",
  };
}

export default async function Page(
  props: PageProps<"/admin/events/review/[reviewId]">,
) {
  const { reviewId } = await props.params;
  const view = await loadReview(reviewId);
  const eventReviewContent = view ? (
    <EventReviewControls initialView={view} />
  ) : (
    <Card className="mx-4 lg:mx-6">
      <CardHeader>
        <CardTitle>Event review unavailable</CardTitle>
        <CardDescription>
          The submission could not be found or this account cannot review it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="min-h-11" variant="outline">
          <Link href="/admin/events/review">Back to review queue</Link>
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <AdminConsole
      section="events"
      reviewId={reviewId}
      eventReviewContent={eventReviewContent}
    />
  );
}
