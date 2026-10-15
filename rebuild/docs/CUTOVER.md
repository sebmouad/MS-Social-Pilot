# Rebuild cutover plan

The legacy app remains the production service throughout preparation. The
existing `scripts/deploy/deploy.sh` and `socialpilot-deploy` commands continue
to publish the legacy root package. Do not use either command to deploy the
rebuild.

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
   read-only `rebuild-verify-staging.sh` requires a loopback URL by default and
   checks HTTP health. It must never be pointed
   at production as a substitute for staging evidence.
3. **Decide the schema path.** `rebuild/prisma/schema.prisma` is a partial
   compatibility view, not a migration schema. It has no rebuild migration
   directory. The worker expects its lease and run tables, and MCP uses a key
   table; their additive migrations exist in the root migration directory and
   have passed only on an isolated local database.
   No `prisma db push` or `migrate deploy` is permitted from the rebuild until
   a reviewed forward migration, data impact analysis, and recovery plan exist.
   Verify mapped columns, enum labels, row counts, and representative record
   behavior on the sanitized staging copy. The existing
   `rebuild/scripts/cutover-rehearsal.sh` tests a staging dump's mapped schema
   and backup/restore mechanics on local scratch databases; it does not test
   application workflows or apply rebuild migrations.
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

- Rebuild feature coverage is incomplete. Current gaps include passkey
  verification, complete provider disconnect/data deletion, full Facebook
  media and Ads lifecycles, broad scoped-role access, Root coverage of all
  operational options, MCP parity, and live provider integration tests.
- Production currently has no rebuild web or worker systemd unit and no
  verified proxy switch from 3100 to 3200.
- The rebuild schema is not a migration schema. Its two additive root
  migrations passed on the isolated test database but still need review
  against a production-shaped copy and a restore-aware plan.
- There is no sanitized production-shaped staging evidence covering the full
  authorization and write workflows, media, and provider callbacks.
- A verified production backup/restore rehearsal for the exact cutover
  artifact and a tested proxy/service rollback have not been recorded.

Until these blockers are closed, `rebuild-deploy.sh` and
`rebuild-rollback.sh` are guardrails that print the unresolved requirements and
exit without SSH, service, proxy, database, or filesystem changes.
