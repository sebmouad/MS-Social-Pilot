-- CreateTable
CREATE TABLE "post_comments" (
    "id" TEXT NOT NULL,
    "postTargetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "parentRemoteId" TEXT,
    "message" TEXT NOT NULL,
    "fromName" TEXT,
    "fromId" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_reviews" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "reviewerName" TEXT,
    "rating" INTEGER,
    "recommendationType" TEXT,
    "reviewText" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "snippet" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "participants" JSONB,
    "updatedTime" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "fromName" TEXT,
    "fromId" TEXT,
    "message" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_posts" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "message" TEXT,
    "permalink" TEXT,
    "statusType" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "insights" JSONB,
    "insightsSyncedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_videos" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "lengthSeconds" DOUBLE PRECISION,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "insights" JSONB,
    "insightsSyncedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "targetId" TEXT,
    "igUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "profilePictureUrl" TEXT,
    "followersCount" INTEGER,
    "followsCount" INTEGER,
    "mediaCount" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_media" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "caption" TEXT,
    "mediaType" TEXT,
    "mediaProductType" TEXT,
    "mediaUrl" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "likeCount" INTEGER,
    "commentsCount" INTEGER,
    "insights" JSONB,
    "insightsSyncedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_insights" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "value" JSONB NOT NULL,
    "numeric" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "actId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "accountStatus" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_insights" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "objectName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "cpc" DOUBLE PRECISION,
    "cpm" DOUBLE PRECISION,
    "cpp" DOUBLE PRECISION,
    "ctr" DOUBLE PRECISION,
    "frequency" DOUBLE PRECISION,
    "actions" JSONB,
    "fields" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_comments_postTargetId_createdTime_idx" ON "post_comments"("postTargetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "post_comments_postTargetId_remoteId_key" ON "post_comments"("postTargetId", "remoteId");

-- CreateIndex
CREATE INDEX "page_reviews_targetId_createdTime_idx" ON "page_reviews"("targetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "page_reviews_targetId_remoteId_key" ON "page_reviews"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "conversations_targetId_updatedTime_idx" ON "conversations"("targetId", "updatedTime");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_targetId_remoteId_key" ON "conversations"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_createdTime_idx" ON "conversation_messages"("conversationId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_conversationId_remoteId_key" ON "conversation_messages"("conversationId", "remoteId");

-- CreateIndex
CREATE INDEX "external_posts_targetId_createdTime_idx" ON "external_posts"("targetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "external_posts_targetId_remoteId_key" ON "external_posts"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "page_videos_targetId_createdTime_idx" ON "page_videos"("targetId", "createdTime");

-- CreateIndex
CREATE UNIQUE INDEX "page_videos_targetId_remoteId_key" ON "page_videos"("targetId", "remoteId");

-- CreateIndex
CREATE INDEX "instagram_accounts_workspaceId_idx" ON "instagram_accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_accounts_workspaceId_igUserId_key" ON "instagram_accounts"("workspaceId", "igUserId");

-- CreateIndex
CREATE INDEX "instagram_media_accountId_timestamp_idx" ON "instagram_media"("accountId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_media_accountId_remoteId_key" ON "instagram_media"("accountId", "remoteId");

-- CreateIndex
CREATE INDEX "instagram_insights_accountId_metric_endTime_idx" ON "instagram_insights"("accountId", "metric", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_insights_accountId_metric_period_endTime_key" ON "instagram_insights"("accountId", "metric", "period", "endTime");

-- CreateIndex
CREATE INDEX "ad_accounts_workspaceId_idx" ON "ad_accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_accounts_workspaceId_actId_key" ON "ad_accounts"("workspaceId", "actId");

-- CreateIndex
CREATE INDEX "ad_insights_adAccountId_date_idx" ON "ad_insights"("adAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_insights_adAccountId_level_objectId_date_key" ON "ad_insights"("adAccountId", "level", "objectId", "date");

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "post_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_reviews" ADD CONSTRAINT "page_reviews_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_posts" ADD CONSTRAINT "external_posts_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_videos" ADD CONSTRAINT "page_videos_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_media" ADD CONSTRAINT "instagram_media_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_insights" ADD CONSTRAINT "instagram_insights_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_insights" ADD CONSTRAINT "ad_insights_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
