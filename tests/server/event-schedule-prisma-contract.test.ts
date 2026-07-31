import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260730000000_structured_event_schedule/migration.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const eventModel = schema.match(/model Event \{[\s\S]*?\n\}/)?.[0] ?? "";

describe("structured event schedule Prisma contract", () => {
  test("defines nullable schedule fields beside legacy display labels", () => {
    expect(schema).toMatch(
      /enum EventRecurrence\s+\{\s+NONE\s+WEEKLY\s+\}/,
    );
    expect(eventModel).toMatch(/startsAt\s+DateTime\?/);
    expect(eventModel).toMatch(/endsAt\s+DateTime\?/);
    expect(eventModel).toMatch(/timeZone\s+String\?\s+@db\.VarChar\(80\)/);
    expect(eventModel).toMatch(/recurrence\s+EventRecurrence\?/);
    expect(eventModel).toMatch(/recurrenceEndsAt\s+DateTime\?/);
    expect(eventModel).toContain("@@index([startsAt])");
    expect(eventModel).toMatch(/dateLabel\s+String/);
    expect(eventModel).toMatch(/timeLabel\s+String/);
  });

  test("adds the schedule columns without dropping legacy labels", () => {
    expect(migration).toContain(
      `CREATE TYPE "EventRecurrence" AS ENUM ('NONE', 'WEEKLY')`,
    );
    expect(migration).toContain(`ADD COLUMN "startsAt" TIMESTAMP(3)`);
    expect(migration).toContain(`ADD COLUMN "endsAt" TIMESTAMP(3)`);
    expect(migration).toContain(`ADD COLUMN "timeZone" VARCHAR(80)`);
    expect(migration).toContain(
      `ADD COLUMN "recurrence" "EventRecurrence"`,
    );
    expect(migration).toContain(`ADD COLUMN "recurrenceEndsAt" TIMESTAMP(3)`);
    expect(migration).toContain(
      `CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt")`,
    );
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE).*dateLabel/i);
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE).*timeLabel/i);
  });
});
