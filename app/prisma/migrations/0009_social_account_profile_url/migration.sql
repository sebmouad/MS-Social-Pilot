-- The connecting Facebook profile's own link, when Facebook shares it (the user_link permission).
ALTER TABLE social_accounts ADD COLUMN "profileUrl" TEXT;
