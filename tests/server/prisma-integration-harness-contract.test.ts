import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

function readHarnessFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Prisma integration harness contract", () => {
  test("uses a separate opt-in Vitest configuration and excludes it from default tests", () => {
    const integrationVitestConfig = readHarnessFile("vitest.prisma-integration.config.ts");
    const defaultVitestConfig = readHarnessFile("vitest.config.ts");

    expect(packageJson.scripts?.["test:prisma"]).toBe(
      "vitest run --config vitest.prisma-integration.config.ts",
    );
    expect(integrationVitestConfig).toContain("tests/prisma-integration/**/*.integration.test.ts");
    expect(integrationVitestConfig).toContain("tests/prisma-integration/setup.ts");
    expect(integrationVitestConfig).toContain("fileParallelism: false");
    expect(defaultVitestConfig).toContain("tests/prisma-integration/**");
  });

  test("pins Prisma migrations to the explicit test URL without loading application env files", () => {
    const integrationPrismaConfig = readHarnessFile("prisma.integration.config.ts");

    expect(integrationPrismaConfig).toContain("requirePrismaIntegrationTestDatabaseUrl");
    expect(integrationPrismaConfig).toContain('schema: "prisma/schema.prisma"');
    expect(integrationPrismaConfig).toContain('path: "prisma/migrations"');
    expect(integrationPrismaConfig).not.toContain("loadEnvConfig");
    expect(integrationPrismaConfig).not.toContain("DATABASE_URL");
    expect(integrationPrismaConfig).not.toContain("DIRECT_URL");
  });

  test("makes migration preparation a separately gated deploy-only command", () => {
    const prepareScript = readHarnessFile("tests/prisma-integration/prepare.ts");

    expect(packageJson.scripts?.["test:prisma:prepare"]).toBe(
      "tsx tests/prisma-integration/prepare.ts",
    );
    expect(prepareScript).toContain("getPrismaIntegrationMigrationArguments");
    expect(prepareScript).toContain("createPrismaIntegrationChildEnvironment");
    expect(prepareScript).toContain("node_modules/prisma/build/index.js");
    expect(prepareScript).not.toContain("migrate reset");
    expect(prepareScript).not.toContain("db seed");
  });
});
