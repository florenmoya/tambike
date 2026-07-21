import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260722010000_rider_profiles_showcase_rosters/migration.sql",
);
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const prismaSchema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const memberProfileTypesPath = resolve(process.cwd(), "src/features/member-profiles/types.ts");
const memberProfileTypes = existsSync(memberProfileTypesPath)
  ? readFileSync(memberProfileTypesPath, "utf8")
  : "";

describe("member profile, motorcycle, roster, and media schema contract", () => {
  test("defines private-by-default profile publication and roster identity enums", () => {
    expect(prismaSchema).toContain("enum ProfileVisibility");
    expect(prismaSchema).toContain("PUBLIC");
    expect(prismaSchema).toContain("MEMBERS_ONLY");
    expect(prismaSchema).toContain("PRIVATE");
    expect(prismaSchema).toContain("enum RosterIdentity");
    expect(prismaSchema).toContain("VISIBLE");
    expect(prismaSchema).toContain("ANONYMOUS");
    expect(prismaSchema).toMatch(/profileSlug\s+String\?\s+@unique/);
    expect(prismaSchema).toMatch(/profileVisibility\s+ProfileVisibility\s+@default\(PRIVATE\)/);
    expect(prismaSchema).toMatch(
      /defaultRosterIdentity\s+RosterIdentity\s+@default\(ANONYMOUS\)/,
    );
  });

  test("keeps publication and profile-photo metadata nullable until a member opts in", () => {
    for (const field of [
      "profileSlug",
      "profileBio",
      "profilePhotoMediaId",
      "profilePhotoStorageKey",
      "profilePhotoMimeType",
      "profilePhotoWidth",
      "profilePhotoHeight",
      "profilePhotoFinalizedAt",
    ]) {
      expect(prismaSchema).toMatch(new RegExp(`${field}\\s+\\w+\\?`));
    }
  });

  test("models one motorcycle per user, ordered private photos, and one roster setting per event", () => {
    expect(prismaSchema).toMatch(/motorcycle\s+Motorcycle\?/);
    expect(prismaSchema).toMatch(/rosterSettings\s+EventRosterSettings\?/);
    expect(prismaSchema).toMatch(/model Motorcycle\s+\{/);
    expect(prismaSchema).toMatch(/userId\s+String\s+@unique/);
    expect(prismaSchema).toMatch(/onDelete: Cascade/);
    expect(prismaSchema).toMatch(/model MotorcyclePhoto\s+\{/);
    expect(prismaSchema).toMatch(/mediaId\s+String\s+@unique/);
    expect(prismaSchema).toContain("@@unique([motorcycleId, position])");
    expect(prismaSchema).toMatch(/model EventRosterSettings\s+\{/);
    expect(prismaSchema).toMatch(/eventId\s+String\s+@id/);
    expect(prismaSchema).toMatch(/enabled\s+Boolean\s+@default\(false\)/);
  });

  test("stores RSVP roster identity with deterministic Going-roster pagination", () => {
    expect(prismaSchema).toMatch(/rosterIdentity\s+RosterIdentity\s+@default\(ANONYMOUS\)/);
    expect(prismaSchema).toContain("@@index([eventId, status, goingAt, id])");
  });

  test("adds schema objects safely and explicitly anonymizes existing RSVPs", () => {
    expect(migrationSql).toContain("CREATE TYPE \"ProfileVisibility\"");
    expect(migrationSql).toContain("CREATE TYPE \"RosterIdentity\"");
    expect(migrationSql).toContain('UPDATE "RSVP" SET "rosterIdentity" = \'ANONYMOUS\'');
    expect(migrationSql).toContain('ALTER TABLE "RSVP" ALTER COLUMN "rosterIdentity" SET NOT NULL');
    expect(migrationSql).toContain('CREATE TABLE "Motorcycle"');
    expect(migrationSql).toContain('CREATE TABLE "MotorcyclePhoto"');
    expect(migrationSql).toContain('CREATE TABLE "EventRosterSettings"');
  });

  test("exposes only sanitized profile and roster DTO shapes", () => {
    for (const exportedName of ["ProfileVisibility", "RosterIdentity"]) {
      expect(memberProfileTypes).toContain(`export type ${exportedName}`);
    }
    for (const exportedName of [
      "MemberProfileView",
      "MemberProfileEditorView",
      "MotorcycleShowcase",
      "EventAttendeeSummary",
      "EventAttendeeRosterPage",
      "UpdateMemberProfileInput",
      "UpsertMotorcycleInput",
      "RosterIdentityInput",
    ]) {
      expect(memberProfileTypes).toContain(`export interface ${exportedName}`);
    }
    expect(memberProfileTypes).toContain("profilePhotoUrl?: string");
    expect(memberProfileTypes).toContain("slug: string;");
    expect(memberProfileTypes).toContain(
      'export interface MemberProfileEditorView extends Omit<MemberProfileView, "slug">',
    );
    expect(memberProfileTypes).toContain("slug: string | null;");
    expect(memberProfileTypes).not.toMatch(/storageKey|passwordHash|verificationStatus|email:\s*string/);
  });
});
