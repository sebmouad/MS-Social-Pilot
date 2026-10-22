# Operations: host, bootstrap, release (rebuild)

Self-contained operations record for the rebuild. The `prod-*`, `dev-*` and
`cutover-rehearsal` scripts in `rebuild/scripts/` read the production host from
the table below (`grep -o 'root@[0-9.]*' docs/OPERATIONS.md`, relative to
`rebuild/`). Keep exactly one `root@<ip>` address in this file.
Release procedure and gates: [CUTOVER.md](CUTOVER.md),
[RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md). Never print, copy or edit the
production environment file without the owner's approval.

## Repository layout (what a release contains)

Everything the rebuild needs lives under `rebuild/`: `package.json` +
`package-lock.json`, `prisma/schema.prisma` (the mapped client schema),
`prisma/legacy-schema.prisma` (full database model used for catalog tests and
migration authoring), `prisma/migrations/` (authoritative SQL migrations),
`scripts/` (deploy, backup, verification) and `docs/`. A release archive is
`git archive --prefix=rebuild/ <commit>:rebuild`. No root `package.json`,
`node_modules` or `.env` is used.

## Local development and checks

```bash
cd rebuild
npm ci                      # installs everything the rebuild uses; generates nothing yet
npx prisma generate         # client into rebuild/generated/client (also run by npm run build)
npm run typecheck
npm test                    # vitest run
npm run build
```

Bootstrap values (database URL, encryption key, session secret) come from the
process environment or `rebuild/.env*`; every operational value is a Root
setting. The worker reads `rebuild/.env` when present:
`npm run worker`.

## Production

| What | Value |
|---|---|
| URL | https://social.newsgeet.com, behind Cloudflare |
| Host | `root@213.246.45.75`, Debian 12; SSH key `~/.ssh/SebMouadSSH` on the developer's machine |
| Web server | OpenLiteSpeed, virtual host `socialpilot` (`/usr/local/lsws/conf/vhosts/socialpilot/vhconf.conf`), proxying to `127.0.0.1:3100`; TLS at OpenLiteSpeed |
| Live app | `/srv/ms-social-pilot-rebuild` (`.prev` previous release, `.new` staging, `-build` persistent build folder); app directory `rebuild/` inside it |
| Environment | `/srv/ms-social-pilot-rebuild/rebuild/.env.production.local` (mode 600, never printed) |
| Data | `/var/lib/ms-social-pilot` (media) and PostgreSQL database `social_pilot` |
| Services | `social-pilot-rebuild` (web) and `social-pilot-rebuild-worker` (worker), both `User=socialpilot` |
| Legacy fallback | Removed by `scripts/server-legacy-cleanup.sh` (lane 47): old release directories, old systemd units and the old deploy guard. Until that script runs, the old units stay stopped and disabled; never run them beside the rebuild worker (one publisher) |
| Neighbours | Three WordPress sites on the same server must stay up |
| Backups | `/usr/local/sbin/ms-social-pilot-backup` → `/var/backups/ms-social-pilot` (database dump, media, env), 04:15 daily; every `prod-deploy.sh` also takes `/var/backups/socialpilot-deploy-<time>/social_pilot.dump` first |
| Off-site backups | `rebuild/scripts/server/offsite-backup.sh`, `restore-test.sh`, `install-offsite.sh` (age-encrypted, rclone); results in Root › Backups |
| Health | `/api/health` on `127.0.0.1:3100` and the public origin |
| Logs | `journalctl -u social-pilot-rebuild -n 100`, `journalctl -u social-pilot-rebuild-worker -n 100` |
| Firewall | Ports 80/443 accept Cloudflare ranges only (`/etc/nftables.conf`); applied once by `rebuild/scripts/server/hardening-20261009.sh` (record only, do not re-run) |

## Deploy

```bash
bash rebuild/scripts/prod-deploy.sh      # from any directory in the checkout; ships origin/main
```

1. Reads the host from this file, resolves `origin/main`, orders the migrations
   in `rebuild/prisma/migrations` (reviewed order from `cutover-rehearsal.sh`
   first) and ships them plus `git archive` of `rebuild/` only.
