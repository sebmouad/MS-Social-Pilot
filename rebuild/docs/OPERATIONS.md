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

## Metric alert runbook (engagement batch, 2026-10-22)

Module: `src/modules/analytics/alerts/` (rules + worker evaluation).
Rules live in `metric_alert_rules`, firings in `metric_alert_firings`
(one open firing per rule). Root bounds live in
`analytics.alerts.policy` (rules per workspace, page sizes, rules
evaluated per run, transaction bounds); the worker cadence is
`analytics.alerts.schedule` (default every 10 minutes).

- **Evaluation:** the `analyticsAlerts` job reads enabled rules from
  active, non-purging workspaces and evaluates each in its own
  transaction: plan/channel authority is rechecked, the stored actual
  is read through the channel module's neutral measures (no provider
  calls), and a firing opens (once, with one notification-center
  entry) or resolves. Unknown measurements change nothing. The job
  summary ends with
  `examined=<n> fired=<n> resolved=<n> skipped=<n> failed=<n>`.
- **Audit:** firings write `analytics.metric_alert_fired` and
  resolutions `analytics.metric_alert_resolved` with `actorId` NULL
  (worker rows). Rule changes are audited manager writes.
- **Notifications:** firings emit `metric_alert` to eligible members;
  email follows the personal `onMetricAlert` switch (default on).
  Completed scheduled reports emit `report_delivered` (best effort;
  the run receipt stands without it). New inbox assignments emit
  `triage_assigned` to the new owner only.
- **Incidents:** to stop checks for one rule, pause it (owners/admins/
  editors; pausing resolves its open firing). There is no per-job kill
  switch: stopping the whole worker cadence needs `jobs.enabled` off
  (which stops every job). Never edit the alert tables by hand: rule
  changes are audited service writes.

## Supervised autopilot runbook (idea batch 2, 2026-10-22)

