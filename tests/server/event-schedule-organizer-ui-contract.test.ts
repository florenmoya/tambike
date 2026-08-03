import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const organizerSource = readFileSync(
  resolve(
    process.cwd(),
    "src/features/organizer/organizer-console.tsx",
  ),
  "utf8",
);
const editorSource = readFileSync(
  resolve(process.cwd(), "src/features/organizer/event-editor-fields.tsx"),
  "utf8",
);

describe("organizer structured event schedule UI", () => {
  test("uses labelled native schedule controls instead of display-label text", () => {
    for (const [label, name, type] of [
      ["Start date", "startDate", "date"],
      ["Start time", "startTime", "time"],
      ["End date", "endDate", "date"],
      ["End time", "endTime", "time"],
    ]) {
      expect(editorSource).toContain(`label="${label}"`);
      expect(editorSource).toContain(`inputProps("${name}")`);
      expect(editorSource).toContain(`type="${type}"`);
    }
    expect(editorSource).not.toContain('label="Date label"');
    expect(editorSource).not.toContain('label="Time label"');
    expect(organizerSource).not.toContain('formData.get("date")');
    expect(organizerSource).not.toContain('formData.get("time")');
  });

  test("submits a one-time schedule with an explicit, restricted recurrence control", () => {
    expect(editorSource).toContain('inputProps("timeZone")');
    expect(editorSource).toContain('<option value="Asia/Manila">');
    expect(editorSource).toContain('inputProps("recurrence")');
    expect(editorSource).toContain('<option value="NONE">One-time event</option>');
    expect(organizerSource).toContain('formData.get("recurrence") ?? "NONE"');
    expect(editorSource).not.toContain('value="WEEKLY"');
    expect(editorSource).not.toContain('recurrence === "WEEKLY"');
    expect(editorSource).not.toContain('inputProps("recurrenceEndsOn")');
  });
});
