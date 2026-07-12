-- Add the Event Giveaway aggregate without converting existing Perk records or mutating history.

CREATE TYPE "GiveawayKind" AS ENUM ('raffle', 'giveaway');
CREATE TYPE "GiveawayStatus" AS ENUM ('draft', 'scheduled', 'open', 'paused', 'locked', 'drawing', 'claims_open', 'completed', 'cancelled', 'suspended');
CREATE TYPE "GiveawayComplianceStatus" AS ENUM ('draft', 'pending_review', 'approved', 'changes_requested', 'rejected');
CREATE TYPE "GiveawayEntryMode" AS ENUM ('automatic', 'opt_in', 'claim_code', 'manual_only');
CREATE TYPE "GiveawayVisibility" AS ENUM ('event_page', 'registered_riders', 'eligible_riders', 'hidden');
CREATE TYPE "GiveawayEligibilitySource" AS ENUM ('active_rsvp_pass', 'confirmed_check_in', 'staff_confirmed_check_in', 'perk_redemption', 'campaign_code', 'manual');
CREATE TYPE "GiveawayEntryStatus" AS ENUM ('eligible', 'locked', 'disqualified', 'withdrawn');
CREATE TYPE "GiveawayEntryEventType" AS ENUM ('automatic_qualified', 'opted_in', 'campaign_code_claimed', 'manual_grant', 'manual_revoke', 'source_revalidated');
CREATE TYPE "GiveawayAwardMode" AS ENUM ('random_draw', 'first_come', 'guaranteed', 'manual_selection');
CREATE TYPE "GiveawayPrizeItemStatus" AS ENUM ('available', 'reserved', 'fulfilled', 'voided');
CREATE TYPE "GiveawayDrawType" AS ENUM ('initial', 'redraw');
CREATE TYPE "GiveawayDrawStatus" AS ENUM ('pending', 'completed', 'published', 'voided');
CREATE TYPE "GiveawayAwardStatus" AS ENUM ('pending_verification', 'claimable', 'verified', 'fulfilled', 'declined', 'disqualified', 'expired', 'voided', 'superseded');
CREATE TYPE "GiveawayClaimVerificationMethod" AS ENUM ('camera', 'upload', 'manual');
CREATE TYPE "GiveawayClaimVerificationResult" AS ENUM ('verified', 'rejected');
CREATE TYPE "GiveawayFulfillmentType" AS ENUM ('onsite', 'digital_code', 'delivery', 'manual_contact');
CREATE TYPE "GiveawayFulfillmentStatus" AS ENUM ('pending', 'fulfilled', 'failed', 'cancelled');

CREATE TABLE "EventGiveaway" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "creatorUserId" TEXT NOT NULL,
  "organizerAttestedById" TEXT,
  "complianceReviewerId" TEXT,
  "suspendedByUserId" TEXT,
  "title" TEXT NOT NULL,
  "kind" "GiveawayKind" NOT NULL,
  "status" "GiveawayStatus" NOT NULL DEFAULT 'draft',
  "complianceStatus" "GiveawayComplianceStatus" NOT NULL DEFAULT 'draft',
  "entryMode" "GiveawayEntryMode" NOT NULL,
  "visibility" "GiveawayVisibility" NOT NULL DEFAULT 'hidden',
  "timeZone" TEXT NOT NULL,
  "entryOpensAt" TIMESTAMP(3),
  "entryClosesAt" TIMESTAMP(3),
  "drawAt" TIMESTAMP(3),
  "claimDeadlineAt" TIMESTAMP(3),
  "maxWinsPerRider" INTEGER NOT NULL DEFAULT 1,
  "maxWinsTotal" INTEGER NOT NULL DEFAULT 1,
  "organizerAttestedAt" TIMESTAMP(3),
  "complianceReviewedAt" TIMESTAMP(3),
  "complianceReviewReason" TEXT,
  "suspendedAt" TIMESTAMP(3),
  "suspensionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventGiveaway_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventGiveaway_maxWinsPerRider_positive" CHECK ("maxWinsPerRider" > 0),
  CONSTRAINT "EventGiveaway_maxWinsTotal_positive" CHECK ("maxWinsTotal" > 0),
  CONSTRAINT "EventGiveaway_lifecycle_dates_ordered" CHECK (
    ("entryOpensAt" IS NULL OR "entryClosesAt" IS NULL OR "entryOpensAt" < "entryClosesAt")
    AND ("entryClosesAt" IS NULL OR "drawAt" IS NULL OR "entryClosesAt" < "drawAt")
    AND ("drawAt" IS NULL OR "claimDeadlineAt" IS NULL OR "drawAt" < "claimDeadlineAt")
  )
);

