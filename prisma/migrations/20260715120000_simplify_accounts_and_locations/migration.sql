BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE "_AccountCleanupOrganizerAllowlist" (
  "userId" text PRIMARY KEY,
  "profileId" text UNIQUE NOT NULL,
  "email" text UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO "_AccountCleanupOrganizerAllowlist" ("userId", "profileId", "email") VALUES
  ('user-cafe-classico', 'cafe-classico', 'cafe-classico@seed.tambike.local'),
  ('user-arai-hjc-riders', 'arai-hjc-riders', 'arai-hjc-riders@seed.tambike.local'),
  ('user-ducati-access-plus', 'ducati-access-plus', 'ducati-access-plus@seed.tambike.local'),
  ('user-republik-riders', 'republik-riders', 'republik-riders@seed.tambike.local'),
  ('user-mandirigma-endutour', 'mandirigma-endutour', 'mandirigma-endutour@seed.tambike.local'),
  ('user-motoir-ph', 'motoir-ph', 'motoir-ph@seed.tambike.local'),
  ('user-makina-moto', 'makina-moto', 'makina-moto@seed.tambike.local'),
  ('user-dsboys-tambike', 'dsboys-tambike', 'dsboys-tambike@seed.tambike.local'),
  ('user-boys-underbone-laguna', 'boys-underbone-laguna', 'boys-underbone-laguna@seed.tambike.local'),
  ('user-swabz-classic-motoparts', 'swabz-classic-motoparts', 'swabz-classic-motoparts@seed.tambike.local'),
  ('user-yloco-bandits', 'yloco-bandits', 'yloco-bandits@seed.tambike.local'),
  ('user-motor-ace-bmw', 'motor-ace-bmw', 'motor-ace-bmw@seed.tambike.local'),
  ('user-fullprint-manila', 'fullprint-manila', 'fullprint-manila@seed.tambike.local'),
  ('user-boys-of-garage', 'boys-of-garage', 'boys-of-garage@seed.tambike.local'),
  ('user-ccph-upper-east', 'ccph-upper-east', 'ccph-upper-east@seed.tambike.local'),
  ('user-ccph-cebu', 'ccph-cebu', 'ccph-cebu@seed.tambike.local'),
  ('user-antipolo-endurance-challenge', 'antipolo-endurance-challenge', 'antipolo-endurance-challenge@seed.tambike.local'),
  ('user-laguna-moto-fest', 'laguna-moto-fest', 'laguna-moto-fest@seed.tambike.local'),
  ('user-ngo-philippines', 'ngo-philippines', 'ngo-philippines@seed.tambike.local'),
  ('user-mindanao-wide-motocross', 'mindanao-wide-motocross', 'mindanao-wide-motocross@seed.tambike.local');

CREATE TEMP TABLE "_AccountCleanupRemovableUsers" (
  "userId" text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO "_AccountCleanupRemovableUsers" ("userId")
SELECT "userId" FROM "_AccountCleanupOrganizerAllowlist"
UNION ALL VALUES
  ('user-mina-rider'),
  ('user-demo-scan-rider'),
  ('user-ana-venue');

CREATE TEMP TABLE "_AccountCleanupBaseline" (
  "emptyInstall" boolean NOT NULL,
  "eventCount" bigint NOT NULL,
  "florenUserCount" bigint NOT NULL,
  "florenRsvpCount" bigint NOT NULL,
  "florenPassCount" bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO "_AccountCleanupBaseline" (
  "emptyInstall",
  "eventCount",
  "florenUserCount",
  "florenRsvpCount",
  "florenPassCount"
)
SELECT
  (SELECT count(*) FROM "User") = 0
    AND (SELECT count(*) FROM "OrganizerProfile") = 0
    AND (SELECT count(*) FROM "Event") = 0
    AND (SELECT count(*) FROM "Venue") = 0,
  (SELECT count(*) FROM "Event"),
  (SELECT count(*) FROM "User" WHERE lower("email") = 'florenmoya@gmail.com'),
  (
    SELECT count(*)
    FROM "RSVP" rsvp
    JOIN "User" rider ON rider."id" = rsvp."userId"
    WHERE lower(rider."email") = 'florenmoya@gmail.com'
  ),
  (
    SELECT count(*)
    FROM "Pass" pass
    JOIN "User" rider ON rider."id" = pass."userId"
    WHERE lower(rider."email") = 'florenmoya@gmail.com'
  );

DO $account_cleanup_preflight$
DECLARE
  empty_install boolean;
BEGIN
  SELECT "emptyInstall" INTO empty_install FROM "_AccountCleanupBaseline";
  IF empty_install THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "User" retained_user
    JOIN "OrganizerProfile" retained_profile
      ON retained_profile."userId" = retained_user."id"
    WHERE retained_user."id" = 'user-marco-organizer'
      AND retained_user."role"::text = 'organizer'
      AND retained_profile."id" = 'user-marco-organizer-profile'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_CANONICAL_ORGANIZER_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE lower("email") = lower('organizer@bayanko.ph')
      AND "id" <> 'user-marco-organizer'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_TARGET_EMAIL_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "_AccountCleanupOrganizerAllowlist" allowed
    LEFT JOIN "User" allowed_user
      ON allowed_user."id" = allowed."userId"
    LEFT JOIN "OrganizerProfile" allowed_profile
      ON allowed_profile."id" = allowed."profileId"
    LEFT JOIN "User" email_owner
      ON lower(email_owner."email") = lower(allowed."email")
    WHERE (
      allowed_user."id" IS NOT NULL
      OR allowed_profile."id" IS NOT NULL
      OR email_owner."id" IS NOT NULL
    ) AND (
      allowed_user."id" IS DISTINCT FROM allowed."userId"
      OR allowed_user."email" IS DISTINCT FROM allowed."email"
      OR allowed_user."role"::text IS DISTINCT FROM 'organizer'
      OR allowed_profile."id" IS DISTINCT FROM allowed."profileId"
      OR allowed_profile."userId" IS DISTINCT FROM allowed."userId"
      OR email_owner."id" IS DISTINCT FROM allowed."userId"
    )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_ALLOWLIST_IDENTITY_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "User" organizer_user
    LEFT JOIN "OrganizerProfile" organizer_profile
      ON organizer_profile."userId" = organizer_user."id"
    LEFT JOIN "_AccountCleanupOrganizerAllowlist" allowed
      ON allowed."userId" = organizer_user."id"
    WHERE organizer_user."role"::text = 'organizer'
      AND organizer_user."id" <> 'user-marco-organizer'
      AND (
        allowed."userId" IS NULL
        OR allowed."email" IS DISTINCT FROM organizer_user."email"
        OR allowed."profileId" IS DISTINCT FROM organizer_profile."id"
      )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_UNEXPECTED_ORGANIZER_USER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OrganizerProfile" organizer_profile
    LEFT JOIN "User" organizer_user
      ON organizer_user."id" = organizer_profile."userId"
    LEFT JOIN "_AccountCleanupOrganizerAllowlist" allowed
      ON allowed."profileId" = organizer_profile."id"
    WHERE organizer_profile."id" <> 'user-marco-organizer-profile'
      AND (
        allowed."profileId" IS NULL
        OR allowed."userId" IS DISTINCT FROM organizer_profile."userId"
        OR allowed."email" IS DISTINCT FROM organizer_user."email"
        OR organizer_user."role"::text IS DISTINCT FROM 'organizer'
      )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_UNEXPECTED_ORGANIZER_PROFILE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE ("id" = 'user-mina-rider' OR lower("email") = lower('mina.rider@example.com'))
      AND NOT (
        "id" = 'user-mina-rider'
        AND "email" = 'mina.rider@example.com'
        AND "role"::text = 'rider'
      )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_MINA_IDENTITY_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE ("id" = 'user-demo-scan-rider' OR lower("email") = lower('scan-rider@seed.tambike.local'))
      AND NOT (
        "id" = 'user-demo-scan-rider'
        AND "email" = 'scan-rider@seed.tambike.local'
        AND "role"::text = 'rider'
      )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_SCAN_RIDER_IDENTITY_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE ("id" = 'user-ana-venue' OR lower("email") = lower('ana.venue@example.com'))
      AND NOT (
        "id" = 'user-ana-venue'
        AND "email" = 'ana.venue@example.com'
        AND "role"::text = 'venue'
      )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_VENUE_IDENTITY_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE "role"::text = 'venue' AND "id" <> 'user-ana-venue'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_UNEXPECTED_VENUE_USER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Event" event
    LEFT JOIN "Venue" venue ON venue."id" = event."venueId"
    WHERE venue."id" IS NULL
      OR char_length(btrim(event."area")) NOT BETWEEN 1 AND 120
      OR char_length(btrim(venue."name")) NOT BETWEEN 1 AND 120
      OR char_length(btrim(venue."address")) NOT BETWEEN 1 AND 240
      OR (
        NULLIF(btrim(venue."mapLink"), '') IS NOT NULL
        AND (
          char_length(btrim(venue."mapLink")) > 500
          OR btrim(venue."mapLink") !~* '^https?://([^@/?#[:space:]]+@)?([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]+)?([/?#]|$)'
        )
      )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_INVALID_LOCATION_SNAPSHOT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "EventGiveaway" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" IN (history."creatorUserId", history."organizerAttestedById", history."complianceReviewerId", history."suspendedByUserId")
    UNION ALL
    SELECT 1 FROM "GiveawayMechanicsVersion" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" IN (history."createdByUserId", history."reviewedByUserId")
    UNION ALL
    SELECT 1 FROM "GiveawayCampaignCode" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" IN (history."createdByUserId", history."revokedByUserId")
    UNION ALL
    SELECT 1 FROM "GiveawayEntry" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."riderId"
    UNION ALL
    SELECT 1 FROM "GiveawayCampaignCodeClaim" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."riderId"
    UNION ALL
    SELECT 1 FROM "GiveawayEntryEvent" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."actorUserId"
    UNION ALL
    SELECT 1 FROM "GiveawaySnapshot" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."lockedByUserId"
    UNION ALL
    SELECT 1 FROM "GiveawayDraw" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."initiatedByUserId"
    UNION ALL
    SELECT 1 FROM "GiveawayAward" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."winnerUserId"
    UNION ALL
    SELECT 1 FROM "GiveawayClaimVerification" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."operatorActorUserId"
    UNION ALL
    SELECT 1 FROM "GiveawayFulfillment" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."operatorActorUserId"
    UNION ALL
    SELECT 1 FROM "GiveawayDeliveryDetail" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."submittedByUserId"
    UNION ALL
    SELECT 1 FROM "GiveawayOperator" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" IN (history."userId", history."grantedByUserId", history."revokedByUserId")
    UNION ALL
    SELECT 1 FROM "GiveawayAuditEvent" history JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = history."actorUserId"
  ) THEN
    RAISE EXCEPTION 'IMMUTABLE_GIVEAWAY_HISTORY_REFERENCES_REMOVABLE_ACCOUNT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "EventApproval" approval
    JOIN "_AccountCleanupRemovableUsers" removable
      ON removable."userId" = approval."reviewerId"
    WHERE approval."approvalType"::text = 'admin'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_SURVIVING_APPROVAL_REVIEWER_IS_REMOVABLE';
  END IF;
END
$account_cleanup_preflight$;

ALTER TABLE "Event"
  ADD COLUMN "locationName" VARCHAR(120),
  ADD COLUMN "locationAddress" VARCHAR(240),
  ADD COLUMN "locationMapLink" VARCHAR(500);

UPDATE "Event" event
SET
  "locationName" = btrim(venue."name"),
  "locationAddress" = btrim(venue."address"),
  "locationMapLink" = NULLIF(btrim(venue."mapLink"), ''),
  "area" = btrim(event."area")
FROM "Venue" venue
WHERE venue."id" = event."venueId";

UPDATE "User"
SET
  "email" = 'organizer@bayanko.ph',
  "displayName" = 'Tambike Organizer',
  "clubName" = 'Tambike Organizer',
  "verificationStatus" = 'APPROVED'
WHERE "id" = 'user-marco-organizer';

UPDATE "OrganizerProfile"
SET
  "organizerType" = 'Tambike Organizer',
  "displayName" = 'Tambike Organizer',
  "realName" = 'Tambike Organizer',
  "clubPageName" = 'Tambike Organizer',
  "verificationStatus" = 'APPROVED'
WHERE "id" = 'user-marco-organizer-profile';

UPDATE "Event"
SET "organizerId" = 'user-marco-organizer-profile'
WHERE "organizerId" <> 'user-marco-organizer-profile';

UPDATE "Event"
SET "status" = 'PENDING_ADMIN_REVIEW'
WHERE "status" = 'PENDING_VENUE_APPROVAL';

DELETE FROM "EventApproval"
WHERE "approvalType" = 'venue';

ALTER TABLE "CheckIn" DROP CONSTRAINT "CheckIn_scannedBy_fkey";
ALTER TABLE "CheckIn"
  ADD CONSTRAINT "CheckIn_scannedBy_fkey"
  FOREIGN KEY ("scannedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DELETE FROM "User" user_to_remove
USING "_AccountCleanupRemovableUsers" removable
WHERE user_to_remove."id" = removable."userId";

ALTER TABLE "Event"
  ALTER COLUMN "locationName" SET NOT NULL,
  ALTER COLUMN "locationAddress" SET NOT NULL,
  ALTER COLUMN "area" TYPE VARCHAR(120) USING btrim("area");

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_locationName_trimmed_check"
    CHECK ("locationName" = btrim("locationName") AND char_length("locationName") BETWEEN 1 AND 120),
  ADD CONSTRAINT "Event_locationAddress_trimmed_check"
    CHECK ("locationAddress" = btrim("locationAddress") AND char_length("locationAddress") BETWEEN 1 AND 240),
  ADD CONSTRAINT "Event_area_trimmed_check"
    CHECK ("area" = btrim("area") AND char_length("area") BETWEEN 1 AND 120),
  ADD CONSTRAINT "Event_locationMapLink_http_check"
    CHECK (
      "locationMapLink" IS NULL
      OR (
        "locationMapLink" = btrim("locationMapLink")
        AND char_length("locationMapLink") BETWEEN 1 AND 500
        AND "locationMapLink" ~* '^https?://([^@/?#[:space:]]+@)?([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]+)?([/?#]|$)'
      )
    );

ALTER TABLE "Event" DROP CONSTRAINT "Event_venueId_fkey";
ALTER TABLE "Event" DROP COLUMN "venueId";
DROP TABLE "Venue";

ALTER TABLE "EventApproval" DROP COLUMN "approvalType";
DROP TYPE "ApprovalType";

ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('rider', 'organizer', 'admin');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'rider';
DROP TYPE "Role_old";

ALTER TYPE "EventStatus" RENAME TO "EventStatus_old";
CREATE TYPE "EventStatus" AS ENUM (
  'DRAFT',
  'PENDING_ADMIN_REVIEW',
  'PUBLISHED',
  'ONGOING',
  'COMPLETED',
  'NEEDS_CHANGES',
  'REJECTED',
  'CANCELLED'
);
ALTER TABLE "Event" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Event"
  ALTER COLUMN "status" TYPE "EventStatus" USING ("status"::text::"EventStatus");
ALTER TABLE "Event" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "EventStatus_old";

DO $account_cleanup_postconditions$
DECLARE
  baseline "_AccountCleanupBaseline"%ROWTYPE;
BEGIN
  SELECT * INTO baseline FROM "_AccountCleanupBaseline";

  IF NOT baseline."emptyInstall" THEN
    IF (SELECT count(*) FROM "User" WHERE "role"::text = 'organizer') <> 1
      OR NOT EXISTS (
        SELECT 1 FROM "User"
        WHERE "id" = 'user-marco-organizer'
           AND "email" = 'organizer@bayanko.ph'
           AND "displayName" = 'Tambike Organizer'
           AND "role"::text = 'organizer'
           AND "verificationStatus"::text = 'APPROVED'
      )
      OR (SELECT count(*) FROM "OrganizerProfile") <> 1
      OR NOT EXISTS (
        SELECT 1 FROM "OrganizerProfile"
        WHERE "id" = 'user-marco-organizer-profile'
           AND "userId" = 'user-marco-organizer'
           AND "displayName" = 'Tambike Organizer'
           AND "verificationStatus"::text = 'APPROVED'
      )
    THEN
      RAISE EXCEPTION 'ACCOUNT_CLEANUP_POSTCONDITION_FAILED';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "Event"
      WHERE "organizerId" <> 'user-marco-organizer-profile'
    ) OR EXISTS (
      SELECT 1 FROM "User" user_row
      JOIN "_AccountCleanupRemovableUsers" removable ON removable."userId" = user_row."id"
    ) OR EXISTS (
      SELECT 1 FROM "OrganizerProfile" profile
      JOIN "_AccountCleanupOrganizerAllowlist" removable ON removable."profileId" = profile."id"
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_CLEANUP_POSTCONDITION_FAILED';
    END IF;

    IF (SELECT count(*) FROM "Event") <> baseline."eventCount"
      OR (SELECT count(*) FROM "User" WHERE lower("email") = 'florenmoya@gmail.com') <> baseline."florenUserCount"
      OR (
        SELECT count(*) FROM "RSVP" rsvp
        JOIN "User" rider ON rider."id" = rsvp."userId"
        WHERE lower(rider."email") = 'florenmoya@gmail.com'
      ) <> baseline."florenRsvpCount"
      OR (
        SELECT count(*) FROM "Pass" pass
        JOIN "User" rider ON rider."id" = pass."userId"
        WHERE lower(rider."email") = 'florenmoya@gmail.com'
      ) <> baseline."florenPassCount"
    THEN
      RAISE EXCEPTION 'ACCOUNT_CLEANUP_PRESERVATION_POSTCONDITION_FAILED';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Event"
    WHERE "organizerId" <> 'user-marco-organizer-profile'
      AND NOT baseline."emptyInstall"
  ) OR EXISTS (
    SELECT 1 FROM "Event"
    WHERE char_length(btrim("locationName")) NOT BETWEEN 1 AND 120
      OR char_length(btrim("locationAddress")) NOT BETWEEN 1 AND 240
      OR char_length(btrim("area")) NOT BETWEEN 1 AND 120
      OR "locationName" <> btrim("locationName")
      OR "locationAddress" <> btrim("locationAddress")
      OR "area" <> btrim("area")
      OR (
        "locationMapLink" IS NOT NULL
        AND (
          "locationMapLink" <> btrim("locationMapLink")
          OR "locationMapLink" !~* '^https?://([^@/?#[:space:]]+@)?([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]+)?([/?#]|$)'
        )
      )
  ) THEN
    RAISE EXCEPTION 'LOCATION_SNAPSHOT_POSTCONDITION_FAILED';
  END IF;

  IF to_regclass('"Venue"') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'Event'
        AND column_name IN ('venueId')
    )
    OR to_regtype('"ApprovalType"') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'EventApproval'
        AND column_name = 'approvalType'
    )
  THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_SCHEMA_POSTCONDITION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conname = 'CheckIn_scannedBy_fkey'
      AND constraint_row.conrelid = '"CheckIn"'::regclass
      AND constraint_row.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CLEANUP_SCANNER_POSTCONDITION_FAILED';
  END IF;
END
$account_cleanup_postconditions$;

COMMIT;
