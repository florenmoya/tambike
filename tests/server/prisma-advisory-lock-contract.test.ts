import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const prismaBackend = readFileSync(
  resolve(process.cwd(), "src/server/prisma-backend.ts"),
  "utf8",
);

describe("Prisma advisory transaction lock contract", () => {
  test("executes every void-returning advisory lock without deserializing a result", () => {
    const advisoryLockStatements = prismaBackend
      .split("\n")
      .filter((line) => line.includes("pg_advisory_xact_lock"));

    expect(advisoryLockStatements).toHaveLength(3);
    for (const statement of advisoryLockStatements) {
      expect(statement).toContain("$executeRaw");
      expect(statement).not.toContain("$queryRaw");
    }
  });
});
