-- Account-level insights were stored under both "<id>" and "act_<id>", so account totals counted every day twice.
-- Keep the act_ row where both exist, then move any remaining unprefixed account rows to the act_ form.
DELETE FROM "ad_insights" a
USING "ad_insights" b
WHERE a.level = 'account' AND b.level = 'account' AND a."adAccountId" = b."adAccountId" AND a.date = b.date
  AND b."objectId" = 'act_' || a."objectId";
UPDATE "ad_insights" SET "objectId" = 'act_' || "objectId"
WHERE level = 'account' AND "objectId" NOT LIKE 'act\_%';
