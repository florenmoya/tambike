-- Add the Event Giveaway aggregate without converting existing Perk records or mutating history.

CREATE TYPE "GiveawayKind" AS ENUM ('raffle', 'giveaway');
CREATE TYPE "GiveawayStatus" AS ENUM ('draft', 'scheduled', 'open', 'paused', 'locked', 'drawing', 'claims_open', 'completed', 'cancelled', 'suspended');
CREATE TYPE "GiveawayComplianceStatus" AS ENUM ('draft', 'pending_review', 'approved', 'changes_requested', 'rejected');
CREATE TYPE "GiveawayEntryMode" AS ENUM ('automatic', 'opt_in', 'claim_code', 'manual_only');
CREATE TYPE "GiveawayEntryPath" AS ENUM ('automatic', 'opt_in', 'campaign_code', 'manual');
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

-- RSVP records predate giveaways. Keep the actual transition timestamp when
-- available, and conservatively derive old going records from their pass or
-- RSVP creation time without fabricating a newer queue priority.
ALTER TABLE "RSVP" ADD COLUMN "goingAt" TIMESTAMP(3);
UPDATE "RSVP" AS rsvp
SET "goingAt" = GREATEST(pass."generatedAt", rsvp."createdAt", rsvp."updatedAt")
FROM "Pass" AS pass
WHERE rsvp."status" = 'going'
  AND rsvp."goingAt" IS NULL
  AND pass."rsvpId" = rsvp."id";
UPDATE "RSVP"
SET "goingAt" = GREATEST("createdAt", "updatedAt")
WHERE "status" = 'going'
  AND "goingAt" IS NULL;

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
  "maxEntriesPerRider" INTEGER NOT NULL,
  "presenceVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
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
  CONSTRAINT "EventGiveaway_maxEntriesPerRider_bounded" CHECK ("maxEntriesPerRider" >= 1 AND "maxEntriesPerRider" <= 10000),
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
  "createdByUserId" TEXT NOT NULL,
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
  "entryPath" "GiveawayEntryPath" NOT NULL,
  "currentWeight" INTEGER NOT NULL DEFAULT 1,
  "eligibilityCycleAt" TIMESTAMP(3) NOT NULL,
  "qualifiedSourceFingerprint" TEXT NOT NULL,
  "qualifiedEligibilityGroupIds" JSONB NOT NULL,
  "qualifiedEligibilityGroupTimings" JSONB NOT NULL,
  "manualGrantActive" BOOLEAN NOT NULL DEFAULT false,
  "acknowledgedMechanicsVersionId" TEXT,
  "acknowledgedMechanicsChecksum" TEXT,
  "acknowledgedMechanicsAt" TIMESTAMP(3),
  "opaquePublicReference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayEntry_currentWeight_positive" CHECK ("currentWeight" > 0),
  CONSTRAINT "GiveawayEntry_qualifiedEligibilityGroupIds_array" CHECK (jsonb_typeof("qualifiedEligibilityGroupIds") = 'array'),
  CONSTRAINT "GiveawayEntry_qualifiedEligibilityGroupTimings_array" CHECK (jsonb_typeof("qualifiedEligibilityGroupTimings") = 'array'),
  CONSTRAINT "GiveawayEntry_optIn_acknowledgement" CHECK (
    ("entryPath" = 'opt_in' AND "acknowledgedMechanicsVersionId" IS NOT NULL AND "acknowledgedMechanicsChecksum" IS NOT NULL AND "acknowledgedMechanicsAt" IS NOT NULL)
    OR ("entryPath" <> 'opt_in' AND "acknowledgedMechanicsVersionId" IS NULL AND "acknowledgedMechanicsChecksum" IS NULL AND "acknowledgedMechanicsAt" IS NULL)
  ),
  CONSTRAINT "GiveawayEntry_manual_grant_path" CHECK ("entryPath" = 'manual' OR "manualGrantActive" = false)
);

