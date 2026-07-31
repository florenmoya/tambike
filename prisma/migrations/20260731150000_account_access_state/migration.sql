BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
