# Existing data compatibility

The fresh app reads selected records from the existing PostgreSQL database. Its
Prisma schema in `prisma/schema.prisma` maps only the existing tables needed for
identity, workspace membership, destinations, posts, connected social accounts,
advertising account metadata, and the minimum user/session columns required to
reuse existing sign-in state.

This schema is a client view, not a database migration. Do not run `prisma db
push`, `prisma migrate`, or any schema migration from the rebuild app against
the production database. The rebuild now writes compatible sessions, two-step
credentials, draft posts, selected destinations, and Root configuration.
Every read and write must validate workspace membership and feature access.

The mapped column and enum names follow `app/prisma/schema.prisma`. The schema
omits legacy fields and tables the new app does not need, including some
workspace settings and external provider credentials. Session token hashes
are read for authentication; the rebuild also creates and revokes sessions.
Social access tokens are not selected by customer read views. A small set of
legacy app settings backs the typed Root configuration registry. Additional
models must be checked against the production schema and migration plan before
use.