CREATE TABLE "GiveawayCampaignCodeClaim" (
  "id" TEXT NOT NULL,
  "campaignCodeId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GiveawayCampaignCodeClaim_pkey" PRIMARY KEY ("id")
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
  "eligibilityCycleAt" TIMESTAMP(3) NOT NULL,
  "qualifiedSourceFingerprint" TEXT NOT NULL,
  "qualifiedEligibilityGroupIds" JSONB NOT NULL,
  "qualifiedEligibilityGroupTimings" JSONB NOT NULL,
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
  "reasonDigest" TEXT,
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
  "entryId" TEXT NOT NULL,
  "drawId" TEXT,
  "prizePoolId" TEXT NOT NULL,
  "prizeItemId" TEXT,
  "snapshotEntryId" TEXT,
  "winnerUserId" TEXT NOT NULL,
  "status" "GiveawayAwardStatus" NOT NULL DEFAULT 'pending_verification',
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "rank" INTEGER,
  "directAllocationKey" TEXT,
  "allocationEligibilityAt" TIMESTAMP(3),
  "opaqueClaimReference" TEXT NOT NULL,
  "claimTokenHash" TEXT,
  "claimDeadlineAt" TIMESTAMP(3),
  "reasonDigest" TEXT,
  "predecessorAwardId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayAward_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GiveawayAward_provenance_paired" CHECK (("drawId" IS NULL) = ("snapshotEntryId" IS NULL)),
  CONSTRAINT "GiveawayAward_rank_matches_provenance" CHECK (("drawId" IS NULL AND "rank" IS NULL) OR ("drawId" IS NOT NULL AND "rank" IS NOT NULL AND "rank" > 0)),
  CONSTRAINT "GiveawayAward_directAllocation_provenance" CHECK (("drawId" IS NULL) = ("directAllocationKey" IS NOT NULL)),
  CONSTRAINT "GiveawayAward_directAllocation_timing" CHECK (("directAllocationKey" IS NULL) = ("allocationEligibilityAt" IS NULL))
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
CREATE UNIQUE INDEX "GiveawayCampaignCodeClaim_campaignCodeId_riderId_key"
  ON "GiveawayCampaignCodeClaim"("campaignCodeId", "riderId");
CREATE UNIQUE INDEX "GiveawayCampaignCodeClaim_campaignCodeId_idempotencyKey_key"
  ON "GiveawayCampaignCodeClaim"("campaignCodeId", "idempotencyKey");
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
CREATE UNIQUE INDEX "GiveawayAward_directAllocationKey_key"
  ON "GiveawayAward"("directAllocationKey");
CREATE UNIQUE INDEX "GiveawayDeliveryDetail_awardId_key"
  ON "GiveawayDeliveryDetail"("awardId");
CREATE UNIQUE INDEX "GiveawayOperator_giveawayId_userId_key"
  ON "GiveawayOperator"("giveawayId", "userId");
CREATE UNIQUE INDEX "GiveawayAuditEvent_giveawayId_sequence_key"
  ON "GiveawayAuditEvent"("giveawayId", "sequence");

CREATE UNIQUE INDEX "GiveawayAward_currentPrizeItem_key"
  ON "GiveawayAward" ("prizeItemId")
  WHERE "isCurrent" AND "prizeItemId" IS NOT NULL;

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
CREATE INDEX "GiveawayCampaignCode_createdByUserId_idx" ON "GiveawayCampaignCode"("createdByUserId");
CREATE INDEX "GiveawayCampaignCode_revokedByUserId_idx" ON "GiveawayCampaignCode"("revokedByUserId");
CREATE INDEX "GiveawayCampaignCodeClaim_riderId_idx" ON "GiveawayCampaignCodeClaim"("riderId");
CREATE INDEX "GiveawayCampaignCodeClaim_entryId_idx" ON "GiveawayCampaignCodeClaim"("entryId");
CREATE INDEX "GiveawayEntry_giveawayId_status_idx" ON "GiveawayEntry"("giveawayId", "status");
CREATE INDEX "GiveawayEntry_giveawayId_status_eligibilityCycleAt_id_idx"
  ON "GiveawayEntry"("giveawayId", "status", "eligibilityCycleAt", "id");
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
CREATE INDEX "GiveawayAward_entryId_idx" ON "GiveawayAward"("entryId");
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
  ADD CONSTRAINT "GiveawayCampaignCode_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayCampaignCode_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayEntry"
  ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "EventGiveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayEntry_riderId_fkey"
  FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayEntry_acknowledgedMechanicsVersionId_fkey"
  FOREIGN KEY ("acknowledgedMechanicsVersionId") REFERENCES "GiveawayMechanicsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiveawayCampaignCodeClaim"
  ADD CONSTRAINT "GiveawayCampaignCodeClaim_campaignCodeId_fkey"
  FOREIGN KEY ("campaignCodeId") REFERENCES "GiveawayCampaignCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayCampaignCodeClaim_riderId_fkey"
  FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayCampaignCodeClaim_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "GiveawayEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
  ADD CONSTRAINT "GiveawayAward_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "GiveawayEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
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
  RAISE EXCEPTION 'GiveawayAuditEvent is append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "GiveawayAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_audit_event_mutation"();

CREATE FUNCTION "prevent_giveaway_entry_event_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'GiveawayEntryEvent is append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayEntryEvent_append_only"
BEFORE UPDATE OR DELETE ON "GiveawayEntryEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_entry_event_mutation"();

CREATE FUNCTION "prevent_giveaway_campaign_code_claim_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'GiveawayCampaignCodeClaim is append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayCampaignCodeClaim_append_only"
BEFORE UPDATE OR DELETE ON "GiveawayCampaignCodeClaim"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_campaign_code_claim_mutation"();

CREATE FUNCTION "prevent_giveaway_snapshot_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'GiveawaySnapshot is immutable';
  END IF;

  IF OLD."seedRevealedAt" IS NOT NULL
    OR NEW."seedRevealedAt" IS NULL
    OR (to_jsonb(NEW) - 'seedRevealedAt' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'seedRevealedAt' - 'updatedAt') THEN
    RAISE EXCEPTION 'GiveawaySnapshot is immutable except for its initial seed revelation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawaySnapshot_immutable"
BEFORE UPDATE OR DELETE ON "GiveawaySnapshot"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_snapshot_mutation"();

CREATE FUNCTION "prevent_giveaway_snapshot_entry_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'GiveawaySnapshotEntry is immutable';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawaySnapshotEntry_immutable"
BEFORE UPDATE OR DELETE ON "GiveawaySnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_snapshot_entry_mutation"();

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
  WHERE "id" = NEW."prizePoolId" FOR UPDATE;

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

-- Finite prize allocation is item-backed. The pool check establishes whether
-- inventory is finite; these two guards make the item count authoritative.
CREATE FUNCTION "validate_giveaway_prize_item_inventory"()
RETURNS TRIGGER AS $$
DECLARE
  pool_award_mode "GiveawayAwardMode";
  pool_inventory_limit INTEGER;
  pool_item_count INTEGER;
BEGIN
  SELECT "awardMode", "inventoryLimit"
    INTO pool_award_mode, pool_inventory_limit
  FROM "GiveawayPrizePool"
  WHERE "id" = NEW."prizePoolId" FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GiveawayPrizeItem requires an existing prize pool';
  END IF;

  IF pool_award_mode = 'guaranteed' THEN
    RAISE EXCEPTION 'Unlimited guaranteed pools cannot contain prize items';
  END IF;

  IF pool_inventory_limit IS NULL OR pool_inventory_limit <= 0 THEN
    RAISE EXCEPTION 'Finite prize pools require a positive inventory limit';
  END IF;

  SELECT COUNT(*)
    INTO pool_item_count
  FROM "GiveawayPrizeItem"
  WHERE "prizePoolId" = NEW."prizePoolId"
    AND "id" <> NEW."id";

  IF pool_item_count >= pool_inventory_limit THEN
    RAISE EXCEPTION 'GiveawayPrizeItem exceeds its pool inventory limit';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayPrizeItem_inventory_guard"
BEFORE INSERT OR UPDATE OF "prizePoolId" ON "GiveawayPrizeItem"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_prize_item_inventory"();

CREATE FUNCTION "validate_giveaway_prize_pool_inventory"()
RETURNS TRIGGER AS $$
DECLARE
  pool_item_count INTEGER;
  pool_award_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO pool_item_count
  FROM "GiveawayPrizeItem"
  WHERE "prizePoolId" = NEW."id";

  SELECT COUNT(*)
    INTO pool_award_count
  FROM "GiveawayAward"
  WHERE "prizePoolId" = NEW."id";

  IF TG_OP = 'UPDATE'
    AND pool_award_count > 0
    AND (
      NEW."awardMode" IS DISTINCT FROM OLD."awardMode"
      OR NEW."inventoryLimit" IS DISTINCT FROM OLD."inventoryLimit"
      OR NEW."maxWinsPerRider" IS DISTINCT FROM OLD."maxWinsPerRider"
    ) THEN
    RAISE EXCEPTION 'GiveawayPrizePool award mode, inventory, and winner limit cannot change after awards exist';
  END IF;

  IF NEW."awardMode" = 'guaranteed' THEN
    IF pool_item_count > 0 THEN
      RAISE EXCEPTION 'Unlimited guaranteed pools cannot contain prize items';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."inventoryLimit" IS NULL OR NEW."inventoryLimit" <= 0 THEN
    RAISE EXCEPTION 'Finite prize pools require a positive inventory limit';
  END IF;

  IF pool_item_count > NEW."inventoryLimit" THEN
    RAISE EXCEPTION 'GiveawayPrizePool inventory limit cannot be below existing prize item count';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayPrizePool_inventory_guard"
BEFORE INSERT OR UPDATE OF "awardMode", "inventoryLimit", "maxWinsPerRider" ON "GiveawayPrizePool"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_prize_pool_inventory"();

CREATE FUNCTION "validate_event_giveaway_winner_limits"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."maxWinsPerRider" IS NOT DISTINCT FROM OLD."maxWinsPerRider"
    AND NEW."maxWinsTotal" IS NOT DISTINCT FROM OLD."maxWinsTotal" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GiveawayAward"
    WHERE "giveawayId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'EventGiveaway winner limits cannot change after awards exist';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EventGiveaway_winner_limits_guard"
BEFORE UPDATE OF "maxWinsPerRider", "maxWinsTotal" ON "EventGiveaway"
FOR EACH ROW EXECUTE FUNCTION "validate_event_giveaway_winner_limits"();

-- Once anyone has an entry or entry-ledger event, mechanics are a consent and
-- fairness record. Operations may still rename, reschedule, retime-zone, or
-- change visibility with a re-review, but cannot silently alter who can enter
-- or what an entrant agreed to.
CREATE FUNCTION "giveaway_has_entrant_history"(target_giveaway_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM "GiveawayEntry" WHERE "giveawayId" = target_giveaway_id
  ) OR EXISTS (
    SELECT 1 FROM "GiveawayEntryEvent" WHERE "giveawayId" = target_giveaway_id
  );
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_event_giveaway_entrant_configuration"()
RETURNS TRIGGER AS $$
BEGIN
  -- These operational fields intentionally remain mutable after entry
  -- history: NEW."title", NEW."visibility", NEW."timeZone", and schedule.
  IF NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."visibility" IS DISTINCT FROM OLD."visibility"
    OR NEW."timeZone" IS DISTINCT FROM OLD."timeZone"
    OR NEW."entryOpensAt" IS DISTINCT FROM OLD."entryOpensAt"
    OR NEW."entryClosesAt" IS DISTINCT FROM OLD."entryClosesAt"
    OR NEW."drawAt" IS DISTINCT FROM OLD."drawAt"
    OR NEW."claimDeadlineAt" IS DISTINCT FROM OLD."claimDeadlineAt" THEN
    NULL;
  END IF;

  IF giveaway_has_entrant_history(OLD."id")
    AND (
      NEW."kind" IS DISTINCT FROM OLD."kind"
      OR NEW."entryMode" IS DISTINCT FROM OLD."entryMode"
      OR NEW."maxEntriesPerRider" IS DISTINCT FROM OLD."maxEntriesPerRider"
      OR NEW."presenceVerificationRequired" IS DISTINCT FROM OLD."presenceVerificationRequired"
      OR NEW."maxWinsPerRider" IS DISTINCT FROM OLD."maxWinsPerRider"
      OR NEW."maxWinsTotal" IS DISTINCT FROM OLD."maxWinsTotal"
    ) THEN
    RAISE EXCEPTION 'EventGiveaway entrant-facing configuration cannot change after entry history';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EventGiveaway_entrant_configuration_guard"
BEFORE UPDATE ON "EventGiveaway"
FOR EACH ROW EXECUTE FUNCTION "validate_event_giveaway_entrant_configuration"();

CREATE FUNCTION "validate_giveaway_mechanics_entrant_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  target_giveaway_id TEXT;
BEGIN
  target_giveaway_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."giveawayId" ELSE NEW."giveawayId" END;
  IF TG_OP = 'UPDATE'
    AND NEW."giveawayId" IS NOT DISTINCT FROM OLD."giveawayId"
    AND NEW."version" IS NOT DISTINCT FROM OLD."version"
    AND NEW."mechanics" IS NOT DISTINCT FROM OLD."mechanics"
    AND NEW."terms" IS NOT DISTINCT FROM OLD."terms"
    AND NEW."sponsorDisclosure" IS NOT DISTINCT FROM OLD."sponsorDisclosure"
    AND NEW."checksum" IS NOT DISTINCT FROM OLD."checksum"
    AND NEW."createdByUserId" IS NOT DISTINCT FROM OLD."createdByUserId"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  IF giveaway_has_entrant_history(target_giveaway_id) THEN
    RAISE EXCEPTION 'Giveaway mechanics and terms cannot change after entry history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayMechanicsVersion_entrant_configuration_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "GiveawayMechanicsVersion"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_mechanics_entrant_configuration"();

CREATE FUNCTION "validate_giveaway_eligibility_group_entrant_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  target_giveaway_id TEXT;
BEGIN
  target_giveaway_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."giveawayId" ELSE NEW."giveawayId" END;
  IF TG_OP = 'UPDATE'
    AND NEW."position" IS NOT DISTINCT FROM OLD."position"
    AND NEW."label" IS NOT DISTINCT FROM OLD."label"
    AND NEW."entryWeight" IS NOT DISTINCT FROM OLD."entryWeight"
    AND NEW."enabled" IS NOT DISTINCT FROM OLD."enabled" THEN
    RETURN NEW;
  END IF;
  IF giveaway_has_entrant_history(target_giveaway_id) THEN
    RAISE EXCEPTION 'Giveaway eligibility groups cannot change after entry history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayEligibilityGroup_entrant_configuration_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "GiveawayEligibilityGroup"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_eligibility_group_entrant_configuration"();

CREATE FUNCTION "validate_giveaway_eligibility_condition_entrant_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  target_group_id TEXT;
  target_giveaway_id TEXT;
BEGIN
  target_group_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."groupId" ELSE NEW."groupId" END;
  SELECT "giveawayId" INTO target_giveaway_id
  FROM "GiveawayEligibilityGroup"
  WHERE "id" = target_group_id;
  IF target_giveaway_id IS NOT NULL AND giveaway_has_entrant_history(target_giveaway_id) THEN
    RAISE EXCEPTION 'Giveaway eligibility conditions cannot change after entry history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayEligibilityCondition_entrant_configuration_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "GiveawayEligibilityCondition"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_eligibility_condition_entrant_configuration"();

CREATE FUNCTION "validate_giveaway_prize_pool_entrant_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  target_giveaway_id TEXT;
BEGIN
  target_giveaway_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."giveawayId" ELSE NEW."giveawayId" END;
  IF TG_OP = 'UPDATE'
    AND NEW."position" IS NOT DISTINCT FROM OLD."position"
    AND NEW."title" IS NOT DISTINCT FROM OLD."title"
    AND NEW."description" IS NOT DISTINCT FROM OLD."description"
    AND NEW."awardMode" IS NOT DISTINCT FROM OLD."awardMode"
    AND NEW."fulfillmentType" IS NOT DISTINCT FROM OLD."fulfillmentType"
    AND NEW."inventoryLimit" IS NOT DISTINCT FROM OLD."inventoryLimit"
    AND NEW."maxWinsPerRider" IS NOT DISTINCT FROM OLD."maxWinsPerRider"
    AND NEW."presenceVerificationRequired" IS NOT DISTINCT FROM OLD."presenceVerificationRequired"
    AND NEW."claimDeadlineAt" IS NOT DISTINCT FROM OLD."claimDeadlineAt" THEN
    RETURN NEW;
  END IF;
  IF giveaway_has_entrant_history(target_giveaway_id) THEN
    RAISE EXCEPTION 'Giveaway prize pool configuration cannot change after entry history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayPrizePool_entrant_configuration_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "GiveawayPrizePool"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_prize_pool_entrant_configuration"();

CREATE FUNCTION "validate_giveaway_prize_item_entrant_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  target_pool_id TEXT;
  target_giveaway_id TEXT;
BEGIN
  target_pool_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."prizePoolId" ELSE NEW."prizePoolId" END;
  SELECT "giveawayId" INTO target_giveaway_id
  FROM "GiveawayPrizePool"
  WHERE "id" = target_pool_id;
  IF TG_OP = 'UPDATE'
    AND NEW."prizePoolId" IS NOT DISTINCT FROM OLD."prizePoolId"
    AND NEW."position" IS NOT DISTINCT FROM OLD."position"
    AND NEW."title" IS NOT DISTINCT FROM OLD."title"
    AND NEW."description" IS NOT DISTINCT FROM OLD."description"
    AND NEW."digitalSecretCiphertext" IS NOT DISTINCT FROM OLD."digitalSecretCiphertext"
    AND NEW."digitalSecretIv" IS NOT DISTINCT FROM OLD."digitalSecretIv"
    AND NEW."digitalSecretAuthTag" IS NOT DISTINCT FROM OLD."digitalSecretAuthTag"
    AND NEW."encryptionKeyVersion" IS NOT DISTINCT FROM OLD."encryptionKeyVersion" THEN
    RETURN NEW;
  END IF;
  IF target_giveaway_id IS NOT NULL AND giveaway_has_entrant_history(target_giveaway_id) THEN
    RAISE EXCEPTION 'Giveaway prize items cannot change after entry history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayPrizeItem_entrant_configuration_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "GiveawayPrizeItem"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_prize_item_entrant_configuration"();

CREATE FUNCTION "validate_giveaway_pool_eligibility_entrant_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  target_pool_id TEXT;
  target_giveaway_id TEXT;
BEGIN
  target_pool_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."prizePoolId" ELSE NEW."prizePoolId" END;
  SELECT "giveawayId" INTO target_giveaway_id
  FROM "GiveawayPrizePool"
  WHERE "id" = target_pool_id;
  IF target_giveaway_id IS NOT NULL AND giveaway_has_entrant_history(target_giveaway_id) THEN
    RAISE EXCEPTION 'Giveaway pool eligibility cannot change after entry history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayPrizePoolEligibilityGroup_entrant_configuration_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "GiveawayPrizePoolEligibilityGroup"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_pool_eligibility_entrant_configuration"();

-- The aggregate stores simple ids rather than duplicating campaign ids on all
-- children, so join-aware write guards preserve parentage without redundant
-- scope columns or undocumented composite foreign keys.
CREATE FUNCTION "validate_giveaway_draw_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_giveaway_id TEXT;
BEGIN
  SELECT "giveawayId"
    INTO snapshot_giveaway_id
  FROM "GiveawaySnapshot"
  WHERE "id" = NEW."snapshotId";

  IF NOT FOUND OR snapshot_giveaway_id <> NEW."giveawayId" THEN
    RAISE EXCEPTION 'GiveawayDraw snapshot must belong to the same giveaway';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayDraw_parentage_guard"
BEFORE INSERT OR UPDATE OF "giveawayId", "snapshotId" ON "GiveawayDraw"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_draw_parentage"();

CREATE FUNCTION "validate_giveaway_award_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  entry_giveaway_id TEXT;
  entry_rider_id TEXT;
  entry_status "GiveawayEntryStatus";
  entry_eligibility_cycle_at TIMESTAMP(3);
  entry_eligibility_group_timings JSONB;
  draw_giveaway_id TEXT;
  draw_snapshot_id TEXT;
  pool_giveaway_id TEXT;
  expected_allocation_eligibility_at TIMESTAMP(3);
  expected_direct_allocation_key TEXT;
  snapshot_entry_giveaway_id TEXT;
  snapshot_entry_snapshot_id TEXT;
  snapshot_entry_entry_id TEXT;
  snapshot_entry_rider_id TEXT;
  predecessor_giveaway_id TEXT;
  predecessor_pool_id TEXT;
BEGIN
  SELECT "giveawayId", "riderId", "status", "eligibilityCycleAt", "qualifiedEligibilityGroupTimings"
    INTO entry_giveaway_id, entry_rider_id, entry_status, entry_eligibility_cycle_at, entry_eligibility_group_timings
  FROM "GiveawayEntry"
  WHERE "id" = NEW."entryId";

  IF NOT FOUND
    OR entry_giveaway_id <> NEW."giveawayId"
    OR entry_rider_id <> NEW."winnerUserId" THEN
    RAISE EXCEPTION 'GiveawayAward entry must belong to the same giveaway rider';
  END IF;

  IF (NEW."drawId" IS NULL) <> (NEW."snapshotEntryId" IS NULL) THEN
    RAISE EXCEPTION 'GiveawayAward draw and snapshot entry provenance must be paired';
  END IF;

  IF NEW."drawId" IS NULL THEN
    IF NEW."rank" IS NOT NULL THEN
      RAISE EXCEPTION 'Entry-time GiveawayAward rows cannot have a draw rank';
    END IF;
    IF NEW."directAllocationKey" IS NULL OR NEW."allocationEligibilityAt" IS NULL THEN
      RAISE EXCEPTION 'Entry-time GiveawayAward rows require stable allocation provenance';
    END IF;
  ELSE
    IF NEW."rank" IS NULL OR NEW."rank" <= 0 THEN
      RAISE EXCEPTION 'Draw-backed GiveawayAward rows require a positive rank';
    END IF;
    IF NEW."directAllocationKey" IS NOT NULL OR NEW."allocationEligibilityAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Draw-backed GiveawayAward rows cannot claim entry-time allocation provenance';
    END IF;

    SELECT "giveawayId", "snapshotId"
      INTO draw_giveaway_id, draw_snapshot_id
    FROM "GiveawayDraw"
    WHERE "id" = NEW."drawId";

    IF NOT FOUND OR draw_giveaway_id <> NEW."giveawayId" THEN
      RAISE EXCEPTION 'GiveawayAward draw must belong to the same giveaway';
    END IF;
  END IF;

  SELECT "giveawayId"
    INTO pool_giveaway_id
  FROM "GiveawayPrizePool"
  WHERE "id" = NEW."prizePoolId";

  IF NOT FOUND OR pool_giveaway_id <> NEW."giveawayId" THEN
    RAISE EXCEPTION 'GiveawayAward prize pool must belong to the same giveaway';
  END IF;

  -- A direct (entry-time) award must be reproducibly bound to the exact
  -- priority that made this entry eligible for this pool. Do not trust a
  -- caller-provided timestamp/key: derive it from the entry's frozen
  -- eligibility-group timings and the pool's permitted groups.
  IF NEW."drawId" IS NULL THEN
    IF entry_status <> 'eligible' THEN
      RAISE EXCEPTION 'GiveawayAward direct allocations require an eligible entry';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "GiveawayPrizePoolEligibilityGroup"
      WHERE "prizePoolId" = NEW."prizePoolId"
    ) THEN
      SELECT MIN(((timing.value ->> 'eligibleAt')::timestamptz AT TIME ZONE 'UTC'))
        INTO expected_allocation_eligibility_at
      FROM jsonb_array_elements(entry_eligibility_group_timings) AS timing(value)
      JOIN "GiveawayPrizePoolEligibilityGroup" AS pool_group
        ON pool_group."prizePoolId" = NEW."prizePoolId"
        AND pool_group."eligibilityGroupId" = (timing.value ->> 'groupId');
    ELSE
      expected_allocation_eligibility_at := entry_eligibility_cycle_at;
    END IF;

    IF expected_allocation_eligibility_at IS NULL
      OR NEW."allocationEligibilityAt" IS DISTINCT FROM expected_allocation_eligibility_at THEN
      RAISE EXCEPTION 'GiveawayAward direct allocation provenance must match entry and pool priority';
    END IF;

    expected_direct_allocation_key := format('direct:%s:%s:%s',
      NEW."entryId",
      NEW."prizePoolId",
      to_char(expected_allocation_eligibility_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    IF NEW."directAllocationKey" IS DISTINCT FROM expected_direct_allocation_key THEN
      RAISE EXCEPTION 'GiveawayAward direct allocation provenance must match entry and pool priority';
    END IF;
  END IF;

  IF NEW."snapshotEntryId" IS NOT NULL THEN
    SELECT snapshot."giveawayId", snapshot_entry."snapshotId", snapshot_entry."entryId", entry."riderId"
      INTO snapshot_entry_giveaway_id, snapshot_entry_snapshot_id, snapshot_entry_entry_id, snapshot_entry_rider_id
    FROM "GiveawaySnapshotEntry" AS snapshot_entry
    JOIN "GiveawaySnapshot" AS snapshot ON snapshot."id" = snapshot_entry."snapshotId"
    JOIN "GiveawayEntry" AS entry ON entry."id" = snapshot_entry."entryId"
    WHERE snapshot_entry."id" = NEW."snapshotEntryId";

    IF NOT FOUND
      OR snapshot_entry_giveaway_id <> NEW."giveawayId"
      OR draw_snapshot_id <> snapshot_entry_snapshot_id
      OR snapshot_entry_entry_id <> NEW."entryId"
      OR snapshot_entry_rider_id <> NEW."winnerUserId" THEN
      RAISE EXCEPTION 'GiveawayAward draw and snapshot entry must refer to the same frozen snapshot';
    END IF;
  END IF;

  IF NEW."predecessorAwardId" IS NOT NULL THEN
    SELECT "giveawayId", "prizePoolId"
      INTO predecessor_giveaway_id, predecessor_pool_id
    FROM "GiveawayAward"
    WHERE "id" = NEW."predecessorAwardId";

    IF NOT FOUND
      OR predecessor_giveaway_id <> NEW."giveawayId"
      OR predecessor_pool_id <> NEW."prizePoolId" THEN
      RAISE EXCEPTION 'GiveawayAward predecessor must belong to the same giveaway and prize pool';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayAward_parentage_guard"
BEFORE INSERT OR UPDATE OF "giveawayId", "entryId", "drawId", "prizePoolId", "snapshotEntryId", "winnerUserId", "rank", "directAllocationKey", "allocationEligibilityAt", "predecessorAwardId"
ON "GiveawayAward"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_award_parentage"();

CREATE FUNCTION "validate_giveaway_prize_pool_eligibility_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  pool_giveaway_id TEXT;
  group_giveaway_id TEXT;
BEGIN
  SELECT "giveawayId"
    INTO pool_giveaway_id
  FROM "GiveawayPrizePool"
  WHERE "id" = NEW."prizePoolId";

  SELECT "giveawayId"
    INTO group_giveaway_id
  FROM "GiveawayEligibilityGroup"
  WHERE "id" = NEW."eligibilityGroupId";

  IF pool_giveaway_id IS NULL
    OR group_giveaway_id IS NULL
    OR pool_giveaway_id <> group_giveaway_id THEN
    RAISE EXCEPTION 'GiveawayPrizePoolEligibilityGroup members must belong to the same giveaway';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayPrizePoolEligibilityGroup_parentage_guard"
BEFORE INSERT OR UPDATE OF "prizePoolId", "eligibilityGroupId"
ON "GiveawayPrizePoolEligibilityGroup"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_prize_pool_eligibility_parentage"();

CREATE FUNCTION "validate_giveaway_entry_event_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  entry_giveaway_id TEXT;
BEGIN
  SELECT "giveawayId"
    INTO entry_giveaway_id
  FROM "GiveawayEntry"
  WHERE "id" = NEW."entryId";

  IF NOT FOUND OR entry_giveaway_id <> NEW."giveawayId" THEN
    RAISE EXCEPTION 'GiveawayEntryEvent entry must belong to the same giveaway';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayEntryEvent_parentage_guard"
BEFORE INSERT OR UPDATE OF "giveawayId", "entryId" ON "GiveawayEntryEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_entry_event_parentage"();

CREATE FUNCTION "validate_giveaway_entry_provenance"()
RETURNS TRIGGER AS $$
DECLARE
  mechanics_giveaway_id TEXT;
  earliest_eligibility_at TIMESTAMP(3);
  qualified_group_count INTEGER;
  distinct_qualified_group_count INTEGER;
  timing_count INTEGER;
  distinct_timing_group_count INTEGER;
BEGIN
  IF NEW."acknowledgedMechanicsVersionId" IS NOT NULL THEN
    SELECT "giveawayId"
      INTO mechanics_giveaway_id
    FROM "GiveawayMechanicsVersion"
    WHERE "id" = NEW."acknowledgedMechanicsVersionId";

    IF NOT FOUND OR mechanics_giveaway_id <> NEW."giveawayId" THEN
      RAISE EXCEPTION 'GiveawayEntry acknowledgement must belong to the same giveaway';
    END IF;
  END IF;

  IF jsonb_typeof(NEW."qualifiedEligibilityGroupIds") <> 'array' THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility groups must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupIds") AS group_value(value)
    WHERE jsonb_typeof(group_value.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility groups must contain only ids';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW."qualifiedEligibilityGroupIds") AS qualified_group_id(value)
    LEFT JOIN "GiveawayEligibilityGroup" AS eligibility_group
      ON eligibility_group."id" = qualified_group_id.value
    WHERE eligibility_group."id" IS NULL
      OR eligibility_group."giveawayId" <> NEW."giveawayId"
  ) THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility groups must belong to the same giveaway';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT qualified_group_id.value)
    INTO qualified_group_count, distinct_qualified_group_count
  FROM jsonb_array_elements_text(NEW."qualifiedEligibilityGroupIds") AS qualified_group_id(value);
  IF qualified_group_count <> distinct_qualified_group_count THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility groups must not contain duplicates';
  END IF;

  IF COALESCE((
    SELECT jsonb_agg(eligibility_group."id" ORDER BY eligibility_group."position", eligibility_group."id")
    FROM jsonb_array_elements_text(NEW."qualifiedEligibilityGroupIds") AS qualified_group_id(value)
    JOIN "GiveawayEligibilityGroup" AS eligibility_group
      ON eligibility_group."id" = qualified_group_id.value
      AND eligibility_group."giveawayId" = NEW."giveawayId"
  ), '[]'::jsonb) IS DISTINCT FROM NEW."qualifiedEligibilityGroupIds" THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility groups must use canonical group order';
  END IF;

  IF jsonb_typeof(NEW."qualifiedEligibilityGroupTimings") <> 'array' THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility timings must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value)
    WHERE jsonb_typeof(timing.value) <> 'object'
      OR jsonb_typeof(timing.value -> 'groupId') <> 'string'
      OR jsonb_typeof(timing.value -> 'eligibleAt') <> 'string'
      OR (SELECT COUNT(*) FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(timing.value) = 'object' THEN timing.value ELSE '{}'::jsonb END
      )) <> 2
  ) THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility timings must contain group ids and timestamps';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT (timing.value ->> 'groupId'))
    INTO timing_count, distinct_timing_group_count
  FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value);
  IF timing_count <> distinct_timing_group_count THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility timings must not contain duplicate groups';
  END IF;

  IF COALESCE((
    SELECT jsonb_agg(timing.value ->> 'groupId' ORDER BY timing.ordinality)
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") WITH ORDINALITY AS timing(value, ordinality)
  ), '[]'::jsonb) IS DISTINCT FROM NEW."qualifiedEligibilityGroupIds" THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility timing groups must exactly match qualified groups';
  END IF;

  BEGIN
    SELECT MIN(((timing.value ->> 'eligibleAt')::timestamptz AT TIME ZONE 'UTC'))
      INTO earliest_eligibility_at
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value);
  EXCEPTION
    WHEN SQLSTATE '22007' OR SQLSTATE '22008' THEN
      RAISE EXCEPTION 'GiveawayEntry qualified eligibility timing timestamps must be valid UTC instants';
  END;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value)
    WHERE to_char(
      ((timing.value ->> 'eligibleAt')::timestamptz AT TIME ZONE 'UTC'),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) <> (timing.value ->> 'eligibleAt')
  ) THEN
    RAISE EXCEPTION 'GiveawayEntry qualified eligibility timing timestamps must be canonical UTC instants';
  END IF;

  IF NEW."status" IN ('eligible', 'locked')
    AND (qualified_group_count = 0 OR timing_count = 0) THEN
    RAISE EXCEPTION 'Eligible GiveawayEntry rows require active eligibility timings';
  END IF;
  IF NEW."status" = 'withdrawn'
    AND (qualified_group_count <> 0 OR timing_count <> 0) THEN
    RAISE EXCEPTION 'Withdrawn GiveawayEntry rows must clear active eligibility timings';
  END IF;
  IF timing_count > 0
    AND NEW."eligibilityCycleAt" IS DISTINCT FROM earliest_eligibility_at THEN
    RAISE EXCEPTION 'GiveawayEntry eligibility cycle must equal its earliest active eligibility timing';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayEntry_provenance_guard"
