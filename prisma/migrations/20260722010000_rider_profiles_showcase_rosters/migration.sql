BEGIN;

CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'MEMBERS_ONLY', 'PRIVATE');
CREATE TYPE "RosterIdentity" AS ENUM ('VISIBLE', 'ANONYMOUS');

ALTER TABLE "User"
  ADD COLUMN "profileSlug" TEXT,
  ADD COLUMN "profileBio" TEXT,
  ADD COLUMN "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "defaultRosterIdentity" "RosterIdentity" NOT NULL DEFAULT 'ANONYMOUS',
  ADD COLUMN "profilePhotoMediaId" TEXT,
  ADD COLUMN "profilePhotoStorageKey" TEXT,
  ADD COLUMN "profilePhotoMimeType" TEXT,
  ADD COLUMN "profilePhotoWidth" INTEGER,
  ADD COLUMN "profilePhotoHeight" INTEGER,
  ADD COLUMN "profilePhotoFinalizedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_profileSlug_key" ON "User"("profileSlug");
CREATE UNIQUE INDEX "User_profilePhotoMediaId_key" ON "User"("profilePhotoMediaId");

CREATE TABLE "Motorcycle" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "year" INTEGER,
  "displacementCc" INTEGER,
  "nickname" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Motorcycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Motorcycle_userId_key" UNIQUE ("userId"),
  CONSTRAINT "Motorcycle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MotorcyclePhoto" (
  "id" TEXT NOT NULL,
  "motorcycleId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "mediaId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MotorcyclePhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MotorcyclePhoto_mediaId_key" UNIQUE ("mediaId"),
  CONSTRAINT "MotorcyclePhoto_motorcycleId_position_key" UNIQUE ("motorcycleId", "position"),
  CONSTRAINT "MotorcyclePhoto_position_check" CHECK ("position" BETWEEN 0 AND 4),
  CONSTRAINT "MotorcyclePhoto_motorcycleId_fkey" FOREIGN KEY ("motorcycleId") REFERENCES "Motorcycle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EventRosterSettings" (
  "eventId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventRosterSettings_pkey" PRIMARY KEY ("eventId"),
  CONSTRAINT "EventRosterSettings_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "RSVP" ADD COLUMN "rosterIdentity" "RosterIdentity" DEFAULT 'ANONYMOUS';
UPDATE "RSVP" SET "rosterIdentity" = 'ANONYMOUS' WHERE "rosterIdentity" IS NULL;
ALTER TABLE "RSVP" ALTER COLUMN "rosterIdentity" SET NOT NULL;

CREATE INDEX "RSVP_eventId_status_goingAt_id_idx" ON "RSVP"("eventId", "status", "goingAt", "id");

COMMIT;
