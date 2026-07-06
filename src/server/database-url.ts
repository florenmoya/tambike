type DatabaseEnv = {
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