2. On the host: pg_dump backup; incremental build in `/srv/ms-social-pilot-rebuild-build`
   (`npm ci` in `rebuild/` only when its `package-lock.json` changes, then
   `npm run build`, under `systemd-run` CPU/IO caps).
3. Applies unrecorded migrations as `postgres` without a wrapping transaction
   each (the baseline contains `ALTER TYPE ... ADD VALUE`, which PostgreSQL
   forbids inside a transaction block), records them in `_prisma_migrations`,
   hands table/function ownership to the app role. A database that already
   recorded the squashed migrations gets the baseline marked applied
   (resolve semantics) instead of re-running it.
4. Swaps directories, restarts web and worker, probes `/api/health`, the
   sign-in Origin check and the public origin. Any failure restores the previous
   release folder (database restore is manual; the dump path is printed).

## Rollback and restore

The previous release folder is `/srv/ms-social-pilot-rebuild.prev`; the deploy
script restores it automatically on a failed health check. Migrations are
additive and never reversed. A database restore needs the owner's approval:

```bash
ls -t /var/backups/socialpilot-deploy-*/social_pilot.dump | head -1
systemctl stop social-pilot-rebuild social-pilot-rebuild-worker
runuser -u postgres -- pg_restore --clean -d social_pilot <dump>
```

`rebuild/scripts/prod-rollback-drill.sh` proves a backup restores into a scratch
database and that the installed rebuild release starts against it (rebuild-only
since lane 47; the legacy half of the drill was retired with the legacy release).

## Migrations

Database history is one baseline migration, `20261103000000_baseline` (a squash
of the 140 reviewed migrations, proven equivalent by applying both to scratch
databases), plus later additive migrations. New SQL migrations go in
`rebuild/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`. Keep them
additive; shipped migrations are checksum-pinned by
`scripts/cutover-rehearsal.sh` and must never be edited. Add every new table to
`src/server/data-control/README.md`. `prisma migrate` is never used: the
project applies migrations with its own `_prisma_migrations` ledger and plain
`psql`, without a wrapping transaction, because `ALTER TYPE ... ADD VALUE`
forbids single-transaction application. Pin any new migration in
`cutover-rehearsal.sh` and rehearse it on a scratch database before release.

## Root recovery

`rebuild/scripts/prod-owner-reset-link.sh you@example.com` issues one audited
single-use reset link for an account while mail is unconfigured. Promoting
another installation owner or resetting a Root second step has no web path;
use the rebuild equivalents in `rebuild/scripts/admin/` (`set-root.ts`,
`reset-two-step.ts`) from `rebuild/` with the production database URL.

## Instagram connector runbook

Module: `src/platforms/instagram/` (installed, `platforms.instagram.enabled`
defaults to `false`). Full audit and live checklist:
[INSTAGRAM_LIVE_RUN.md](INSTAGRAM_LIVE_RUN.md).

- **Root prerequisites:** set `instagram.appSecret` (Graph signing secret),
  review `instagram.policy` (endpoint/version, bounds, required grants,
  metric requests, EN/FR copy), then switch `platforms.instagram.enabled` on.
  Access follows `platforms.instagram.includedByDefault` /
  `platforms.instagram.planFeatures`. No Facebook setting changes.
- **Connect:** customers use Settings › Channels › Instagram › Connect
  (`START CONNECTION instagram`); discovery reads only enabled, selected
  Facebook Pages and persists unselected encrypted clones. Grant health rows
  (publishing/comments/analytics) show missing scopes per connection.
- **Jobs:** the shared `analytics` job (`sync.analytics.schedule`) runs
  `syncInstagramAnalytics` (account metrics, profile snapshot, media window).
  Inbox sync is manual per channel; there is no inbox background job.
- **Evidence:** per-attempt container/publication intents live in
  `root_activities` (`instagram.publication_step`); the recovery host keeps
  unknown dispatches held and exposes content-free evidence to Root even while
  the module is off. Sync receipts use `instagram.analytics_synced`.
- **Incidents:** missing/expired grants fail closed with reconnect prompts —
  reconnect the parent Facebook Page, then re-run Instagram Connect to rotate
  clones. There is no remote media delete: remove test posts in the Instagram
  app. Only public HTTPS media URLs publish; stored-library bytes are refused
  until the signed-URL pipeline exists.
