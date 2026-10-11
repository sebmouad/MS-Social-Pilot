---
name: db-migration
description: Change the Prisma schema of MS Social Pilot and generate an additive migration that deploys cleanly.
---

# Database migration

1. Edit `prisma/schema.prisma`; `npx prisma format`.
2. Generate (test DB container running):
```bash
docker exec msp-test-pg psql -U postgres -c "drop database if exists sp_shadow2" -c "create database sp_shadow2"
M=prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<name>; mkdir -p $M
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://postgres:postgres@127.0.0.1:55432/sp_shadow2 --script > $M/migration.sql
npx prisma generate
```
3. Read the SQL: additive only (new tables/columns nullable or with defaults,
   `ALTER TYPE … ADD VALUE`). No drops/renames without the owner's OK and a data
   plan. Production is PostgreSQL 15.
4. Integration tests clean up new tables in `beforeEach` where relevant.
5. Migrations run during `scripts/deploy/deploy.sh` after a backup.
