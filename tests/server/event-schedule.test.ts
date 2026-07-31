import { describe, expect, test } from "vitest";
import {
  EventScheduleValidationError,
  compareEventsBySchedule,
  formatEventSchedule,
  getRelevantEventOccurrence,
  parseEventScheduleInput,
} from "../../src/features/tambike-demo/event-schedule";
import type {
  Event,
  EventSchedule,
  EventScheduleInput,
} from "../../src/features/tambike-demo/types";

const oneTimeInput: EventScheduleInput = {
  startDate: "2026-09-19",
  startTime: "18:00",
  endDate: "2026-09-19",
  endTime: "20:00",
  timeZone: "Asia/Manila",
  recurrence: "NONE",
};

const weeklySchedule: EventSchedule = {
  startsAt: "2026-08-01T10:00:00.000Z",
  endsAt: "2026-08-01T12:00:00.000Z",
  timeZone: "Asia/Manila",
  recurrence: "WEEKLY",
};

function sortableEvent(
  id: string,
  schedule: Partial<EventSchedule> & { date?: string; time?: string },
): Pick<
  Event,
  | "id"
  | "date"
  | "time"
  | "startsAt"
  | "endsAt"
  | "timeZone"
  | "recurrence"
  | "recurrenceEndsAt"
> {
  return {
    id,
    date: schedule.date ?? "",
    time: schedule.time ?? "",
    ...schedule,
  };
}

describe("structured event schedules", () => {
  test("parses organizer wall-clock input into UTC", () => {
    expect(parseEventScheduleInput(oneTimeInput)).toEqual({
      startsAt: "2026-09-19T10:00:00.000Z",
      endsAt: "2026-09-19T12:00:00.000Z",
      timeZone: "Asia/Manila",
      recurrence: "NONE",
    });
  });

  test("rejects weekly recurrence while recurrence is disabled", () => {
    expect(() =>
      parseEventScheduleInput({
        ...oneTimeInput,
        recurrence: "WEEKLY",
      }),
    ).toThrow("recurrence is currently unavailable");
  });

  test.each([
    [{ ...oneTimeInput, startDate: "2026-02-30" }, "start date"],
    [{ ...oneTimeInput, startTime: "24:00" }, "start time"],
    [{ ...oneTimeInput, timeZone: "Mars/Olympus" }, "timezone"],
    [{ ...oneTimeInput, endTime: "17:59" }, "after"],
  ])("rejects an invalid schedule", (input, message) => {
    expect(() => parseEventScheduleInput(input)).toThrow(
      EventScheduleValidationError,
    );
    expect(() => parseEventScheduleInput(input)).toThrow(message);
  });

  test("generates one-time and weekly public labels", () => {
    const oneTime = parseEventScheduleInput(oneTimeInput);

    expect(formatEventSchedule(oneTime)).toEqual({
      date: "Sat · Sep 19, 2026",
      time: "6:00 PM – 8:00 PM",
    });
    expect(formatEventSchedule(weeklySchedule)).toEqual({
      date: "Every Saturday",
      time: "6:00 PM – 8:00 PM",
    });
  });

  test("generates a readable date range for multi-day events", () => {
    const schedule = parseEventScheduleInput({
      startDate: "2026-09-19",
      startTime: "09:00",
      endDate: "2026-09-20",
      endTime: "23:00",
      timeZone: "Asia/Manila",
      recurrence: "NONE",
    });

    expect(formatEventSchedule(schedule)).toEqual({
      date: "Sat · Sep 19 – Sun · Sep 20, 2026",
      time: "9:00 AM – 11:00 PM",
    });
  });

  test("returns the active and next weekly occurrences", () => {
    expect(
      getRelevantEventOccurrence(
        weeklySchedule,
        new Date("2026-08-01T10:30:00.000Z"),
      ),
    ).toEqual({
      state: "ONGOING",
      startsAt: new Date("2026-08-01T10:00:00.000Z"),
      endsAt: new Date("2026-08-01T12:00:00.000Z"),
    });

    expect(
      getRelevantEventOccurrence(
        weeklySchedule,
        new Date("2026-08-01T12:01:00.000Z"),
      ),
    ).toEqual({
      state: "UPCOMING",
      startsAt: new Date("2026-08-08T10:00:00.000Z"),
      endsAt: new Date("2026-08-08T12:00:00.000Z"),
    });
  });

  test("treats a weekly series past its recurrence end as past", () => {
    const occurrence = getRelevantEventOccurrence(
      {
        ...weeklySchedule,
        recurrenceEndsAt: "2026-08-15T15:59:59.999Z",
      },
      new Date("2026-08-16T00:00:00.000Z"),
    );

    expect(occurrence).toEqual({
      state: "PAST",
      startsAt: new Date("2026-08-15T10:00:00.000Z"),
      endsAt: new Date("2026-08-15T12:00:00.000Z"),
    });
  });

  test("sorts ongoing, upcoming, past, and unscheduled events for discovery", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const events = [
      sortableEvent("unscheduled", {}),
      sortableEvent("older-past", {
        startsAt: "2026-07-27T10:00:00.000Z",
        endsAt: "2026-07-27T12:00:00.000Z",
        timeZone: "Asia/Manila",
        recurrence: "NONE",
      }),
      sortableEvent("farther-upcoming", {
        startsAt: "2026-08-08T10:00:00.000Z",
        endsAt: "2026-08-08T12:00:00.000Z",
        timeZone: "Asia/Manila",
        recurrence: "NONE",
      }),
      sortableEvent("ongoing", {
        startsAt: "2026-07-30T11:00:00.000Z",
        endsAt: "2026-07-30T13:00:00.000Z",
        timeZone: "Asia/Manila",
        recurrence: "NONE",
      }),
      sortableEvent("recent-past", {
        startsAt: "2026-07-29T10:00:00.000Z",
        endsAt: "2026-07-29T12:00:00.000Z",
        timeZone: "Asia/Manila",
        recurrence: "NONE",
      }),
      sortableEvent("nearest-upcoming", {
        startsAt: "2026-08-01T10:00:00.000Z",
        endsAt: "2026-08-01T12:00:00.000Z",
        timeZone: "Asia/Manila",
        recurrence: "NONE",
      }),
    ];

    expect(
      events
        .sort((left, right) => compareEventsBySchedule(left, right, now))
        .map((event) => event.id),
    ).toEqual([
      "ongoing",
      "nearest-upcoming",
      "farther-upcoming",
      "recent-past",
      "older-past",
      "unscheduled",
    ]);
  });

  test("keeps legacy rows chronological while structured schedules are backfilled", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const events = [
      sortableEvent("unknown", {
        date: "Soon",
        time: "After lunch",
      }),
      sortableEvent("september", {
        date: "Sat · Sep 5, 2026",
        time: "5:00 AM - 5:00 PM",
      }),
      sortableEvent("cafe-weekly", {
        date: "Every Saturday",
        time: "6:00 PM - 8:00 PM",
      }),
      sortableEvent("august-morning", {
        date: "Sat · August 1",
        time: "9:00 AM",
      }),
      sortableEvent("recent-past", {
        date: "Wed · July 29, 2026",
        time: "7:00 PM - 9:00 PM",
      }),
    ];

    expect(
      events
        .sort((left, right) => compareEventsBySchedule(left, right, now))
        .map((event) => event.id),
    ).toEqual([
      "august-morning",
      "cafe-weekly",
      "september",
      "recent-past",
      "unknown",
    ]);
  });
});
