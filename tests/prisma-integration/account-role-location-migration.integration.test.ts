import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";
import { describe, expect, test } from "vitest";

import { requirePrismaIntegrationTestDatabaseUrl } from "./environment";

const targetMigrationName = "20260715120000_simplify_accounts_and_locations";
const migrationsRoot = resolve(process.cwd(), "prisma/migrations");
const targetMigrationPath = resolve(migrationsRoot, targetMigrationName, "migration.sql");
const migrationTestTimeout = 120_000;

type LegacyFixtureOptions = {
  venueName?: string;
  venueMapLink?: string;
};

type IsolatedLegacyDatabase = {
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

async function createIsolatedLegacyDatabase(): Promise<IsolatedLegacyDatabase> {
  const client = new Client({
    connectionString: requirePrismaIntegrationTestDatabaseUrl(process.env),
  });
  const schemaName = `account_location_${randomUUID().replaceAll("-", "_")}`;
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

async function disposeIsolatedLegacyDatabase(database: IsolatedLegacyDatabase) {
  const quotedSchema = quoteIdentifier(database.schemaName);
  await database.client.query("ROLLBACK").catch(() => undefined);
  await database.client.query("SET search_path TO public").catch(() => undefined);
  await database.client.query(`DROP SCHEMA ${quotedSchema} CASCADE`).catch(() => undefined);
  await database.client.end();
}

async function insertLegacyUser(
  client: Client,
  input: { id: string; displayName: string; email: string; role: string; area?: string },
) {
  await client.query(
    `INSERT INTO "User" (
      "id", "displayName", "email", "passwordHash", "role", "verificationStatus", "area", "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, 'legacy-test-hash', $4::"Role", 'APPROVED', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [input.id, input.displayName, input.email, input.role, input.area ?? "Antipolo"],
  );
}

async function insertLegacyOrganizerProfile(
  client: Client,
  input: { id: string; userId: string; displayName: string },
) {
  await client.query(
    `INSERT INTO "OrganizerProfile" (
      "id", "userId", "organizerType", "displayName", "realName", "contactNumber", "fbLink",
      "clubPageName", "reason", "pastEventLinks", "verificationStatus", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, 'Legacy organizer', $3, $3, '09000000000', 'https://example.test/organizer',
      $3, 'Legacy migration fixture', ARRAY[]::text[], 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
    [input.id, input.userId, input.displayName],
  );
}

async function insertRepresentativeLegacyData(
  client: Client,
  options: LegacyFixtureOptions = {},
) {
  const users = [
    {
      id: "user-marco-organizer",
      displayName: "Marco Organizer",
      email: "marco.organizer@example.com",
      role: "organizer",
    },
    {
      id: "user-cafe-classico",
      displayName: "Cafe Classico",
      email: "cafe-classico@seed.tambike.local",
      role: "organizer",
    },
    {
      id: "user-mina-rider",
      displayName: "Mina Rider",
      email: "mina.rider@example.com",
      role: "rider",
    },
    {
      id: "user-demo-scan-rider",
      displayName: "Seeded Scan Rider",
      email: "scan-rider@seed.tambike.local",
      role: "rider",
    },
    {
      id: "user-ana-venue",
      displayName: "Ana Venue",
      email: "ana.venue@example.com",
      role: "venue",
    },
    {
      id: "user-admin",
      displayName: "Admin User",
      email: "admin@bayanko.ph",
      role: "admin",
    },
    {
      id: "user-floren-preserved",
      displayName: "Floren Moya",
      email: "florenmoya@gmail.com",
      role: "rider",
    },
    {
      id: "user-unrelated-rider",
      displayName: "Unrelated Rider",
      email: "unrelated-rider@example.test",
      role: "rider",
    },
  ] as const;
  for (const user of users) await insertLegacyUser(client, user);

  await insertLegacyOrganizerProfile(client, {
    id: "user-marco-organizer-profile",
    userId: "user-marco-organizer",
    displayName: "Marco Organizer",
  });
  await insertLegacyOrganizerProfile(client, {
    id: "cafe-classico",
    userId: "user-cafe-classico",
    displayName: "Cafe Classico",
  });

  await client.query(
    `INSERT INTO "Venue" (
      "id", "name", "area", "address", "mapLink", "ownerUserId", "status", "capacityNotes",
      "houseRules", "contact", "createdAt", "updatedAt"
    ) VALUES (
      'venue-legacy', $1, 'Quezon City', '  42 Legacy Avenue, Quezon City  ', $2,
      'user-ana-venue', 'APPROVED', 'Legacy capacity', ARRAY['Respect event staff'],
      'Legacy contact', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
    [options.venueName ?? "  Legacy Event Grounds  ", options.venueMapLink ?? "  https://maps.example.test/legacy  "],
  );

  await client.query(
    `INSERT INTO "Event" (
      "id", "slug", "title", "type", "status", "organizerId", "venueId", "dateLabel", "timeLabel",
      "area", "expectedRiders", "description", "whatHappens", "poster", "perkPreview", "tags",
      "riskFlags", "safetyRules", "createdAt", "updatedAt"
    ) VALUES (
      'event-legacy', 'event-legacy', 'Legacy migration event', 'Bike Night', 'PENDING_VENUE_APPROVAL',
      'cafe-classico', 'venue-legacy', 'July 25, 2026', '7:00 PM - 10:00 PM', '  Quezon City  ',
      40, 'Legacy event description', 'Legacy event flow', '/legacy-event.webp', 'Legacy sticker',
      ARRAY['fixture'], ARRAY[]::text[], ARRAY['Ride safely'], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
  );

  await client.query(
    `INSERT INTO "RSVP" (
      "id", "eventId", "userId", "status", "goingAt", "attendanceType", "companions", "createdAt", "updatedAt"
    ) VALUES (
      'rsvp-floren', 'event-legacy', 'user-floren-preserved', 'going', CURRENT_TIMESTAMP,
      'direct', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
  );
  await client.query(
    `INSERT INTO "Pass" (
      "id", "eventId", "userId", "rsvpId", "qrTokenHash", "status", "generatedAt"
    ) VALUES (
      'pass-floren', 'event-legacy', 'user-floren-preserved', 'rsvp-floren',
      'legacy-floren-pass-hash', 'active', CURRENT_TIMESTAMP
    )`,
  );
  await client.query(
    `INSERT INTO "CheckIn" (
      "id", "eventId", "passId", "userId", "scannedBy", "timestamp", "confirmedAt", "status", "method", "confirmationMethod"
    ) VALUES (
      'checkin-floren', 'event-legacy', 'pass-floren', 'user-floren-preserved', 'user-demo-scan-rider',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'confirmed', 'manual', 'manual'
    )`,
  );
  await client.query(
    `INSERT INTO "AuditLog" ("id", "actorUserId", "action", "targetType", "targetId", "metadata")
     VALUES ('audit-ana', 'user-ana-venue', 'LEGACY_REVIEW', 'event', 'event-legacy', '{}'::jsonb)`,
  );
  await client.query(
    `INSERT INTO "EventApproval" (
      "id", "eventId", "approvalType", "reviewerId", "decision", "createdAt"
    ) VALUES
      ('approval-venue', 'event-legacy', 'venue', 'user-ana-venue', 'approved', CURRENT_TIMESTAMP),
      ('approval-admin', 'event-legacy', 'admin', 'user-admin', 'pending', CURRENT_TIMESTAMP)`,
  );
}

async function rollbackFailedMigration(
  database: IsolatedLegacyDatabase,
  expectedMessage: string,
) {
  await expect(database.client.query(database.targetMigrationSql)).rejects.toThrow(expectedMessage);
  await database.client.query("ROLLBACK");
}

async function expectLegacyStateAfterRollback(
  client: Client,
  expectedAccountId: string,
) {
  const venue = await client.query<{ present: string | null }>(
    `SELECT to_regclass('"Venue"')::text AS present`,
  );
  expect(venue.rows[0]?.present).toBe('"Venue"');

  const roles = await client.query<{ enumlabel: string }>(
    `SELECT enum_value.enumlabel
     FROM pg_enum enum_value
     JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
     JOIN pg_namespace namespace ON namespace.oid = enum_type.typnamespace
     WHERE namespace.nspname = current_schema() AND enum_type.typname = 'Role'
     ORDER BY enum_value.enumsortorder`,
  );
  expect(roles.rows.map((row) => row.enumlabel)).toContain("venue");

  const statuses = await client.query<{ enumlabel: string }>(
    `SELECT enum_value.enumlabel
     FROM pg_enum enum_value
     JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
     JOIN pg_namespace namespace ON namespace.oid = enum_type.typnamespace
     WHERE namespace.nspname = current_schema() AND enum_type.typname = 'EventStatus'
     ORDER BY enum_value.enumsortorder`,
  );
  expect(statuses.rows.map((row) => row.enumlabel)).toContain("PENDING_VENUE_APPROVAL");
  expect(
    (await client.query(`SELECT count(*)::int AS count FROM "User" WHERE "id" = $1`, [expectedAccountId]))
      .rows[0]?.count,
  ).toBe(1);
}

describe("account and event-location migration", () => {
  test(
    "migrates an empty legacy schema without requiring a canonical account",
    async () => {
      const database = await createIsolatedLegacyDatabase();
      try {
        await database.client.query(database.targetMigrationSql);
        expect((await database.client.query(`SELECT to_regclass('"Venue"')::text AS present`)).rows[0]?.present).toBeNull();
        expect(
          (
            await database.client.query(
              `SELECT column_name FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'Event'`,
            )
          ).rows.map((row) => row.column_name),
        ).toEqual(expect.arrayContaining(["locationName", "locationAddress", "locationMapLink", "area"]));
      } finally {
        await disposeIsolatedLegacyDatabase(database);
      }
    },
    migrationTestTimeout,
  );

  test(
    "backfills locations, retains Floren history, and removes only guarded demo accounts",
    async () => {
      const database = await createIsolatedLegacyDatabase();
      try {
        await insertRepresentativeLegacyData(database.client);
        await database.client.query(database.targetMigrationSql);

        const event = await database.client.query<{
          locationName: string;
          locationAddress: string;
          locationMapLink: string | null;
          area: string;
          organizerId: string;
          status: string;
        }>(
          `SELECT "locationName", "locationAddress", "locationMapLink", "area", "organizerId", "status"::text
           FROM "Event" WHERE "id" = 'event-legacy'`,
        );
        expect(event.rows[0]).toEqual({
          locationName: "Legacy Event Grounds",
          locationAddress: "42 Legacy Avenue, Quezon City",
          locationMapLink: "https://maps.example.test/legacy",
          area: "Quezon City",
          organizerId: "user-marco-organizer-profile",
          status: "PENDING_ADMIN_REVIEW",
        });

        const retainedOrganizer = await database.client.query(
          `SELECT "email", "displayName", "clubName" FROM "User" WHERE "id" = 'user-marco-organizer'`,
        );
        expect(retainedOrganizer.rows[0]).toEqual({
          email: "organizer@bayanko.ph",
          displayName: "Tambike Organizer",
          clubName: "Tambike Organizer",
        });

        const removedCount = await database.client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM "User"
           WHERE "id" = ANY($1::text[])`,
          [["user-cafe-classico", "user-mina-rider", "user-demo-scan-rider", "user-ana-venue"]],
        );
        expect(removedCount.rows[0]?.count).toBe(0);
        expect(
          (
            await database.client.query(
              `SELECT count(*)::int AS count FROM "RSVP" WHERE "id" = 'rsvp-floren'`,
            )
          ).rows[0]?.count,
        ).toBe(1);
        expect(
          (
            await database.client.query(
              `SELECT count(*)::int AS count FROM "Pass" WHERE "id" = 'pass-floren'`,
            )
          ).rows[0]?.count,
        ).toBe(1);
        expect(
          (
            await database.client.query(
              `SELECT "scannedBy" FROM "CheckIn" WHERE "id" = 'checkin-floren'`,
            )
          ).rows[0]?.scannedBy,
        ).toBeNull();
        expect(
          (
            await database.client.query(
              `SELECT "actorUserId" FROM "AuditLog" WHERE "id" = 'audit-ana'`,
            )
          ).rows[0]?.actorUserId,
        ).toBeNull();
        expect(
          (
            await database.client.query(
              `SELECT count(*)::int AS count FROM "EventApproval" WHERE "id" = 'approval-admin'`,
            )
          ).rows[0]?.count,
        ).toBe(1);
      } finally {
        await disposeIsolatedLegacyDatabase(database);
      }
    },
    migrationTestTimeout,
  );

  test(
    "aborts atomically for an unexpected organizer",
    async () => {
      const database = await createIsolatedLegacyDatabase();
      try {
        await insertRepresentativeLegacyData(database.client);
        await insertLegacyUser(database.client, {
          id: "user-unexpected-organizer",
          displayName: "Unexpected Organizer",
          email: "unexpected-organizer@example.test",
          role: "organizer",
        });
        await insertLegacyOrganizerProfile(database.client, {
          id: "unexpected-organizer-profile",
          userId: "user-unexpected-organizer",
          displayName: "Unexpected Organizer",
        });

        await rollbackFailedMigration(database, "ACCOUNT_CLEANUP_UNEXPECTED_ORGANIZER_USER");
        await expectLegacyStateAfterRollback(database.client, "user-unexpected-organizer");
      } finally {
        await disposeIsolatedLegacyDatabase(database);
      }
    },
    migrationTestTimeout,
  );

  test(
    "aborts atomically for a case-insensitive canonical email conflict",
    async () => {
      const database = await createIsolatedLegacyDatabase();
      try {
        await insertRepresentativeLegacyData(database.client);
        await insertLegacyUser(database.client, {
          id: "user-email-conflict",
          displayName: "Email Conflict",
          email: "Organizer@Bayanko.ph",
          role: "rider",
        });

        await rollbackFailedMigration(database, "ACCOUNT_CLEANUP_TARGET_EMAIL_CONFLICT");
        await expectLegacyStateAfterRollback(database.client, "user-email-conflict");
      } finally {
        await disposeIsolatedLegacyDatabase(database);
      }
    },
    migrationTestTimeout,
  );

  test(
    "aborts atomically for blank required or invalid map location snapshots",
    async () => {
      for (const fixture of [
        { venueName: "   ", venueMapLink: "https://maps.example.test/legacy" },
        { venueName: "Legacy Event Grounds", venueMapLink: "ftp://maps.example.test/legacy" },
      ]) {
        const database = await createIsolatedLegacyDatabase();
        try {
          await insertRepresentativeLegacyData(database.client, fixture);
          await rollbackFailedMigration(database, "ACCOUNT_CLEANUP_INVALID_LOCATION_SNAPSHOT");
          await expectLegacyStateAfterRollback(database.client, "user-ana-venue");
        } finally {
          await disposeIsolatedLegacyDatabase(database);
        }
      }
    },
    migrationTestTimeout,
  );

  test(
    "aborts atomically when removable users appear in immutable giveaway history",
    async () => {
      const database = await createIsolatedLegacyDatabase();
      try {
        await insertRepresentativeLegacyData(database.client);
        await database.client.query(
          `INSERT INTO "EventGiveaway" (
            "id", "eventId", "creatorUserId", "title", "kind", "entryMode", "maxEntriesPerRider",
            "visibility", "timeZone", "updatedAt"
          ) VALUES (
            'giveaway-removable-history', 'event-legacy', 'user-cafe-classico', 'Immutable fixture',
            'giveaway', 'automatic', 1, 'hidden', 'Asia/Manila', CURRENT_TIMESTAMP
          )`,
        );

        await rollbackFailedMigration(
          database,
          "IMMUTABLE_GIVEAWAY_HISTORY_REFERENCES_REMOVABLE_ACCOUNT",
        );
        await expectLegacyStateAfterRollback(database.client, "user-cafe-classico");
        expect(
          (
            await database.client.query(
              `SELECT count(*)::int AS count FROM "EventGiveaway" WHERE "id" = 'giveaway-removable-history'`,
            )
          ).rows[0]?.count,
        ).toBe(1);
      } finally {
        await disposeIsolatedLegacyDatabase(database);
      }
    },
    migrationTestTimeout,
  );
});