BEFORE INSERT OR UPDATE OF "giveawayId", "status", "qualifiedEligibilityGroupIds", "qualifiedEligibilityGroupTimings", "eligibilityCycleAt", "acknowledgedMechanicsVersionId"
ON "GiveawayEntry"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_entry_provenance"();

CREATE FUNCTION "validate_giveaway_campaign_code_claim_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  code_giveaway_id TEXT;
  entry_giveaway_id TEXT;
  entry_rider_id TEXT;
BEGIN
  SELECT "giveawayId"
    INTO code_giveaway_id
  FROM "GiveawayCampaignCode"
  WHERE "id" = NEW."campaignCodeId";

  SELECT "giveawayId", "riderId"
    INTO entry_giveaway_id, entry_rider_id
  FROM "GiveawayEntry"
  WHERE "id" = NEW."entryId";

  IF code_giveaway_id IS NULL
    OR entry_giveaway_id IS NULL
    OR code_giveaway_id <> entry_giveaway_id
    OR entry_rider_id <> NEW."riderId" THEN
    RAISE EXCEPTION 'GiveawayCampaignCodeClaim code, entry, and rider must share the same giveaway';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayCampaignCodeClaim_parentage_guard"
BEFORE INSERT OR UPDATE OF "campaignCodeId", "riderId", "entryId"
ON "GiveawayCampaignCodeClaim"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_campaign_code_claim_parentage"();

