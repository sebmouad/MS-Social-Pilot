-- Object identity is independent of delivery. Account deletion erases its inventory.
CREATE TABLE ads_objects (
  "adAccountId" TEXT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('campaign', 'adset', 'ad')),
  "objectId" TEXT NOT NULL,
  name TEXT,
  "parentId" TEXT,
  status TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("adAccountId", level, "objectId")
);
