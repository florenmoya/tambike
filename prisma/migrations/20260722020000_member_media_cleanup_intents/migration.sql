BEGIN;

CREATE TABLE "MemberMediaCleanupIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "cleanupAfter" TIMESTAMP(3) NOT NULL,
  "claimToken" TEXT,
  "claimExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemberMediaCleanupIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberMediaCleanupIntent_storageKey_key"
  ON "MemberMediaCleanupIntent"("storageKey");
CREATE INDEX "MemberMediaCleanupIntent_cleanupAfter_createdAt_id_idx"
  ON "MemberMediaCleanupIntent"("cleanupAfter", "createdAt", "id");
CREATE INDEX "MemberMediaCleanupIntent_claimExpiresAt_idx"
  ON "MemberMediaCleanupIntent"("claimExpiresAt");

COMMIT;
