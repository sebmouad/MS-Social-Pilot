-- CreateTable
CREATE TABLE "public_holidays" (
    "country" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "localName" TEXT NOT NULL,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("country","date","name")
);

-- CreateTable
CREATE TABLE "holiday_years" (
    "country" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_years_pkey" PRIMARY KEY ("country","year")
);

-- CreateTable
CREATE TABLE "key_dates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "yearly" BOOLEAN NOT NULL DEFAULT false,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonal_modes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rule" TEXT NOT NULL,
    "shiftMinutes" INTEGER NOT NULL DEFAULT 0,
    "extraTimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasonal_modes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_holidays_date_idx" ON "public_holidays"("date");

-- CreateIndex
CREATE INDEX "key_dates_workspaceId_date_idx" ON "key_dates"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "seasonal_modes_workspaceId_idx" ON "seasonal_modes"("workspaceId");

-- AddForeignKey
ALTER TABLE "key_dates" ADD CONSTRAINT "key_dates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonal_modes" ADD CONSTRAINT "seasonal_modes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

