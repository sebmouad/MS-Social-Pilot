-- Additive; existing legacy labels remain untrusted until classified with provenance.
ALTER TABLE post_comments
  ADD COLUMN "sentimentAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "sentimentProvenance" JSONB;

-- A provider edit invalidates the old classification atomically, including legacy writes.
CREATE FUNCTION rebuild_invalidate_comment_sentiment() RETURNS trigger AS $$
BEGIN
  IF NEW.message IS DISTINCT FROM OLD.message THEN
    NEW.sentiment := NULL;
    NEW."sentimentAttemptedAt" := NULL;
    NEW."sentimentProvenance" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rebuild_comment_sentiment_invalidation
  BEFORE UPDATE ON post_comments FOR EACH ROW
  EXECUTE FUNCTION rebuild_invalidate_comment_sentiment();
CREATE INDEX post_comments_sentiment_pending_idx ON post_comments ("sentimentAttemptedAt", "createdTime") WHERE sentiment IS NULL;