CREATE FUNCTION "validate_giveaway_snapshot_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  mechanics_giveaway_id TEXT;
BEGIN
  SELECT "giveawayId"
    INTO mechanics_giveaway_id
  FROM "GiveawayMechanicsVersion"
  WHERE "id" = NEW."mechanicsVersionId";

  IF NOT FOUND OR mechanics_giveaway_id <> NEW."giveawayId" THEN
    RAISE EXCEPTION 'GiveawaySnapshot mechanics version must belong to the same giveaway';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawaySnapshot_parentage_guard"
BEFORE INSERT OR UPDATE OF "giveawayId", "mechanicsVersionId" ON "GiveawaySnapshot"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_snapshot_parentage"();

CREATE FUNCTION "validate_giveaway_snapshot_entry_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_giveaway_id TEXT;
  entry_giveaway_id TEXT;
  entry_eligibility_cycle_at TIMESTAMP(3);
  entry_eligibility_group_ids JSONB;
  entry_eligibility_group_timings JSONB;
  entry_current_weight INTEGER;
  entry_opaque_public_reference TEXT;
  entry_qualified_source_fingerprint TEXT;
  earliest_eligibility_at TIMESTAMP(3);
  qualified_group_count INTEGER;
  distinct_qualified_group_count INTEGER;
  timing_count INTEGER;
  distinct_timing_group_count INTEGER;
