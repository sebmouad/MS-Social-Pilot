# Rebuild cutover plan

The legacy app remains the production service throughout preparation. The
existing `scripts/deploy/deploy.sh` and `socialpilot-deploy` commands continue
to publish the legacy root package. Do not use either command to deploy the
rebuild.

On 2026-10-15, a read-only schema-only dump from production restored into an
isolated PostgreSQL 16 database. Both additive rebuild migrations applied to
that clone. The cutover rehearsal then verified every mapped column and enum,
and a second custom-format backup restored with matching row counts. The
schema-only dump contained zero customer rows, so this check does not prove
data migration, permissions, application writes, media, or provider behavior.
The rehearsal now compares exact counts for every public table in its source
and restored scratch databases. A read-only production catalog inspection on
2026-10-15 showed nonempty legacy feature tables outside the rebuild Prisma
view, including `external_posts`, `metric_availability`, `page_insights`, and
`ad_insights`; it also showed an enrolled passkey. The counts were estimates
from PostgreSQL statistics, not copied customer records or migration proof.
The latest production custom-format backup observed on 2026-10-15
(`db-20261015-0415.dump`, 683900 bytes) was restored into a temporary database
on the production host with `pg_restore --exit-on-error`. The restored database
had 92 public tables, 2 workspaces, 2 users, and 9884 Page insight rows. The
temporary database was removed; zero restore-check databases remained, all
three relevant services remained active, and the public health endpoint
returned 200. This proves that particular backup can be restored, but it does
not prove the exact future cutover backup, application behavior on restored
data, media restoration, or proxy/service rollback.

The rebuild currently listens on port 3200; production OpenLiteSpeed proxies to
the legacy service on port 3100. No rebuild systemd units, proxy-switch
configuration, or rebuild-specific production rollback is checked in. The
production transition is therefore intentionally blocked. The scripts in
`scripts/deploy/rebuild-*` can prepare and inspect a staging build, but the
deploy and rollback commands refuse to make changes until a separately reviewed
cutover runbook and host configuration are supplied.

## Phases and gates

1. **Build a release candidate.** From the repository root run
   `scripts/deploy/rebuild-stage.sh`. It builds the current working tree,
   installs from the root lockfile, generates the rebuild's
   mapped Prisma client, and builds `rebuild/`. It does not connect to the
   production host, copy `.env`, run a migration, or touch the legacy release.
2. **Verify on isolated staging.** Deploy the build only to an isolated host
   with a sanitized database copy and test media. Run the application's unit,
   type, browser, workflow, authorization, and provider checks there. The
   capability crosswalk in `docs/LEGACY_CAPABILITY_PARITY.md` must be complete:
   every customer and operator workflow from the legacy app needs a working
   tested equivalent, alongside the new modular platform and MCP capabilities.
   read-only `rebuild-verify-staging.sh` requires a loopback URL by default and
   checks HTTP health. It must never be pointed
   at production as a substitute for staging evidence.
3. **Decide the schema path.** `rebuild/prisma/schema.prisma` is a partial
   compatibility view, not a migration schema. It has no rebuild migration
   directory. The worker expects its lease and run tables, and MCP uses a key
   table; their additive migrations exist in the root migration directory and
   have passed only on an isolated local database.
   No `prisma db push` or `migrate deploy` is permitted from the rebuild against
   production. For the local rehearsal, use a sanitized, pre-migration custom
   format dump and a loopback-only PostgreSQL admin URL. Set
   `CUTOVER_DUMP_SANITIZED=YES` only after a separate sanitization review, and
   set `CUTOVER_APPROVED_MIGRATION_SET=20261015120000_mcp_api_keys,20261023100000_rebuild_worker_jobs`.
   `rebuild/scripts/cutover-rehearsal.sh` pins those two SQL files by SHA-256,
   restores the dump into local scratch databases, refuses migration objects
   or success records already present, applies only those files, checks the
   explicitly enumerated mapped columns and enum labels, reports aggregate
   public-table row counts, and compares counts after an independent
   backup/restore. Review the verifier whenever the rebuild Prisma schema
   changes; it does not automatically discover new fields. It
   drops both scratch databases on exit. It never starts the rebuild app and
   does not verify authentication, application workflows, writes, media,
   provider callbacks, or the meaning of the source data.

   The sanitization flag is an operator attestation, not a sanitizer or proof
   that sensitive values were removed. Keep the source dump in approved
   storage, do not print or inspect record contents during this run, and
   retain only the aggregate evidence needed for review. This rehearsal is
   bounded to a local clone and cannot serve as production authorization.
   Rehearse `scripts/import-legacy-config.ts` on that copy before app traffic
   moves. Verify the imported `security.twoStep`, sign-in limits, Meta
   credentials, and OAuth redirect against the legacy environment. The rebuild
   reads Root registry values for authentication and no longer reads the
   legacy authentication environment variables at request time.
4. **Prove backup and recovery.** Before any eventual production switch,
   perform the configured backup and verify its artifact, timestamp, and
   restore into an isolated database. Include media and environment recovery
   without displaying or copying secrets. Record the legacy release hash and
   ensure its directory remains available. Rehearse returning proxy traffic to
   legacy and restarting the legacy web and worker units.
5. **Review the host switch.** Supply and review the actual systemd units,
   OpenLiteSpeed vhost/proxy config path and reload method, media path/ownership,
   environment handling, service health behavior, and lock/atomicity strategy.
   Decide whether the rebuild worker runs alongside or replaces the legacy
   worker; do not let two schedulers publish the same queue. Run only additive,
   backward-compatible migrations before switching traffic. If they cannot be
   backward compatible, code rollback alone is insufficient.
6. **Cut over only after sign-off.** Once all gates are documented and
   rehearsed, update the rebuild deploy/rollback scripts with the reviewed
   host-specific commands. Stage the exact immutable release, back up, apply
   only approved migration steps, start and health-check rebuild on 3200, then
   switch the proxy and validate the public health endpoint, sign-in, worker,
   and representative read/write paths. Keep legacy files and services
   available until the observation window and rollback decision are complete.
7. **Rollback.** Route the proxy back to legacy first, reload the proxy, restart
   legacy services, and verify health. Do not restore the database by default:
   compare writes since cutover against the backup and separately decide how to
   preserve them. A database restore is destructive and must be performed only
   under the separately reviewed recovery procedure.

## Current blockers

- Rebuild feature coverage and legacy capability parity are incomplete; see
  `docs/LEGACY_CAPABILITY_PARITY.md`. Passkey verification now has a
  challenge-bound implementation, but its Root-managed origin and a real
  enrolled credential still need production-shaped validation. Other gaps
  include complete provider disconnect/data deletion, full Facebook
  media and Ads lifecycles, broad scoped-role access, Root coverage of all
  operational options, MCP parity, and live provider integration tests.
- Production currently has no rebuild web or worker systemd unit and no
  verified proxy switch from 3100 to 3200.
- The rebuild schema is not a migration schema. Its two checksum-pinned
  additive migrations still need application and data-impact review against a
  sanitized production-shaped copy and a restore-aware plan.
- There is no sanitized production-shaped staging evidence covering the full
  authorization and write workflows, media, and provider callbacks.
- A verified production backup/restore rehearsal for the exact cutover
  artifact and a tested proxy/service rollback have not been recorded.

Until these blockers are closed, `rebuild-deploy.sh` and
`rebuild-rollback.sh` are guardrails that print the unresolved requirements and
exit without SSH, service, proxy, database, or filesystem changes.
