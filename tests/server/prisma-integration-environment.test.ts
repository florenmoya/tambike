import { describe, expect, test } from "vitest";

import {
  createPrismaIntegrationChildEnvironment,
  getPrismaIntegrationMigrationArguments,
  requirePrismaIntegrationTestDatabaseUrl,
} from "../prisma-integration/environment";

const testDatabaseUrl =
  "postgresql://integration:secret@127.0.0.1:5432/tambike_test_giveaways";

function integrationEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS: "1",
    TAMBIKE_TEST_DATABASE_URL: testDatabaseUrl,
    ...overrides,
  };
}

describe("Prisma integration test environment", () => {
  test("requires the explicit opt-in switch", () => {
    expect(() =>
      requirePrismaIntegrationTestDatabaseUrl({
        TAMBIKE_TEST_DATABASE_URL: testDatabaseUrl,
      }),
    ).toThrow("TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS=1");
  });

  test("never falls back to DATABASE_URL or DIRECT_URL", () => {
    expect(() =>
      requirePrismaIntegrationTestDatabaseUrl({
        TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS: "1",
        DATABASE_URL: testDatabaseUrl,
        DIRECT_URL: testDatabaseUrl,
      }),
    ).toThrow("TAMBIKE_TEST_DATABASE_URL");
  });

  test("accepts only a disposable loopback test database", () => {
    expect(requirePrismaIntegrationTestDatabaseUrl(integrationEnv())).toBe(testDatabaseUrl);
    expect(
      requirePrismaIntegrationTestDatabaseUrl(
        integrationEnv({
          TAMBIKE_TEST_DATABASE_URL:
            "postgresql://integration:secret@localhost:5432/tambike_test_localhost",
        }),
      ),
    ).toContain("tambike_test_localhost");
    expect(
      requirePrismaIntegrationTestDatabaseUrl(
        integrationEnv({
          TAMBIKE_TEST_DATABASE_URL:
            "postgresql://integration:secret@[::1]:5432/tambike_test_ipv6",
        }),
      ),
    ).toContain("tambike_test_ipv6");
  });

  test.each([
    ["remote host", "postgresql://integration:secret@db.example.com:5432/tambike_test_remote"],
    ["non-test database", "postgresql://integration:secret@127.0.0.1:5432/tambike"],
    ["empty test suffix", "postgresql://integration:secret@127.0.0.1:5432/tambike_test_"],
    ["uppercase test database", "postgresql://integration:secret@127.0.0.1:5432/TAMBIKE_TEST_UPPER"],
    ["non-Postgres protocol", "mysql://integration:secret@127.0.0.1:3306/tambike_test_mysql"],
  ])("rejects a %s", (_description, candidate) => {
    expect(() =>
      requirePrismaIntegrationTestDatabaseUrl(
        integrationEnv({ TAMBIKE_TEST_DATABASE_URL: candidate }),
      ),
    ).toThrow("TAMBIKE_TEST_DATABASE_URL");
  });

  test("refuses a test URL that targets the configured runtime database", () => {
    expect(() =>
      requirePrismaIntegrationTestDatabaseUrl(
        integrationEnv({
          DATABASE_URL:
            "postgres://runtime:secret@localhost:5432/tambike_test_giveaways?sslmode=disable",
        }),
      ),
    ).toThrow("same database as DATABASE_URL");
  });

  test("refuses a test URL that targets the configured direct database", () => {
    expect(() =>
      requirePrismaIntegrationTestDatabaseUrl(
        integrationEnv({ DIRECT_URL: testDatabaseUrl }),
      ),
    ).toThrow("same database as DIRECT_URL");
  });

  test("removes application database variables before launching Prisma", () => {
    const childEnvironment = createPrismaIntegrationChildEnvironment(
      integrationEnv({
        DATABASE_URL: "postgresql://runtime:secret@db.example.com:5432/tambike",
        DIRECT_URL: "postgresql://runtime:secret@db.example.com:5432/tambike",
        SUPABASE_DATABASE_URL: "postgresql://runtime:secret@db.example.com:5432/tambike",
        SHADOW_DATABASE_URL: "postgresql://runtime:secret@db.example.com:5432/tambike_shadow",
        KEEP_ME: "present",
      }),
    );

    expect(childEnvironment.TAMBIKE_TEST_DATABASE_URL).toBe(testDatabaseUrl);
    expect(childEnvironment.KEEP_ME).toBe("present");
    expect(childEnvironment.DATABASE_URL).toBeUndefined();
    expect(childEnvironment.DIRECT_URL).toBeUndefined();
    expect(childEnvironment.SUPABASE_DATABASE_URL).toBeUndefined();
    expect(childEnvironment.SHADOW_DATABASE_URL).toBeUndefined();
  });

  test("requires a second opt-in before preparing the disposable schema", () => {
    expect(() => getPrismaIntegrationMigrationArguments(integrationEnv())).toThrow(
      "TAMBIKE_PREPARE_PRISMA_INTEGRATION_SCHEMA=1",
    );

    const args = getPrismaIntegrationMigrationArguments(
      integrationEnv({ TAMBIKE_PREPARE_PRISMA_INTEGRATION_SCHEMA: "1" }),
    );
    expect(args).toEqual(["migrate", "deploy", "--config", "prisma.integration.config.ts"]);
    expect(args).not.toContain("seed");
    expect(args).not.toContain("reset");
  });
});
