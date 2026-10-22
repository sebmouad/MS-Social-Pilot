-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "firstReadAt" TIMESTAMP(3);


-- Pages connected before this column existed have been read by the regular
-- jobs already; only Pages connected from now on wait for a first read.
UPDATE "targets" SET "firstReadAt" = CURRENT_TIMESTAMP;
