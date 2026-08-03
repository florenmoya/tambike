import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, test } from "vitest";

import { requirePrismaIntegrationTestDatabaseUrl } from "./environment";

const targetMigrationName = "20260731160000_event_review_lifecycle";
const migrationsRoot = resolve(process.cwd(), "prisma/migrations");
const targetMigrationPath = resolve(migrationsRoot, targetMigrationName, "migration.sql");
const migrationTestTimeout = 120_000;

type IsolatedPreReviewDatabase = {
  client: Client;
  schemaName: string;
  targetMigrationSql: string;
};

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function readPriorMigrationSql() {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isDirectory() && entry.name < targetMigrationName)
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    migrationNames.map(async (migrationName) => ({
      migrationName,
      sql: await readFile(resolve(migrationsRoot, migrationName, "migration.sql"), "utf8"),
    })),
  );
}

async function createIsolatedPreReviewDatabase(): Promise<IsolatedPreReviewDatabase> {
  const client = new Client({
    connectionString: requirePrismaIntegrationTestDatabaseUrl(process.env),
  });
  const schemaName = `event_review_${randomUUID().replaceAll("-", "_")}`;
  const quotedSchema = quoteIdentifier(schemaName);
  await client.connect();
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET search_path TO ${quotedSchema}`);

  try {
    for (const migration of await readPriorMigrationSql()) {
      try {
        await client.query(migration.sql);
      } catch (error) {
        throw new Error(`Failed to apply prior migration ${migration.migrationName}`, {
          cause: error,
        });
      }
    }
    return {
      client,
      schemaName,
      targetMigrationSql: await readFile(targetMigrationPath, "utf8"),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("SET search_path TO public").catch(() => undefined);
    await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
    throw error;
  }
}

async function disposeIsolatedPreReviewDatabase(database: IsolatedPreReviewDatabase) {
  const quotedSchema = quoteIdentifier(database.schemaName);
  await database.client.query("ROLLBACK").catch(() => undefined);
  await database.client.query("SET search_path TO public").catch(() => undefined);
  await database.client.query(`DROP SCHEMA ${quotedSchema} CASCADE`).catch(() => undefined);
  await database.client.end();
}

async function insertRepresentativePreReviewHistory(client: Client) {
  await client.query(
    `INSERT INTO "User" (
      "id", "displayName", "email", "passwordHash", "role", "verificationStatus",
      "accountStatus", "area", "createdAt", "updatedAt"
    ) VALUES
      ('review-organizer-user', 'Review Organizer', 'review-organizer@example.test', 'test-only',
       'organizer', 'APPROVED', 'ACTIVE', 'Antipolo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('historical-reviewer', 'Historical Reviewer', 'historical-reviewer@example.test', 'test-only',
       'admin', 'APPROVED', 'ACTIVE', 'Antipolo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('current-reviewer', 'Current Reviewer', 'current-reviewer@example.test', 'test-only',
       'admin', 'APPROVED', 'ACTIVE', 'Antipolo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await client.query(
    `INSERT INTO "OrganizerProfile" (
      "id", "userId", "organizerType", "displayName", "realName", "contactNumber", "fbLink",
      "reason", "pastEventLinks", "verificationStatus", "createdAt", "updatedAt"
    ) VALUES (
      'review-organizer', 'review-organizer-user', 'Integration organizer', 'Review Organizer',
      'Review Organizer', '09000000000', 'https://example.test/review-organizer',
      'Versioned migration fixture', ARRAY[]::text[], 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
  );
  await client.query(
    `INSERT INTO "Event" (
      "id", "slug", "title", "type", "status", "organizerId", "locationName", "locationAddress",
      "dateLabel", "timeLabel", "area", "expectedRiders", "description", "whatHappens", "poster",
      "perkPreview", "tags", "riskFlags", "safetyRules", "createdAt", "updatedAt"
    ) VALUES (
      'event-review-migration', 'event-review-migration', 'Versioned migration event', 'Bike Night',
      'PENDING_ADMIN_REVIEW', 'review-organizer', 'Integration Cafe', '42 Integration Avenue',
      'July 31, 2030', '6:00 PM - 9:00 PM', 'Antipolo', 25, 'Migration test event',
      'Review history test', '/migration-event.webp', 'Migration sticker', ARRAY['migration'],
      ARRAY[]::text[], ARRAY['Ride safely'], '2026-07-29T00:00:00.000Z',
      '2026-07-31T00:00:00.000Z'
    )`,
  );
  await client.query(
    `INSERT INTO "EventApproval" (
      "id", "eventId", "reviewerId", "decision", "notes", "decidedAt", "createdAt"
    ) VALUES
      ('legacy-approval-z', 'event-review-migration', 'historical-reviewer', 'published',
       'Historical publication', '2026-07-30T02:00:00.000Z', '2026-07-30T01:00:00.000Z'),
      ('approval-admin', 'event-review-migration', NULL, 'pending',
       'Current pending review', NULL, '2026-07-31T01:00:00.000Z')`,
  );
}

describe("event review lifecycle migration", () => {
  test(
    "backfills deterministic versions and enforces protected forward state",
    async () => {
      const database = await createIsolatedPreReviewDatabase();
      try {
        await insertRepresentativePreReviewHistory(database.client);
        await database.client.query(database.targetMigrationSql);

        const event = await database.client.query<{
          submissionVersion: number;
          status: string;
        }>(
          `SELECT "submissionVersion", "status"::text AS status
           FROM "Event" WHERE "id" = 'event-review-migration'`,
        );
        expect(event.rows[0]).toEqual({
          submissionVersion: 2,
          status: "PENDING_ADMIN_REVIEW",
        });

        const approvals = await database.client.query<{
          id: string;
          submissionVersion: number;
          reviewerId: string | null;
          submittedMatchesCreated: boolean;
        }>(
          `SELECT "id", "submissionVersion", "reviewerId",
                  "submittedAt" = "createdAt" AS "submittedMatchesCreated"
           FROM "EventApproval"
           WHERE "eventId" = 'event-review-migration'
           ORDER BY "submissionVersion"`,
        );
        expect(approvals.rows).toEqual([
          {
            id: "legacy-approval-z",
            submissionVersion: 1,
            reviewerId: "historical-reviewer",
            submittedMatchesCreated: true,
          },
          {
            id: "approval-admin",
            submissionVersion: 2,
            reviewerId: null,
            submittedMatchesCreated: true,
          },
        ]);

        const versionDefault = await database.client.query<{ columnDefault: string | null }>(
          `SELECT column_default AS "columnDefault"
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'EventApproval'
             AND column_name = 'submissionVersion'`,
        );
        expect(versionDefault.rows[0]?.columnDefault).toBeNull();

        await expect(
          database.client.query(
            `INSERT INTO "EventApproval" (
              "id", "eventId", "submissionVersion", "decision", "submittedAt", "createdAt"
            ) VALUES (
              'duplicate-version', 'event-review-migration', 2, 'pending', CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )`,
          ),
        ).rejects.toMatchObject({ code: "23505" });

        await database.client.query(`DELETE FROM "User" WHERE "id" = 'historical-reviewer'`);
        const preservedHistory = await database.client.query<{
          count: number;
          reviewerId: string | null;
        }>(
          `SELECT count(*)::int AS count, min("reviewerId") AS "reviewerId"
           FROM "EventApproval" WHERE "id" = 'legacy-approval-z'`,
        );
        expect(preservedHistory.rows[0]).toEqual({ count: 1, reviewerId: null });

        await expect(
          database.client.query(
            `UPDATE "EventApproval" SET "reviewerId" = 'missing-reviewer'
             WHERE "id" = 'approval-admin'`,
          ),
        ).rejects.toMatchObject({ code: "23503" });

        const enumValues = await database.client.query<{ enumlabel: string }>(
          `SELECT enum_value.enumlabel
           FROM pg_enum enum_value
           JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
           JOIN pg_namespace namespace ON namespace.oid = enum_type.typnamespace
           WHERE namespace.nspname = current_schema() AND enum_type.typname = 'EventStatus'
           ORDER BY enum_value.enumsortorder`,
        );
        expect(enumValues.rows.map((row) => row.enumlabel)).toContain("DISABLED");
      } finally {
        await disposeIsolatedPreReviewDatabase(database);
      }
    },
    migrationTestTimeout,
  );
});
