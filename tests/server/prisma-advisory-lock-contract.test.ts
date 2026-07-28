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

  test("does not run giveaway configuration reads concurrently on one transaction client", () => {
    const start = prismaBackend.indexOf(
      "private async replaceGiveawayConfiguration(",
    );
    const end = prismaBackend.indexOf(
      "private currentGiveawayMechanics(",
      start,
    );
    const methodSource = prismaBackend.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(methodSource).not.toContain("Promise.all");
  });

  test("gives complex giveaway configuration transactions an explicit bounded timeout", () => {
    const createStart = prismaBackend.indexOf("async createGiveaway(");
    const updateStart = prismaBackend.indexOf(
      "async updateGiveaway(",
      createStart,
    );
    const listStart = prismaBackend.indexOf(
      "async listOrganizerGiveaways(",
      updateStart,
    );

    expect(prismaBackend).toContain(
      "timeout: 30_000",
    );
    expect(prismaBackend.slice(createStart, updateStart)).toContain(
      "GIVEAWAY_CONFIGURATION_TRANSACTION_OPTIONS",
    );
    expect(prismaBackend.slice(updateStart, listStart)).toContain(
      "GIVEAWAY_CONFIGURATION_TRANSACTION_OPTIONS",
    );
  });

  test("configures a bounded default for other complex backend transactions", () => {
    const createStart = prismaBackend.indexOf("static create(");
    const disconnectStart = prismaBackend.indexOf(
      "async disconnect()",
      createStart,
    );
    const createSource = prismaBackend.slice(createStart, disconnectStart);

    expect(createSource).toContain("transactionOptions");
    expect(createSource).toContain("timeout: 30_000");
    expect(createSource).toContain("maxWait: 5_000");
  });
});
