ALTER TABLE "post_templates"
  ADD COLUMN "firstCommentDelayMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "post_templates_firstCommentDelayMinutes_check" CHECK ("firstCommentDelayMinutes" >= 0);

ALTER TABLE "post_versions"
  ADD COLUMN "firstCommentDelayMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "post_versions_firstCommentDelayMinutes_check" CHECK ("firstCommentDelayMinutes" >= 0);
