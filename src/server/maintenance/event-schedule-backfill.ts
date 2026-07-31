import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { demoEvents } from "@/features/tambike-demo/data";
import type {
  EventRecurrence,
  EventSchedule,
} from "@/features/tambike-demo/types";

export interface EventScheduleBackfillRow {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  timeZone: string | null;
  recurrence: EventRecurrence | null;
  recurrenceEndsAt: Date | null;
}

export interface EventScheduleBackfillPlan {
  updates: Array<{
    id: string;
    schedule: EventSchedule;
    dateLabel: string;
    timeLabel: string;
  }>;
  skipped: Array<{
    id: string;
    reason:
      | "already_structured"
      | "partially_structured"
      | "no_known_schedule";
  }>;
}

export interface EventScheduleBackfillStore {
  inspect(): Promise<EventScheduleBackfillRow[]>;
  apply(plan: EventScheduleBackfillPlan): Promise<void>;
  close(): Promise<void>;
}

const knownSchedules = new Map(
  demoEvents.flatMap((event) => {
    if (
      !event.startsAt ||
      !event.endsAt ||
      !event.timeZone ||
      !event.recurrence
    ) {
      return [];
    }
    return [
      [
        event.id,
        {
          schedule: {
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            timeZone: event.timeZone,
            recurrence: event.recurrence,
            recurrenceEndsAt: event.recurrenceEndsAt,
          },
          dateLabel: event.date,
          timeLabel: event.time,
        },
      ] as const,
    ];
  }),
);

export function buildEventScheduleBackfillPlan(
  rows: EventScheduleBackfillRow[],
): EventScheduleBackfillPlan {
  const updates: EventScheduleBackfillPlan["updates"] = [];
  const skipped: EventScheduleBackfillPlan["skipped"] = [];

  for (const row of rows) {
    const structuredValues = [
      row.startsAt,
      row.endsAt,
      row.timeZone,
      row.recurrence,
      row.recurrenceEndsAt,
    ];
    const requiredValues = [
      row.startsAt,
      row.endsAt,
      row.timeZone,
      row.recurrence,
    ];
    if (requiredValues.every(Boolean)) {
      skipped.push({ id: row.id, reason: "already_structured" });
      continue;
    }
    if (structuredValues.some(Boolean)) {
      skipped.push({ id: row.id, reason: "partially_structured" });
      continue;
    }

    const known = knownSchedules.get(row.id);
    if (!known) {
      skipped.push({ id: row.id, reason: "no_known_schedule" });
      continue;
    }
    updates.push({
      id: row.id,
      schedule: known.schedule,
      dateLabel: known.dateLabel,
      timeLabel: known.timeLabel,
    });
  }

  return { updates, skipped };
}

export function createPrismaEventScheduleBackfill(
  databaseUrl: string,
): EventScheduleBackfillStore {
  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

  return {
    inspect: () =>
      prisma.event.findMany({
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          timeZone: true,
          recurrence: true,
          recurrenceEndsAt: true,
        },
        orderBy: { id: "asc" },
      }),
    async apply(plan) {
      await prisma.$transaction(async (transaction) => {
        for (const update of plan.updates) {
          const result = await transaction.event.updateMany({
            where: {
              id: update.id,
              startsAt: null,
              endsAt: null,
              timeZone: null,
              recurrence: null,
              recurrenceEndsAt: null,
            },
            data: {
              startsAt: new Date(update.schedule.startsAt),
              endsAt: new Date(update.schedule.endsAt),
              timeZone: update.schedule.timeZone,
              recurrence: update.schedule.recurrence,
              recurrenceEndsAt: update.schedule.recurrenceEndsAt
                ? new Date(update.schedule.recurrenceEndsAt)
                : null,
              dateLabel: update.dateLabel,
              timeLabel: update.timeLabel,
            },
          });
          if (result.count !== 1) {
            throw new Error(`EVENT_SCHEDULE_CHANGED:${update.id}`);
          }
        }
      });
    },
    close: () => prisma.$disconnect(),
  };
}
