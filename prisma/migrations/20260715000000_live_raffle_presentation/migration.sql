CREATE TYPE "GiveawayPresentationLabelKind" AS ENUM ('consented_name', 'masked');

ALTER TABLE "GiveawayEntry"
  ADD COLUMN "livePresentationOptedInAt" TIMESTAMP(3),
  ADD COLUMN "livePresentationRevokedAt" TIMESTAMP(3);

ALTER TABLE "GiveawaySnapshotEntry"
  ADD COLUMN "presentationLabel" TEXT,
  ADD COLUMN "presentationLabelKind" "GiveawayPresentationLabelKind";
