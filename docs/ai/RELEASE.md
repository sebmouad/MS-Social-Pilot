# Release and deployment (production)

Everything a new session needs to ship safely. Tested end to end many times on
2026-10-11.

## TL;DR

```bash
# 1. tests must pass (see TESTING.md)
# 2. commit on main
scripts/deploy/deploy.sh          # build on the server, migrate, swap, health-check
scripts/deploy/deploy.sh --rollback   # if something is wrong
```

`deploy.sh` refuses to run with uncommitted changes (only the committed tree is
shipped, via `git archive HEAD`). It ends with `DEPLOY_OK <hash>` when the app
and the three WordPress sites answer 200.

## The server

| What | Value |
|---|---|
| Host | `root@213.246.45.75` (Debian 12 bookworm, 915 GB disk) |
| SSH key (on the developer Mac) | `~/.ssh/SebMouadSSH` — always pass `-i ~/.ssh/SebMouadSSH` |
| Public URL | https://social.newsgeet.com |
| Web server | **OpenLiteSpeed** (`/usr/local/lsws`). Virtual host `socialpilot`, `vhRoot /www/socialpilot`, config `/usr/local/lsws/conf/vhosts/socialpilot/vhconf.conf`, `extprocessor socialpilot` → `127.0.0.1:3100`. Mapped to `social.newsgeet.com` in `/usr/local/lsws/conf/httpd_config.conf`. TLS is terminated by OpenLiteSpeed. |
| Other sites on the same box (must stay up) | recettes.newsgeet.com, desomemes.com, goltaf.com (WordPress) |
| App directory (live) | `/srv/ms-social-pilot` (owned by `socialpilot:socialpilot`) |
| Previous release | `/srv/ms-social-pilot.prev` (kept by every deploy, used by rollback) |
| Staging dir during a deploy | `/srv/ms-social-pilot.new` |
| Release tarballs and old scripts | `/root/deploy-socialpilot-20261009/` (`release-<hash>.tar`, old `stage-*.sh`/`swap-*.sh`, `database_url`, `env.backup`, `httpd_config.conf`, `nftables.conf`) |
| Environment | `/srv/ms-social-pilot/.env` (bootstrap only: DATABASE_URL, ENCRYPTION_KEY, SESSION_SECRET, APP_URL, PORT=3100, HOST=127.0.0.1, FACEBOOK_*…). Most settings live in the DB and are edited in **Settings → Configuration** (owner only). Never print or copy secret values. |
| Data | `/var/lib/ms-social-pilot` (HOME of the services; `media/` uploads) |
| Database | PostgreSQL 15 on the same host, database `social_pilot` |
| Node | v22 |
| Services (systemd) | `social-pilot` (web: `node scripts/start.mjs`, MemoryMax 2G, CPUQuota 200%) and `social-pilot-worker` (scheduler: `node --import tsx scripts/worker.ts`, MemoryMax 1G). Both `User=socialpilot`, `EnvironmentFile=/srv/ms-social-pilot/.env`, hardened (`ProtectSystem=strict`, `ReadWritePaths=/var/lib/ms-social-pilot /srv/ms-social-pilot/.next`). |
| Backups | `/usr/local/sbin/ms-social-pilot-backup` → `/var/backups/ms-social-pilot` (pg_dump `db-*.dump`, `media-*.tar.gz`, `env-*`), kept 14 days. Cron `/etc/cron.d/ms-social-pilot-backup`: 04:15 daily. Every deploy runs it first. |
| Health | `curl http://127.0.0.1:3100/api/health` on the server, or https://social.newsgeet.com/api/health → `{"status":"ok","worker":{"status":"ok",...}}` |
| Logs | `journalctl -u social-pilot -n 100`, `journalctl -u social-pilot-worker -n 100` (worker logs every publish: `[publish] Published post … url: …`) |
| Server clock | Europe/Paris in logs (CEST); the app works in UTC/workspace time zones |
| Hardening (2026-10-09 audit) | Applied once by `scripts/server/hardening-20261009.sh` (backups in `/root/audit-fix-20261009`). **Firewall (nftables): ports 80/443 accept only Cloudflare IP ranges** — every site must stay proxied through Cloudflare, and direct-to-origin requests time out; port 25 closed, Postfix loopback-only; SSH (22) open. OpenLiteSpeed trusts Cloudflare's real-IP header. phpMyAdmin limited to Moroccan IPs. WordPress: `DISALLOW_FILE_EDIT`, xmlrpc blocked. If Cloudflare publishes new ranges, update `CLOUDFLARE_V4/V6` in `/etc/nftables.conf`. Don't re-run the script. |

## What deploy.sh does (scripts/deploy/)

1. `git archive HEAD` → `/root/deploy-socialpilot-20261009/release-<hash>.tar`.
2. `remote-stage.sh` (piped over ssh with `H=<hash>`): copies the live tree to
   `/srv/ms-social-pilot.new` (keeps `.env` and caches), untars the release,
   `npm ci`, `npm run build` inside `systemd-run` with CPU/RAM/IO limits (so the
   WordPress sites are not starved), checks `.next/BUILD_ID`, prints `BUILD_OK`.
   **The live app is untouched until this succeeds.**
3. `remote-swap.sh`: backup → `prisma migrate deploy` → swap dirs (`live → .prev`,
   `.new → live`) → restart both services → poll `/api/health`.
   The single `curl: (7) Failed to connect … port 3100` line during restart is
   normal (Next is still booting); the next line must be the JSON health.
4. Checks the four public URLs.

Build takes ~2–3 minutes; downtime is the restart only (~5 s).

## Rollback

`scripts/deploy/deploy.sh --rollback` swaps `.prev` back and restarts. Database
migrations are not reversed — every migration so far is additive (new tables,
columns, enum values), so old code runs on the new schema. If a migration itself
broke data, restore the latest dump:

```bash
ssh -i ~/.ssh/SebMouadSSH root@213.246.45.75
ls -t /var/backups/ms-social-pilot/db-*.dump | head -1
# systemctl stop social-pilot social-pilot-worker
# runuser -u postgres -- pg_restore --clean -d social_pilot <dump>
```
Ask the user before restoring a database.

## Migrations

- Create: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://postgres:postgres@127.0.0.1:55432/sp_shadow2 --script > prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`
  (drop/create `sp_shadow2` first: `docker exec msp-test-pg psql -U postgres -c "drop database if exists sp_shadow2" -c "create database sp_shadow2"`), then `npx prisma generate`.
- Keep them additive. Postgres 15 allows `ALTER TYPE … ADD VALUE` in a migration.
- They run automatically in `remote-swap.sh`.

## Rules

- Deploy only after the unit and browser suites pass (TESTING.md). The one known
  failing unit test is the old daylight-saving test ("scheduling into an hour that
  does not exist") — pre-existing, not a regression.
- After deploying UI changes, verify on production in the user's Chrome (real data).
- Don't put the ssh command in a zsh variable (zsh does not word-split); the script
  uses a bash array.
- Don't read production database contents (the user's policy). Logs, service
  status and health are fine.
- Release history: `git log --oneline` on main; the deployed hash is the last
  `DEPLOY_OK` and the newest `release-*.tar` on the server.
