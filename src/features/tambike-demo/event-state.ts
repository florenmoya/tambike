import type { Event, EventStatus } from "./types";

export interface EventQueryInput {
  q?: string;
  type?: string;
}

export interface EventCtaState {
  canRegister: boolean;
  canShowInterest: boolean;
  label: string;
  title: string;
  body: string;
  isPast: boolean;
}

const registerableStatuses = new Set<EventStatus>(["PUBLISHED", "ONGOING"]);
const monthIndex: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function explicitDateFromLabel(dateLabel: string, now: Date) {
  if (/^\s*every\s+/i.test(dateLabel)) {
    return null;
  }

  const match = dateLabel.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i,
  );
  if (!match) {
    return null;
  }

  const month = monthIndex[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : now.getFullYear();
  if (month === undefined || !Number.isFinite(day) || day < 1 || day > 31) {
    return null;
  }

  return new Date(year, month, day, 23, 59, 59, 999);
}

export function isEventPast(event: Pick<Event, "date" | "status">, now = new Date()) {
  if (event.status === "COMPLETED") {
    return true;
  }

  const datedAt = explicitDateFromLabel(event.date, now);
  return datedAt ? datedAt.getTime() < now.getTime() : false;
}

export function getEventCtaState(event: Pick<Event, "date" | "status">, now = new Date()): EventCtaState {
  const isPast = isEventPast(event, now);

  if (isPast) {
    return {
      canRegister: false,
      canShowInterest: false,
      label: "Past event",
      title: "Past event",
      body: "Registration is closed because this event date has passed.",
      isPast,
    };
  }

  if (!registerableStatuses.has(event.status)) {
    return {
      canRegister: false,
      canShowInterest: false,
      label: "Under review",
      title: "Registration not open",
      body: "This event is still moving through organizer, venue, or admin review.",
      isPast,
    };
  }

  return {
    canRegister: true,
    canShowInterest: true,
    label: "Register",
    title: "Registration open",
    body: "Riders can save interest or generate a Tambike Pass.",
    isPast,
  };
}

export function filterEventsByQuery<T extends Event>(events: T[], query?: EventQueryInput) {
  const normalizedQuery = query?.q?.trim().toLowerCase();
  if (!normalizedQuery) {
    return events;
  }

  return events.filter((event) => {
    const searchable = [
      event.title,
      event.type,
      event.area,
      event.shortDescription,
      event.whatHappens,
      event.perkPreview,
      ...event.tags,
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  });
}