CREATE TABLE "GiveawayMechanicsVersion" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "mechanics" TEXT NOT NULL,
  "terms" TEXT NOT NULL,
  "sponsorDisclosure" TEXT,
  "checksum" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "reviewDecision" "GiveawayComplianceStatus",
  "reviewReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayMechanicsVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayMechanicsVersion_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "GiveawayEligibilityGroup" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "entryWeight" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayEligibilityGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayEligibilityGroup_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "GiveawayEligibilityGroup_entryWeight_positive" CHECK ("entryWeight" > 0)
);

CREATE TABLE "GiveawayEligibilityCondition" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "source" "GiveawayEligibilitySource" NOT NULL,
  "perkId" TEXT,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayEligibilityCondition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayCampaignCode" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxUses" INTEGER NOT NULL,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayCampaignCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayCampaignCode_use_bounds" CHECK ("maxUses" > 0 AND "useCount" >= 0 AND "useCount" <= "maxUses")
);

CREATE TABLE "GiveawayEntry" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "status" "GiveawayEntryStatus" NOT NULL DEFAULT 'eligible',
  "currentWeight" INTEGER NOT NULL DEFAULT 1,
  "opaquePublicReference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayEntry_currentWeight_positive" CHECK ("currentWeight" > 0)
);

CREATE TABLE "GiveawayEntryEvent" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "type" "GiveawayEntryEventType" NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceSnapshot" JSONB,
  "weightDelta" INTEGER NOT NULL,
  "actorUserId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GiveawayEntryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawaySnapshot" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "mechanicsVersionId" TEXT NOT NULL,
  "configDigest" TEXT NOT NULL,
  "snapshotDigest" TEXT NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "seedCommitment" TEXT NOT NULL,
  "encryptedSeedCiphertext" TEXT NOT NULL,
  "encryptedSeedIv" TEXT NOT NULL,
  "encryptedSeedAuthTag" TEXT NOT NULL,
  "encryptionKeyVersion" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "lockedByUserId" TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seedRevealedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawaySnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawaySnapshot_candidateCount_nonnegative" CHECK ("candidateCount" >= 0)
);

CREATE TABLE "GiveawaySnapshotEntry" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "opaquePublicReference" TEXT NOT NULL,
  "frozenWeight" INTEGER NOT NULL,
  "rankSourceDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawaySnapshotEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawaySnapshotEntry_frozenWeight_positive" CHECK ("frozenWeight" > 0)
);

CREATE TABLE "GiveawayPrizePool" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "awardMode" "GiveawayAwardMode" NOT NULL,
  "fulfillmentType" "GiveawayFulfillmentType" NOT NULL,
  "inventoryLimit" INTEGER,
  "maxWinsPerRider" INTEGER NOT NULL DEFAULT 1,
  "presenceVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  "claimDeadlineAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayPrizePool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayPrizePool_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "GiveawayPrizePool_maxWinsPerRider_positive" CHECK ("maxWinsPerRider" > 0),
  CONSTRAINT "GiveawayPrizePool_inventory_matches_award_mode" CHECK (
    ("awardMode" = 'guaranteed' AND "inventoryLimit" IS NULL)
    OR ("awardMode" <> 'guaranteed' AND "inventoryLimit" IS NOT NULL AND "inventoryLimit" > 0)
  )
);

