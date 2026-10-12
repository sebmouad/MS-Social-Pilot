-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "country" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "knownDevices" TEXT[] DEFAULT ARRAY[]::TEXT[];

