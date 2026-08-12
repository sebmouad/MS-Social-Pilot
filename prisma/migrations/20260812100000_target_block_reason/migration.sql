-- The reason a destination cannot publish, as a code rather than a sentence.
-- The sentence is written by a background job that cannot know who will read
-- it, and half this product's audience reads French. `publishBlocker` keeps
-- the English text as a fallback for rows written before this column existed.
ALTER TABLE "targets" ADD COLUMN "publishBlockerCode" TEXT;