BEGIN
  SELECT "giveawayId"
    INTO snapshot_giveaway_id
  FROM "GiveawaySnapshot"
  WHERE "id" = NEW."snapshotId";

  SELECT "giveawayId", "eligibilityCycleAt", "qualifiedEligibilityGroupIds", "qualifiedEligibilityGroupTimings",
         "currentWeight", "opaquePublicReference", "qualifiedSourceFingerprint"
    INTO entry_giveaway_id, entry_eligibility_cycle_at, entry_eligibility_group_ids, entry_eligibility_group_timings,
         entry_current_weight, entry_opaque_public_reference, entry_qualified_source_fingerprint
  FROM "GiveawayEntry"
  WHERE "id" = NEW."entryId";

  IF snapshot_giveaway_id IS NULL
    OR entry_giveaway_id IS NULL
    OR snapshot_giveaway_id <> entry_giveaway_id THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry snapshot and entry must belong to the same giveaway';
  END IF;

  IF NEW."eligibilityCycleAt" IS DISTINCT FROM entry_eligibility_cycle_at
    OR NEW."qualifiedEligibilityGroupIds" IS DISTINCT FROM entry_eligibility_group_ids
    OR NEW."qualifiedEligibilityGroupTimings" IS DISTINCT FROM entry_eligibility_group_timings THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry eligibility facts must match its source entry at lock';
  END IF;

  IF NEW."frozenWeight" IS DISTINCT FROM entry_current_weight
    OR NEW."opaquePublicReference" IS DISTINCT FROM entry_opaque_public_reference
    OR NEW."qualifiedSourceFingerprint" IS DISTINCT FROM entry_qualified_source_fingerprint THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry frozen ranking facts must match its source entry at lock';
  END IF;

  IF jsonb_typeof(NEW."qualifiedEligibilityGroupIds") <> 'array'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupIds") AS group_value(value)
      WHERE jsonb_typeof(group_value.value) <> 'string'
    ) THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility groups must be a JSON array of ids';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW."qualifiedEligibilityGroupIds") AS qualified_group_id(value)
    LEFT JOIN "GiveawayEligibilityGroup" AS eligibility_group
      ON eligibility_group."id" = qualified_group_id.value
    WHERE eligibility_group."id" IS NULL
      OR eligibility_group."giveawayId" <> snapshot_giveaway_id
  ) THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility groups must belong to the same giveaway';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT qualified_group_id.value)
    INTO qualified_group_count, distinct_qualified_group_count
  FROM jsonb_array_elements_text(NEW."qualifiedEligibilityGroupIds") AS qualified_group_id(value);
  IF qualified_group_count <> distinct_qualified_group_count THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility groups must not contain duplicates';
  END IF;

  IF COALESCE((
    SELECT jsonb_agg(eligibility_group."id" ORDER BY eligibility_group."position", eligibility_group."id")
    FROM jsonb_array_elements_text(NEW."qualifiedEligibilityGroupIds") AS qualified_group_id(value)
    JOIN "GiveawayEligibilityGroup" AS eligibility_group
      ON eligibility_group."id" = qualified_group_id.value
      AND eligibility_group."giveawayId" = snapshot_giveaway_id
  ), '[]'::jsonb) IS DISTINCT FROM NEW."qualifiedEligibilityGroupIds" THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility groups must use canonical group order';
  END IF;

  IF jsonb_typeof(NEW."qualifiedEligibilityGroupTimings") <> 'array'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value)
      WHERE jsonb_typeof(timing.value) <> 'object'
        OR jsonb_typeof(timing.value -> 'groupId') <> 'string'
        OR jsonb_typeof(timing.value -> 'eligibleAt') <> 'string'
        OR (SELECT COUNT(*) FROM jsonb_object_keys(
          CASE WHEN jsonb_typeof(timing.value) = 'object' THEN timing.value ELSE '{}'::jsonb END
        )) <> 2
    ) THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility timings must contain group ids and timestamps';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT (timing.value ->> 'groupId'))
    INTO timing_count, distinct_timing_group_count
  FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value);
  IF timing_count <> distinct_timing_group_count THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility timings must not contain duplicate groups';
  END IF;

  IF COALESCE((
    SELECT jsonb_agg(timing.value ->> 'groupId' ORDER BY timing.ordinality)
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") WITH ORDINALITY AS timing(value, ordinality)
  ), '[]'::jsonb) IS DISTINCT FROM NEW."qualifiedEligibilityGroupIds" THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility timing groups must exactly match qualified groups';
  END IF;

  BEGIN
    SELECT MIN(((timing.value ->> 'eligibleAt')::timestamptz AT TIME ZONE 'UTC'))
      INTO earliest_eligibility_at
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value);
  EXCEPTION
    WHEN SQLSTATE '22007' OR SQLSTATE '22008' THEN
      RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility timing timestamps must be valid UTC instants';
  END;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."qualifiedEligibilityGroupTimings") AS timing(value)
    WHERE to_char(
      ((timing.value ->> 'eligibleAt')::timestamptz AT TIME ZONE 'UTC'),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) <> (timing.value ->> 'eligibleAt')
  ) THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry qualified eligibility timing timestamps must be canonical UTC instants';
  END IF;

  IF qualified_group_count = 0 OR timing_count = 0 THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry requires active eligibility timings';
  END IF;
  IF NEW."eligibilityCycleAt" IS DISTINCT FROM earliest_eligibility_at THEN
    RAISE EXCEPTION 'GiveawaySnapshotEntry eligibility cycle must equal its earliest active eligibility timing';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawaySnapshotEntry_parentage_guard"
