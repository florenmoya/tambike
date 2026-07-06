import { describe, expect, test } from "vitest";
import {
  getMigrationDatabaseUrl,
  getRuntimeDatabaseUrl,
  requireMigrationDatabaseUrl,
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
});
