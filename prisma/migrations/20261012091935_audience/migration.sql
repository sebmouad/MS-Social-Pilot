-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "audienceCalendars" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceTimezone" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "audienceCalendars" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "audienceTimezone" TEXT;