BEFORE INSERT OR UPDATE OF "snapshotId", "entryId", "opaquePublicReference", "frozenWeight", "qualifiedSourceFingerprint", "eligibilityCycleAt", "qualifiedEligibilityGroupIds", "qualifiedEligibilityGroupTimings" ON "GiveawaySnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_snapshot_entry_parentage"();

CREATE FUNCTION "validate_giveaway_eligibility_condition_parentage"()
RETURNS TRIGGER AS $$
DECLARE
  condition_event_id TEXT;
  perk_event_id TEXT;
BEGIN
  IF NEW."perkId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT giveaway."eventId"
    INTO condition_event_id
  FROM "GiveawayEligibilityGroup" AS eligibility_group
  JOIN "EventGiveaway" AS giveaway ON giveaway."id" = eligibility_group."giveawayId"
  WHERE eligibility_group."id" = NEW."groupId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GiveawayEligibilityCondition requires an existing eligibility group';
  END IF;

  SELECT "eventId"
    INTO perk_event_id
  FROM "Perk"
  WHERE "id" = NEW."perkId";

  IF NOT FOUND OR perk_event_id <> condition_event_id THEN
    RAISE EXCEPTION 'GiveawayEligibilityCondition perk must belong to the giveaway event';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayEligibilityCondition_parentage_guard"
