-- Scheduling place per destination (post target): 'application' (our worker publishes at the time)
-- or 'remote' (the destination's platform holds the post). Additive and nullable: NULL means the
-- destination follows the post-level choice stored in posts."publishMode" (legacy and existing rows).
ALTER TABLE "post_targets" ADD COLUMN "scheduleMode" TEXT;
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_scheduleMode_check"
  CHECK ("scheduleMode" IS NULL OR "scheduleMode" IN ('application', 'remote'));
