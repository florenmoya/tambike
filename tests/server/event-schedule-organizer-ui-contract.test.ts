import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EventEditorFields } from "../../src/features/organizer/event-editor-fields";

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

  test("submits fixed schedule values without showing dead single-option controls", () => {
    const createMarkup = renderToStaticMarkup(
      createElement(EventEditorFields, { idPrefix: "create-event" }),
    );
    const weeklyMarkup = renderToStaticMarkup(
      createElement(EventEditorFields, {
        idPrefix: "copy-event",
        defaults: {
          recurrence: "WEEKLY",
          recurrenceEndsOn: "2026-09-30",
          timeZone: "Asia/Tokyo",
        },
      }),
    );

    expect(createMarkup).toContain('<input type="hidden" name="recurrence" value="NONE"');
    expect(createMarkup).toContain('<input type="hidden" name="timeZone" value="Asia/Manila"');
    expect(createMarkup).not.toContain('name="recurrenceEndsOn"');
    expect(weeklyMarkup).toContain('<input type="hidden" name="recurrence" value="WEEKLY"');
    expect(weeklyMarkup).toContain('<input type="hidden" name="recurrenceEndsOn" value="2026-09-30"');
    expect(weeklyMarkup).toContain('<input type="hidden" name="timeZone" value="Asia/Tokyo"');
    expect(createMarkup).not.toContain("Schedule</label>");
    expect(createMarkup).not.toContain("Time zone</label>");
    expect(organizerSource).toContain('formData.get("recurrence") ?? "NONE"');
    expect(organizerSource).toContain('formData.get("recurrenceEndsOn")');
  });
});
