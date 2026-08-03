import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as generatedPrismaClient from "@prisma/client";
import { Prisma } from "@prisma/client";
import { describe, expect, test } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260715120000_simplify_accounts_and_locations/migration.sql",
);
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const eventReviewMigrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260731160000_event_review_lifecycle/migration.sql",
);
const eventReviewMigrationSql = existsSync(eventReviewMigrationPath)
  ? readFileSync(eventReviewMigrationPath, "utf8")
  : "";
const prismaSchema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const typesSource = readFileSync(
  resolve(process.cwd(), "src/features/tambike-demo/types.ts"),
  "utf8",
);

const generatedEnums = generatedPrismaClient as unknown as Record<
  string,
  Record<string, string> | undefined
>;

const generatedOrganizerAllowlist = [
  ["user-cafe-classico", "cafe-classico", "cafe-classico@seed.tambike.local"],
  ["user-arai-hjc-riders", "arai-hjc-riders", "arai-hjc-riders@seed.tambike.local"],
  ["user-ducati-access-plus", "ducati-access-plus", "ducati-access-plus@seed.tambike.local"],
  ["user-republik-riders", "republik-riders", "republik-riders@seed.tambike.local"],
  ["user-mandirigma-endutour", "mandirigma-endutour", "mandirigma-endutour@seed.tambike.local"],
  ["user-motoir-ph", "motoir-ph", "motoir-ph@seed.tambike.local"],
  ["user-makina-moto", "makina-moto", "makina-moto@seed.tambike.local"],
  ["user-dsboys-tambike", "dsboys-tambike", "dsboys-tambike@seed.tambike.local"],
  ["user-boys-underbone-laguna", "boys-underbone-laguna", "boys-underbone-laguna@seed.tambike.local"],
  ["user-swabz-classic-motoparts", "swabz-classic-motoparts", "swabz-classic-motoparts@seed.tambike.local"],
  ["user-yloco-bandits", "yloco-bandits", "yloco-bandits@seed.tambike.local"],
  ["user-motor-ace-bmw", "motor-ace-bmw", "motor-ace-bmw@seed.tambike.local"],
  ["user-fullprint-manila", "fullprint-manila", "fullprint-manila@seed.tambike.local"],
  ["user-boys-of-garage", "boys-of-garage", "boys-of-garage@seed.tambike.local"],
  ["user-ccph-upper-east", "ccph-upper-east", "ccph-upper-east@seed.tambike.local"],
  ["user-ccph-cebu", "ccph-cebu", "ccph-cebu@seed.tambike.local"],
  ["user-antipolo-endurance-challenge", "antipolo-endurance-challenge", "antipolo-endurance-challenge@seed.tambike.local"],
  ["user-laguna-moto-fest", "laguna-moto-fest", "laguna-moto-fest@seed.tambike.local"],
  ["user-ngo-philippines", "ngo-philippines", "ngo-philippines@seed.tambike.local"],
  ["user-mindanao-wide-motocross", "mindanao-wide-motocross", "mindanao-wide-motocross@seed.tambike.local"],
] as const;

const immutableUserReferences = [
  ["EventGiveaway", "creatorUserId"],
  ["EventGiveaway", "organizerAttestedById"],
  ["EventGiveaway", "complianceReviewerId"],
  ["EventGiveaway", "suspendedByUserId"],
  ["GiveawayMechanicsVersion", "createdByUserId"],
  ["GiveawayMechanicsVersion", "reviewedByUserId"],
  ["GiveawayCampaignCode", "createdByUserId"],
  ["GiveawayCampaignCode", "revokedByUserId"],
  ["GiveawayEntry", "riderId"],
  ["GiveawayCampaignCodeClaim", "riderId"],
  ["GiveawayEntryEvent", "actorUserId"],
  ["GiveawaySnapshot", "lockedByUserId"],
  ["GiveawayDraw", "initiatedByUserId"],
  ["GiveawayAward", "winnerUserId"],
  ["GiveawayClaimVerification", "operatorActorUserId"],
  ["GiveawayFulfillment", "operatorActorUserId"],
  ["GiveawayDeliveryDetail", "submittedByUserId"],
  ["GiveawayOperator", "userId"],
  ["GiveawayOperator", "grantedByUserId"],
  ["GiveawayOperator", "revokedByUserId"],
  ["GiveawayAuditEvent", "actorUserId"],
] as const;

