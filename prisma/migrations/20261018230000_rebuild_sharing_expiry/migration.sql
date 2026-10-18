-- Legacy links without an expiry remain stored but are not publicly served by the rebuild.
-- Owners can rotate/recreate them with an explicit bounded lifetime.
ALTER TABLE "share_links" ADD COLUMN "expiresAt" TIMESTAMP(3);
