export type PrismaIntegrationEnvironment = Readonly<Record<string, string | undefined>>;

const optInEnvironmentVariable = "TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS";
const testDatabaseUrlEnvironmentVariable = "TAMBIKE_TEST_DATABASE_URL";
const prepareEnvironmentVariable = "TAMBIKE_PREPARE_PRISMA_INTEGRATION_SCHEMA";

const applicationDatabaseEnvironmentVariables = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_DATABASE_URL",
  "SHADOW_DATABASE_URL",
] as const;

type DatabaseIdentity = {
  databaseName: string;
  host: string;
  port: string;
};

function readEnvironmentValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeHost(host: string) {
  const normalized = host.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized)) {
    return "loopback";
  }
  return normalized;
}

function parseDatabaseIdentity(value: string): DatabaseIdentity | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return null;
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }

  if (!databaseName || databaseName.includes("/")) {
    return null;
  }

  return {
    databaseName,
    host: normalizeHost(url.hostname),
    port: url.port || "5432",
  };
}

function isLoopbackHost(host: string) {
  return host === "loopback";
}

function isDisposableDatabaseName(databaseName: string) {
  return /^tambike_test_[a-z0-9_]+$/.test(databaseName);
}

function pointsAtSameDatabase(left: DatabaseIdentity, right: DatabaseIdentity) {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.databaseName.toLowerCase() === right.databaseName.toLowerCase()
  );
}

/**
 * Returns only the explicitly supplied disposable URL. It intentionally never
 * falls back to the application's runtime or migration connection variables.
 */
export function requirePrismaIntegrationTestDatabaseUrl(
  environment: PrismaIntegrationEnvironment = process.env,
) {
  if (readEnvironmentValue(environment[optInEnvironmentVariable]) !== "1") {
    throw new Error(
      "Prisma integration tests require TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS=1.",
    );
  }

  const testDatabaseUrl = readEnvironmentValue(environment[testDatabaseUrlEnvironmentVariable]);
  if (!testDatabaseUrl) {
    throw new Error(
      "Prisma integration tests require an explicit TAMBIKE_TEST_DATABASE_URL; DATABASE_URL and DIRECT_URL are never used.",
    );
  }

  const testIdentity = parseDatabaseIdentity(testDatabaseUrl);
  if (
    !testIdentity ||
    !isLoopbackHost(testIdentity.host) ||
    !isDisposableDatabaseName(testIdentity.databaseName)
  ) {
    throw new Error(
      "TAMBIKE_TEST_DATABASE_URL must be a PostgreSQL URL for a loopback tambike_test_* database.",
    );
  }

  for (const variableName of applicationDatabaseEnvironmentVariables) {
    const applicationDatabaseUrl = readEnvironmentValue(environment[variableName]);
    if (!applicationDatabaseUrl) continue;

    const applicationIdentity = parseDatabaseIdentity(applicationDatabaseUrl);
    if (applicationIdentity && pointsAtSameDatabase(testIdentity, applicationIdentity)) {
      throw new Error(
        `TAMBIKE_TEST_DATABASE_URL must not point at the same database as ${variableName}.`,
      );
    }
  }

  return testDatabaseUrl;
}

/** Removes normal application database variables before invoking Prisma CLI. */
export function createPrismaIntegrationChildEnvironment(
  environment: PrismaIntegrationEnvironment = process.env,
) {
  requirePrismaIntegrationTestDatabaseUrl(environment);
  const childEnvironment = { ...environment } as NodeJS.ProcessEnv;
  for (const variableName of applicationDatabaseEnvironmentVariables) {
    delete childEnvironment[variableName];
  }
  return childEnvironment;
}

/** Returns the only database-mutating command this harness permits. */
export function getPrismaIntegrationMigrationArguments(
  environment: PrismaIntegrationEnvironment = process.env,
) {
  requirePrismaIntegrationTestDatabaseUrl(environment);
  if (readEnvironmentValue(environment[prepareEnvironmentVariable]) !== "1") {
    throw new Error(
      "Preparing the Prisma integration schema requires TAMBIKE_PREPARE_PRISMA_INTEGRATION_SCHEMA=1.",
    );
  }

  return ["migrate", "deploy", "--config", "prisma.integration.config.ts"];
}
