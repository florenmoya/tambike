import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/server/prisma-backend.ts"),
  "utf8",
);

describe("Prisma event schedule backend contract", () => {
  test("counts only interested RSVPs in the Interested metric", async () => {
    const backend = await import("../../src/server/prisma-backend") as {
      eventRelationshipCountSelect?: unknown;
    };

    expect(backend.eventRelationshipCountSelect).toEqual({
      passes: true,
      rsvps: { where: { status: "interested" } },
    });
  });

  test("validates structured input and persists generated labels", () => {
    const createStart = source.indexOf("async createEventDraft");
    const createEnd = source.indexOf("async registerForEvent", createStart);
    const createSource = source.slice(createStart, createEnd);
    const normalizeStart = source.indexOf("private normalizeEventSubmissionInput");
    const normalizeEnd = source.indexOf("private nextUserUpdatedAt", normalizeStart);
    const normalizeSource = source.slice(normalizeStart, normalizeEnd);

    expect(createSource).toContain("this.normalizeEventSubmissionInput(input)");
    expect(normalizeSource).toContain("parseEventScheduleInput(input)");
    expect(normalizeSource).toContain("formatEventSchedule(schedule)");
    expect(createSource).toContain("dateLabel: normalized.labels.date");
    expect(createSource).toContain("timeLabel: normalized.labels.time");
    expect(createSource).toContain("startsAt: new Date(normalized.schedule.startsAt)");
    expect(createSource).toContain("recurrence: normalized.schedule.recurrence");
    expect(createSource).not.toContain("startsAt: new Date(schedule.startsAt)");
    expect(createSource).not.toContain("recurrence: schedule.recurrence");
    expect(createSource).not.toContain("input.date.trim()");
    expect(createSource).not.toContain("input.time.trim()");
  });

  test("selects only migrated event columns in normal event queries", () => {
    const listStart = source.indexOf("async listEvents");
    const listEnd = source.indexOf("private async listPassesForUser", listStart);
    expect(source.slice(listStart, listEnd)).toContain(
      "select: eventRecordWithCountsSelect",
    );
  });

  test("selects only migrated event columns through giveaway relations", () => {
    const selectStart = source.indexOf("const eventRecordSelect =");
    const includeStart = source.indexOf("const giveawayConfigurationInclude =");
    const includeEnd = source.indexOf(
      "type GiveawayConfiguration =",
      includeStart,
    );
    const includeSource = source.slice(includeStart, includeEnd);

    expect(selectStart).toBeGreaterThanOrEqual(0);
    expect(selectStart).toBeLessThan(includeStart);
    expect(includeSource).toContain("event: {\n    select: {");
    expect(includeSource).toContain("...eventRecordSelect");
    expect(includeSource).not.toContain("event: {\n    include: {");
    expect(includeSource).not.toContain("startsAt: true");
    expect(includeSource).not.toContain("recurrence: true");
  });

  test("maps generated labels and sorts mapped public events", () => {
    const listStart = source.indexOf("async listEvents");
    const listEnd = source.indexOf("private async listPassesForUser", listStart);
    const listSource = source.slice(listStart, listEnd);
    const mapperStart = source.indexOf("private toEvent");
    const mapperEnd = source.indexOf("private toPass", mapperStart);
    const mapperSource = source.slice(mapperStart, mapperEnd);

    expect(listSource).toContain("sortEventsBySchedule(");
    expect(mapperSource).toContain("formatEventSchedule(schedule)");
    expect(mapperSource).toContain("startsAt: event.startsAt.toISOString()");
    expect(mapperSource).toContain("recurrenceEndsAt");
    expect(mapperSource).toContain("date: labels.date");
    expect(mapperSource).toContain("time: labels.time");
  });

  test("uses the current one-time schedule for known legacy event rows", () => {
    const mapperStart = source.indexOf("private toEvent");
    const mapperEnd = source.indexOf("private toPass", mapperStart);
    const mapperSource = source.slice(mapperStart, mapperEnd);

    expect(mapperSource).toContain("getDemoEventSchedule(event.id)");
    expect(mapperSource).toContain("knownSchedule");
  });
});
