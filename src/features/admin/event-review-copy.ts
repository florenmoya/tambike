import type { Event } from "@/features/tambike-demo/types";

export function eventReviewSummary(
  event: Event,
  state: { isDisabled: boolean; isPublished: boolean },
) {
  if (state.isDisabled) {
    return `${event.title} is disabled and hidden from public operations.`;
  }
  if (state.isPublished) {
    return `${event.title} is published and visible to riders.`;
  }
  return event.shortDescription;
}
