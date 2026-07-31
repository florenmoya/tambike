import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("Prisma seed policy", () => {
  test("uses an explicit disposable loopback database instead of configured URLs", async () => {
    const seedModule = (await import("../../prisma/seed")) as Record<string, unknown>;
    const resolveSeedDatabaseUrl = seedModule.requireDisposableSeedDatabaseUrl;

    expect(resolveSeedDatabaseUrl).toBeTypeOf("function");
    if (typeof resolveSeedDatabaseUrl !== "function") {
      return;
    }

    const requireDisposableSeedDatabaseUrl = resolveSeedDatabaseUrl as (
      environment: Record<string, string | undefined>,
    ) => string;
    const disposableUrl = "postgresql://integration:secret@127.0.0.1:5432/tambike_test_seed";

    expect(
      requireDisposableSeedDatabaseUrl({
        TAMBIKE_TEST_DATABASE_URL: disposableUrl,
        DIRECT_URL: "postgresql://configured:secret@db.example.test:5432/tambike",
      }),
    ).toBe(disposableUrl);
    expect(() =>
      requireDisposableSeedDatabaseUrl({
        DIRECT_URL: "postgresql://configured:secret@db.example.test:5432/tambike",
      }),
    ).toThrow("TAMBIKE_TEST_DATABASE_URL");
    expect(() =>
      requireDisposableSeedDatabaseUrl({
        TAMBIKE_TEST_DATABASE_URL: "postgresql://integration:secret@db.example.test:5432/tambike_test_seed",
      }),
    ).toThrow("loopback tambike_test_*");
    expect(() =>
      requireDisposableSeedDatabaseUrl({
        TAMBIKE_TEST_DATABASE_URL: "mysql://integration:secret@127.0.0.1:3306/tambike_test_seed",
      }),
    ).toThrow("loopback tambike_test_*");

    const seedSource = readFileSync(resolve(process.cwd(), "prisma/seed.ts"), "utf8");
    expect(seedSource).toContain("const databaseUrl = requireDisposableSeedDatabaseUrl();");
    expect(seedSource).toMatch(/accountStatus:\s*"ACTIVE"/);
    expect(seedSource).not.toMatch(/verificationStatus:\s*"SUSPENDED"/);
  });
});
