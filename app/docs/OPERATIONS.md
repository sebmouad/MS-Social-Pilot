# Operations: Host, Bootstrap & Release

Self-contained operations guide for MS Social Pilot (`app/`). The `prod-*`, `dev-*` and `cutover-rehearsal` scripts in `app/scripts/` read the production host from the table below (`grep -o 'root@[0-9.]*' docs/OPERATIONS.md`, relative to `app/`). Keep exactly one `root@<ip>` address in this file.

Release procedure and recovery: [CUTOVER.md](CUTOVER.md). Never print, copy or edit the production environment file without the owner's approval.

## Repository Layout

Everything the application needs lives under `app/`:
- `package.json` + `package-lock.json`
- `prisma/schema.prisma` (mapped client schema)
- `prisma/migrations/` (authoritative SQL migrations)
- `scripts/` (deploy, backup, rehearsal, worker)
- `docs/` (architecture, API v1, MCP parity, operations, UI/UX roadmap)

A release archive is `git archive --prefix=app/ <commit>:app`. No root `package.json`, `node_modules` or `.env` is used.

## Local Development & Verification

```bash
cd app
npm ci                      # installs dependencies
npx prisma generate         # generates Prisma client into app/generated/client
npm run typecheck           # TypeScript strict check
npm test                    # Vitest test suite
npm run build               # Next.js production build
```

Bootstrap values (database URL, encryption key, session secret) come from the process environment or `app/.env*`; every operational value is a Root setting configured in `/root/config`. The background worker runs via `npm run worker`.

## Production Environment

| Property | Value |
|---|---|
| Public URL | `https://social.newsgeet.com` (behind Cloudflare) |
| Host | `root@213.246.45.75` (Debian 12; SSH key `~/.ssh/SebMouadSSH`) |
| Web Server | OpenLiteSpeed, virtual host `socialpilot` (`/usr/local/lsws/conf/vhosts/socialpilot/vhconf.conf`), proxying to `127.0.0.1:3100` |
| Live Release | `/srv/ms-social-pilot-rebuild` (`.prev` previous release, `.new` staging, `-build` persistent build folder); app directory `app/` inside it |
| Environment | `/srv/ms-social-pilot-rebuild/app/.env.production.local` (mode `600`, never printed) |
| Data & Storage | `/var/lib/ms-social-pilot` (media) and PostgreSQL database `social_pilot` |
| Systemd Units | `social-pilot-rebuild` (web) and `social-pilot-rebuild-worker` (worker), running as `User=socialpilot` |
| Backups | `/var/backups/socialpilot-deploy-<time>/social_pilot.dump` created automatically before every deploy |
| Off-site Backups | `app/scripts/server/offsite-backup.sh`, `restore-test.sh`, `install-offsite.sh` (age-encrypted, rclone); results surfaced in Root › Backups |
| Health Probe | `/api/health` on `127.0.0.1:3100` and the public origin |
| Service Logs | `journalctl -u social-pilot-rebuild -n 100`, `journalctl -u social-pilot-rebuild-worker -n 100` |

## Deployment

```bash
bash app/scripts/prod-deploy.sh      # from any directory in the checkout; ships origin/main
```

1. Resolves `origin/main`, orders migrations in `app/prisma/migrations` (baseline first) and archives `app/` to the production server.
2. Takes a fresh `pg_dump` backup (`social_pilot.dump`) and builds incrementally in `/srv/ms-social-pilot-rebuild-build/app` under `systemd-run` CPU/IO caps.
3. Applies unrecorded migrations as `postgres` without a wrapping transaction (`ALTER TYPE ... ADD VALUE` compatibility), records them in `_prisma_migrations`, and transfers object ownership to the app database role.
4. Swaps release directories, restarts web and worker services, and verifies `/api/health`, `/api/auth/sign-in` Origin protection, and public HTTPS readiness. Any health failure automatically restores `.prev`.

## Rollback & Restore

The previous release directory is `/srv/ms-social-pilot-rebuild.prev` and is restored automatically if post-swap health checks fail. Database restoration requires explicit owner approval:

```bash
ls -t /var/backups/socialpilot-deploy-*/social_pilot.dump | head -1
systemctl stop social-pilot-rebuild social-pilot-rebuild-worker
runuser -u postgres -- pg_restore --clean -d social_pilot <dump>
```

`bash app/scripts/prod-rollback-drill.sh` verifies that the latest backup restores cleanly into an isolated scratch database and starts the installed release against it with a read-only database role.

## Migrations

Database history starts from the squashed baseline migration `20261103000000_baseline` plus additive post-baseline migrations in `app/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`. Keep all new migrations additive, register new tables in `src/server/data-control/README.md`, and rehearse on a local scratch database via `bash app/scripts/cutover-rehearsal.sh`.

## Operational Runbooks

- **Root Account Recovery**: `bash app/scripts/prod-owner-reset-link.sh you@example.com` issues a single-use 30-minute password recovery link audited in `root_activities`. CLI promotion and 2FA reset scripts live in `app/scripts/admin/` (`set-root.ts`, `reset-two-step.ts`).
- **Signed Media Delivery**: `src/modules/publishing/server/media/signed-urls.ts` serves expiring workspace-scoped HMAC URLs at `GET /api/media/[id]?ws=&exp=&sig=` when `publishing.mediaShareSecret` and `app.publicOrigin` are configured in Root.
- **Metric Alerts**: `src/modules/analytics/alerts/` evaluates workspace metric alert rules on the `analyticsAlerts` worker schedule (`analytics.alerts.schedule`) against stored channel metrics.
- **Supervised Autopilot**: `src/modules/studio/agents/` enforces workspace autopilot tiers (`manual`, `assisted`, `supervised_auto`) within Root guardrails (`agents.autopilotPolicy`).
- **Staging Dry-Run**: Root toggle `jobs.stagingDryRun` suppresses outbound provider writes, chat notifications, emails, and webhooks from background workers while auditing suppressed batches as `worker.staging_dry_run`.
- **Meta Webhooks**: `src/platforms/facebook/webhooks.ts` verifies `X-Hub-Signature-256` against `meta.appSecret` and ingests Page feed and message events into stored tables with content-free receipts in `meta_webhook_deliveries`.
- **Analytics Rollups**: `src/modules/analytics/rollups/` precomputes daily and weekly rollups (`analytics_rollup_daily`, `analytics_rollup_weekly`) via the `analyticsRollups` worker job.
