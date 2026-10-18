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

The 2026-10-16 first-comment batch maps three existing nullable legacy delivery
columns (`firstCommentId`, `firstCommentAt`, `firstCommentError`). Its verifier
inventory now explicitly checks them. Local catalog metadata and actual
PostgreSQL receipt/attempt writes passed without DDL; this is not a new
migration or a claim of the complete production-shaped cutover rehearsal.

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
  directory. The worker expects its lease and run tables, MCP uses a key
  table, and deletion recovery uses journal tables; their additive migrations
  exist in the root migration directory and have passed only on an isolated
  local database.
   No `prisma db push` or `migrate deploy` is permitted from the rebuild against
   production. For the local rehearsal, use a sanitized, pre-migration custom
   format dump and a loopback-only PostgreSQL admin URL. Set
   `CUTOVER_DUMP_SANITIZED=YES` only after a separate sanitization review, and
   set `CUTOVER_APPROVED_MIGRATION_SET=20261015120000_mcp_api_keys,20261023100000_rebuild_worker_jobs,20261016190000_rebuild_inbox_deletions,20261016220000_rebuild_post_deletions,20261017010000_rebuild_publication_attempts,20261017020000_rebuild_facebook_media_steps,20261017030000_rebuild_facebook_media_deletions,20261017040000_rebuild_facebook_media_resolution`.
   `rebuild/scripts/cutover-rehearsal.sh` pins those eight SQL files by SHA-256,
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
- The rebuild schema is not a migration schema. Its eight checksum-pinned
  additive migrations still need application and data-impact review against a
  sanitized production-shaped copy and a restore-aware plan.
- There is no sanitized production-shaped staging evidence covering the full
  authorization and write workflows, media, and provider callbacks.
- A verified production backup/restore rehearsal for the exact cutover
  artifact and a tested proxy/service rollback have not been recorded.

Until these blockers are closed, `rebuild-deploy.sh` and
`rebuild-rollback.sh` are guardrails that print the unresolved requirements and
exit without SSH, service, proxy, database, or filesystem changes.

## Inbox deletion journal addition — 2026-10-16

The third reviewed additive migration, `20261016190000_rebuild_inbox_deletions`, adds only the durable Inbox deletion journal and its constraints/indexes. At that point, the cutover script pinned three checksums and checked their migration-history entries and mapped columns. The original two-migration schema-only rehearsal above remains historical evidence; it does not prove the then-current three-migration rehearsal. The later fourth migration is described below.

Before applying the new table to the isolated synthetic preview, a private custom-format backup was restored into a scratch database and users/workspaces/posts/audit/comments/conversations counts matched (1/1/6/37/3/2). The scratch database was removed; the backup remains private at `/private/tmp/socialpilot-preview-before-inbox-deletion-20261016T182951Z.dump`. The table was applied only to the preview, without db push or production changes. The complete three-migration rehearsal against a sanitized pre-migration production-shaped baseline, exact cutover backup/media recovery and proxy/service rollback remain required.

The final Inbox journal schema also retains local alias IDs and suppressed descendant remote IDs. Its current checksum-pinned SQL was applied from scratch to a private pre-journal restore, then independently backed up/restored with matching counts across 96 public tables; both scratch databases were removed. The isolated preview’s array-column amendment was separately preceded by another restore-verified backup. These are local journal-migration checks; they do not substitute for the full approved four-file rehearsal on a sanitized production-shaped baseline or production proxy/service/media rollback.

## Publishing post-deletion journal addition — 2026-10-16

The fourth pinned additive migration, `20261016220000_rebuild_post_deletions`, adds the content-free remote post deletion journal. Its SHA-256 is now `80e406ae33000a349d07f9e428563d20083bc36c65956a969a5e7ccc77c32f07`; the state/timestamp CHECK is explicitly NULL-safe. Before the isolated synthetic preview received this migration, the private backup `/private/tmp/socialpilot-preview-before-post-deletion-20261016T210904Z.dump` (244200 bytes) was restored; the exact source-table counts matched, and the migration restore matched the 97-table inventory. The revised DDL has not been applied to the preview; the parent will back up and restore it before applying the correction. Production was not changed.

At that snapshot, the cutover allowlist, checksum pin, migration-history guard, and mapped-column inventory contained five migrations. This backup/restore evidence and preview application do not prove a full five-file rehearsal against a sanitized, production-shaped pre-migration baseline. Exact production cutover backup/media recovery, application workflows, and proxy/service rollback remain required. See [POST_DELETION_RECOVERY.md](POST_DELETION_RECOVERY.md) for service semantics and remaining gaps.

