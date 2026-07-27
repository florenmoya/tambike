CREATE TYPE "GiveawayPrizeDisclosure" AS ENUM ('revealed', 'surprise');

ALTER TABLE "GiveawayPrizePool"
  ADD COLUMN "publicDisclosure" "GiveawayPrizeDisclosure" NOT NULL DEFAULT 'revealed',
  ADD COLUMN "publicTitle" TEXT,
  ADD COLUMN "publicDescription" TEXT;

UPDATE "GiveawayPrizePool" AS pool
SET "publicTitle" = COALESCE((SELECT item."title" FROM "GiveawayPrizeItem" AS item WHERE item."prizePoolId" = pool."id" ORDER BY item."position" ASC LIMIT 1), pool."title");

CREATE TABLE "GiveawayPrizeImage" (
  "id" TEXT NOT NULL,
  "prizePoolId" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GiveawayPrizeImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiveawayPrizeImage_prizePoolId_key" ON "GiveawayPrizeImage"("prizePoolId");
CREATE UNIQUE INDEX "GiveawayPrizeImage_mediaId_key" ON "GiveawayPrizeImage"("mediaId");
CREATE UNIQUE INDEX "GiveawayPrizeImage_storageKey_key" ON "GiveawayPrizeImage"("storageKey");
CREATE INDEX "GiveawayPrizeImage_uploadedByUserId_idx" ON "GiveawayPrizeImage"("uploadedByUserId");

ALTER TABLE "GiveawayPrizeImage"
  ADD CONSTRAINT "GiveawayPrizeImage_prizePoolId_fkey"
  FOREIGN KEY ("prizePoolId") REFERENCES "GiveawayPrizePool"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GiveawayPrizeImage_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "validate_giveaway_prize_pool_entrant_configuration"()
RETURNS TRIGGER AS $$
DECLARE
  target_giveaway_id TEXT;
BEGIN
  target_giveaway_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."giveawayId" ELSE NEW."giveawayId" END;
  IF TG_OP = 'UPDATE'
    AND NEW."position" IS NOT DISTINCT FROM OLD."position"
    AND NEW."title" IS NOT DISTINCT FROM OLD."title"
    AND NEW."description" IS NOT DISTINCT FROM OLD."description"
    AND NEW."publicDisclosure" IS NOT DISTINCT FROM OLD."publicDisclosure"
    AND NEW."publicTitle" IS NOT DISTINCT FROM OLD."publicTitle"
    AND NEW."publicDescription" IS NOT DISTINCT FROM OLD."publicDescription"
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

CREATE FUNCTION "validate_giveaway_prize_image_entrant_configuration"()
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
    RAISE EXCEPTION 'Giveaway prize image cannot change after entry history';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayPrizeImage_entrant_configuration_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "GiveawayPrizeImage"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_prize_image_entrant_configuration"();
