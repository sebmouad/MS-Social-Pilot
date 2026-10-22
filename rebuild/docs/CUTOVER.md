# Cutover, release and rollback

Production runs this rebuild at `https://social.newsgeet.com` since the
2026-10-20 cutover. The legacy tree was deleted from the repository on
2026-10-22 (lane 47); server-side legacy removal runs via
`scripts/server-legacy-cleanup.sh` and is still pending. There is no
legacy rollback target anymore.

## Release procedure

Releases go through `scripts/prod-deploy.sh` only, from this checkout:

1. Typecheck and the full suite are green (see [TESTING.md](TESTING.md)).
2. The deploy script resolves `origin/main`, orders `prisma/migrations`
   (the checksum-pinned baseline first, then any newer migration) and ships
   `rebuild/` plus the migrations to the host.
3. On the host it takes a `pg_dump` backup, builds incrementally, applies
   unrecorded migrations as `postgres` without a wrapping transaction, records
   them in `_prisma_migrations`, then swaps the release and restarts web and
   worker. A database that already recorded the squashed migrations gets the
   baseline marked applied (resolve semantics) instead of re-running it.
4. It probes `/api/health` locally and publicly plus the sign-in Origin check.
   Any failure restores the previous release folder; a database restore needs
   the owner's approval (the dump path is printed).

New migrations must be additive, checksum-pinned in
`scripts/cutover-rehearsal.sh`, and rehearsed on a scratch database before
release (see [OPERATIONS.md](OPERATIONS.md#migrations)). Never edit the
shipped baseline.

## Rollback and restore

- Failed deploy: `prod-deploy.sh` restores the previous release folder
  automatically on a failed health check.
- Last good release: `/srv/ms-social-pilot-rebuild.prev` on the host.
- Database restore (owner approval required): stop the rebuild units, restore
  the newest `socialpilot-deploy-*` dump, restart. Commands are in
  [OPERATIONS.md](OPERATIONS.md#rollback-and-restore).
- `scripts/prod-rollback-drill.sh` (rebuild-only) proves a backup restores
  into a scratch database and the installed release starts against it.
- `scripts/verify-legacy-migration.ts` verifies a restored copy: row counts
  against a snapshot baseline (`--snapshot`), foreign-key orphans, required
  enums/columns, media files under the restored media root, and encrypted
  Root settings. Read-only; refuses production-shaped URLs and requires the
  same confirmation plus TLS material as the rehearsal.

## Archived: pre-cutover history

- The cutover ran 2026-10-20 at 22:09 CEST after 34 applied migrations,
  backup, health checks, ownership repair and owner sign-in confirmation.
  Full log: [RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md#production-cutover--2026-10-20-2209-cest).
- Pre-cutover staging used a 127.0.0.1:3100/3101 dual-release setup with a
  guarded legacy deploy helper; all of it is retired with the legacy release.
- The migration history (139 rebuild migrations plus the chat-deliveries
  migration) was squashed into `20261103000000_baseline` on 2026-10-22 and
  proven equivalent on scratch databases; see [LEGACY_REMOVAL_PLAN.md](LEGACY_REMOVAL_PLAN.md)
  and [LEGACY_DATA_MIGRATION.md](LEGACY_DATA_MIGRATION.md).
