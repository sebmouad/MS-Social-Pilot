-- Facebook CDN picture URLs are signed and expire. Point Facebook Page targets at the
-- stable Graph picture address, which always redirects to the current picture.
UPDATE "targets" t
SET "pictureUrl" = 'https://graph.facebook.com/' || t."providerId" || '/picture?type=square'
FROM "social_accounts" a
WHERE a.id = t."socialAccountId" AND a.provider = 'facebook' AND t.type = 'page';
