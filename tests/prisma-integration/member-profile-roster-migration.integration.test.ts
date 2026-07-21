import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, test } from "vitest";

import { requirePrismaIntegrationTestDatabaseUrl } from "./environment";

const targetMigrationName = "20260722010000_rider_profiles_showcase_rosters";
const migrationsRoot = resolve(process.cwd(), "prisma/migrations");
const targetMigrationPath = resolve(migrationsRoot, targetMigrationName, "migration.sql");
const migrationTestTimeout = 120_000;

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

async function createIsolatedPreFeatureDatabase() {
  const client = new Client({
    connectionString: requirePrismaIntegrationTestDatabaseUrl(process.env),
  });
  const schemaName = `member_profile_roster_${randomUUID().replaceAll("-", "_")}`;
  const quotedSchema = quoteIdentifier(schemaName);
  await client.connect();
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET search_path TO ${quotedSchema}`);

  try {
    for (const migration of await readPriorMigrationSql()) {
      await client.query(migration.sql);
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

async function disposeIsolatedDatabase(database: Awaited<ReturnType<typeof createIsolatedPreFeatureDatabase>>) {
  const quotedSchema = quoteIdentifier(database.schemaName);
  await database.client.query("ROLLBACK").catch(() => undefined);
  await database.client.query("SET search_path TO public").catch(() => undefined);
  await database.client.query(`DROP SCHEMA ${quotedSchema} CASCADE`).catch(() => undefined);
  await database.client.end();
}

async function insertRepresentativePreFeatureRows(client: Client) {
  await client.query(
    `INSERT INTO "User" (
      "id", "displayName", "email", "passwordHash", "role", "verificationStatus", "area", "createdAt", "updatedAt"
    ) VALUES
      ('member-profile-organizer', 'Organizer', 'organizer@example.test', 'hash', 'organizer', 'APPROVED', 'Manila', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('member-profile-rider', 'Rider', 'rider@example.test', 'hash', 'rider', 'APPROVED', 'Quezon City', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  await client.query(
    `INSERT INTO "OrganizerProfile" (
      "id", "userId", "organizerType", "displayName", "realName", "contactNumber", "fbLink", "reason", "pastEventLinks", "verificationStatus", "createdAt", "updatedAt"
    ) VALUES (
      'member-profile-organizer-profile', 'member-profile-organizer', 'Club', 'Organizer', 'Organizer', '09000000000',
      'https://example.test/organizer', 'Fixture', ARRAY[]::text[], 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
  );
  await client.query(
    `INSERT INTO "Event" (
      "id", "slug", "title", "type", "status", "organizerId", "locationName", "locationAddress", "dateLabel", "timeLabel", "area", "expectedRiders", "description", "whatHappens", "poster", "perkPreview", "tags", "riskFlags", "safetyRules", "createdAt", "updatedAt"
    ) VALUES (
      'member-profile-event', 'member-profile-event', 'Member profile event', 'Tambike', 'PUBLISHED', 'member-profile-organizer-profile',
      'Fixture venue', 'Fixture address', 'July 22, 2026', '8:00 AM', 'Manila', 10, 'Fixture description', 'Fixture flow',
      '/fixture.webp', 'Fixture perk', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
  );
  await client.query(
    `INSERT INTO "RSVP" (
      "id", "eventId", "userId", "status", "goingAt", "attendanceType", "companions", "createdAt", "updatedAt"
    ) VALUES (
      'member-profile-rsvp', 'member-profile-event', 'member-profile-rider', 'going', CURRENT_TIMESTAMP, 'direct', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
  );
}

describe("member profile and roster migration", () => {
  test(
    "preserves representative pre-feature rows and backfills existing RSVPs as anonymous",
    async () => {
      const database = await createIsolatedPreFeatureDatabase();
      try {
        await insertRepresentativePreFeatureRows(database.client);
        await database.client.query(database.targetMigrationSql);

        expect(
          (await database.client.query(`SELECT count(*)::int AS count FROM "User"`)).rows[0]?.count,
        ).toBe(2);
        expect(
          (await database.client.query(`SELECT count(*)::int AS count FROM "Event"`)).rows[0]?.count,
        ).toBe(1);
        expect(
          (
            await database.client.query(
              `SELECT "rosterIdentity"::text AS "rosterIdentity" FROM "RSVP" WHERE "id" = 'member-profile-rsvp'`,
            )
          ).rows[0]?.rosterIdentity,
        ).toBe("ANONYMOUS");
        expect(
          (
            await database.client.query(
              `SELECT column_name FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'profileSlug'`,
            )
          ).rows,
        ).toHaveLength(1);
      } finally {
        await disposeIsolatedDatabase(database);
      }
    },
    migrationTestTimeout,
  );
});
