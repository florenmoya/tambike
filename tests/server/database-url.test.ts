import { describe, expect, test } from "vitest";
import {
  getMigrationDatabaseUrl,
  getRuntimeDatabaseUrl,
  requireMigrationDatabaseUrl,
  resolveRuntimeBackend,
} from "../../src/server/database-url";

describe("Supabase database URL resolution", () => {
  test("uses the Supabase pooled URL for runtime and direct URL for migrations", () => {
    const env = {
      DATABASE_URL: "postgresql://postgres.project:secret@pooler.supabase.com:6543/postgres",
      DIRECT_URL: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
    };

    expect(getRuntimeDatabaseUrl(env)).toBe(env.DATABASE_URL);
    expect(getMigrationDatabaseUrl(env)).toBe(env.DIRECT_URL);
  });

  test("can fall back to a Supabase-specific runtime variable", () => {
    const env = {
      SUPABASE_DATABASE_URL:
        "postgresql://postgres.project:secret@pooler.supabase.com:6543/postgres",
    };

    expect(getRuntimeDatabaseUrl(env)).toBe(env.SUPABASE_DATABASE_URL);
    expect(getMigrationDatabaseUrl(env)).toBe(env.SUPABASE_DATABASE_URL);
  });

  test("can force the runtime to use the in-memory backend", () => {
    const env = {
      TAMBIKE_BACKEND: "memory",
      DATABASE_URL: "postgresql://postgres.project:secret@pooler.supabase.com:6543/postgres",
      SUPABASE_DATABASE_URL:
        "postgresql://postgres.project:secret@pooler.supabase.com:6543/postgres",
    };

    expect(getRuntimeDatabaseUrl(env)).toBeNull();
  });

  test("requires a Supabase database URL before seed or migration work", () => {
    expect(() => requireMigrationDatabaseUrl({})).toThrow(/DIRECT_URL|DATABASE_URL/);
  });

  test("fails closed when production has no database URL", () => {
    expect(() => resolveRuntimeBackend({ NODE_ENV: "production" })).toThrow(
      "Tambike production requires DATABASE_URL or SUPABASE_DATABASE_URL",
    );
  });

  test("rejects forced memory mode in production", () => {
    expect(() =>
      resolveRuntimeBackend({
        NODE_ENV: "production",
        TAMBIKE_BACKEND: "memory",
        DATABASE_URL: "postgresql://runtime.example/tambike",
      }),
    ).toThrow("TAMBIKE_BACKEND=memory is not allowed in production");
  });

  test("allows explicit memory mode outside production", () => {
    expect(
      resolveRuntimeBackend({ NODE_ENV: "test", TAMBIKE_BACKEND: "memory" }),
    ).toEqual({ kind: "memory" });
  });

  test("rejects implicit memory fallback in development", () => {
    expect(() => resolveRuntimeBackend({ NODE_ENV: "development" })).toThrow(
      "Configure a database or explicitly set TAMBIKE_BACKEND=memory for local/test use",
    );
  });

  test("selects Prisma whenever a runtime URL exists", () => {
    expect(
      resolveRuntimeBackend({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://runtime.example/tambike",
      }),
    ).toEqual({
      kind: "prisma",
      databaseUrl: "postgresql://runtime.example/tambike",
    });
  });
});
