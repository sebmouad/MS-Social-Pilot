-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "detail" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_alerts_key_resolvedAt_idx" ON "system_alerts"("key", "resolvedAt");

-- CreateIndex
CREATE INDEX "system_alerts_openedAt_idx" ON "system_alerts"("openedAt");