The final post-deletion SQL above was reapplied from the pre-journal private
backup, then independently backed up/restored with matching exact counts for
97 tables. Its NULL-safe CHECK amendment on the preview was separately preceded
by a restore-verified 97-table backup at
`/private/tmp/socialpilot-preview-before-post-deletion-constraint-20261016T231821Z.dump`
(249411 bytes). These checks establish the local additive migration and
constraint repair only; they do not close the full four-file production-shaped
migration, media or proxy/service rollback gates.

## Publication attempt journal — 2026-10-17

The fifth allowlisted additive migration, `20261017010000_rebuild_publication_attempts`, defines the content-free publication attempt journal and its NULL-safe state/timestamp invariants. Identifiers use a fixed 2048-character database integrity cap, independent of runtime limits. The table has only a workspace foreign key; local post and destination IDs remain durable aliases without cascading foreign keys. A partial unique index holds one attempt per workspace/post-target while its state is `started`, `uncertain`, `receipt_recorded`, or `projected`; `rejected` and `attested_absent` release the claim while retaining history. Workspace deletion erases resolved journal rows through the workspace cascade, while the Publishing service refuses erasure with unresolved attempts.

The migration is checksum-pinned and included in the local cutover rehearsal's mapped-column inventory. Its SHA-256 is `03973b6fb80dcf2580c5e39f0d2be8fd5715f47c1a953127ce939638bfece267`. Before preview application, `/private/tmp/socialpilot-preview-before-publication-20261016T234535Z.dump` (249671 bytes, mode 0600) restored with exact matching counts for all 97 source tables. The migration applied to that scratch restore, and an independent migrated backup restored with exact counts across 98 tables. Only then was the migration applied to the synthetic preview; both scratch databases were removed. Production, workers and remote provider data were unchanged.

This proves the additive local journal and restore path, not a full five-file rehearsal on a sanitized production-shaped pre-migration baseline. The implemented service and fault/authorization evidence are described in PUBLICATION_RECOVERY.md and PREVIEW_QA.md. Exact production backup/media recovery, one-publisher ownership, live provider operations, application/permission migration and proxy/service rollback remain release gates.


## Facebook media-step migration — 2026-10-17

The sixth reviewed additive migration, `20261017020000_rebuild_facebook_media_steps`, adds a
content-free, workspace-owned Facebook photo/feed intent and receipt journal.
SHA-256: `897464050aedf8c727fd695cc9b1fead0810d6c08606f3074c4d70529940a0e1`. It preserves intermediate provider
IDs without credentials, content, image URLs or bytes. It has fixed NULL-safe
phase/state/timestamp constraints, ordered-step uniqueness and per-destination
known-identity uniqueness. Root controls the consumed runtime transaction, media
and history bounds; fixed database integrity caps require a reviewed migration.

Before application to the isolated synthetic preview, a private custom-format
backup `/private/tmp/socialpilot-preview-before-facebook-media-20261017T095438278Z.dump`
(257294 bytes, mode 0600) restored with exact counts across all 98 source tables.
The new migration applied to that scratch restore. An independent migrated
backup `/private/tmp/socialpilot-preview-with-facebook-media-20261017T095438278Z.dump`
(263157 bytes, mode 0600) then restored with exact counts across 99 tables. Only
then was the same checksum applied to the preview; all original counts matched,
the new table was empty, and both scratch databases were removed. The reviewed
cutover allowlist, checksum, baseline-history refusal and mapped-column inventory
now include the sixth migration. No production database, service or provider
changed. This does not prove the full six-file rehearsal on a sanitized
production-shaped baseline, media restore, application/authorization migration
or production proxy/worker rollback. Those release gates remain open.


## Seventh additive migration: Facebook media deletion receipts — batch 53

`20261017030000_rebuild_facebook_media_deletions` adds one content-free
workspace-owned table, strict NULL-safe states/receipt timestamps, bounded
identifiers, immutable binding trigger and a unique non-rejected claim per
workspace/media-step. It changes no legacy content, queue or credential table.
Reviewed SHA-256:
`3f5df63bf339fe532581f14738d089ca5f20a4c245f581f1587573b5bfe6cca5`.
The rehearsal allowlist, checksum, baseline-object/history refusal and mapped
column inventory now include all seven reviewed additive migrations.

Before applying to the isolated synthetic preview, a custom-format backup was
restored to a unique scratch database and every public base-table row count
matched exactly across 99 tables. The seventh migration was applied to scratch;
a second backup/restore matched exactly across 100 tables. The unchanged SQL
was then applied only to the preview, preserving all previous table counts and
starting the deletion journal empty. Both scratch databases were removed.

Private mode-0600 backups:

- `/private/tmp/socialpilot-preview-before-facebook-cleanup-20261017T101638796Z.dump` — 263195 bytes.
- `/private/tmp/socialpilot-preview-with-facebook-cleanup-20261017T101638796Z.dump` — 270295 bytes.

