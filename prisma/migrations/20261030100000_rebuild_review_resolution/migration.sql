-- Reviews in the Inbox can be resolved and reopened locally, like conversations and comments.
ALTER TABLE page_reviews ADD COLUMN "resolvedAt" TIMESTAMP(3);
