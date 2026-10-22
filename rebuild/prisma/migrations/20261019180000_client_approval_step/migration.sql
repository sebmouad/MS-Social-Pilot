ALTER TABLE "workspaces" ADD COLUMN "clientApprovalAfterTeam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "posts" ADD COLUMN "teamApprovedById" TEXT;
ALTER TABLE "posts" ADD COLUMN "teamApprovedAt" TIMESTAMP(3);
