-- One terminal draw award may produce one historical successor only. Do not
-- silently collapse duplicate history: a deployment must stop for an explicit
-- operator decision if a pre-release database already contains a fork.
DO $$
DECLARE
  duplicate_predecessor_award_id TEXT;
BEGIN
  SELECT "predecessorAwardId"
    INTO duplicate_predecessor_award_id
  FROM "GiveawayAward"
  WHERE "predecessorAwardId" IS NOT NULL
  GROUP BY "predecessorAwardId"
  HAVING COUNT(*) > 1
  ORDER BY "predecessorAwardId" ASC
  LIMIT 1;

  IF duplicate_predecessor_award_id IS NOT NULL THEN
    RAISE EXCEPTION 'GiveawayAward predecessor successor duplicate preflight failed for source %', duplicate_predecessor_award_id
      USING ERRCODE = '23505';
  END IF;
END
$$;

CREATE UNIQUE INDEX "GiveawayAward_predecessorAwardId_key"
  ON "GiveawayAward"("predecessorAwardId");

DROP INDEX "GiveawayAward_predecessorAwardId_idx";

-- The unique predecessor link prevents forks. This trigger also makes the
-- replacement lineage itself truthful even when a write bypasses application
-- validation: a successor reuses the exact prize item and frozen snapshot,
-- and it cannot mix manual selection with HMAC redraw semantics.
CREATE FUNCTION "validate_giveaway_award_predecessor_recovery"()
RETURNS TRIGGER AS $$
DECLARE
  predecessor_prize_item_id TEXT;
  predecessor_is_current BOOLEAN;
  predecessor_status TEXT;
  predecessor_snapshot_id TEXT;
  predecessor_algorithm_version TEXT;
  predecessor_draw_status TEXT;
  successor_snapshot_id TEXT;
  successor_algorithm_version TEXT;
  successor_draw_type TEXT;
  successor_draw_status TEXT;
BEGIN
  IF NEW."predecessorAwardId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT predecessor."prizeItemId", predecessor."isCurrent", predecessor."status"::TEXT,
         predecessor_draw."snapshotId", predecessor_draw."algorithmVersion", predecessor_draw."status"::TEXT
    INTO predecessor_prize_item_id, predecessor_is_current, predecessor_status,
         predecessor_snapshot_id, predecessor_algorithm_version, predecessor_draw_status
  FROM "GiveawayAward" AS predecessor
  LEFT JOIN "GiveawayDraw" AS predecessor_draw ON predecessor_draw."id" = predecessor."drawId"
  WHERE predecessor."id" = NEW."predecessorAwardId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GiveawayAward predecessor successor must reference an existing predecessor';
  END IF;

  SELECT "snapshotId", "algorithmVersion", "type"::TEXT, "status"::TEXT
    INTO successor_snapshot_id, successor_algorithm_version, successor_draw_type, successor_draw_status
  FROM "GiveawayDraw"
  WHERE "id" = NEW."drawId";

  IF NOT FOUND
    OR predecessor_is_current
    OR predecessor_prize_item_id IS NULL
    OR NEW."prizeItemId" IS NULL
    OR predecessor_prize_item_id IS DISTINCT FROM NEW."prizeItemId"
    OR predecessor_snapshot_id IS NULL
    OR predecessor_snapshot_id IS DISTINCT FROM successor_snapshot_id THEN
    RAISE EXCEPTION 'GiveawayAward predecessor successor must use the same prize item and frozen snapshot';
  END IF;

  IF predecessor_algorithm_version = 'hmac-sha256-v1' THEN
    IF predecessor_status <> 'superseded'
      OR successor_algorithm_version <> 'hmac-sha256-v1'
      OR successor_draw_type <> 'redraw'
      OR predecessor_draw_status NOT IN ('completed', 'published')
      OR successor_draw_status NOT IN ('completed', 'published') THEN
      RAISE EXCEPTION 'GiveawayAward HMAC predecessor must be superseded by one HMAC redraw';
    END IF;
  ELSIF predecessor_algorithm_version = 'manual-selection-v1' THEN
    IF predecessor_status NOT IN ('declined', 'voided', 'disqualified', 'expired')
      OR successor_algorithm_version <> 'manual-selection-v1'
      OR successor_draw_type <> 'redraw'
      OR predecessor_draw_status <> 'published'
      OR successor_draw_status <> 'published' THEN
      RAISE EXCEPTION 'GiveawayAward manual predecessor must be terminal before one manual replacement';
    END IF;
  ELSE
    RAISE EXCEPTION 'GiveawayAward predecessor must use an approved draw algorithm';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiveawayAward_predecessor_recovery_integrity"
BEFORE INSERT OR UPDATE OF "predecessorAwardId", "drawId", "prizeItemId", "isCurrent", "status"
ON "GiveawayAward"
FOR EACH ROW EXECUTE FUNCTION "validate_giveaway_award_predecessor_recovery"();
