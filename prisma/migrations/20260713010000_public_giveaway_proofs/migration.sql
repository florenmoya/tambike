-- Rider-controlled winner publication is deliberately separate from award
-- allocation/history. A revoked alias remains private in the award record so
-- the historical winner is never reassigned or deleted.
ALTER TABLE "GiveawayAward"
  ADD COLUMN "publicWinnerAlias" TEXT,
  ADD COLUMN "winnerAliasOptedInAt" TIMESTAMP(3),
  ADD COLUMN "winnerAliasRevokedAt" TIMESTAMP(3);

ALTER TABLE "GiveawayAward"
  ADD CONSTRAINT "GiveawayAward_public_winner_alias_pair"
  CHECK (("publicWinnerAlias" IS NULL) = ("winnerAliasOptedInAt" IS NULL)),
  ADD CONSTRAINT "GiveawayAward_public_winner_alias_revocation_requires_consent"
  CHECK ("winnerAliasRevokedAt" IS NULL OR "winnerAliasOptedInAt" IS NOT NULL),
  ADD CONSTRAINT "GiveawayAward_public_winner_alias_format"
  CHECK (
    "publicWinnerAlias" IS NULL
    OR "publicWinnerAlias" ~ '^[A-Za-z][A-Za-z0-9 ._-]{1,39}$'
  );

CREATE FUNCTION "validate_giveaway_award_public_winner_alias"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."publicWinnerAlias" IS NOT NULL
    AND (NEW."drawId" IS NULL OR NEW."snapshotEntryId" IS NULL) THEN
    RAISE EXCEPTION 'GiveawayAward public winner aliases require draw-backed frozen provenance';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayAward_public_winner_alias_guard"
BEFORE INSERT OR UPDATE OF "publicWinnerAlias", "winnerAliasOptedInAt", "winnerAliasRevokedAt"
ON "GiveawayAward"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_award_public_winner_alias"();
