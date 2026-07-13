# Prisma integration tests

The Prisma integration lane is intentionally separate from `test:server`. It is
for disposable local PostgreSQL databases and is designed for future two-client
concurrency tests. It does not use the application's normal connection
variables as a fallback.

## Run the integration lane

Set both required variables in the same PowerShell session, pointing at a
disposable local database:

```powershell
$env:TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS = "1"
$env:TAMBIKE_TEST_DATABASE_URL = "postgresql://integration:password@127.0.0.1:5432/tambike_test_giveaways"
npm run test:prisma
```

The harness accepts only PostgreSQL URLs hosted on `localhost`, `127.0.0.1`, or
`::1`, with a database name matching `tambike_test_*`. It rejects a target that
matches `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_DATABASE_URL`, or
`SHADOW_DATABASE_URL`, including equivalent loopback aliases. The normal
application variables are stripped before the Prisma CLI is launched.

The initial harness smoke test validates the opt-in target without issuing a
database query. Future `*.integration.test.ts` files can use two independent
clients through `tests/prisma-integration/clients.ts`:

```ts
const clients = createPrismaIntegrationClients();
try {
  // Run concurrent operations through clients.primary and clients.secondary.
} finally {
  await closePrismaIntegrationClientPair(clients);
}
```

## Prepare a disposable schema

Tests do not run migrations automatically. If a fresh disposable database needs
the current schema, opt in again before running the preparation command:

```powershell
$env:TAMBIKE_PREPARE_PRISMA_INTEGRATION_SCHEMA = "1"
npm run test:prisma:prepare
```

That command runs only `prisma migrate deploy` with
`prisma.integration.config.ts`, which is pinned to
`TAMBIKE_TEST_DATABASE_URL`. It never runs a seed or destructive reset command.
Do not point this lane at a persistent, shared, staging, or production database.
