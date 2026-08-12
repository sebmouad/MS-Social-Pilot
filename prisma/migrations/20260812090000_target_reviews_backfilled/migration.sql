-- One ratings fetch reaches five hundred reviews. A Page with more is read
-- over several syncs, each ending where the last one started, and its average
-- rating is computed from a partial set until the walk reaches the beginning.
-- This records that it has.
ALTER TABLE "targets" ADD COLUMN "reviewsBackfilled" BOOLEAN NOT NULL DEFAULT false;
