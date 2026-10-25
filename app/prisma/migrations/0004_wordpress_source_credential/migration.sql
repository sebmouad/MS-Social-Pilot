-- Each workspace saves the REST credential of its own WordPress blog (encrypted), instead of one Root-wide secret.
ALTER TABLE "wordpress_recipe_sources" ADD COLUMN "apiCredential" TEXT;
