# Rebuild cutover plan

## Current status — 2026-10-21

**Cutover completed 2026-10-20 at 22:09 CEST.** The owner ran
`rebuild/scripts/prod-cutover.sh` at `5f1e52d7`; the rebuild serves
`https://social.newsgeet.com`. Recorded state: `social-pilot-rebuild` and
`social-pilot-rebuild-worker` active/enabled; legacy `social-pilot` and worker
inactive/disabled. Legacy release remains at `/srv/ms-social-pilot` for rollback.

Use **`rebuild/scripts/prod-deploy.sh`** for rebuild releases (backup, build,
reviewed migrations/ownership, swap, health/same-origin checks and automatic
swap-back). Legacy `socialpilot-deploy` refuses while rebuild is enabled except
status or a deliberate legacy override. Do not revive both publishers.

Evidence: [RELEASE_GATES_PLAN.md results](RELEASE_GATES_PLAN.md#production-cutover--2026-10-20-2209-cest)
records fresh backup, 34 live migrations, health, ownership repair and later
owner sign-in. Root `app.publicOrigin` was set to the live HTTPS origin to fix
proxy-related same-origin refusals; passkey origin/media root and legacy Meta
settings were also corrected/imported. Subsequent deploy ownership fixes are in
`9b29a5f4`. These are recorded outcomes, not new production checks by this worker.

The full rebuild goal remains incomplete. Verify exact deployed SHA, later
migration application/ownership, restorable backup/media and post-cutover rollback
before asserting latest-release recovery. Mail/live Facebook writes and the
recorded long Inbox transactions/worker shutdown behavior need follow-up. New
per-destination scheduling, history cursor and recipe migrations are pinned in
source; this status pass does not establish they ran on production.

The procedures and dated evidence below are retained as **historical pre-cutover
planning and batch records**, not current blockers or instructions to repeat the
switch. Their old migration counts, legacy-service statements and guarded-script
descriptions apply to those snapshots. Use current reviewed scripts and target
migration history for any release. The contract remains unchanged; a completed
switch alone does not establish every release gate or legacy capability.

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
   set `CUTOVER_APPROVED_MIGRATION_SET=20261015120000_mcp_api_keys,20261023100000_rebuild_worker_jobs,20261016190000_rebuild_inbox_deletions,20261016220000_rebuild_post_deletions,20261017010000_rebuild_publication_attempts,20261017020000_rebuild_facebook_media_steps,20261017030000_rebuild_facebook_media_deletions,20261017040000_rebuild_facebook_media_resolution,20261018150000_rebuild_notifications,20261018170000_rebuild_ads_operations,20261018190000_rebuild_ads_creation,20261018193000_rebuild_purge_write_gates,20261025100000_rebuild_task_comments,20261018230000_rebuild_sharing_expiry,20261018233000_rebuild_mcp_resource_scope,20261019010000_rebuild_report_runs,20261019011000_rebuild_report_purge_gate`.
   `rebuild/scripts/cutover-rehearsal.sh` pins those 17 SQL files by SHA-256,
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

## Current verification gaps — status updated 2026-10-21

- Full feature/legacy parity and UI/REST/MCP service/confirmation uniformity remain
  incomplete; see LEGACY_CAPABILITY_PARITY.md and MCP_PARITY.md.
- Production cutover, units/proxy and migration application are recorded for the
  original release. Later migrations and the exact deployed source revision need
  reconciliation; never infer target state from a checksum pin alone.
- Post-cutover rollback, complete backup/media restore and production-shaped
  authorization/write/export/erasure checks remain scope-specific evidence gaps.
- Live Facebook formats, scheduling, Inbox/Ads operations and actual MCP clients
  need outcome verification/cleanup. Preserve the held photo-canary ledger/lock.
- Current-theme browser/keyboard/failure states and remaining mail/security/
  operational checks are not closed by historical matrices or public health.

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

## Ads creation operation kinds (batch 75, validation in progress)

The allowlist contains eleven migrations. The eleventh,
`20261018190000_rebuild_ads_creation`, extends the Ads operation-kind CHECK to
campaign/ad-set creation without rewriting existing records. SHA-256:
`749fc69e2937588b95e7b050ebb49525e30b2624915abd2bdc92de6e92a899d0`.
The script pins this file, applies it after the ledger migration, and includes
its migration history in baseline refusals. A fresh local preview backup was
scratch-restored and migrated before preview application, preserving checked
legacy counts and settings digest. This proves that local additive step only;
full eleven-migration production-shaped rehearsal and release rollback remain
open. Production and its deployment command still target legacy.

On 2026-10-18 the complete eleven-file sequence passed against a schema-only
baseline derived from the isolated preview, excluding reviewed rebuild tables
and their two immutable trigger functions. Mapped-column/enum checks and a second
backup/restore matched across all public tables; scratch databases were removed.
All source rows were absent, so this proves SQL ordering/schema compatibility
and empty-database backup restoration only. The rehearsal now explicitly refuses
pre-existing rebuild functions as well as tables/history. Customer-data migration,
media recovery and production process/proxy rollback are still unverified.

## Workspace purge gate and task comments (batch 76 in progress)

The thirteen-file allowlist adds `20261018193000_rebuild_purge_write_gates`
(SHA-256 `5250ec9a2e1176d59f8dd97b6b86d622187b87bd2d3944c41c7a411d157b51d6`)
and `20261025100000_rebuild_task_comments`
(SHA-256 `648427469b965c3c5572b131c4834f772f1fdfe6884a0fd8c32aebc3588750ea`).
The purge table is an existing legacy prerequisite; its original create-table
migration is not replayed over an existing table. Catalog inspection found the
preview table without its trigger function, so the new additive reconciliation
installs/replaces that shared function and installs missing gates on directly
workspace-owned tables. Existing gates must name the expected function and be
enabled. The task-comments migration then attaches the same gate, enforces a
same-workspace task FK and adds author SET NULL/task cascade/body constraints.

Before local application, a fresh private preview backup restored into scratch;
both migrations applied there with unchanged counts for all 103 original public
tables and unchanged settings digest. Only then were they applied locally with
the same comparisons. Seven PostgreSQL tests pass for workspace/body integrity,
author/task lifecycle and erasure gates, with disposable fixtures rolled back.
This does not yet prove the full thirteen-file or production-shaped migration,
application export/erasure behavior or production service rollback. Production
remains legacy. The original purge migration file is unchanged.

Batch 76: all thirteen checksum-pinned migrations passed a schema-only scratch
rehearsal. The local actual HTTP/MCP export/erasure probe passed after dependency
ordering repair; purge guards remained enabled. This does not close production
data/media migration, service rollback or cutover gates.

Batch79 in progress: nullable share_links.expiresAt is locally applied via a
fresh private backup and scratch restore/migration. Original 104 table counts,
settings digest and share-link contents (excluding the new null column) matched.
Migration SHA256 28d4f9da65ed866f6139aa982d4756906cd329080dccf6cf2d87dee32e59d263.
All fourteen pinned SQL files passed a schema-only scratch rehearsal and eleven
cutover guard tests. Legacy null-expiry links stay stored but are not publicly
served by the rebuild; rotation/recreation requires a bounded lifetime. Production
was untouched. Full customer-data/media/service rollback remains open.

## Reports run history and purge gate — batch82 preparation

Two additive migrations preserve the legacy report templates, schedules,
recipients and `aiRecap` fields:

- `20261019010000_rebuild_report_runs`, SHA-256
  `caa0c553569cf9f984e973ceb6e3ee858750209c6d2931e1316d3323b4357c4a`.
  Adds workspace/target-owned run history, schedule SET NULL references, claims,
  leases, payload hashes and bounded-retention prepared artifacts. No legacy
  report rows are rewritten.
- `20261019011000_rebuild_report_purge_gate`, SHA-256
  `122e813070361737ba1a89d775d2f92922dadd36423debb83411e0d5a4aa5d9e`.
  Attaches the existing workspace purge write gate to report run INSERT/UPDATE;
  DELETE remains available to erasure. The first file was already applied to
  the isolated preview when the missing trigger was discovered, so its immutable
  SQL was preserved and the correction added as a separate migration.

Before local application, private mode-restricted backups were restored to
scratch databases and the unchanged SQL applied there. The base migration
preserved exact counts across 104 prior tables and report template/schedule and
Root-setting fingerprints. The follow-up restored the resulting 105-table
preview and applied its gate before changing the local preview. Backup SHA-256:
`2f46073f5b7da217bf839143480740214bc063eef3bde0e2486b53054400721a`
(base) and
`6b56da0f038953cb0cbf6c803ef64e0166e6630572192c9a927226c7b7d886b0`
(purge gate). Private backup paths are kept outside Git.

The rehearsal script now pins all 17 reviewed files, refuses preexisting report
objects or successful migration history, checks all 22 mapped run columns and
verifies the enabled purge trigger/function binding. An actual local schema-only
17-file rehearsal passed, including its independent backup/restore count check.
This contains no customer rows and proves neither production-shaped migration
nor app/permission behavior, media recovery or proxy/service rollback. Reports
functional, database concurrency and browser verification remain separate gates.
Production and `socialpilot-deploy` remain legacy.


## Batch85 additive format migration (local only)

The reviewed eighteenth migration `20261019020000_rebuild_destination_formats` adds nullable target format intent and version snapshot maps. SHA-256: `30325cdda1951cde93fab77a12bc349caa4422861fe133f68320ac3b979af6c6`. No existing target is backfilled or deleted. Before local application, a full private preview backup was restored into a disposable database and public table counts compared. Backup SHA-256: `468586569142294bf5d67ae96833c2951a74f78bfd4fce2be4f68a4d1f017b97`. Counts remained unchanged after application. The actual eighteen-file schema-only rehearsal passed, including its independent restore/count check. This does not prove production-shaped migration, media recovery or service rollback. No production migration or cutover occurred.


## Batch89 additive native journal migration (local only)

The19th checksum-pinned migration `20261019030000_rebuild_facebook_native_journal`
adds a workspace/parent-bound raw Facebook receipt table, integrity/alias triggers
and the shared purge write gate. SHA256:
`3ef505dccb5156ea1d84472998d19fb8427b1232669f57ca98a8ac6cd1e04d46`.
No existing rows are backfilled or deleted. Full private preview backup SHA256:
`eeb212859bae35198b4aab1ac67b50a1cb5e472d27df4675cdd18856067b45d4`.
An actual scratch restore matched all105 prior public table counts. Final SQL
applied there and passed scoped PostgreSQL concurrency/constraint/export/erasure
tests before local application. Exact backup/SQL identity, prior table counts and
Root setting fingerprint checks passed before/after local application.

The updated19-file schema-only rehearsal passed, including enabled guard/purge
triggers,19 raw-table columns, tenant/composite-parent FKs and independent
backup/restore comparison. No customer rows were present in that rehearsal. This
does not establish production-shaped migration, media restoration or service
rollback. Native customer formats remain disabled, and no production deployment
or live provider content belongs to this batch.


## Native proof and asynchronous receipt migrations — batches91–92

The reviewed sequence now pins21 files. Migration20,
`20261019040000_rebuild_facebook_native_status_proofs`, SHA-256
`253e8fb4f18b4cf60fcce16702772dd166358e641fb875c2781cb84d8dc767d4`, adds
provider-owned, append-only Root observations without granting dispatch authority.
Migration21, `20261019050000_rebuild_publication_submissions,20261019060000_rebuild_template_comment_delay`, SHA-256
`91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931`, extends
only the shared publication state/reason/receipt CHECKs. A submitted identity is
held until a matching verified outcome can be recorded and projected separately.
Active-claim uniqueness and purge write gates remain in force.

Both were applied only to the synthetic local preview after full backup and
scratch restore checks. Batch92's fresh pre-application backup SHA-256 is
`391f4067e5ba0b506b3d721be660a1abc2be6d94f5569c8629b19191368a410d`.
All107 preexisting table counts and exact Root settings matched after migration
and the final API/MCP/browser fixtures were removed. The disposable scratch was
removed; the full backup was retained privately. The complete21-file schema-only
rehearsal passed its independent backup/restore and valid/invalid submitted-row
checks. These are local schema/data checks, not production-shaped customer,
media, application or service rollback proof. Do not narrow allowed states on a
rollback while submitted receipts exist or discard their remote identities.
Production cutover remains blocked on the full release gates above.


## Batch94 additive delay checkpoint
Migration22 adds template/version delay fields; the post field is existing legacy
metadata newly mapped in rebuild Prisma. SQL is checksum-pinned in the staging
rehearsal, which passed the complete22-file schema-only path. Fresh local backup,
actual PostgreSQL workflow and browser/MCP evidence are recorded in
FIRST_COMMENT_SCHEDULING.md. Local example application and exact107-table/settings cleanup passed; scratch
removed and backup retained. The complete checkpoint is recorded there. No production migration, proxy/service change or cutover occurred.

## Read-only legacy data verification

Run `scripts/verify-legacy-migration.ts` from `rebuild/` against isolated restored
copies, after reviewing the production dump's handling and restoring its media.
It refuses every database URL except loopback TCP with a database name ending
`_preview` or `_rehearsal`; routing/schema override query parameters are refused.
It opens one repeatable-read, PostgreSQL-enforced **READ ONLY** transaction and
never starts services, applies migrations, imports settings, or contacts providers.
Use an account restricted to SELECT as an additional operational boundary.

First capture source counts and the names of persisted Root registry settings
from the local pre-migration copy (the command does not export their values):

```sh
# DATABASE_URL must already name the isolated source copy, never production.
TSX_TSCONFIG_PATH=tsconfig.json node --import tsx scripts/verify-legacy-migration.ts --snapshot > /private/tmp/legacy-source-counts.json
```

Then set `DATABASE_URL` to the migrated isolated copy, rehearse the configuration
import separately, and verify it against the source manifest and restored files:

```sh
TSX_TSCONFIG_PATH=tsconfig.json node --import tsx scripts/verify-legacy-migration.ts \
  --baseline /private/tmp/legacy-source-counts.json \
  --media-root /private/tmp/restored-legacy-media \
  > /private/tmp/legacy-migration-report.json
```

The JSON report includes actual/source counts, aggregate checks and `ok`; any
failure or unavailable check exits nonzero. Snapshot mode only captures a
baseline and is **not** a verification pass. Counts cover every public table,
a conservative superset of rebuild-used ORM and raw-SQL tables. New empty tables
are accepted; missing tables, changed counts and new nonempty tables fail. For
intentional additions (migration history, config-import audit/config rows), keep
the original manifest and create a separately reviewed expected-count manifest
with only documented exact deltas. Never capture a fresh target snapshot as the
source baseline to hide unexplained changes. Quiesce both copies while gathering
evidence; separate source/target runs cannot share a transaction snapshot.

Checks cover compatibility-view required tables/columns/nulls/enums and declared
relations even when FK constraints are absent, catalog FK orphans, workspace
boundaries, post destinations, member Page access, workspace owner memberships,
MCP feature/resource shapes and scoped resource ownership/current creator
membership. Stored pre-scope NULL MCP scopes retain their supported legacy
meaning. Root registry settings present in the source must remain present and
valid; legacy import candidates must have destination settings (nonsecret values
must match). Supply the same `APP_URL`, `SECURITY_TWO_STEP`, `LOGIN_ATTEMPTS` and
`LOGIN_WINDOW_MINUTES` used by the importer to include environment-backed import
requirements. Defaults need not all be persisted. Secret settings are checked
for encrypted envelopes only; decryption/equality and live provider grants remain
separate gates.

Post media JSON must contain image/video entries with nonempty URLs. Local media
storage keys and `media:` post references must resolve to regular files within
the restored root, without traversal or symlink components. Library references
must belong to the post's workspace; file-only images use
`<workspace>/images/<uuid>`. External URLs are not fetched. Filesystem contents
must remain stable during verification. This proves reference/file presence,
not bytes/checksums, unreferenced-file cleanup, arbitrary provider JSON semantics,
application authorization workflows, or real provider permission validity. The
report contains no row IDs, contents, credentials or secret values. Existing
migration, backup/media recovery, functional and cutover gates still apply.

Tests: `npx vitest run tests/verify-legacy-migration*.test.ts tests/raw-sql-void-guard.test.ts`.
The real PostgreSQL test requires `REBUILD_PREVIEW_DATABASE_URL`, applies the
same URL guard, reads existing isolated fixtures and verifies count drift without
mutating records. Without that variable it explicitly skips.

## Post-cutover rollback and installed-release restore drill

From `app/`, the release owner runs:

```sh
bash rebuild/scripts/prod-rollback-drill.sh
```

`PROD_HOST` and `PROD_KEY` use the same SSH bootstrap convention as
`prod-deploy.sh`. This is an operator-run recovery smoke test, not a deployment.
The script does not build, migrate, swap releases, start workers, change the proxy,
or issue commands against the live database or live service units. It uses the
retained `/srv/ms-social-pilot` legacy build and the **installed**
`/srv/ms-social-pilot-rebuild/rebuild` build, never `origin/main`. Preserve both
artifacts and avoid concurrent deployments while running it. Output identifies
both Next BUILD_ID hashes and the backup path/SHA-256; these identify tested
artifacts, not a verified Git revision. Correlate them with release evidence.

The newest existing `/var/backups/socialpilot-deploy-*/social_pilot.dump` by file
mtime is restored with `--exit-on-error --no-owner --no-acl` into
`social_pilot_drill`. No older backup fallback or automatic schema repair is
allowed. A pre-existing scratch database/role, occupied drill port, unsafe target,
or concurrent drill causes refusal. The fixed safety targets, local PostgreSQL
socket/port, host paths, readiness bounds and health paths are release bootstrap
constraints; they are not new application settings or Root policy. No registry
schema change is needed. PostgreSQL must be on the expected local cluster/socket
and the releases must have their installed Next CLI and production `.next` build.

Transient `socialpilot-rollback-{legacy,rebuild}-<pid>.service` units run as
`socialpilot`, binding only `127.0.0.1:3120` and `127.0.0.1:3121`. A fresh
non-inheriting read-only database role uses loopback TCP and the scratch database;
release `.env` files are hidden and production credentials are not copied.
Systemd makes release files read-only, blocks external IP traffic and prevents
privilege escalation. The host must support systemd's IP filtering/cgroup BPF
and filesystem isolation; verify enforcement on the host before accepting the
result. Loopback is allowed for PostgreSQL and probes. Only public table/sequence
reads are granted; encrypted-secret use and application writes are outside this
smoke test. Both builds see the same restored schema/data without migrations.
A dump predating schema requirements of the installed build can therefore fail:
retain that failure and resolve the backup/release recovery mismatch separately.

Legacy `/api/health` and rebuild `/sign-in` must each return HTTP 200 within the
readiness bound, with a separately named scratch connection visible in
`pg_stat_activity`; legacy is checked again after rebuild startup. Output records
restore and per-release readiness seconds. Exit/signal cleanup stops only this
invocation's transient units, drops only its newly created scratch database/role,
and removes private temporary environment files. Cleanup errors produce FAIL.
SIGKILL or host loss cannot run traps: inspect leftovers before retrying; the
script deliberately refuses to adopt or delete pre-existing resources. Unit
output is suppressed to avoid logging restored private records or credentials.

Only `ROLLBACK DRILL PASS` with exit code zero **after cleanup** is a passing
smoke result. Retain the timestamp, artifact/backup hashes, timings and verdict in
private release evidence. Static tests and shell syntax checks do not execute
this drill or close the production recovery gate. This test establishes limited
HTTP/database readiness of these two artifacts against that backup; media byte
recovery, authenticated workflows, provider writes, worker/queue ownership,
proxy switching and actual rollback execution remain separate release evidence.

Static checks (from `rebuild/`; the rebuild's `tests/operator-health-probes.test.ts`
asserts the same script contracts; the repository-root test named below is legacy):

```sh
npx vitest run --root .. --cache=false tests/rollback-drill-script.test.ts
npx tsc --noEmit -p .
```