Module: `src/modules/studio/agents/` (policy surface + worker execution).
Workspace tiers live in `autopilot_policies` (one row per workspace; missing
row means `assisted`, today's behavior). Installation ceilings live in Root
`agents.autopilotPolicy` (sends/day ceiling, default quiet hours, new-channel
grace days, guardrail channel limit); a workspace policy can only narrow them.

- **Tiers:** `manual` (worker never runs; humans press Run now for drafts
  only), `assisted` (worker writes drafts; a person reviews, schedules and
  sends), `supervised_auto` (worker writes drafts and schedules them through
  the ordinary queue inside guardrails).
- **Guardrails:** approval-required workspaces, channel scope, drafts-only
  channels, new channels (within the grace window), uncertain channels (never
  published), quiet hours (workspace time) and the daily automatic-send cap.
  Every refusal keeps an honest draft and is audited; refusals never fail the
  run.
- **Audit:** automatic sends write `agents.scheduled.auto_scheduled` and
  refusals `agents.scheduled.auto_refused` with `actorId` NULL (worker rows,
  like `queue.bestTimesAdded`) and `actor: 'autopilot'` plus the tier in the
  detail. Run completions carry `tier`, `scheduled` count and `postIds`.
- **Provenance:** queue, Posts and Calendar show an Autopilot badge
  (`origin=autopilot` filter) for auto-scheduled posts; the agents screen
  history shows the tier and automatic-send count per run.
- **Jobs:** the existing `scheduledAgents` worker job
  (`agents.scheduledRunsSchedule`) executes tiers; its summary ends with
  `autoScheduled=<n> autoRefused=<m>`.
- **Incidents:** to stop all automation immediately, set the workspace tier to
  `manual` (owners/admins, exact `SET AUTOPILOT TIER manual` confirmation) or
  switch `agents.scheduledRunsEnabled` off. Already scheduled posts still send
  through the normal publish path; cancel them in the queue. Never edit
  `autopilot_policies` by hand: tier changes are audited service writes.

## Staging dry-run (platform/moat batch, 2026-10-23)

Root switch `jobs.stagingDryRun` (default off, `Sync schedules`). When on,
worker publish (`posts` due posts), first-comment (`posts` due first
comments) and automatic inbox moderation (`inbox`) dispatches are skipped
and each suppressed batch is audited as `worker.staging_dry_run`
(`actorId` NULL) with workspace, job, kind, count and a bounded id
sample, instead of sent. Local scheduling, drafts, reads,
reconciliation and every user-initiated action are unaffected, so a
rehearsal exercises the full local pipeline without touching providers.

- **Rehearse:** switch dry-run on, run the worker (or Run now on `posts`
  and `inbox`), then inspect Root activity for `worker.staging_dry_run`
  rows and the job summaries (`skipped=<n>` counts the suppressed
  dispatches). Switch dry-run back off before leaving rehearsal.
- **Incidents:** dry-run never changes post, comment or moderation state;
  suppressed dispatches simply run on the next live tick. There is no
  per-workspace dry-run: the switch covers the whole installation.

## Meta webhooks runbook (platform/moat batch, 2026-10-23)

Module: `src/platforms/facebook/webhooks.ts` (verify, parse, ingest).
Full contract: [META_WEBHOOKS.md](META_WEBHOOKS.md).

- **Subscribe:** set `meta.webhookVerifyToken` in Root, enter the same
  value plus `https://<host>/api/platforms/facebook/webhooks` in the Meta
  app dashboard webhook subscription (Page `feed` and `messages` fields),
  and confirm the handshake echoes. `meta.webhooksEnabled` stays on.
- **Diagnose:** Root, Facebook platform page, "Meta webhook deliveries"
  panel: the 50 most recent content-free receipts (outcome, matched
  channels, counts). `unmatched` means no eligible stored target, post
  or thread resolved; those events wait for the next sync. `duplicate`
  means Meta retried a delivery that already converged.
- **Rotate:** change `meta.webhookVerifyToken` in Root, then update the
  Meta dashboard value; deliveries signed with the app secret are
  unaffected. Changing `meta.appSecret` re-signs every delivery.
- **Pause:** switch `meta.webhooksEnabled` off. Deliveries are still
  verified and recorded as ignored without storing.
- **Incidents:** signature failures (`401`) mean the app secret and Meta
  disagree; handshake refusals (`403`) mean the verify token disagrees.
  Receipts older than `meta.webhookDeliveryRetentionDays` (default 30)
  are purged by the inbox job. Never edit `meta_webhook_deliveries` by
  hand: receipts are written only by ingestion.

## Analytics rollup runbook (platform/moat batch, 2026-10-23)

Module: `src/modules/analytics/rollups/` (worker + read preference) with
the Facebook stored-data mapper in
`src/platforms/facebook/rollups.ts`. Full contract:
[ANALYTICS_ROLLUPS.md](ANALYTICS_ROLLUPS.md).

- **Precompute:** the `analyticsRollups` job
  (`analytics.rollups.schedule`, default `30 1 * * *`) folds stored Page
  insights into `analytics_rollup_daily` and derives
  `analytics_rollup_weekly`, recording coverage per workspace in
  `analytics_rollup_runs`. No provider request is made. The summary ends
  with `workspaces=<n> examined=<n> written=<n> skipped=<n> failed=<n>`.
- **Reads:** overview, explorer and comparison prefer the rollups when a
  run finished today covers the request (window plus every selected
  channel); long ranges render weekly points with a catalog note, the
  current day always reads in detail, and anything uncovered falls back
  to detailed reads. The daily path is output-identical to detailed
  reads.
- **Incidents:** a missed or failed run only slows reads (they fall
  back); fix the worker and the next run refreshes the hot lookback.
  `partial` runs mean a workspace exceeds `batchTargets`: uncovered
  channels fall back until the batch grows. Never edit the rollup
  tables by hand; delete nothing to "refresh" them.
