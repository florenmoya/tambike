import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/features/organizer/organizer-console.tsx",
  ),
  "utf8",
);
const sectionStart = source.indexOf("function CreateEventSection");
const sectionEnd = source.indexOf("function EventDetailSection", sectionStart);
const createEventSection = source.slice(sectionStart, sectionEnd);

describe("organizer structured event schedule UI", () => {
  test("uses labelled native schedule controls instead of display-label text", () => {
    for (const field of [
      ["Start date", "startDate", "date"],
      ["Start time", "startTime", "time"],
      ["End date", "endDate", "date"],
      ["End time", "endTime", "time"],
    ]) {
      expect(createEventSection).toContain(
        `<Field label="${field[0]}" htmlFor="${field[1]}">`,
      );
      expect(createEventSection).toMatch(
        new RegExp(
          `<Input[^>]*id="${field[1]}"[^>]*name="${field[1]}"[^>]*type="${field[2]}"`,
        ),
      );
    }
    expect(createEventSection).not.toContain('label="Date label"');
    expect(createEventSection).not.toContain('label="Time label"');
    expect(createEventSection).not.toContain('formData.get("date")');
    expect(createEventSection).not.toContain('formData.get("time")');
  });

  test("submits a one-time schedule without recurrence controls", () => {
    expect(createEventSection).toContain('name="timeZone"');
    expect(createEventSection).toContain('value="Asia/Manila"');
    expect(createEventSection).toContain('recurrence: "NONE"');
    expect(createEventSection).not.toContain('name="recurrence"');
    expect(createEventSection).not.toContain('value="WEEKLY"');
    expect(createEventSection).not.toContain('recurrence === "WEEKLY"');
    expect(createEventSection).not.toContain('name="recurrenceEndsOn"');
  });
});
