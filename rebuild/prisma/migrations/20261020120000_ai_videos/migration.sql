ALTER TYPE "AiGenerationKind" ADD VALUE IF NOT EXISTS 'video';

CREATE TABLE "ai_videos" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'working',
    "mediaId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_videos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_videos_workspaceId_createdAt_idx" ON "ai_videos"("workspaceId", "createdAt");
CREATE INDEX "ai_videos_status_idx" ON "ai_videos"("status");

ALTER TABLE "ai_videos" ADD CONSTRAINT "ai_videos_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
