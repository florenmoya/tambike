import type { CreateEventInput, Event } from "../tambike-demo/types";

export const ORGANIZER_SUBMITTED_EVENT_WHAT_HAPPENS =
  "See the event schedule and organizer updates for timing, activities, and on-site instructions.";

export type EventReviewDecision =
  | "PUBLISH"
  | "REQUEST_CHANGES"
  | "REJECT";

export type EventReviewHistoryItem = {
  id: string;
  submissionVersion: number;
  decision: "pending" | "published" | "needs_changes" | "rejected";
  reviewerName?: string;
  reason?: string;
  submittedAt: string;
  decidedAt?: string;
};

export type AdminEventReviewView = {
  event: Event;
  organizerName: string;
  submissionVersion: number;
  expectedUpdatedAt: string;
  history: EventReviewHistoryItem[];
};

export type OrganizerEventSubmissionView = {
  event: Event;
  submissionVersion: number;
  expectedUpdatedAt: string;
  latestDecision?: EventReviewHistoryItem;
  history: EventReviewHistoryItem[];
};

export type ReviewEventInput = {
  decision: EventReviewDecision;
  reason?: string;
  expectedUpdatedAt: string;
};

export type EventStatusMutationInput = {
  reason: string;
  expectedUpdatedAt: string;
};

export type ResubmitEventInput = {
  event: CreateEventInput;
  reason: string;
  expectedUpdatedAt: string;
};
