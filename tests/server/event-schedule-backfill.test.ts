import { describe, expect, test, vi } from "vitest";

import { runEventScheduleBackfillCli } from "../../scripts/backfill-event-schedules";
import { demoEvents } from "../../src/features/tambike-demo/data";
import {
  buildEventScheduleBackfillPlan,
  type EventScheduleBackfillStore,
} from "../../src/server/maintenance/event-schedule-backfill";

function backfillStore(): EventScheduleBackfillStore {
  return {
    inspect: vi.fn(async () => [
      {
        id: "tambike-cafe-classico",
        startsAt: null,
        endsAt: null,
        timeZone: null,
        recurrence: null,
        recurrenceEndsAt: null,
      },
    ]),
    apply: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("event schedule backfill", () => {
  test("defines Cafe Classico as a one-time Manila event", () => {
    expect(
      demoEvents.find((event) => event.id === "tambike-cafe-classico"),
    ).toMatchObject({
      startsAt: "2026-08-01T10:00:00.000Z",
      endsAt: "2026-08-01T12:00:00.000Z",
      timeZone: "Asia/Manila",
      recurrence: "NONE",
      date: "Sat · Aug 1, 2026",
      time: "6:00 PM – 8:00 PM",
    });
  });

  test("plans only exact known unscheduled events", () => {
    const plan = buildEventScheduleBackfillPlan([
      {
        id: "tambike-cafe-classico",
        startsAt: null,
        endsAt: null,
        timeZone: null,
        recurrence: null,
        recurrenceEndsAt: null,
      },
      {
        id: "motoir-national-round-5",
        startsAt: new Date("2026-09-19T01:00:00.000Z"),
        endsAt: new Date("2026-09-20T15:00:00.000Z"),
        timeZone: "Asia/Manila",
        recurrence: "NONE",
        recurrenceEndsAt: null,
      },
      {
        id: "real-organizer-event",
        startsAt: null,
        endsAt: null,
        timeZone: null,
        recurrence: null,
        recurrenceEndsAt: null,
      },
    ]);

    expect(plan.updates).toEqual([
      {
        id: "tambike-cafe-classico",
        schedule: {
          startsAt: "2026-08-01T10:00:00.000Z",
          endsAt: "2026-08-01T12:00:00.000Z",
          timeZone: "Asia/Manila",
          recurrence: "NONE",
        },
        dateLabel: "Sat · Aug 1, 2026",
        timeLabel: "6:00 PM – 8:00 PM",
      },
    ]);
    expect(plan.skipped).toEqual([
      { id: "motoir-national-round-5", reason: "already_structured" },
      { id: "real-organizer-event", reason: "no_known_schedule" },
    ]);
  });

  test("defaults the CLI to preview and requires a named environment to apply", async () => {
    const store = backfillStore();
    const preview = await runEventScheduleBackfillCli({
      argv: [],
      environment: {
        DATABASE_URL:
          "postgresql://secret-user:secret-password@db.example.test:5432/tambike_db",
      },
      createStore: () => store,
      write: () => undefined,
    });

    expect(preview.mode).toBe("preview");
    expect(preview.target).toEqual({
      host: "db.example.test",
      database: "tambike_db",
    });
    expect(store.apply).not.toHaveBeenCalled();

    await expect(
      runEventScheduleBackfillCli({
        argv: ["--apply"],
        environment: {
          DATABASE_URL: "postgresql://localhost:5432/tambike_db",
        },
        createStore: () => backfillStore(),
        write: () => undefined,
      }),
    ).rejects.toThrow("EVENT_SCHEDULE_BACKFILL_ENVIRONMENT_REQUIRED");
  });

  test("applies exactly the previewed plan with explicit flags", async () => {
    const store = backfillStore();
    const receipt = await runEventScheduleBackfillCli({
      argv: ["--apply", "--environment=local"],
      environment: {
        DATABASE_URL: "postgresql://localhost:5432/tambike_db",
      },
      createStore: () => store,
      write: () => undefined,
    });

    expect(receipt.mode).toBe("apply");
    expect(receipt.environment).toBe("local");
    expect(store.apply).toHaveBeenCalledWith({
      updates: receipt.updates,
      skipped: receipt.skipped,
    });
    expect(store.close).toHaveBeenCalledOnce();
  });
});
