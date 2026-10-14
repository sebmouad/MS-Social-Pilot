# Existing data compatibility

The fresh app reads selected records from the existing PostgreSQL database. Its
Prisma schema in `prisma/schema.prisma` maps only the existing tables needed for
identity, workspace membership, destinations, posts, connected social accounts,
advertising account metadata, and the minimum user/session columns required to
reuse existing sign-in state.

This schema is a client view, not a database migration. Do not run `prisma db
push`, `prisma migrate`, or any schema migration from the rebuild app against
the production database. The new app's data module exposes read queries only;
application code should continue to authorize each request through the user's
membership before reading workspace-scoped records.

The mapped column and enum names follow `app/prisma/schema.prisma`. The schema
omits legacy fields and tables the new app does not need, including workspace
settings and external provider credentials. Session token hashes are read only
for authentication; session creation and revocation remain outside this layer.
Social access tokens are not selected by the read API. No legacy settings are
copied into the rebuild app. If it later needs additional data, add only the
required columns and relations after checking the production schema; preserve
the read-only boundary until a separately reviewed write design exists.