CREATE TABLE "GiveawayPrizeItem" (
  "id" TEXT NOT NULL,
  "prizePoolId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "GiveawayPrizeItemStatus" NOT NULL DEFAULT 'available',
  "digitalSecretCiphertext" TEXT,
  "digitalSecretIv" TEXT,
  "digitalSecretAuthTag" TEXT,
  "encryptionKeyVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayPrizeItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayPrizeItem_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "GiveawayPrizeItem_digital_secret_complete" CHECK (
    ("digitalSecretCiphertext" IS NULL AND "digitalSecretIv" IS NULL AND "digitalSecretAuthTag" IS NULL AND "encryptionKeyVersion" IS NULL)
    OR ("digitalSecretCiphertext" IS NOT NULL AND "digitalSecretIv" IS NOT NULL AND "digitalSecretAuthTag" IS NOT NULL AND "encryptionKeyVersion" IS NOT NULL)
  )
);

CREATE TABLE "GiveawayPrizePoolEligibilityGroup" (
  "id" TEXT NOT NULL,
  "prizePoolId" TEXT NOT NULL,
  "eligibilityGroupId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayPrizePoolEligibilityGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayDraw" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "GiveawayDrawType" NOT NULL,
  "status" "GiveawayDrawStatus" NOT NULL DEFAULT 'pending',
  "idempotencyKey" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "resultDigest" TEXT,
  "initiatedByUserId" TEXT NOT NULL,
  "reason" TEXT,
  "completedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayDraw_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayDraw_sequence_positive" CHECK ("sequence" > 0)
);

CREATE TABLE "GiveawayAward" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "drawId" TEXT NOT NULL,
  "prizePoolId" TEXT NOT NULL,
  "prizeItemId" TEXT,
  "snapshotEntryId" TEXT NOT NULL,
  "winnerUserId" TEXT NOT NULL,
  "status" "GiveawayAwardStatus" NOT NULL DEFAULT 'pending_verification',
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "rank" INTEGER NOT NULL,
  "opaqueClaimReference" TEXT NOT NULL,
  "claimTokenHash" TEXT,
  "claimDeadlineAt" TIMESTAMP(3),
  "reason" TEXT,
  "predecessorAwardId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayAward_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayAward_rank_positive" CHECK ("rank" > 0)
);

