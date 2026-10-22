-- Optional neutral provider observations; existing rows retain unknown metadata.
ALTER TABLE conversations ADD COLUMN "inboxMetadata" JSONB;
ALTER TABLE conversation_messages ADD COLUMN "inboxMetadata" JSONB;
ALTER TABLE post_comments ADD COLUMN "inboxMetadata" JSONB;
