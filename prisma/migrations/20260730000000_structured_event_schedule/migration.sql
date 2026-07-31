CREATE TYPE "EventRecurrence" AS ENUM ('NONE', 'WEEKLY');

ALTER TABLE "Event"
ADD COLUMN "startsAt" TIMESTAMP(3),
ADD COLUMN "endsAt" TIMESTAMP(3),
ADD COLUMN "timeZone" VARCHAR(80),
ADD COLUMN "recurrence" "EventRecurrence",
ADD COLUMN "recurrenceEndsAt" TIMESTAMP(3);

CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");
