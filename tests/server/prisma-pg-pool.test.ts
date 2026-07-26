import { describe, expect, test } from "vitest";

describe("Prisma PostgreSQL pool", () => {
  test("attaches one lazy pool with the bounded production configuration", async () => {
    const poolModule = await import("../../src/server/prisma-pg-pool").catch(() => null);
    expect(poolModule).not.toBeNull();
    if (!poolModule) return;

    const attached: unknown[] = [];
    const fakeDatabaseUrl = "postgresql://pool-test.invalid/tambike";
    const pool = poolModule.createPrismaPgPool(
      fakeDatabaseUrl,
      (candidate) => attached.push(candidate),
    );

    expect(attached).toEqual([pool]);
    expect({
      connectionString: pool.options.connectionString,
      max: pool.options.max,
      min: pool.options.min,
      idleTimeoutMillis: pool.options.idleTimeoutMillis,
      connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
      maxLifetimeSeconds: pool.options.maxLifetimeSeconds,
    }).toEqual({
      connectionString: fakeDatabaseUrl,
      max: 2,
      min: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      maxLifetimeSeconds: 60,
    });
    expect(pool.totalCount).toBe(0);

    await pool.end();
  });
});
