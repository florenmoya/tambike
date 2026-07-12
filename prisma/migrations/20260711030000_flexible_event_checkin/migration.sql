-- Stop rather than silently deleting historical attendance if prior data has duplicate check-ins.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CheckIn"
    GROUP BY "eventId", "passId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add one-check-in-per-event constraint: duplicate CheckIn rows exist.';
  END IF;
END $$;

ALTER TYPE "CheckInMethod" ADD VALUE IF NOT EXISTS 'staff_camera';
ALTER TYPE "CheckInMethod" ADD VALUE IF NOT EXISTS 'staff_upload';
ALTER TYPE "CheckInMethod" ADD VALUE IF NOT EXISTS 'staff_manual';
ALTER TYPE "CheckInMethod" ADD VALUE IF NOT EXISTS 'rider_qr';

CREATE TYPE "CheckInStatus" AS ENUM ('pending', 'confirmed');
CREATE TYPE "SelfCheckInMode" AS ENUM ('staff_only', 'self_review', 'self_instant');
CREATE TYPE "SelfCheckInState" AS ENUM ('closed', 'open', 'paused');
CREATE TYPE "OrganizerQrMode" AS ENUM ('rotating', 'fixed');

ALTER TABLE "CheckIn" ALTER COLUMN "scannedBy" DROP NOT NULL;
ALTER TABLE "CheckIn"
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "status" "CheckInStatus" NOT NULL DEFAULT 'confirmed',
  ADD COLUMN "confirmationMethod" "CheckInMethod",
  ADD COLUMN "selfCheckInSessionId" TEXT;

UPDATE "CheckIn"
SET "confirmedAt" = "timestamp"
WHERE "confirmedAt" IS NULL;

CREATE TABLE "EventCheckInSettings" (
  "eventId" TEXT NOT NULL,
  "mode" "SelfCheckInMode" NOT NULL DEFAULT 'staff_only',
  "state" "SelfCheckInState" NOT NULL DEFAULT 'closed',
  "qrMode" "OrganizerQrMode" NOT NULL DEFAULT 'rotating',
  "fixedQrAcknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventCheckInSettings_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "EventSelfCheckInQrSession" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventSelfCheckInQrSession_pkey" PRIMARY KEY ("id")
);

INSERT INTO "EventCheckInSettings" ("eventId", "mode", "state", "qrMode", "createdAt", "updatedAt")
SELECT "id", 'staff_only', 'closed', 'rotating', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Event";

CREATE UNIQUE INDEX "CheckIn_eventId_passId_key" ON "CheckIn"("eventId", "passId");
CREATE UNIQUE INDEX "EventSelfCheckInQrSession_tokenHash_key" ON "EventSelfCheckInQrSession"("tokenHash");

ALTER TABLE "EventCheckInSettings"
  ADD CONSTRAINT "EventCheckInSettings_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSelfCheckInQrSession"
  ADD CONSTRAINT "EventSelfCheckInQrSession_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckIn"
  ADD CONSTRAINT "CheckIn_selfCheckInSessionId_fkey"
  FOREIGN KEY ("selfCheckInSessionId") REFERENCES "EventSelfCheckInQrSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