This is exact local backup/restore proof, not the complete seven-file rehearsal
on a sanitized production-shaped baseline or a verified production rollback.
No production database/service/provider changed. The earlier worker ownership,
functional/authorization, live-provider, backup/media recovery and deployment
rollback gates still apply. `socialpilot-deploy` still deploys the legacy app.


## Eighth migration: external media reports and late results — batch 54

`20261017040000_rebuild_facebook_media_resolution` adds a content-free
workspace-owned immutable-event ledger, explicit attested/conflict states and
attestor metadata to the two Facebook media journals. It replaces state-shape
checks and the deletion claim index so an externally reported still-present
photo permits only a new explicitly confirmed cleanup intent. Existing seven
migration files remain unchanged. No content or credential data is deleted.
Reviewed SHA-256:
`3227fbe5f381a25c87955ac809ef605fe1f2d51d9bb4f3ca4e5e9ce743c2a844`.

Before preview application, a private backup restored with exact public table
counts across 100 tables. This SQL was applied to scratch; a separate migrated
backup/restore matched all 101 tables exactly. The unchanged SQL was then applied
only to the synthetic preview, preserving every original table count and
starting the event ledger empty. Both scratch databases were removed.

- `/private/tmp/socialpilot-preview-before-facebook-resolution-20261017T104410011Z.dump` — 270630 bytes, mode 0600.
- `/private/tmp/socialpilot-preview-with-facebook-resolution-20261017T104410011Z.dump` — 281027 bytes, mode 0600.

The allowlist, checksums, prior object/history refusal and mapped-column checks
now include all eight migrations. This does not prove the complete eight-file
rehearsal on a sanitized production-shaped baseline, production rollback, media
restore, provider permission migration or publisher ownership. Production
services, database and provider content are unchanged.

## Live-provider canary boundary — batch 55

The separately reviewed engine-only canary used existing host credentials to
create two generated photos and one uniquely labelled post on the user-selected
Page. Publication/association readback and feed deletion were confirmed; child
photo cleanup remains unresolved with private evidence and a retained Page lock.
FACEBOOK_LIVE_MEDIA_CANARY.md records the first exact-photo DELETE attempts and
their unconfirmed results. No production database, schema, configuration, queue,
service or proxy was modified. This is limited provider evidence, not a rebuild
deployment or migrated UI/API/MCP/worker proof. It closes none of the remaining
cutover/rollback or full capability-parity gates. Do not run `socialpilot-deploy`
as a substitute for the rebuild deployment plan above.

## Queue probe interruption recovery — batch 71, local preview only

Before deleting two confirmed interrupted synthetic queue runs, the private archive
`/private/tmp/msp-queue71-before-cleanup-20261018120749988.dump` was restored into
an isolated scratch database and compared. SHA-256:
`8579ddf0f8601f2fc59069bf7a36b23535866bf22f2004dfef70929c2bcea897`.
Users/workspaces/posts/settings/Root-audit counts matched (5/5/8/22/242), as did
the configuration checksum. The scratch database was removed. The archive is the
state before recovery, including the interrupted fixtures; it is not a recovered
pre-probe configuration or a production cutover backup.

The original pre-probe values for nine non-secret settings were lost when the
probe processes were interrupted without persisted snapshots. After releasing
orphan local preview transactions, both exact synthetic run scopes were deleted
and zero remaining fixtures were verified. An audited typed preview baseline was
explicitly established (MCP owner/admin access, Facebook and Publishing features
enabled; collaboration retention/queue bounds from the registry). Exact recovery
of the earlier values is not claimed. The private recovery ledger and archive
remain available. Subsequent hardened probe runs passed and restored their captured
new baseline exactly. No production process, data or provider content changed.


## Notification migration addition (batch 73)

The reviewed allowlist now contains nine migrations, including
`20261018150000_rebuild_notifications`. Its pinned checksum, existing-table and
migration-history refusals, and mapped-column checks are in the rehearsal script.
A fresh private local preview backup was scratch-restored and this additive SQL
was scratch-applied before preview application; legacy counts and settings
checksum matched. This does not prove a complete nine-migration staging rehearsal,
production data/media migration or release rollback. Production was not migrated.


## Ads ledger addition (batch 74)

The allowlist now contains ten checksum-pinned migrations, adding
`20261018170000_rebuild_ads_operations`. The rehearsal refuses existing ledger
objects/history and checks mapped columns. Only isolated preview was migrated,
after fresh backup, scratch restore/migration and unchanged legacy count/settings
comparison. A full ten-migration production-shaped staging and rollback rehearsal
remains outstanding; production was not migrated.
