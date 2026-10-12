-- CreateTable
CREATE TABLE "uptime_days" (
    "day" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "uptime_days_pkey" PRIMARY KEY ("day","component")
);