BEFORE INSERT OR UPDATE OF "groupId", "perkId" ON "GiveawayEligibilityCondition"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_eligibility_condition_parentage"();

-- Child-side parentage guards cannot observe a later update to an owning
-- scope. Campaign ownership and frozen snapshot links are immutable once set.
CREATE FUNCTION "prevent_giveaway_scope_reparenting"()
RETURNS TRIGGER AS $$
DECLARE
  field_name TEXT;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) ->> field_name) IS DISTINCT FROM (to_jsonb(OLD) ->> field_name) THEN
      RAISE EXCEPTION '% scope field is immutable once created', TG_TABLE_NAME || '.' || field_name;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EventGiveaway_scope_immutable"
BEFORE UPDATE OF "eventId" ON "EventGiveaway"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('eventId');

CREATE TRIGGER "GiveawayMechanicsVersion_scope_immutable"
BEFORE UPDATE OF "giveawayId" ON "GiveawayMechanicsVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('giveawayId');

CREATE TRIGGER "GiveawayEligibilityGroup_scope_immutable"
BEFORE UPDATE OF "giveawayId" ON "GiveawayEligibilityGroup"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('giveawayId');

CREATE TRIGGER "GiveawayEntry_scope_immutable"
BEFORE UPDATE OF "giveawayId" ON "GiveawayEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('giveawayId');

