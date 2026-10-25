-- The anonymous Graph picture address shows a placeholder for restricted Pages. Serve Facebook Page
-- pictures through the application, which reads them with the Page's own token.
UPDATE "targets" t
SET "pictureUrl" = '/api/channels/' || t.id || '/picture'
FROM "social_accounts" a
WHERE a.id = t."socialAccountId" AND a.provider = 'facebook' AND t.type = 'page';