CREATE TABLE "GiveawayClaimVerification" (
  "id" TEXT NOT NULL,
  "awardId" TEXT NOT NULL,
  "method" "GiveawayClaimVerificationMethod" NOT NULL,
  "result" "GiveawayClaimVerificationResult" NOT NULL,
  "staffActorUserId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GiveawayClaimVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayFulfillment" (
  "id" TEXT NOT NULL,
  "awardId" TEXT NOT NULL,
  "type" "GiveawayFulfillmentType" NOT NULL,
  "status" "GiveawayFulfillmentStatus" NOT NULL DEFAULT 'pending',
  "staffActorUserId" TEXT NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayDeliveryDetail" (
  "id" TEXT NOT NULL,
  "awardId" TEXT NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "encryptedIv" TEXT NOT NULL,
  "encryptedAuthTag" TEXT NOT NULL,
  "encryptionKeyVersion" TEXT NOT NULL,
  "winnerConsentedAt" TIMESTAMP(3) NOT NULL,
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayDeliveryDetail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayDeliveryDetail_retention_after_consent" CHECK ("retentionExpiresAt" > "winnerConsentedAt")
);

CREATE TABLE "GiveawayOperator" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayOperator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayAuditEvent" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "canonicalPayload" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "previousHash" TEXT,
  "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GiveawayAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayAuditEvent_sequence_positive" CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "GiveawayMechanicsVersion_giveawayId_version_key"
  ON "GiveawayMechanicsVersion"("giveawayId", "version");
CREATE UNIQUE INDEX "GiveawayEligibilityGroup_giveawayId_position_key"
  ON "GiveawayEligibilityGroup"("giveawayId", "position");
CREATE UNIQUE INDEX "GiveawayCampaignCode_tokenHash_key"
  ON "GiveawayCampaignCode"("tokenHash");
CREATE UNIQUE INDEX "GiveawayEntry_giveawayId_riderId_key"
  ON "GiveawayEntry"("giveawayId", "riderId");
CREATE UNIQUE INDEX "GiveawayEntry_opaquePublicReference_key"
  ON "GiveawayEntry"("opaquePublicReference");
CREATE UNIQUE INDEX "GiveawayEntryEvent_giveawayId_idempotencyKey_key"
  ON "GiveawayEntryEvent"("giveawayId", "idempotencyKey");
CREATE UNIQUE INDEX "GiveawaySnapshot_giveawayId_key"
  ON "GiveawaySnapshot"("giveawayId");
CREATE UNIQUE INDEX "GiveawaySnapshotEntry_snapshotId_entryId_key"
  ON "GiveawaySnapshotEntry"("snapshotId", "entryId");
CREATE UNIQUE INDEX "GiveawayPrizePool_giveawayId_position_key"
  ON "GiveawayPrizePool"("giveawayId", "position");
CREATE UNIQUE INDEX "GiveawayPrizeItem_prizePoolId_position_key"
  ON "GiveawayPrizeItem"("prizePoolId", "position");
CREATE UNIQUE INDEX "GiveawayPrizePoolEligibilityGroup_prizePoolId_eligibilityGroupId_key"
  ON "GiveawayPrizePoolEligibilityGroup"("prizePoolId", "eligibilityGroupId");
CREATE UNIQUE INDEX "GiveawayDraw_giveawayId_sequence_key"
  ON "GiveawayDraw"("giveawayId", "sequence");
CREATE UNIQUE INDEX "GiveawayDraw_giveawayId_idempotencyKey_key"
  ON "GiveawayDraw"("giveawayId", "idempotencyKey");
CREATE UNIQUE INDEX "GiveawayAward_opaqueClaimReference_key"
  ON "GiveawayAward"("opaqueClaimReference");
CREATE UNIQUE INDEX "GiveawayAward_claimTokenHash_key"
  ON "GiveawayAward"("claimTokenHash");
CREATE UNIQUE INDEX "GiveawayDeliveryDetail_awardId_key"
  ON "GiveawayDeliveryDetail"("awardId");
CREATE UNIQUE INDEX "GiveawayOperator_giveawayId_userId_key"
  ON "GiveawayOperator"("giveawayId", "userId");
CREATE UNIQUE INDEX "GiveawayAuditEvent_giveawayId_sequence_key"
  ON "GiveawayAuditEvent"("giveawayId", "sequence");

CREATE UNIQUE INDEX "GiveawayAward_currentPrizeItem_key"
  ON "GiveawayAward" ("prizeItemId")
  WHERE "isCurrent" AND "prizeItemId" IS NOT NULL;

CREATE UNIQUE INDEX "GiveawayAward_currentPoolSnapshotEntry_key"
  ON "GiveawayAward" ("giveawayId", "prizePoolId", "snapshotEntryId")
  WHERE "isCurrent";

CREATE INDEX "EventGiveaway_eventId_status_idx" ON "EventGiveaway"("eventId", "status");
CREATE INDEX "EventGiveaway_complianceStatus_createdAt_idx" ON "EventGiveaway"("complianceStatus", "createdAt");
CREATE INDEX "EventGiveaway_status_entryOpensAt_idx" ON "EventGiveaway"("status", "entryOpensAt");
CREATE INDEX "EventGiveaway_status_entryClosesAt_idx" ON "EventGiveaway"("status", "entryClosesAt");
CREATE INDEX "EventGiveaway_status_drawAt_idx" ON "EventGiveaway"("status", "drawAt");
CREATE INDEX "EventGiveaway_status_claimDeadlineAt_idx" ON "EventGiveaway"("status", "claimDeadlineAt");
CREATE INDEX "EventGiveaway_creatorUserId_idx" ON "EventGiveaway"("creatorUserId");
CREATE INDEX "EventGiveaway_organizerAttestedById_idx" ON "EventGiveaway"("organizerAttestedById");
CREATE INDEX "EventGiveaway_complianceReviewerId_idx" ON "EventGiveaway"("complianceReviewerId");
CREATE INDEX "EventGiveaway_suspendedByUserId_idx" ON "EventGiveaway"("suspendedByUserId");
CREATE INDEX "GiveawayMechanicsVersion_createdByUserId_idx" ON "GiveawayMechanicsVersion"("createdByUserId");
CREATE INDEX "GiveawayMechanicsVersion_reviewedByUserId_idx" ON "GiveawayMechanicsVersion"("reviewedByUserId");
CREATE INDEX "GiveawayEligibilityCondition_groupId_idx" ON "GiveawayEligibilityCondition"("groupId");
CREATE INDEX "GiveawayEligibilityCondition_perkId_idx" ON "GiveawayEligibilityCondition"("perkId");
CREATE INDEX "GiveawayCampaignCode_giveawayId_expiresAt_idx" ON "GiveawayCampaignCode"("giveawayId", "expiresAt");
CREATE INDEX "GiveawayCampaignCode_revokedByUserId_idx" ON "GiveawayCampaignCode"("revokedByUserId");
CREATE INDEX "GiveawayEntry_giveawayId_status_idx" ON "GiveawayEntry"("giveawayId", "status");
CREATE INDEX "GiveawayEntry_riderId_idx" ON "GiveawayEntry"("riderId");
CREATE INDEX "GiveawayEntryEvent_entryId_idx" ON "GiveawayEntryEvent"("entryId");
CREATE INDEX "GiveawayEntryEvent_actorUserId_idx" ON "GiveawayEntryEvent"("actorUserId");
CREATE INDEX "GiveawayEntryEvent_giveawayId_createdAt_idx" ON "GiveawayEntryEvent"("giveawayId", "createdAt");
CREATE INDEX "GiveawaySnapshot_mechanicsVersionId_idx" ON "GiveawaySnapshot"("mechanicsVersionId");
CREATE INDEX "GiveawaySnapshot_lockedByUserId_idx" ON "GiveawaySnapshot"("lockedByUserId");
CREATE INDEX "GiveawaySnapshotEntry_entryId_idx" ON "GiveawaySnapshotEntry"("entryId");
CREATE INDEX "GiveawayPrizePool_giveawayId_awardMode_idx" ON "GiveawayPrizePool"("giveawayId", "awardMode");
CREATE INDEX "GiveawayPrizeItem_prizePoolId_status_idx" ON "GiveawayPrizeItem"("prizePoolId", "status");
CREATE INDEX "GiveawayPrizePoolEligibilityGroup_eligibilityGroupId_idx" ON "GiveawayPrizePoolEligibilityGroup"("eligibilityGroupId");
CREATE INDEX "GiveawayDraw_giveawayId_status_idx" ON "GiveawayDraw"("giveawayId", "status");
CREATE INDEX "GiveawayDraw_snapshotId_idx" ON "GiveawayDraw"("snapshotId");
CREATE INDEX "GiveawayDraw_initiatedByUserId_idx" ON "GiveawayDraw"("initiatedByUserId");
CREATE INDEX "GiveawayAward_giveawayId_status_idx" ON "GiveawayAward"("giveawayId", "status");
CREATE INDEX "GiveawayAward_drawId_idx" ON "GiveawayAward"("drawId");
CREATE INDEX "GiveawayAward_prizePoolId_idx" ON "GiveawayAward"("prizePoolId");
CREATE INDEX "GiveawayAward_prizeItemId_idx" ON "GiveawayAward"("prizeItemId");
CREATE INDEX "GiveawayAward_snapshotEntryId_idx" ON "GiveawayAward"("snapshotEntryId");
CREATE INDEX "GiveawayAward_winnerUserId_idx" ON "GiveawayAward"("winnerUserId");
CREATE INDEX "GiveawayAward_predecessorAwardId_idx" ON "GiveawayAward"("predecessorAwardId");
CREATE INDEX "GiveawayClaimVerification_awardId_createdAt_idx" ON "GiveawayClaimVerification"("awardId", "createdAt");
CREATE INDEX "GiveawayClaimVerification_staffActorUserId_idx" ON "GiveawayClaimVerification"("staffActorUserId");
CREATE INDEX "GiveawayFulfillment_awardId_status_idx" ON "GiveawayFulfillment"("awardId", "status");
CREATE INDEX "GiveawayFulfillment_staffActorUserId_idx" ON "GiveawayFulfillment"("staffActorUserId");
CREATE INDEX "GiveawayOperator_userId_idx" ON "GiveawayOperator"("userId");
CREATE INDEX "GiveawayOperator_grantedByUserId_idx" ON "GiveawayOperator"("grantedByUserId");
CREATE INDEX "GiveawayOperator_revokedByUserId_idx" ON "GiveawayOperator"("revokedByUserId");
CREATE INDEX "GiveawayAuditEvent_actorUserId_idx" ON "GiveawayAuditEvent"("actorUserId");
CREATE INDEX "GiveawayAuditEvent_giveawayId_createdAt_idx" ON "GiveawayAuditEvent"("giveawayId", "createdAt");

-- Future eligibility lookup indexes. These do not change existing data or semantics.
CREATE INDEX "Pass_eventId_userId_status_idx" ON "Pass"("eventId", "userId", "status");
CREATE INDEX "CheckIn_eventId_status_userId_idx" ON "CheckIn"("eventId", "status", "userId");
CREATE INDEX "Perk_eventId_idx" ON "Perk"("eventId");
CREATE INDEX "PerkRedemption_perkId_userId_status_idx" ON "PerkRedemption"("perkId", "userId", "status");

ALTER TABLE "EventGiveaway"
  ADD CONSTRAINT "EventGiveaway_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventGiveaway_creatorUserId_fkey"
  FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventGiveaway_organizerAttestedById_fkey"
  FOREIGN KEY ("organizerAttestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventGiveaway_complianceReviewerId_fkey"
  FOREIGN KEY ("complianceReviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventGiveaway_suspendedByUserId_fkey"
  FOREIGN KEY ("suspendedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayMechanicsVersion"
  ADD CONSTRAINT "GiveawayMechanicsVersion_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayMechanicsVersion_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayMechanicsVersion_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayEligibilityGroup"
  ADD CONSTRAINT "GiveawayEligibilityGroup_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayEligibilityCondition"
  ADD CONSTRAINT "GiveawayEligibilityCondition_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "GiveawayEligibilityGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayEligibilityCondition_perkId_fkey"
  FOREIGN KEY ("perkId") REFERENCES "Perk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayCampaignCode"
  ADD CONSTRAINT "GiveawayCampaignCode_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayCampaignCode_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayEntry"
  ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayEntry_riderId_fkey"
  FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayEntryEvent"
  ADD CONSTRAINT "GiveawayEntryEvent_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayEntryEvent_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "GiveawayEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayEntryEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawaySnapshot"
  ADD CONSTRAINT "GiveawaySnapshot_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawaySnapshot_mechanicsVersionId_fkey"
  FOREIGN KEY ("mechanicsVersionId") REFERENCES "GiveawayMechanicsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawaySnapshot_lockedByUserId_fkey"
  FOREIGN KEY ("lockedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawaySnapshotEntry"
  ADD CONSTRAINT "GiveawaySnapshotEntry_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "GiveawaySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawaySnapshotEntry_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "GiveawayEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayPrizePool"
  ADD CONSTRAINT "GiveawayPrizePool_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayPrizeItem"
  ADD CONSTRAINT "GiveawayPrizeItem_prizePoolId_fkey"
  FOREIGN KEY ("prizePoolId") REFERENCES "GiveawayPrizePool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayPrizePoolEligibilityGroup"
  ADD CONSTRAINT "GiveawayPrizePoolEligibilityGroup_prizePoolId_fkey"
  FOREIGN KEY ("prizePoolId") REFERENCES "GiveawayPrizePool"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayPrizePoolEligibilityGroup_eligibilityGroupId_fkey"
  FOREIGN KEY ("eligibilityGroupId") REFERENCES "GiveawayEligibilityGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayDraw"
  ADD CONSTRAINT "GiveawayDraw_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayDraw_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "GiveawaySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayDraw_initiatedByUserId_fkey"
  FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayAward"
  ADD CONSTRAINT "GiveawayAward_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayAward_drawId_fkey"
  FOREIGN KEY ("drawId") REFERENCES "GiveawayDraw"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayAward_prizePoolId_fkey"
  FOREIGN KEY ("prizePoolId") REFERENCES "GiveawayPrizePool"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayAward_prizeItemId_fkey"
  FOREIGN KEY ("prizeItemId") REFERENCES "GiveawayPrizeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayAward_snapshotEntryId_fkey"
  FOREIGN KEY ("snapshotEntryId") REFERENCES "GiveawaySnapshotEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayAward_winnerUserId_fkey"
  FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayAward_predecessorAwardId_fkey"
  FOREIGN KEY ("predecessorAwardId") REFERENCES "GiveawayAward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayClaimVerification"
  ADD CONSTRAINT "GiveawayClaimVerification_awardId_fkey"
  FOREIGN KEY ("awardId") REFERENCES "GiveawayAward"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayClaimVerification_staffActorUserId_fkey"
  FOREIGN KEY ("staffActorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayFulfillment"
  ADD CONSTRAINT "GiveawayFulfillment_awardId_fkey"
  FOREIGN KEY ("awardId") REFERENCES "GiveawayAward"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayFulfillment_staffActorUserId_fkey"
  FOREIGN KEY ("staffActorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayDeliveryDetail"
  ADD CONSTRAINT "GiveawayDeliveryDetail_awardId_fkey"
  FOREIGN KEY ("awardId") REFERENCES "GiveawayAward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayOperator"
  ADD CONSTRAINT "GiveawayOperator_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayOperator_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayOperator_grantedByUserId_fkey"
  FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayOperator_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayAuditEvent"
  ADD CONSTRAINT "GiveawayAuditEvent_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayAuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_giveaway_audit_event_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'GiveawayAuditEvent is append-only';
  END IF;

  IF current_setting('tambike.allow_giveaway_audit_purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'GiveawayAuditEvent deletes require the seed-only transaction-local purge setting';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "GiveawayAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_audit_event_mutation"();

-- PostgreSQL CHECK constraints cannot inspect a prize item's parent pool. Keep
-- the optional item for unlimited guaranteed awards only, and make finite
-- awards name an item from their own pool and giveaway.
CREATE FUNCTION "validate_giveaway_award_inventory"()
RETURNS TRIGGER AS $$
DECLARE
  pool_giveaway_id TEXT;
  pool_award_mode "GiveawayAwardMode";
  item_pool_id TEXT;
BEGIN
  SELECT "giveawayId", "awardMode"
    INTO pool_giveaway_id, pool_award_mode
  FROM "GiveawayPrizePool"
  WHERE "id" = NEW."prizePoolId";

  IF NOT FOUND OR pool_giveaway_id <> NEW."giveawayId" THEN
    RAISE EXCEPTION 'GiveawayAward prize pool must belong to the same giveaway';
  END IF;

  IF pool_award_mode = 'guaranteed' THEN
    IF NEW."prizeItemId" IS NOT NULL THEN
      SELECT "prizePoolId" INTO item_pool_id
      FROM "GiveawayPrizeItem"
      WHERE "id" = NEW."prizeItemId";

      IF NOT FOUND OR item_pool_id <> NEW."prizePoolId" THEN
        RAISE EXCEPTION 'GiveawayAward prize item must belong to the selected prize pool';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."prizeItemId" IS NULL THEN
    RAISE EXCEPTION 'Finite GiveawayAward rows require a prize item';
  END IF;

  SELECT "prizePoolId" INTO item_pool_id
  FROM "GiveawayPrizeItem"
  WHERE "id" = NEW."prizeItemId";

  IF NOT FOUND OR item_pool_id <> NEW."prizePoolId" THEN
    RAISE EXCEPTION 'GiveawayAward prize item must belong to the selected prize pool';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayAward_inventory_guard"
BEFORE INSERT OR UPDATE OF "giveawayId", "prizePoolId", "prizeItemId"
ON "GiveawayAward"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_award_inventory"();
