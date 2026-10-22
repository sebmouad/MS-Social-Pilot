-- A first comment, posted as the Page under the post when it goes out.
ALTER TABLE "posts" ADD COLUMN "firstComment" TEXT;

-- Per destination: the comment Facebook accepted, when it was last attempted
-- (the claim against commenting twice), and why it was refused.
ALTER TABLE "post_targets" ADD COLUMN "firstCommentId" TEXT,
ADD COLUMN "firstCommentAt" TIMESTAMP(3),
ADD COLUMN "firstCommentError" TEXT;
