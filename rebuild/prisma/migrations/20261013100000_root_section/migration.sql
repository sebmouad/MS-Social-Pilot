-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "root_activities" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "root_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "root_activities_createdAt_idx" ON "root_activities"("createdAt");

-- AddForeignKey
ALTER TABLE "root_activities" ADD CONSTRAINT "root_activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

