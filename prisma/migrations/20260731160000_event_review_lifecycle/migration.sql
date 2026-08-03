BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- OPERATOR ROLLBACK / FORWARD-RECOVERY RUNBOOK (do not execute as part of this migration)
-- Prerequisites before deployment: stop application writes for the cutover window and verify a
-- restorable, pre-migration backup or point-in-time-recovery (PITR) target. Preserve a separate
-- post-migration backup before attempting any recovery action.
--
-- Lossless rollback: restore a clone from the verified PITR point immediately before this migration,
-- validate application reads plus review history in that clone, and confirm this migration is absent
-- from the clone's `_prisma_migrations` table. Redirect traffic only after the clone is approved.
-- Restoring the pre-migration point discards every later write; reconcile or replay those writes
-- separately before cutover.
--
-- Do not attempt an in-place down migration. PostgreSQL enum values are not safely removable in place,
-- and flattening versioned approval history would discard submission chronology and disable provenance.
--
-- Forward recovery: if any statement fails before COMMIT, PostgreSQL rolls back the whole transaction;
-- correct the reported precondition or lock failure and rerun from the unchanged schema. If COMMIT
-- succeeds but the application rollout fails, keep this additive schema and deploy the matching
-- event-review-aware application before reopening writes. Reapply this migration only through the
-- normal Prisma deployment path; never edit `_prisma_migrations` or recreate review history manually.

ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'DISABLED';

ALTER TABLE "Event"
  ADD COLUMN "submissionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "disabledByUserId" TEXT,
  ADD COLUMN "disableReason" VARCHAR(500);

ALTER TABLE "EventApproval"
  ADD COLUMN "submissionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "submittedAt" TIMESTAMP(3);

-- Preserve the original creation timestamp as the submission timestamp for every legacy decision.
UPDATE "EventApproval"
SET "submittedAt" = "createdAt";

-- Refuse to truncate historical review notes when applying the new bounded contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "EventApproval"
    WHERE char_length("notes") > 1000
  ) THEN
    RAISE EXCEPTION 'EVENT_REVIEW_NOTES_TOO_LONG';
  END IF;
END
$$;

ALTER TABLE "EventApproval"
  ALTER COLUMN "notes" TYPE VARCHAR(1000),
  ALTER COLUMN "submittedAt" SET NOT NULL,
  ALTER COLUMN "submittedAt" SET DEFAULT CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "eventId"
      ORDER BY COALESCE("decidedAt", "createdAt"), "id"
    ) AS version
  FROM "EventApproval"
)
UPDATE "EventApproval" approval
SET "submissionVersion" = ranked.version
FROM ranked
WHERE approval."id" = ranked."id";

UPDATE "Event" event
SET "submissionVersion" = history.latest
FROM (
  SELECT "eventId", MAX("submissionVersion") AS latest
  FROM "EventApproval"
  GROUP BY "eventId"
) history
WHERE event."id" = history."eventId";

-- The Prisma model requires callers to choose an approval version. The temporary default above exists
-- only so legacy rows can be ranked without an unsafe nullable intermediate state.
ALTER TABLE "EventApproval"
  ALTER COLUMN "submissionVersion" DROP DEFAULT;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_submissionVersion_positive"
  CHECK ("submissionVersion" > 0);

ALTER TABLE "EventApproval"
  ADD CONSTRAINT "EventApproval_submissionVersion_positive"
  CHECK ("submissionVersion" > 0);

CREATE UNIQUE INDEX "EventApproval_eventId_submissionVersion_key"
  ON "EventApproval"("eventId", "submissionVersion");
CREATE INDEX "EventApproval_decision_submittedAt_idx"
  ON "EventApproval"("decision", "submittedAt");

-- The legacy schema did not enforce this reference. Abort instead of erasing historical reviewer
-- provenance if drift introduced an orphan; an operator must restore the referenced user first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "EventApproval" approval
    LEFT JOIN "User" reviewer ON reviewer."id" = approval."reviewerId"
    WHERE approval."reviewerId" IS NOT NULL
      AND reviewer."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'EVENT_REVIEW_ORPHAN_REVIEWER';
  END IF;
END
$$;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_disabledByUserId_fkey"
  FOREIGN KEY ("disabledByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventApproval"
  ADD CONSTRAINT "EventApproval_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
