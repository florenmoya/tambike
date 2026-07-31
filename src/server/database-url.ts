type DatabaseEnv = {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  DIRECT_URL?: string | undefined;
  SUPABASE_DATABASE_URL?: string | undefined;
  SHADOW_DATABASE_URL?: string | undefined;
  TAMBIKE_BACKEND?: string | undefined;
  [key: string]: string | undefined;
};

function readEnv(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveRuntimeBackend(env: DatabaseEnv = process.env):
  | { kind: "memory" }
  | { kind: "prisma"; databaseUrl: string } {
  const forcedMemory = readEnv(env.TAMBIKE_BACKEND)?.toLowerCase() === "memory";
  const production = readEnv(env.NODE_ENV)?.toLowerCase() === "production";

  if (forcedMemory) {
    if (production) {
      throw new Error("TAMBIKE_BACKEND=memory is not allowed in production");
    }
    return { kind: "memory" };
  }

  const databaseUrl =
    readEnv(env.DATABASE_URL) ?? readEnv(env.SUPABASE_DATABASE_URL);
  if (databaseUrl) {
    return { kind: "prisma", databaseUrl };
  }
  throw new Error(
    production
      ? "Tambike production requires DATABASE_URL or SUPABASE_DATABASE_URL"
      : "Configure a database or explicitly set TAMBIKE_BACKEND=memory for local/test use",
  );
}

export function getRuntimeDatabaseUrl(env: DatabaseEnv = process.env) {
  if (readEnv(env.TAMBIKE_BACKEND)?.toLowerCase() === "memory") {
    return null;
  }

  return readEnv(env.DATABASE_URL) ?? readEnv(env.SUPABASE_DATABASE_URL) ?? null;
}

export function getMigrationDatabaseUrl(env: DatabaseEnv = process.env) {
  return readEnv(env.DIRECT_URL) ?? getRuntimeDatabaseUrl(env);
}

export function getShadowDatabaseUrl(env: DatabaseEnv = process.env) {
  return readEnv(env.SHADOW_DATABASE_URL);
}

export function requireMigrationDatabaseUrl(env: DatabaseEnv = process.env) {
  const url = getMigrationDatabaseUrl(env);
  if (!url) {
    throw new Error(
      "Set DIRECT_URL to your Supabase direct connection string, or set DATABASE_URL/SUPABASE_DATABASE_URL to a Supabase Postgres connection string.",
    );
  }

  return url;
}
