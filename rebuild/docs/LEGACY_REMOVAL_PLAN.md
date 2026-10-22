# Legacy removal plan (executed 2026-10-22 by lane 47; kept as the audit trail)

Prepared 2026-10-21; executed 2026-10-22 under owner approval ("delete all old
app files and doc from github and server and cleanup the new app from any
residues or old migration"). Production backup taken and restore verified
(`/var/backups/legacy-removal-202610221216`). Lane 47 deleted the tracked
legacy paths from the repository, squashed the migration history into the
`20261103000000_baseline` migration, removed the `OAuthCode` export/erase hooks
and the old migration-expectation helper, and produced
`scripts/server-legacy-cleanup.sh` (not run here) for the server-side removal
and the five legacy-only table drops. The phase plan below is the historical
record.

The binding [architecture contract](ARCHITECTURE_CONTRACT.md),
[cutover procedure](CUTOVER.md), [capability inventory](LEGACY_CAPABILITY_PARITY.md),
[contract audit](CONTRACT_AUDIT_2026-10-21.md) and
[legacy sweep](LEGACY_SWEEP_2026-10-21.md) govern removal. The sweep is present in
this checkout; older ARCHITECTURE/GOAL/DELIVERY_PLAN/AGENT_HANDOFF statements that
it is unavailable need reconciliation. Its “done” rows are static source evidence,
not proof that parity or retirement gates passed.

Cutover is recorded as completed on 2026-10-20, with legacy web/worker disabled
and the retained release at `/srv/ms-social-pilot`. No host state, installed
guard, deployed SHA, migration receipt or backup was inspected by this lane.
The repository still contains dependencies that prevent wholesale root removal.

**Phase 3 progress (2026-10-22, self-contained lane; source only, nothing run
against a host):** `prisma/schema.prisma` moved to `rebuild/prisma/legacy-schema.prisma`
and `prisma/migrations/` to `rebuild/prisma/migrations/` (folders and SQL bytes
unchanged, so checksums are identical). `rebuild/package.json` and its lockfile now
carry every dependency the rebuild imports (vitest, jsdom, tsx, sharp, nodemailer,
SimpleWebAuthn, Playwright); `npm test` uses the local vitest and the worker reads
`rebuild/.env`. Host/bootstrap facts moved to [OPERATIONS.md](OPERATIONS.md) and all
`prod-*`/`dev-*` scripts read it from there and operate from `rebuild/`.
`scripts/server/*` and `scripts/deploy/rebuild-*.sh` moved under `rebuild/scripts/`.
`prod-deploy.sh` now ships `git archive` of `rebuild/` only, installs and builds
only in `rebuild/`, and still takes a backup, migrates, swaps and health-checks.
The root `package.json` points Prisma at the moved legacy schema so the legacy tree
still builds until its removal batch. Remaining for phase 3: rebuild equivalents of
`scripts/admin/{set-root,reset-two-step}.ts` and `scripts/dev/test-db.sh`; a clean-checkout
`npm ci && npm run build` proof (the lockfile was merged from the root lock without
registry access; run `npm install --package-lock-only` once online to prune unused
entries); root `.claude/skills/db-migration` and the legacy `scripts/deploy/*` that
still cite old paths.

## Removal gates and sequence

Use these phase numbers in the inventory. “Safe” below always means safe **after
the stated prerequisites and these gates**, never safe merely because a path
contains “legacy”. Keep each removal batch independently reviewable/revertible.

1. **Freeze the retirement scope and recovery baseline.** Release owner records
   exact source/deployed revisions, migration checksums and applied history,
   units/drop-ins, proxy routing, scheduled jobs, media roots and installed helper
   locations. Preserve an immutable source/release archive and restricted backup
   of DB, media, environment and host configuration; verify checksums and an
   isolated full restore. Record the owner-approved observation window and its
   end, rollback trigger and recovery owner; this plan invents no duration.
2. **Close parity and recovery blockers.** Module owners reconcile every useful
   legacy capability and sweep finding against current source. Prove current
   UI/REST/MCP paths share authorized services, exact write confirmations and
   audit, including owner/member/viewer, cross-workspace and restricted-key
   refusal. Complete appropriate EN/FR browser, provider and real-client checks.
   Verify configuration migration, relationships/counts, media, export/erasure
   and live integration callbacks. Resolve uncertain remote work using the
   existing recovery services; preserve unresolved canary locks and receipts.
   Passing source guards or switching traffic does not satisfy this gate.
3. **Remove rebuild dependencies on legacy artifacts first.** Port needed
   bootstrap/admin/backup tooling, change build/install paths deliberately,
   replace legacy-backed probes and rehearse rebuild-only deployment and
   rollback. Keep root migrations at their current authoritative path unless a
   separate approved migration-tooling change relocates them atomically.
   Verify from a clean checkout with no root `src/` and no legacy release/env.
4. **Retire legacy entry points and repository application files.** Preserve a
   fail-closed legacy deploy guard/tombstone, retire callers and installers,
   then remove the legacy-only source/scripts/config/tests/assets in small
   batches. Update active docs and agent instructions together. Re-run the
   dependency checks and rebuild validation after every batch.
5. **Retire the host fallback last.** Only after phases 1–4, the observation
   window and an explicit owner retirement decision, archive then remove
   legacy unit files/drop-ins and release directories. Check proxy, process,
   timer/cron and filesystem references first. Keep rebuild services running;
   no legacy/rebuild publisher overlap is permitted. Validate public routing,
   auth, representative workflows, worker claims and backups afterward.
6. **Consider data retirement separately.** No table/column/key deletion belongs
   to application-tree cleanup. Each proven obsolete dataset needs its own
   ownership/retention decision, dependency catalog, restore evidence, reviewed
   root SQL migration and export/erasure tests. A code revert cannot recover
   deleted records; reconcile post-backup writes before any restore.

Stop if any check finds an unexplained consumer, if backup/restore fails, if a
publisher's ownership is uncertain, or if live capability/recovery evidence is
missing. Leave the affected artifact in place and assign its owner.

## Dependency checks

Run repository checks from the repository root unless marked otherwise. These
are discovery commands, not deletion commands. `rg` exit 1 means no match, not
proof of safety: inspect indirect imports, runtime/catalog discovery, generated
bundles and external consumers too. Scope-exclusion is intentional: a candidate's
own references are not external dependencies. Review every match; do not require
zero historical documentation mentions. Never print environment/config values,
credentials or customer records into an evidence report.

| ID | Command and required interpretation |
| --- | --- |
| C1 | `git ls-files src messages public tests e2e scripts docs` — save the exact candidate file list at execution time; compare against rebuild replacements and retained history. |
| C2 | `rg -n --hidden -g '!.git/**' -g '!node_modules/**' -g '!rebuild/node_modules/**' -g '!package-lock.json' -g '!**/.env*' -g '!src/**' -g '!tests/**' -g '!e2e/**' 'src/lib/\|src/components/\|messages/\|next.config.mjs\|tailwind.config.ts\|scripts/(worker.ts\|start.mjs\|setup.mjs)' .` — inspect legacy path consumers, including probe dynamic imports and automation. |
| C3 | `rg -n 'npm ci\|npm .*run\|node_modules\|package-lock\|prisma/(schema\|migrations)\|docs/OPERATIONS' rebuild scripts package.json README.md` — build, deployment, tests and migration ownership; no root package/lockfile deletion while consumed. |
| C4 | `rg -n 'socialpilot-deploy\|ALLOW_LEGACY\|social-pilot-worker\|/srv/ms-social-pilot' scripts rebuild .claude AGENTS.md CLAUDE.md README.md docs` — separate exact legacy paths from the rebuild's similarly prefixed paths. Review deployment skills as consumers. |
| C5 | `rg -n 'legacyConfigCandidates\|legacyFacebookSettingKeys\|legacy-import\|import-legacy-config\|SECURITY_TWO_STEP\|LOGIN_ATTEMPTS\|LOGIN_WINDOW_MINUTES\|APP_URL' rebuild` — importer, verifier, seed and fixture dependencies; compare setting coverage privately. |
| C6 | `rg -n 'server/root/legacy\|root.legacy.\|legacy-ops.css\|hashLegacy\|verifyLegacy\|LEGACY_SESSION_COOKIE' rebuild` — live Root/auth consumers; keep behavior/config identifiers until coordinated migration. |
| C7 | `rg -n 'legacy\|Legacy\|OAuthCode\|OAuthClient\|workspace_exports\|external_posts\|metric_availability\|page_videos\|notification_settings\|instagram_' rebuild/src rebuild/prisma rebuild/tests rebuild/scripts prisma` — trace actual reads/writes, raw SQL, export/purge and schema mappings, not just names. |
| C8 | `rg -n 'readFile\|readFileSync\|new URL\|prisma/migrations\|legacy\|Legacy' rebuild/tests tests e2e` — inspect tests' file dependencies; retain security, migration and migrated-data regressions even if their names contain legacy. |
| C9 | `rg -n 'docs/\|LEGACY_AGENT_GUIDE\|socialpilot-deploy\|scripts/server\|scripts/admin' README.md AGENTS.md CLAUDE.md rebuild scripts .claude` — active doc links, host-source dependencies and agent/skill commands must move before root docs/tooling. |
| C10 | `rg -n 'sw.js\|offline.html\|icon-192\|icon-512\|apple-touch-icon\|messages/' rebuild public src` — retire unused static/PWA/localization artifacts only after checking live references and cached service-worker clients. |

For a particular table substitute its **exact case-sensitive name** into C7
and inspect all SQL migrations and the actual PostgreSQL catalog. On an isolated
restored database, inspect `pg_constraint`, `pg_depend`, `pg_trigger`, `pg_views`,
`pg_proc` and `pg_indexes` for FKs, views, triggers/functions and dynamic SQL;
compare aggregate row counts and ownership before/after rehearsal. A partial
Prisma schema and source grep cannot certify that a table is unused.

Host checks below are **future release-owner checks**, not commands run here:

```sh
systemctl is-active social-pilot social-pilot-worker social-pilot-rebuild social-pilot-rebuild-worker
systemctl is-enabled social-pilot social-pilot-worker social-pilot-rebuild social-pilot-rebuild-worker
systemctl show social-pilot.service social-pilot-worker.service -p FragmentPath -p DropInPaths -p WorkingDirectory -p MainPID -p ActiveState -p UnitFileState
systemctl list-dependencies --reverse social-pilot.service
systemctl list-dependencies --reverse social-pilot-worker.service
systemctl list-timers --all --no-pager
readlink -f /srv/ms-social-pilot /srv/ms-social-pilot.prev /srv/ms-social-pilot.new /srv/ms-social-pilot.failed
rg -l --hidden '/srv/ms-social-pilot([/ .]|$)|social-pilot(-worker)?\.service|socialpilot-deploy' /etc/systemd/system /etc/cron.d /usr/local/sbin /usr/local/lsws/conf
rg -n 'rebuild|LEGACY|override|refus' /usr/local/sbin/socialpilot-deploy
```

Also inspect root/app-user crontabs, supervisor/container startup, unit drop-ins,
mounts/open-file users and the actual proxy config locations discovered on host.
Use metadata/filenames only where output might contain secrets. Disabled/inactive
legacy services alone do not prove no cron, process or external caller can
restart them. A passing sign-in probe alone does not prove worker or DB readiness.

## Repository removal inventory

All paths here are repository-relative. Rollback “source archive” means the
phase-1 immutable revision/archive plus verified install/build instructions;
Git history by itself does not preserve media, secrets or installed dependencies.

| Candidate path / action | Why removal can become safe; current dependency | Check | Order | Rollback note |
| --- | --- | --- | --- | --- |
| `src/` (entire legacy app: pages, API, provider code, components, libraries, styles and instrumentation) | Rebuild is the active app, but useful legacy capabilities must first be implemented/proven and legacy-backed probes replaced. Source remains a parity/recovery reference until then. | C1, C2, C4, C8; capability/sweep row-by-row review | 4 after 2–3 | Restore source archive; host traffic reversal still requires phase-1 recovery and a single publisher. |
| `messages/en.json`, `messages/fr.json` | Legacy translation catalogs; removable when no rebuild code, test or retained tool loads them and needed copy exists in owning bilingual runtime catalogs. | C1, C2, C10 | 4 with `src/` | Restore catalogs with the matching legacy revision. |
| Root `public/sw.js`, `public/offline.html`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/apple-touch-icon.png` | Legacy PWA assets; check rebuild branding references. Existing registered service workers may need a reviewed cache/unregister transition before removing their URL. | C10; browser cache/registration inspection | 4 after client transition | Restore versioned assets and reviewed cache behavior; deleting files does not unregister installed workers. |
| Root `next.config.mjs`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, generated root `next-env.d.ts`, root `.next/` and `*.tsbuildinfo` | Legacy build configuration/output only after rebuild compilation, CSS and generated imports are independently verified. Shared dependency/config resolution must be traced. | C2, C3; clean rebuild install/typecheck/build | 4 after 3 | Restore matching source configs; regenerate caches rather than treating caches as recovery assets. |
| Root `Dockerfile`, `docker-compose.yml`, `.dockerignore` if present | Legacy deployment topology; only retire when no operator/CI still uses it and a reviewed replacement covers DB, media, backup and worker ownership. | C1, C3, C4; `git ls-files '*Docker*' '*docker*'` | 4 after 3 | Retain images/config privately; do not remove volumes or shared DB with container cleanup. |
| Root package scripts `setup`, `dev`, `dev:worker`, `build`, `start`, `worker`, `screenshots` | Invoke legacy entry points. Replace operator/dev documentation and any automation consumers first. | C2, C3, C9; inspect `package.json` | 4 | Restore package scripts and their exact dependencies together. |
| Root package scripts `deploy`, `deploy:rollback`, `deploy:status` | Target legacy remote deploy/swap. Retire only with the guard and callers described below; never silently repoint to a different deployment. | C3, C4 | 4, after guard/caller transition | Retain guarded rollback procedures privately; restoring these scripts is not permission to restart legacy. |
| Root package scripts `typecheck`, `test`, `test:watch`; root `vitest.config.ts`, `playwright.config.ts`; root `tests/`, `e2e/` | Legacy suites can retire once useful assertions are ported and parity evidence preserved. Do not delete rebuild's own Vitest configuration or tests. | C8; compare capability/security/browser coverage with rebuild | 4 after 2 | Restore legacy tests with matching runtime/config; retain dated result summaries. |
| Root package scripts `db:push`, `db:migrate`, `db:studio`, `db:seed`, `db:demo`, `postinstall`; package `prisma.seed`; `prisma/seed.ts`, `prisma/demo.ts`, root `prisma/schema.prisma` | Legacy schema/fixtures, but root `postinstall` generates its client during root `npm ci`, and rebuild tests inspect the root schema. Port required tooling/fixtures and catalog assertions first. Do not replace this with production `db push`. | C3, C8; especially `rebuild/tests/inbox-data-control-coverage.test.ts` | 3 prepares, 4 retires | Restore schema/seed source without replaying destructive seeds or schema sync against production. |
| Root `package.json`, `package-lock.json`, root `node_modules/` | **Blocked wholesale.** Staging uses root lockfile/install; production installs root and rebuild; rebuild tests use `../node_modules/.bin/vitest`, worker uses `../.env`, and transitive imports rely on parent dependencies. Retain a shared tooling package or create a complete independently locked rebuild install before considering deletion. | C3; clean install/build/test/worker packaging with root dependencies absent | 3 before 4 | Restore both manifests/locks and generated clients; test executable resolution from clean checkout. |
| `scripts/setup.mjs`, `scripts/start.mjs`, `scripts/worker.ts`, `scripts/install-debian.sh` | Legacy bootstrap/server/worker and installer that writes/enables legacy units. Port needed host bootstrap and safe owner provisioning; retire installer so it cannot recreate removed services. | C2, C4, C9 | 3 port, 4 remove | Keep archived installer for isolated recovery only; never run it beside a rebuild publisher. |
| `scripts/admin/set-root.ts`, `scripts/admin/reset-two-step.ts`; `scripts/dev/test-db.sh`, `scripts/dev/add-messages.py`, `scripts/dev/bin/psql` | Legacy admin/dev tools; installation-owner bootstrap and account recovery need working rebuild equivalents, not just deletion of the sole tool. Keep synthetic-preview setup available. | C2, C9; inspect imports and exercise replacements on synthetic DB | 3 then 4 | Recover source privately; keep privileged tools off customer paths. |
| `scripts/deploy/deploy.sh`, `server-deploy.sh`, `remote-stage.sh`, `remote-swap.sh`, `remote-rollback.sh` | Legacy remote installer, swap and rollback machinery. Remove only after all entry points/installers are retired and recovery fallback is deliberately replaced. | C4, C9; installed helper comparison | 4; host artifacts in 5 | Archived script versions must match retained release; do not invoke old swap after source-only revert. |
| `scripts/deploy/rebuild-stage.sh`, `rebuild-verify-staging.sh`, `rebuild-deploy.sh`, `rebuild-rollback.sh` | **Classify individually.** Stage/verify are rebuild support; deploy/rollback currently include cutover gates/refusal guidance. Move useful tooling and update callers; do not delete `scripts/deploy/` as a legacy-only directory. | C3, C4, C9; `rebuild/tests/cutover-rehearsal.test.ts`, root `tests/deployment-files.test.ts` | 3 relocate/replace, 4 retire old paths | Restore wrapper/caller pair; keep refusal guards until replacement is proven. |
| `scripts/server/offsite-backup.sh`, `restore-test.sh`, `install-offsite.sh`, `hardening-20261009.sh` | **Preserve capability and source.** These underpin installed backups/restore records Root reads. Port maintained scripts to rebuild operations before retiring root copies; hardening is history, not a script to replay casually. | C4, C9; check installed paths, cron, Root `backup_runs` and restore evidence | 3 port, 4 remove old copies | Preserve restricted offsite/environment configuration, decryption material and tested old backup reader. |
| `.claude/skills/**`, root `AGENTS.md`, `CLAUDE.md`, `README.md`, `.env.example`, `.gitignore` | Retain shared project/security guidance; update legacy-only commands/skills and bootstrap examples. Remove obsolete skill instructions only after identifying their consumers. Keep secret/media ignores. | C2, C4, C9; inspect tracked hidden files | 3–4 | Restore guidance from archive without restoring unsafe deploy defaults or exposing actual env files. |

### Root documentation disposition

Every current root `docs/` file is listed below. “Archive” means retain a
sanitized, clearly dated history/recovery copy (or immutable revision plus an
active history index) before removing the active root path. Fix incoming links
with C9 and enumerate external runbook consumers. History must not become
current architecture or deployment instructions.

| Path | Why safe only after / dependency check | Order | Rollback note |
| --- | --- | --- | --- |
| `docs/OPERATIONS.md` | **Blocked:** rebuild production/stage/rehearsal/dev/reset scripts derive their host from this file. Move non-secret bootstrap/host documentation and every reader; archive host recovery/backup instructions. C3, C4, C9. | 3 migrate, 4 archive | Restore exact runbook/reader pair; archived host names do not establish current routing. |
| `docs/LEGACY_AGENT_GUIDE.md` | Retire legacy-only edit/deploy instructions once no legacy maintenance remains; update root agent references. C9. | 4 | Keep dated guide with recovery source. |
| `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/MODULAR_PRODUCT.md`, `docs/INTERNAL_STANDARDISATION.md` | Archive legacy architecture/design decisions; active design/architecture already belong to rebuild. Ensure unique parity requirements were transferred. C1, C9. | 4 after 2 | Restore historical references without replacing rebuild contract. |
| `docs/FEATURES.md`, `docs/PLAN.md`, `docs/PERMISSIONS.md`, `docs/QUALITY_AUDIT.md` | Preserve unique feature/security findings in parity/audit evidence first. These cannot be deleted to make missing capabilities disappear. C1, C8, C9. | 4 after 2 | Keep dated source/evidence for regression review. |
| `docs/META_API_NOTES.md` | Archive protocol/app-review findings; transfer still-applicable knowledge to Facebook-owned documentation and validate callbacks/config. C4, C9. | 3–4 | Restore historical notes; never restore obsolete protocol settings automatically. |
| `docs/README.md` | Replace incoming links with active rebuild docs/history index before deleting the old index. C9. | 4 last among docs | Restore link index or redirect references in source/docs together. |

Re-run `git ls-files docs` when executing: additions since this snapshot need
explicit disposition too. Keep `rebuild/docs/` contracts, parity reports,
cutover/release receipts and this plan. Annotate historical legacy mentions with
retirement status rather than erasing evidence. Updates to ARCHITECTURE.md,
CUTOVER.md, DATA_COMPATIBILITY.md, ROOT_LEGACY_OPERATIONS.md, GOAL.md,
DELIVERY_PLAN.md and AGENT_HANDOFF.md are integrator work outside this lane.

## Host retirement and the deploy guard

| Path / artifact | Why safe only after / dependency check | Order | Rollback note |
| --- | --- | --- | --- |
| `/usr/local/sbin/socialpilot-deploy`; repository `scripts/deploy/server-deploy.sh` and its installer | CUTOVER records a guard refusing legacy while rebuild is enabled (status/explicit override excepted), but this checkout's `server-deploy.sh` has **no such guard** and reinstalls itself. Confirm the installed implementation; retire installers/callers first. Prefer a permanent fail-closed tombstone at the old command path until all callers are retired. Never remove the guard while leaving an executable legacy deploy path. C4 plus host metadata/source inspection above. | 3 reconcile; 4 source retirement; 5 host retirement | Preserve exact guarded helper privately. Restoring the unguarded repository version would revive accidental legacy deployment. |
| `/etc/systemd/system/social-pilot.service`, `/etc/systemd/system/social-pilot-worker.service` and discovered drop-ins/enablement links | Only remove after verified inactive/disabled state, no reverse dependencies or scheduled restart paths, and approved retirement of the fallback. Discover actual `FragmentPath`/`DropInPaths`; installer paths are not host observations. | 5, before release deletion | Restore archived units/drop-ins, reload systemd and follow reviewed proxy/queue recovery. Stop/drain rebuild publisher before any legacy publisher starts. |
| `/srv/ms-social-pilot`, `.prev`, `.new`, `.failed` siblings | Remove exact legacy directories only after no process/unit/proxy/cron/probe/build loads them and independent DB/media/env/source recovery is proven. Inspect symlinks/mounts first. Never use a prefix wildcard: `/srv/ms-social-pilot-rebuild*` are active rebuild assets. C4 and host checks. | 5 after units/callers | Restore immutable legacy artifact to its documented path only under recovery plan; preserve post-cutover writes and reviewed schema compatibility. |
| `/root/deploy-socialpilot-20261009`, `/root/ms-social-pilot.git`, `/root/.ssh/socialpilot_deploy`, `github-socialpilot` SSH alias; `/run/socialpilot-deploy.lock` | Source names legacy staging/cache/key/lock locations. Verify actual use before cleanup; bare repo/deploy key may still support rebuild releases. Retire only dedicated artifacts after caller inventory. No secret contents in evidence. | 5, conditional | Keep necessary repository access; credential revocation requires replacement access and its own recovery procedure. |
| OpenLiteSpeed proxy/vhost fragments pointing to legacy; legacy cron/timers/container startup | Remove only legacy routes/restart hooks discovered on host after current rebuild routing/callback URLs are verified. Preserve unrelated sites and active rebuild proxy. C4, host filename scan, timer/crontab review. | 5 before deleting legacy release | Restore private config snapshot and reviewed reload sequence; reconcile writes and one-publisher ownership first. |
| `/usr/local/sbin/ms-social-pilot-backup`, `ms-social-pilot-offsite`, `ms-social-pilot-restore-test`; `/etc/cron.d/ms-social-pilot-offsite`, `/etc/ms-social-pilot/offsite.env`; `/var/backups/ms-social-pilot`, `/var/backups/socialpilot-deploy-*`, `/var/lib/ms-social-pilot` | **Retain:** names do not mean obsolete. Backup/offsite tooling and media are recovery/active-data dependencies; `prod-deploy.sh` still creates `socialpilot-deploy-*` and the drill discovers that prefix. Only rename/retire old copies after replacement backups, retention, restore readers, ownership and media references are verified. | 3 port; separate retention decision after 5 | Preserve DB/media/env backup sets, offsite keys and restore compatibility. Never erase backup history or shared media as release-directory cleanup. |

## Compatibility code and data: replace before removal

| Path / compatibility slice | Why safe only after / dependency check | Order | Rollback note |
| --- | --- | --- | --- |
| `rebuild/src/server/config/legacy-import.ts`, `rebuild/scripts/import-legacy-config.ts` | One-time typed Root import bridge for Facebook, AI and auth/origin options. Verify all required settings (including unimported operational settings in sweep §6), encrypted values privately, current schema validity and audited application; preserve restore/migration procedure before retiring importer. C5. | 3 verification; 4 optional retirement | Keep importer with matching schemas/crypto in recovery archive. Do not replay `--apply` blindly or drop `app_settings`. |
| `rebuild/scripts/verify-legacy-migration.ts`, `rebuild/scripts/cutover-rehearsal.sh` | Still needed for migration, counts/media/config/authorization checks and checksum/order dependencies consumed by production deployment. Split durable upgrade/restore verification from one-time legacy checks before deleting anything. C3, C5, C7, C8. | 3 replace; retain until evidence complete | Keep old verifier and immutable SQL checksums for restoring older backups. |
| `rebuild/scripts/prod-cutover.sh`, `prod-rehearsal.sh`, `prod-stage-drill.sh`, `prod-rollback-drill.sh`; `scripts/deploy/rebuild-*` | Historical cutover/rehearsal and legacy fallback/env/service dependencies. Replace necessary staging/recovery drills with rebuild-only equivalents first. `prod-deploy.sh` remains active and must keep migration/backup/swap-back behavior. C3, C4. | 3 replace; 4 archive historical scripts | Retain tested old procedures privately; do not replay one-shot cutover against a current DB. |
| `rebuild/scripts/verify-facebook-live-read.mjs`, `verify-facebook-live-media.mjs` | Dynamically import root `src/lib/settings/index.ts`, `env.ts`, `crypto.ts` via an external app-root argument. Replace credential loading/probes through the configured Facebook module and existing shared services before root `src/` retirement. Keep unresolved canary ledger/lock and remote cleanup capability. C2, C4. | 3 before 4 | Preserve pinned engine/defaults/ledger in restricted recovery storage; never repeat a possibly submitted remote write to test removal. |
| `rebuild/src/server/root/legacy/**` (including audit/authz/backups/config/copy/errors/http/index/connection-refresh/connections/lifecycle/mcp/plans/policy/privileges/sessions/shared/transfer); `rebuild/src/app/root/plans/legacy-ops.css` | **Live rebuild Root services/styles, not dead legacy app.** Relocate product implementation into Root-owned module structure with thin callers, retaining installation-owner checks, confirmations, audit and settings IDs. Rename CSS only with callers. C6, C8. | 3 coordinated refactor; no functionality deletion | Revert caller/implementation/style moves together; old persisted `root.legacy.*` keys need a separately versioned config migration if renamed. |
| `rebuild/src/server/data.ts` legacy storage readers; `server/{account-settings,connection-mutations,post-mutations}.ts` compatibility exports | Shared Prisma/auth infrastructure remains necessary. Move product readers/re-exports to owning modules only after all imports migrate; provider reads belong in platform adapters. No mass file deletion. C2, C6, C7; `rg -n 'server/(data\|account-settings\|connection-mutations\|post-mutations)' rebuild`. | 3 module-by-module | Revert moves atomically; preserve tenant/resource scope, visibility and safe error projection. |
| `rebuild/src/server/auth.ts`, `auth-flow.ts`, `two-step.ts`, `secret-crypto.ts` and migrated credential formats/cookie names | **Retain compatibility:** legacy-named password/session helpers authenticate current users. Any eventual replacement needs verified hash/session/encryption migration and recovery, not a grep cleanup. C6, C7. | Separate security migration after 2 | Preserve decryption trust material and login recovery; source rollback alone cannot reverse re-encrypted records or invalidated sessions. |
| `rebuild/src/modules/publishing/server/publication.ts`, `publication-guard.ts`, `lifecycle.ts`, `first-comment-state.ts`, recovery route/UI/MCP legacy-adoption branches | Adopt/reconcile migrated processing destinations and uncertain remote outcomes. Remove only after an inventory proves no unresolved old work and an equivalent recovery path exists across UI/REST/MCP. C7, C8; `rg -n 'adoptLegacy\|adopt_legacy\|legacy' rebuild/src/modules/publishing rebuild/src/app/api/publishing`. | 3 reconcile; optional later 4 | Keep durable attempts, aliases, remote IDs and locks; never reset an uncertain destination into a fresh publish. |
| `rebuild/src/platforms/facebook/{analytics,post-performance,page-insights,destination-measures,jobs}.ts` and `rebuild/prisma/schema.prisma` mapped legacy storage | **Retain active reads/writes** of insights, external posts and published targets. Replace only with lossless verified storage/backfill and provider-owned normalization; keep source identity and metric semantics. C7, C8. | Separate data migration, phase 6 | Preserve original data and schema mapping until counts/relationships/metrics and restore are verified. |
| `rebuild/src/server/data-control/{index,archive,account}.ts`; Settings notification/integration services reading old tables | Catalog-discovered `legacyTables`, indirect children, `OAuthCode` account cleanup, notification preferences and grants are active portability/security behavior. Keep export redaction, tenant checks, purge gates and dependency ordering. Payload names are compatibility contracts too. C7, C8; data-control README. | 6 only after replacement coverage | Restore readers with exact data schema; do not claim a rollback can recover erased personal data. |

### Database boundaries

**Keep root `prisma/migrations/**` and `_prisma_migrations`.** Both legacy and
rebuild migrations live there, and current deployment/rehearsal/tests use their
paths/checksums/order. Never delete historical SQL because its table predates the
rebuild. Rebuild's Prisma schema is a partial compatibility view, not proof that
unmapped tables are obsolete. No new migration is proposed by this lane.

Active or retained data includes identity/security (`users`, `sessions`,
`passkeys`, `recovery_codes`, `trusted_devices`, `memberships`, invitations and
email tokens); workspaces/plans/permissions/settings; social accounts/targets;
posts/destinations/versions/notes/labels/templates/fields/queue/mix; Inbox
comments/reviews/conversations/messages/moderation; analytics external posts,
Page/Instagram/Ads insights and `ads_objects`; media, links/clicks, feeds,
sharing/bio/reviews, tasks; reports/webhooks/notifications; Root operational
history (`backup_runs`, `system_alerts`, `error_events`, worker/audit records).
Keep all `rebuild_*` tables and pending recovery/purge/outbox state. Use sweep §7
and the actual catalog for the complete execution-time list.

Do not discard data for missing/unproven capabilities: `ai_agents`,
`ai_generations`, `ai_videos`, `calendar_feeds`, `chart_notes`, `caption_tests`,
`chat_channels`, `client_invitations`, `api_tokens`, `snippets`, `uptime_days`,
`public_holidays`, `holiday_years`, `trending_topics`, `key_dates`, `seasonal_modes`,
`changelog_entries`, `worker_job_runs`, `graph_usage`. C7 plus catalog/data-control
ownership review applies to each; missing UI is not an obsolescence decision.

Possible **later** retirement candidates are the old `workspace_exports` and
legacy connector registration/code tables, after export files/jobs expire or
migrate and connectors are explicitly migrated/re-registered. The sweep calls
the latter `oauth_clients`/`oauth_codes`; source/account data control explicitly
references quoted `"OAuthCode"` and migrations also name `"OAuthClient"`.
Resolve the actual case-sensitive catalog names and every cleanup/export caller
before proposing a DROP. Their removal is not safe at this snapshot. Keep
`rebuild_workspace_exports`, `rebuild_export_file_cleanups`, `mcp_oauth_clients`
and `mcp_oauth_codes`. Never drop `app_settings`: rebuild Root and account
appearance use it. Retire obsolete keys individually only after full setting
coverage, secure recovery and no runtime/import/restore consumer are verified.

## Tests that mention legacy

| Paths | Disposition, dependency check and order | Rollback note |
| --- | --- | --- |
| Root `tests/**`, `e2e/**`, including `tests/deployment-files.test.ts` and fixture/helpers | Port unique capability/auth/tenant/provider assertions before retiring the legacy harness in phase 4; C1, C8. Keep dated evidence; root suite is not rebuild verification. | Restore matching harness/config/source from archive. |
| `rebuild/tests/legacy-config-import.test.ts`, `verify-legacy-migration.test.ts`, `verify-legacy-migration-fixtures.test.ts`, `verify-legacy-migration-postgres.integration.test.ts` | Keep while importer/verifier or old backup restoration exists. Archive only with retired one-time tooling after phase 3 and new upgrade/restore coverage; C5, C8. | Restore fixtures with corresponding importer/schema version. |
| `rebuild/tests/root-legacy-{services,sessions-connections,http-mcp}.test.ts`, `legacy-round9-ui.test.ts`, `root-connection-*.test.ts`, `root-operations.integration.test.ts` | Live Root capability/security regressions; rename/update imports during Root ownership moves in phase 3, retain assertions. C6, C8. | Revert names/imports with implementation, never delete installation-owner refusal coverage. |
| `rebuild/tests/cutover-rehearsal.test.ts`, `inbox-data-control-coverage.test.ts`, migration/schema/journal constraint tests | Some inspect root schema or root migration files. Replace retired schema lookups with equivalent catalog/rebuild-owned assertions; keep SQL/history checks while migrations remain authoritative. C3, C8; phase 3 before root schema/tool deletion. | Restore checks and schema/migration paths together. |
| `rebuild/tests/notifications-legacy-preferences.test.ts`, `account-settings.test.ts`, `auth.test.ts`, `data-control*.test.ts`, `publication-recovery-*.test.ts`, `first-comment*.test.ts`, `publishing-lifecycle.test.ts`, `platform-boundaries.test.ts`, `report-link-details.test.ts` and every additional C8 match | Migrated preferences, credentials, exports, scope, recovery and absence-of-old-boundary regressions stay. Review matches individually; update fixtures only after proven data/behavior migration. Phases 3/6, no blanket legacy-name deletion. | Retain old-format fixtures as long as supported backups/data can contain them. |

Re-run C8 on the final removal diff to discover tests not named above; this is a
dependency classification, not permission to delete every matching test.

## Verification and integration handoff

Documentation-only change: no screen, runtime capability, REST route, MCP tool,
Root key, registry version, migration or data ownership behavior changes.
MCP_PARITY needs no new capability row for this plan. No design skill/browser
claim applies because no screen changed. Future implementation batches must
update their mappings, config registration and data-control ownership as needed.

Fresh local validation from `rebuild/`:

- `npx tsc --noEmit -p . --incremental false`: **PASS**, exit 0, zero errors.
  Incremental output was disabled to avoid writing build artifacts.
- `npx vitest run tests/parity-guard.test.ts tests/config-validation.test.ts --no-cache`:
  **PASS**, 2 files / 29 tests (22 parity, 7 configuration).
- `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --no-cache`:
  **NOT GREEN**, exit 1; 643 files passed, 1 failed, 49 skipped;
  9,888 tests passed, 5 failed, 2,083 skipped. All five failures are in
  `tests/facebook-native-http.test.ts`: sandbox refusal to bind loopback
  (`listen EPERM: operation not permitted ::1`). No successful socket/provider
  execution is claimed. Database-dependent skips are not database proof.
- No test/source files were changed or added, so no changed-file targeted suite
  applies. No app preview/server, deployment or production operation was run.
  The required suite attempted its own ephemeral socket fixtures as above.
  `--no-cache` avoids writing to the external symlinked dependency cache.
- New-file whitespace check: `git diff --no-index --check /dev/null
  rebuild/docs/LEGACY_REMOVAL_PLAN.md` from repository root produced no whitespace
  errors (exit 1 is expected because this is a new file).

No test results here establish production safety or authorize phases 3–6.

Outside this owned file, integration owners need to:

- Reconcile ARCHITECTURE/GOAL/DELIVERY_PLAN/AGENT_HANDOFF with the present sweep,
  link this plan, and assign owners/evidence for each retirement gate.
- Release owner reconciles the installed deploy guard against the unguarded
  source, ports host/admin/backup tooling and `docs/OPERATIONS.md` consumers,
  and proves independent rebuild installation/deployment/recovery before cleanup.
- Root/module/security/data owners perform the specific compatibility moves and
  parity/config/data decisions above; retain shared-service authorization,
  confirmations, audit and provider isolation. Preserve unresolved canary work.
- Only the release owner can record the future host inspection, approved
  retirement window, exact recovery artifacts and eventual removal receipts.
  This worker has not performed them and leaves this file for integration.
