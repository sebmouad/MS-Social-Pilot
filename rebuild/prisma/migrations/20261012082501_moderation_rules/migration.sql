-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "onModerationAlert" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "moderation_rules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action" TEXT NOT NULL,
    "replyText" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "oncePerUser" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "remoteCommentId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "message" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "replyRemoteId" TEXT,
    "error" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_rules_workspaceId_idx" ON "moderation_rules"("workspaceId");

-- CreateIndex
CREATE INDEX "moderation_actions_workspaceId_createdAt_idx" ON "moderation_actions"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_actions_ruleId_createdAt_idx" ON "moderation_actions"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_actions_ruleId_remoteCommentId_key" ON "moderation_actions"("ruleId", "remoteCommentId");

-- AddForeignKey
ALTER TABLE "moderation_rules" ADD CONSTRAINT "moderation_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "moderation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

