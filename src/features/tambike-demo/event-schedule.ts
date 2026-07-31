import type {
  Event,
  EventRecurrence,
  EventSchedule,
  EventScheduleInput,
} from "./types";

export type EventScheduleState =
  | "ONGOING"
  | "UPCOMING"
  | "PAST"
  | "UNSCHEDULED";

export interface EventOccurrence {
  state: EventScheduleState;
  startsAt?: Date;
  endsAt?: Date;
}

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

interface ClockParts {
  hour: number;
  minute: number;
  second: number;
}

interface ZonedDateTimeParts extends CalendarDateParts, ClockParts {}

type SortableEvent = Pick<
  Event,
  | "id"
  | "date"
  | "time"
  | "startsAt"
  | "endsAt"
  | "timeZone"
  | "recurrence"
  | "recurrenceEndsAt"
>;

const legacyMonthIndex: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const legacyWeekdayIndex: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;

const stateRank: Record<EventScheduleState, number> = {
  ONGOING: 0,
  UPCOMING: 1,
  PAST: 2,
  UNSCHEDULED: 3,
};

export class EventScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventScheduleValidationError";
  }
}

function parseCalendarDate(value: string, fieldName: string): CalendarDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new EventScheduleValidationError(`${fieldName} is invalid.`);
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const normalized = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  );
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() !== parts.month - 1 ||
    normalized.getUTCDate() !== parts.day
  ) {
    throw new EventScheduleValidationError(`${fieldName} is invalid.`);
  }

  return parts;
}

