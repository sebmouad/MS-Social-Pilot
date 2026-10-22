CREATE TABLE "plans" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "priceMonthly" INTEGER NOT NULL DEFAULT 0,
  "priceYearly" INTEGER NOT NULL DEFAULT 0,
  "extraChannelPrice" INTEGER NOT NULL DEFAULT 0,
  "channels" INTEGER,
  "members" INTEGER,
  "workspaces" INTEGER,
  "postsPerMonth" INTEGER,
  "aiCredits" INTEGER,
  "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");
ALTER TABLE "users" ADD COLUMN "planId" TEXT, ADD COLUMN "extraChannels" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Suggested values (prices in cents); root edits them in Root › Plans.
INSERT INTO "plans" ("id","key","name","position","priceMonthly","priceYearly","extraChannelPrice","channels","members","workspaces","postsPerMonth","aiCredits","features","isDefault") VALUES
 ('plan_free','free','Free',0,0,0,0,3,1,1,20,20,ARRAY[]::TEXT[],true),
 ('plan_solo','solo','Solo',1,1500,15000,400,5,1,1,NULL,200,ARRAY['api']::TEXT[],false),
 ('plan_team','team','Team',2,3900,39000,300,15,5,3,NULL,600,ARRAY['clients','api']::TEXT[],false),
 ('plan_agency','agency','Agency',3,9900,99000,200,40,NULL,NULL,NULL,2000,ARRAY['clients','whiteLabel','api']::TEXT[],false),
 ('plan_agency_plus','agency_plus','Agency+',4,24900,249000,100,120,NULL,NULL,NULL,6000,ARRAY['clients','whiteLabel','api']::TEXT[],false);
