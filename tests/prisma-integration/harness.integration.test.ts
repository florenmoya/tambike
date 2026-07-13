import { describe, expect, test } from "vitest";

import { requirePrismaIntegrationTestDatabaseUrl } from "./environment";

describe("Prisma integration harness", () => {
  test("uses the explicitly validated disposable database URL", () => {
    expect(requirePrismaIntegrationTestDatabaseUrl(process.env)).toBe(
      process.env.TAMBIKE_TEST_DATABASE_URL?.trim(),
    );
  });
});