function parseClock(value: string, fieldName: string): ClockParts {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new EventScheduleValidationError(`${fieldName} is invalid.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new EventScheduleValidationError(`${fieldName} is invalid.`);
  }

  return { hour, minute, second: 0 };
}

function assertTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new EventScheduleValidationError("The selected timezone is invalid.");
  }
}

function zonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (const part of formatter.formatToParts(date)) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function sameZonedParts(
  actual: ZonedDateTimeParts,
  date: CalendarDateParts,
  clock: ClockParts,
) {
  return (
    actual.year === date.year &&
    actual.month === date.month &&
    actual.day === date.day &&
    actual.hour === clock.hour &&
    actual.minute === clock.minute &&
    actual.second === clock.second
  );
}

function localDateTimeToUtc(
  date: CalendarDateParts,
  clock: ClockParts,
  timeZone: string,
) {
  const desiredAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += desiredAsUtc - actualAsUtc;
  }

  const result = new Date(candidate);
  if (!sameZonedParts(zonedParts(result, timeZone), date, clock)) {
    throw new EventScheduleValidationError(
      "The selected local date and time do not exist in this timezone.",
    );
  }
  return result;
}

function addDays(date: CalendarDateParts, days: number): CalendarDateParts {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function scheduleFromEvent(
  event: Omit<SortableEvent, "id" | "date" | "time">,
): EventSchedule | null {
  if (
    !event.startsAt ||
    !event.endsAt ||
    !event.timeZone ||
    !event.recurrence
  ) {
    return null;
  }

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt <= startsAt ||
    !["NONE", "WEEKLY"].includes(event.recurrence)
  ) {
    return null;
  }

  try {
    assertTimeZone(event.timeZone);
  } catch {
    return null;
  }

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timeZone: event.timeZone,
    recurrence: event.recurrence,
    recurrenceEndsAt: event.recurrenceEndsAt,
  };
}

function legacyClocks(timeLabel: string) {
  const matches = Array.from(
    timeLabel.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/gi),
  );
  return matches.map((match): ClockParts => {
    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === "PM") {
      hour += 12;
    }
    return {
      hour,
      minute: Number(match[2] ?? 0),
      second: 0,
    };
  });
}

function legacyOccurrence(
  event: Pick<SortableEvent, "date" | "time">,
  now: Date,
): EventOccurrence {
  const timeZone = "Asia/Manila";
  const clocks = legacyClocks(event.time);
  const startClock = clocks[0] ?? { hour: 0, minute: 0, second: 0 };
  const endClock = clocks[1] ?? {
    hour: clocks.length ? Math.min(startClock.hour + 2, 23) : 23,
    minute: clocks.length ? startClock.minute : 59,
    second: 0,
  };

  try {
    const recurring = /^\s*Every\s+([A-Za-z]+)\s*$/i.exec(event.date);
    if (recurring) {
      const targetWeekday =
        legacyWeekdayIndex[recurring[1].toLowerCase()];
      if (targetWeekday === undefined) {
        return { state: "UNSCHEDULED" };
      }
      const nowParts = zonedParts(now, timeZone);
      const currentWeekdayName = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
      })
        .format(now)
        .toLowerCase();
      const currentWeekday = legacyWeekdayIndex[currentWeekdayName];
      let daysAhead = (targetWeekday - currentWeekday + 7) % 7;
      let candidateDate = addDays(nowParts, daysAhead);
      let startsAt = localDateTimeToUtc(candidateDate, startClock, timeZone);
      let endsAt = localDateTimeToUtc(candidateDate, endClock, timeZone);
      if (endsAt <= startsAt) {
        endsAt = localDateTimeToUtc(
          addDays(candidateDate, 1),
          endClock,
          timeZone,
        );
      }
      if (now >= startsAt && now < endsAt) {
        return { state: "ONGOING", startsAt, endsAt };
      }
      if (now >= endsAt) {
        daysAhead += 7;
        candidateDate = addDays(nowParts, daysAhead);
        startsAt = localDateTimeToUtc(candidateDate, startClock, timeZone);
        endsAt = localDateTimeToUtc(candidateDate, endClock, timeZone);
        if (endsAt <= startsAt) {
          endsAt = localDateTimeToUtc(
            addDays(candidateDate, 1),
            endClock,
            timeZone,
          );
        }
      }
      return { state: "UPCOMING", startsAt, endsAt };
    }

    const explicit = event.date.match(
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i,
    );
    if (!explicit) {
      return { state: "UNSCHEDULED" };
    }
    const nowParts = zonedParts(now, timeZone);
    const date = {
      year: explicit[3] ? Number(explicit[3]) : nowParts.year,
      month: legacyMonthIndex[explicit[1].toLowerCase()],
      day: Number(explicit[2]),
    };
    if (!date.month) {
      return { state: "UNSCHEDULED" };
    }
    const startsAt = localDateTimeToUtc(date, startClock, timeZone);
    let endsAt = localDateTimeToUtc(date, endClock, timeZone);
    if (endsAt <= startsAt) {
      endsAt = localDateTimeToUtc(addDays(date, 1), endClock, timeZone);
    }
    if (now < startsAt) {
      return { state: "UPCOMING", startsAt, endsAt };
    }
    if (now < endsAt) {
      return { state: "ONGOING", startsAt, endsAt };
    }
    return { state: "PAST", startsAt, endsAt };
  } catch {
    return { state: "UNSCHEDULED" };
  }
}

function occurrenceForSortableEvent(event: SortableEvent, now: Date) {
  const structured = getRelevantEventOccurrence(event, now);
  return structured.state === "UNSCHEDULED"
    ? legacyOccurrence(event, now)
    : structured;
}

export function parseEventScheduleInput(
  input: EventScheduleInput,
): EventSchedule {
  const timeZone = input.timeZone.trim();
  assertTimeZone(timeZone);

  const startDate = parseCalendarDate(input.startDate, "The start date");
  const startTime = parseClock(input.startTime, "The start time");
  const endDate = parseCalendarDate(input.endDate, "The end date");
  const endTime = parseClock(input.endTime, "The end time");
  const startsAt = localDateTimeToUtc(startDate, startTime, timeZone);
  const endsAt = localDateTimeToUtc(endDate, endTime, timeZone);
  if (endsAt <= startsAt) {
    throw new EventScheduleValidationError(
      "The event end must be after its start.",
    );
  }

  const recurrence: EventRecurrence = input.recurrence;
  if (recurrence !== "NONE") {
    throw new EventScheduleValidationError(
      "Event recurrence is currently unavailable.",
    );
  }

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timeZone,
    recurrence,
  };
}

function occurrenceForWeek(schedule: EventSchedule, week: number) {
  const firstStart = zonedParts(new Date(schedule.startsAt), schedule.timeZone);
  const firstEnd = zonedParts(new Date(schedule.endsAt), schedule.timeZone);
  const startsAt = localDateTimeToUtc(
    addDays(firstStart, week * 7),
    firstStart,
    schedule.timeZone,
  );
  const endsAt = localDateTimeToUtc(
    addDays(firstEnd, week * 7),
    firstEnd,
    schedule.timeZone,
  );
  return { startsAt, endsAt };
}

function lastWeeklyOccurrence(schedule: EventSchedule, recurrenceEnd: Date) {
  const firstStart = new Date(schedule.startsAt);
  const approximateWeek = Math.max(
    0,
    Math.floor(
      (recurrenceEnd.getTime() - firstStart.getTime()) / millisecondsPerWeek,
    ),
  );

  for (let week = approximateWeek + 2; week >= 0; week -= 1) {
    const occurrence = occurrenceForWeek(schedule, week);
    if (occurrence.startsAt <= recurrenceEnd) {
      return occurrence;
    }
  }

  return occurrenceForWeek(schedule, 0);
}

export function getRelevantEventOccurrence(
  scheduleInput: Partial<EventSchedule>,
  now = new Date(),
): EventOccurrence {
  const schedule = scheduleFromEvent({
    startsAt: scheduleInput.startsAt,
    endsAt: scheduleInput.endsAt,
    timeZone: scheduleInput.timeZone,
    recurrence: scheduleInput.recurrence,
    recurrenceEndsAt: scheduleInput.recurrenceEndsAt,
  });
  if (!schedule) {
    return { state: "UNSCHEDULED" };
  }

  const firstStart = new Date(schedule.startsAt);
  const firstEnd = new Date(schedule.endsAt);
  if (schedule.recurrence === "NONE") {
    if (now < firstStart) {
      return { state: "UPCOMING", startsAt: firstStart, endsAt: firstEnd };
    }
    if (now < firstEnd) {
      return { state: "ONGOING", startsAt: firstStart, endsAt: firstEnd };
    }
    return { state: "PAST", startsAt: firstStart, endsAt: firstEnd };
  }

  const recurrenceEnd = schedule.recurrenceEndsAt
    ? new Date(schedule.recurrenceEndsAt)
    : null;
  if (recurrenceEnd && now > recurrenceEnd) {
    return {
      state: "PAST",
      ...lastWeeklyOccurrence(schedule, recurrenceEnd),
    };
  }

  if (now < firstStart) {
    return { state: "UPCOMING", startsAt: firstStart, endsAt: firstEnd };
  }

  const approximateWeek = Math.max(
    0,
    Math.floor((now.getTime() - firstStart.getTime()) / millisecondsPerWeek),
  );
  for (
    let week = Math.max(0, approximateWeek - 1);
    week <= approximateWeek + 2;
    week += 1
  ) {
    const occurrence = occurrenceForWeek(schedule, week);
    if (recurrenceEnd && occurrence.startsAt > recurrenceEnd) {
      return {
        state: "PAST",
        ...lastWeeklyOccurrence(schedule, recurrenceEnd),
      };
    }
    if (now >= occurrence.startsAt && now < occurrence.endsAt) {
      return { state: "ONGOING", ...occurrence };
    }
    if (now < occurrence.startsAt) {
      return { state: "UPCOMING", ...occurrence };
    }
  }

  const next = occurrenceForWeek(schedule, approximateWeek + 3);
  return { state: "UPCOMING", ...next };
}

function formatTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatEventSchedule(
  schedule: EventSchedule,
  now = new Date(),
): { date: string; time: string } {
  const relevant = getRelevantEventOccurrence(schedule, now);
  const startsAt = relevant.startsAt ?? new Date(schedule.startsAt);
  const endsAt = relevant.endsAt ?? new Date(schedule.endsAt);
  const startParts = zonedParts(startsAt, schedule.timeZone);
  const endParts = zonedParts(endsAt, schedule.timeZone);
  const spansMultipleDays =
    startParts.year !== endParts.year ||
    startParts.month !== endParts.month ||
    startParts.day !== endParts.day;
  const shortWeekday = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.timeZone,
      weekday: "short",
    }).format(date);
  const monthAndDay = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.timeZone,
      month: "short",
      day: "numeric",
    }).format(date);
  const monthDayAndYear = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);

  const date =
    schedule.recurrence === "WEEKLY"
      ? `Every ${new Intl.DateTimeFormat("en-US", {
          timeZone: schedule.timeZone,
          weekday: "long",
        }).format(startsAt)}`
      : spansMultipleDays
        ? startParts.year === endParts.year
          ? `${shortWeekday(startsAt)} · ${monthAndDay(startsAt)} – ${shortWeekday(endsAt)} · ${monthDayAndYear(endsAt)}`
          : `${shortWeekday(startsAt)} · ${monthDayAndYear(startsAt)} – ${shortWeekday(endsAt)} · ${monthDayAndYear(endsAt)}`
        : `${shortWeekday(startsAt)} · ${monthDayAndYear(startsAt)}`;

  return {
    date,
    time: `${formatTime(startsAt, schedule.timeZone)} – ${formatTime(
      endsAt,
      schedule.timeZone,
    )}`,
  };
}

export function compareEventsBySchedule(
  left: SortableEvent,
  right: SortableEvent,
  now = new Date(),
) {
  const leftOccurrence = occurrenceForSortableEvent(left, now);
  const rightOccurrence = occurrenceForSortableEvent(right, now);
  return compareEventOccurrences(
    left.id,
    leftOccurrence,
    right.id,
    rightOccurrence,
  );
}

function compareEventOccurrences(
  leftId: string,
  leftOccurrence: EventOccurrence,
  rightId: string,
  rightOccurrence: EventOccurrence,
) {
  const rankDifference =
    stateRank[leftOccurrence.state] - stateRank[rightOccurrence.state];
  if (rankDifference !== 0) {
    return rankDifference;
  }

  const leftTime =
    leftOccurrence.state === "ONGOING"
      ? leftOccurrence.endsAt?.getTime()
      : leftOccurrence.state === "PAST"
        ? leftOccurrence.endsAt?.getTime()
        : leftOccurrence.startsAt?.getTime();
  const rightTime =
    rightOccurrence.state === "ONGOING"
      ? rightOccurrence.endsAt?.getTime()
      : rightOccurrence.state === "PAST"
        ? rightOccurrence.endsAt?.getTime()
        : rightOccurrence.startsAt?.getTime();

  if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
    return leftOccurrence.state === "PAST"
      ? rightTime - leftTime
      : leftTime - rightTime;
  }

  return leftId.localeCompare(rightId);
}

export function sortEventsBySchedule<T extends SortableEvent>(
  events: T[],
  now = new Date(),
) {
  return events
    .map((event, originalIndex) => ({
      event,
      originalIndex,
      occurrence: occurrenceForSortableEvent(event, now),
    }))
    .sort((left, right) => {
      const scheduleOrder = compareEventOccurrences(
        left.event.id,
        left.occurrence,
        right.event.id,
        right.occurrence,
      );
      return scheduleOrder || left.originalIndex - right.originalIndex;
    })
    .map(({ event }) => event);
}
