BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- OPERATOR ROLLBACK / FORWARD-RECOVERY RUNBOOK (do not execute as part of this migration)
-- Prerequisites before deployment: stop application writes for the cutover window and verify a
-- restorable, pre-migration backup or point-in-time-recovery (PITR) target. Preserve a separate
-- post-migration backup before attempting any recovery action.
--
-- Lossless rollback: restore a clone from the verified PITR point immediately before this migration,
-- validate application reads and the absence of this migration in that clone's `_prisma_migrations`,
-- then redirect traffic only after the clone is approved. Restoring the pre-migration point discards
-- every write made after that point; reconcile or replay those writes separately before cutover.
--
-- Do not attempt an in-place enum reversal. This migration drops `VerificationStatus_legacy` and maps
-- legacy user `SUSPENDED` verification to `accountStatus = SUSPENDED` plus user verification
-- `APPROVED`; later account-status changes and the derived `suspendedAt` value cannot be reconstructed
-- as the original legacy row state. Organizer-profile `SUSPENDED` values are preserved in
-- `OrganizerVerificationStatus` and do not require restoration.
--
-- Forward recovery: if any statement fails before COMMIT, PostgreSQL rolls back the whole transaction;
-- correct the cause and rerun this migration from the unchanged pre-migration schema. If COMMIT succeeds
-- but the application rollout fails, keep this schema, deploy the account-status-aware application, and
-- verify this migration is recorded as finished before reopening writes. After a PITR rollback, restore
-- the matching pre-migration application version first; when ready to move forward again, reapply this
-- migration once through the normal Prisma deployment path rather than manually recreating the legacy enum.

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "User"
  ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedByUserId" TEXT,
  ADD COLUMN "suspensionReason" VARCHAR(500);

UPDATE "User"
SET
  "accountStatus" = 'SUSPENDED',
  "suspendedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "verificationStatus"::text = 'SUSPENDED';

ALTER TYPE "VerificationStatus" RENAME TO "VerificationStatus_legacy";
CREATE TYPE "VerificationStatus" AS ENUM (
  'UNVERIFIED',
  'PENDING',
  'APPROVED',
  'REJECTED'
);
CREATE TYPE "OrganizerVerificationStatus" AS ENUM (
  'UNVERIFIED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED'
);

ALTER TABLE "User" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "OrganizerProfile" ALTER COLUMN "verificationStatus" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "verificationStatus" TYPE "VerificationStatus"
  USING (
    CASE
      WHEN "verificationStatus"::text = 'SUSPENDED' THEN 'APPROVED'
      ELSE "verificationStatus"::text
    END
  )::"VerificationStatus";

ALTER TABLE "OrganizerProfile"
  ALTER COLUMN "verificationStatus" TYPE "OrganizerVerificationStatus"
  USING ("verificationStatus"::text)::"OrganizerVerificationStatus";

ALTER TABLE "User" ALTER COLUMN "verificationStatus" SET DEFAULT 'UNVERIFIED';
ALTER TABLE "OrganizerProfile" ALTER COLUMN "verificationStatus" SET DEFAULT 'PENDING';
DROP TYPE "VerificationStatus_legacy";

ALTER TABLE "User"
  ADD CONSTRAINT "User_suspendedByUserId_fkey"
  FOREIGN KEY ("suspendedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_role_accountStatus_idx"
  ON "User"("role", "accountStatus");

COMMIT;