describe("account role and event location Prisma schema contract", () => {
  test("generates only the supported account roles and event statuses", () => {
    expect(Object.values(generatedEnums.Role ?? {})).toEqual(["rider", "organizer", "admin"]);
    expect(Object.values(generatedEnums.EventStatus ?? {})).not.toContain("PENDING_VENUE_APPROVAL");
  });

  test("separates account access from user and organizer verification", () => {
    expect(typesSource).toContain('export type AccountStatus = "ACTIVE" | "SUSPENDED"');
    expect(typesSource).toContain("export type OrganizerVerificationStatus");
    expect(typesSource).toMatch(
      /export type VerificationStatus =[\s\S]*?"REJECTED";/,
    );
    expect(prismaSchema.match(/enum VerificationStatus \{([\s\S]*?)\}/)?.[1]).not.toContain(
      "SUSPENDED",
    );
    expect(prismaSchema.match(/enum OrganizerVerificationStatus \{([\s\S]*?)\}/)?.[1]).toContain(
      "SUSPENDED",
    );
    expect(prismaSchema).toContain("enum AccountStatus");
    expect(prismaSchema).toContain("accountStatus");
    expect(prismaSchema).toContain("suspendedByUserId");
    expect(prismaSchema).toContain('relation("UserSuspendedBy"');
  });

  test("persists a distinct disabled event state and versioned review history", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

    expect(typesSource).toMatch(/EventStatus[\s\S]*"DISABLED"/);
    expect(prismaSchema).toContain("DISABLED");
    expect(prismaSchema).toContain("submissionVersion");
    expect(prismaSchema).toContain("disabledByUserId");
    expect(prismaSchema).toContain("@@unique([eventId, submissionVersion])");
    expect(prismaSchema).toContain('relation("EventDisabledBy"');
    expect(prismaSchema).toContain('relation("EventReviewer"');
    expect(models.get("Event")?.fields.find((field) => field.name === "submissionVersion"))
      .toMatchObject({ kind: "scalar", type: "Int" });
    expect(models.get("EventApproval")?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["submissionVersion", "submittedAt", "reviewer"]),
    );
    expect(models.get("EventApproval")?.fields.find((field) => field.name === "reviewer"))
      .toMatchObject({ kind: "object", relationName: "EventReviewer" });
  });

  test("backfills review versions before enforcing unique history and safe reviewer references", () => {
    expect(eventReviewMigrationSql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(eventReviewMigrationSql).toContain('ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS \'DISABLED\'');
    expect(eventReviewMigrationSql).toContain('ROW_NUMBER() OVER (');
    expect(eventReviewMigrationSql).toContain('ORDER BY COALESCE("decidedAt", "createdAt"), "id"');
    expect(eventReviewMigrationSql).toContain('SET "submissionVersion" = ranked.version');
    expect(eventReviewMigrationSql).toContain('SET "submittedAt" = "createdAt"');
    expect(eventReviewMigrationSql).toContain(
      'ALTER COLUMN "submissionVersion" DROP DEFAULT',
    );
    expect(eventReviewMigrationSql).toContain(
      'CREATE UNIQUE INDEX "EventApproval_eventId_submissionVersion_key"',
    );
    expect(eventReviewMigrationSql).toContain("EVENT_REVIEW_ORPHAN_REVIEWER");
    expect(eventReviewMigrationSql).not.toContain('SET "reviewerId" = NULL');
    expect(eventReviewMigrationSql).toContain(
      'FOREIGN KEY ("reviewerId") REFERENCES "User"("id")\n  ON DELETE SET NULL ON UPDATE CASCADE',
    );
    expect(eventReviewMigrationSql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  test("removes venue ownership and approval-type relations from the generated model", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

    expect(models.has("Venue")).toBe(false);
    expect(models.get("User")?.fields.map((field) => field.name)).not.toContain("ownedVenues");
    expect(models.get("Event")?.fields.map((field) => field.name)).not.toContain("venueId");
    expect(models.get("Event")?.fields.map((field) => field.name)).not.toContain("venue");
    expect(models.get("EventApproval")?.fields.map((field) => field.name)).not.toContain(
      "approvalType",
    );
  });

  test("persists bounded required event location snapshots and a nullable map link", () => {
    const event = Prisma.dmmf.datamodel.models.find((model) => model.name === "Event");

    expect(event?.fields.find((field) => field.name === "locationName")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(event?.fields.find((field) => field.name === "locationAddress")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(event?.fields.find((field) => field.name === "locationMapLink")).toMatchObject({
      kind: "scalar",
      type: "String",
    });
    expect(prismaSchema).toMatch(/locationName\s+String\s+@db\.VarChar\(120\)/);
    expect(prismaSchema).toMatch(/locationAddress\s+String\s+@db\.VarChar\(240\)/);
    expect(prismaSchema).toMatch(/locationMapLink\s+String\?\s+@db\.VarChar\(500\)/);
    expect(prismaSchema).toMatch(/area\s+String\s+@db\.VarChar\(120\)/);
    expect(prismaSchema).toMatch(
      /scanner\s+User\?\s+@relation\("ScannerUser", fields: \[scannedBy\], references: \[id\], onDelete: SetNull\)/,
    );
  });

  test("wraps destructive migration work in one guarded transaction", () => {
    expect(migrationSql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migrationSql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(migrationSql).toContain("SET LOCAL statement_timeout = '60s';");
    expect(migrationSql).toContain('CREATE TEMP TABLE "_AccountCleanupOrganizerAllowlist"');
    expect(migrationSql).toContain('CREATE TEMP TABLE "_AccountCleanupBaseline"');
    expect(migrationSql).toContain('"emptyInstall"');
    expect(migrationSql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  test("uses the exact generated organizer allowlist and exact optional demo accounts", () => {
    for (const [userId, profileId, email] of generatedOrganizerAllowlist) {
      expect(migrationSql).toContain(`('${userId}', '${profileId}', '${email}')`);
    }
    expect(migrationSql).toContain("user-mina-rider");
    expect(migrationSql).toContain("user-demo-scan-rider");
    expect(migrationSql).toContain("user-ana-venue");
    expect(migrationSql).not.toMatch(/LIKE\s+'%@seed\.tambike\.local'/i);
  });

  test("guards all immutable giveaway history before account deletion", () => {
    for (const [table, column] of immutableUserReferences) {
      expect(migrationSql).toContain(`FROM "${table}"`);
      expect(migrationSql).toContain(`"${column}"`);
    }
    expect(migrationSql).toContain('FROM "EventApproval"');
    expect(migrationSql).toContain('"reviewerId"');
    expect(migrationSql).toContain("IMMUTABLE_GIVEAWAY_HISTORY");
  });

  test("backfills locations, preserves scans, rebuilds enums, and verifies postconditions", () => {
    expect(migrationSql).toContain('ADD COLUMN "locationName" VARCHAR(120)');
    expect(migrationSql).toContain('ADD COLUMN "locationAddress" VARCHAR(240)');
    expect(migrationSql).toContain('ADD COLUMN "locationMapLink" VARCHAR(500)');
    expect(migrationSql).toContain('DROP CONSTRAINT "CheckIn_scannedBy_fkey"');
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("scannedBy"\) REFERENCES "User"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/,
    );
    expect(migrationSql).toContain('DROP COLUMN "venueId"');
    expect(migrationSql).toContain('DROP TABLE "Venue"');
    expect(migrationSql).toContain('DROP COLUMN "approvalType"');
    expect(migrationSql).toContain('DROP TYPE "ApprovalType"');
    expect(migrationSql).toContain('ALTER TYPE "Role" RENAME TO "Role_old"');
    expect(migrationSql).toContain('CREATE TYPE "Role" AS ENUM (\'rider\', \'organizer\', \'admin\')');
    expect(migrationSql).toContain('ALTER TYPE "EventStatus" RENAME TO "EventStatus_old"');
    expect(migrationSql).toContain("ACCOUNT_CLEANUP_POSTCONDITION_FAILED");
    expect(migrationSql).toContain("LOCATION_SNAPSHOT_POSTCONDITION_FAILED");
  });
});