CREATE TRIGGER "GiveawayCampaignCodeClaim_scope_immutable"
BEFORE UPDATE OF "campaignCodeId", "riderId", "entryId" ON "GiveawayCampaignCodeClaim"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('campaignCodeId', 'riderId', 'entryId');

CREATE TRIGGER "GiveawaySnapshot_scope_immutable"
BEFORE UPDATE OF "giveawayId", "mechanicsVersionId" ON "GiveawaySnapshot"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('giveawayId', 'mechanicsVersionId');

CREATE TRIGGER "GiveawaySnapshotEntry_scope_immutable"
BEFORE UPDATE OF "snapshotId", "entryId" ON "GiveawaySnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('snapshotId', 'entryId');

CREATE TRIGGER "GiveawayPrizePool_scope_immutable"
BEFORE UPDATE OF "giveawayId" ON "GiveawayPrizePool"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('giveawayId');

CREATE TRIGGER "GiveawayPrizeItem_scope_immutable"
BEFORE UPDATE OF "prizePoolId" ON "GiveawayPrizeItem"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('prizePoolId');

CREATE TRIGGER "GiveawayDraw_scope_immutable"
BEFORE UPDATE OF "giveawayId", "snapshotId" ON "GiveawayDraw"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('giveawayId', 'snapshotId');

CREATE TRIGGER "GiveawayAward_scope_immutable"
BEFORE UPDATE OF "giveawayId", "entryId", "drawId", "prizePoolId", "prizeItemId", "snapshotEntryId", "winnerUserId", "rank", "directAllocationKey", "allocationEligibilityAt", "predecessorAwardId"
ON "GiveawayAward"
FOR EACH ROW EXECUTE FUNCTION "prevent_giveaway_scope_reparenting"('giveawayId', 'entryId', 'drawId', 'prizePoolId', 'prizeItemId', 'snapshotEntryId', 'winnerUserId', 'rank', 'directAllocationKey', 'allocationEligibilityAt', 'predecessorAwardId');

CREATE FUNCTION "validate_giveaway_perk_event_parentage"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."eventId" IS NOT DISTINCT FROM OLD."eventId" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GiveawayEligibilityCondition" AS condition
    JOIN "GiveawayEligibilityGroup" AS eligibility_group ON eligibility_group."id" = condition."groupId"
    JOIN "EventGiveaway" AS giveaway ON giveaway."id" = eligibility_group."giveawayId"
    WHERE condition."perkId" = OLD."id"
      AND giveaway."eventId" IS DISTINCT FROM NEW."eventId"
  ) THEN
    RAISE EXCEPTION 'Perk event cannot change while a giveaway eligibility condition references it';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Perk_giveaway_event_parentage_guard"
BEFORE UPDATE OF "eventId" ON "Perk"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_perk_event_parentage"();
