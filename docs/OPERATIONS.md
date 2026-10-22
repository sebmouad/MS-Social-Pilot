# Operations: testing, settings, release

## Testing

Three layers before any deploy: typecheck, unit and integration, browser walk.
After deploying, check the change on production in a real browser with real
data. Small edits need the typecheck and the tests they touch; run the full
suites when a feature is finished and before a deploy.

### Test database (once per machine)

```bash
npm ci
scripts/dev/test-db.sh        # Docker: Postgres on 127.0.0.1:55432, database social_pilot_test
```

Without Docker (cloud sessions), run a local PostgreSQL on the same port, in UTC:

```bash
D=/var/tmp/msp-pg; mkdir -p $D && chown postgres $D
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 55432 -k /tmp -c listen_addresses=127.0.0.1 -c timezone=UTC' -l $D/log start"
psql -h 127.0.0.1 -p 55432 -U postgres -c "alter user postgres password 'postgres'" -c "create database social_pilot_test"
```

### Typecheck

```bash
npm run typecheck
```

There is no ESLint configuration.

### Unit and integration (Vitest)

```bash
env TZ=UTC TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npx vitest run
```

- Integration tests (`*.integration.test.ts`) create their own database through
  `tests/helpers/database.ts`.
- Use `TZ=UTC` for deterministic test wall clocks. The timeout HTTP-fixture suite can emit an Undici stream abort error on Node 24 even when every assertion passes; verify `tests/graph-timeout.test.ts` separately under Node 22 LTS when this occurs. Do not suppress unhandled errors.
- Convention guards, keep them green: `tests/locale.test.ts` (same keys,
  placeholders and ICU plurals in both catalogues), `tests/metadata.test.ts`
  (every page has a title), `tests/api-routes.integration.test.ts` (every API
  route answers 401 when signed out; contributor and root-only lists),
  `tests/tenant-isolation.integration.test.ts`, `tests/generic-content.test.ts`
  (no owner-, country- or niche-specific content), `tests/configuration-docs.test.ts`
  (every setting is listed below), `tests/documentation.test.ts` (paths and
  symbols named in these docs exist).
- Mock Graph and other networks with a local HTTP server and
  `FACEBOOK_GRAPH_BASE_URL` (see `tests/budget.test.ts`) or `vi.stubGlobal('fetch', …)`
  (see `tests/networks.test.ts`).

### Browser walk (Playwright)

Playwright is not in `package.json`; install it after each `npm ci`
(`e2e/README.md` explains why):

```bash
npm i --no-save @playwright/test
env PATH="$PWD/scripts/dev/bin:$PATH" \
  E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test \
  npx playwright test --reporter=line
```

- `playwright.config.ts` starts `next dev` on port 3100 (`E2E_PORT`) against a
  schema `e2e` that `e2e/prepare.ts` recreates. `E2E_PROD=1` walks a production
  build instead (`next build` then `next start`), which is faster for a full run.
  `E2E_BASE_URL` points at a server already running.
- Projects: `setup` (registers the first account), `chromium` (desktop) and
  `phone` (Pixel 7).
- The `psql` shim in `scripts/dev/bin` runs psql inside the Docker container;
  leave it off `PATH` when a real `psql` is installed. In cloud sessions set
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` rather than installing a browser.
- Every signed-in screen is listed in `SIGNED_IN_SCREENS` in `e2e/helpers.ts`
  and checked for console errors, phone overflow and accessible names. Add new
  screens there.
- Confirm dialogs: click `[data-confirm]` to accept, `[data-close]` to dismiss.
- Do not edit code while the dev-server walk runs. One spec:
  `npx playwright test e2e/phone.spec.ts -g "calendar"`.
- `npm run screenshots` writes screenshots to `test-results/screenshots`.

### Live check on production

After a deploy, verify the change in the owner's Chrome on production with
real data. Read-only checks are always fine. Publishing, deleting, messaging or
emailing needs the owner's OK for each action, on the agreed test Page only:
switch it on in Channels for the test, delete the test posts afterwards
("Delete from Facebook"), switch it off again. Automation quirks: the first
click after a navigation is sometimes lost (check and click again); prefer
coordinates from a fresh screenshot in long lists.

## Settings and environment

`.env` holds only what the app needs before it can read its database:

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/social_pilot
ENCRYPTION_KEY=          # openssl rand -base64 32; decrypts every stored token
SESSION_SECRET=          # openssl rand -base64 48; rotating it signs everybody out
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=             # set when behind a reverse proxy
```

Everything else is a runtime setting stored in the database and edited by root
(Root › Settings and Root › Platforms). Each setting can fall back to an
environment variable of the same name; Root › Settings flags values still read
from `.env` and offers to move them into the database. The registry is
`src/lib/settings/definitions.ts`; defaults shown:

```env
# General
APP_URL=http://localhost:3000
OPEN_REGISTRATION=false
LOGIN_ATTEMPTS=10
LOGIN_WINDOW_MINUTES=15
DEFAULT_LOCALE=en
CRON_SECRET=
SECURITY_TWO_STEP=admins

# Meta
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_GRAPH_VERSION=v26.0
FACEBOOK_GRAPH_BASE_URL=https://graph.facebook.com
GRAPH_TIMEOUT_SECONDS=60
GRAPH_UPLOAD_TIMEOUT_SECONDS=300
FACEBOOK_SCOPES=
FACEBOOK_ENABLE_GROUPS=false
FACEBOOK_ENABLE_MESSAGING=false
FACEBOOK_ENABLE_INSTAGRAM=false
FACEBOOK_ENABLE_ADS=false

# Scheduler
SCHEDULER_POLL_SECONDS=30
SCHEDULER_CONCURRENCY=4
SCHEDULER_MAX_ATTEMPTS=5
SCHEDULER_STALE_LOCK_MINUTES=15
RSS_POLL_MINUTES=15
EVERGREEN_CHECK_MINUTES=60
NATIVE_RECONCILE_MINUTES=15
TOKEN_EXPIRY_CHECK_HOURS=24
BULK_ROW_LIMIT=500

# Analytics
ANALYTICS_REFRESH_HOURS=6
PAGE_INSIGHTS_HOURS=12
EDGE_SYNC_HOURS=4
INSTAGRAM_SYNC_HOURS=12
ADS_SYNC_HOURS=12

# Other networks (Bluesky, Mastodon and Telegram need no app)
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
THREADS_CLIENT_ID=
THREADS_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
PINTEREST_CLIENT_ID=
PINTEREST_CLIENT_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=

# AI (models are fetched from each provider)
AI_PROVIDER=auto
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
AI_MODEL=
AI_RATE_LIMIT_PER_HOUR=100
AI_MONTHLY_BUDGET_USD=0
AI_PRICE_OVERRIDES=

# Alerts
ALERTS_EMAIL=
ALERTS_TELEGRAM_BOT_TOKEN=
ALERTS_TELEGRAM_CHAT_ID=
ALERTS_PUBLISH_FAILURES=5
ALERTS_DISK_PERCENT=85

# Email
EMAIL_PROVIDER=auto
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
RESEND_API_KEY=
EMAIL_FROM=

# Links and media
SHORTENER_DOMAIN=
MEDIA_DIR=./media
MAX_UPLOAD_MB=25
```

Network callbacks to register with each provider:
`https://<APP_URL host>/api/networks/<network>/callback`. Meta's addresses are
shown on Root › Platforms › Meta.

`ENCRYPTION_KEY` decrypts every stored token: changing it means every account
must reconnect, unless a migration re-encrypts the tokens (the ciphertext
carries a `v1:` prefix for that). Media in `MEDIA_DIR` needs a persistent
volume and belongs in the same backup as the database. Instagram fetches media
by URL, so `APP_URL` must be publicly reachable for Instagram publishing.

## Install on a fresh server

```bash
sudo bash scripts/install-debian.sh
```

Node.js 22, PostgreSQL, a database and role, `.env` with generated secrets,
dependencies, migrations, a production build and systemd units for the web
app and the worker. Re-runnable; never overwrites an existing `.env` or key.
`docker-compose.yml` and the `Dockerfile` are the container alternative. The
first account registered becomes root and finishes setup in the app.

## Production

| What | Value |
|---|---|
| URL | https://social.newsgeet.com, behind Cloudflare |
| Host | `root@213.246.45.75`, Debian 12; SSH key `~/.ssh/SebMouadSSH` on the developer's machine |
| Web server | OpenLiteSpeed, virtual host `socialpilot`, proxying to `127.0.0.1:3100`; TLS at OpenLiteSpeed |
| Live app | `/srv/ms-social-pilot` (`.prev` = previous release, `.new` = staging during a deploy) |
| Data | `/var/lib/ms-social-pilot` (media) and PostgreSQL 15 database `social_pilot` |
| Services | `social-pilot` (web, `node scripts/start.mjs`) and `social-pilot-worker` (`node --import tsx scripts/worker.ts`), both `User=socialpilot`, hardened, memory and CPU capped |
| Neighbours | Three WordPress sites on the same server (listed in `scripts/deploy/deploy.sh`) must stay up |
| Backups | `/usr/local/sbin/ms-social-pilot-backup` → `/var/backups/ms-social-pilot` (database dump, media, env), 04:15 daily, 14 days; every deploy runs it first |
| Off-site backups | `rebuild/scripts/server/offsite-backup.sh`, `restore-test.sh`, `install-offsite.sh` (age-encrypted, rclone); results in Root › Backups; not installed yet |
| Health | `/api/health` → `{"status":"ok","worker":{"status":"ok",…}}` |
| Logs | `journalctl -u social-pilot -n 100`, `journalctl -u social-pilot-worker -n 100` |
| Firewall | Ports 80/443 accept Cloudflare ranges only (`/etc/nftables.conf`); applied once by `rebuild/scripts/server/hardening-20261009.sh` (record only, do not re-run) |

The production `.env` is never edited, printed or copied without the owner's
OK, and production database contents are never read. Logs, service status and
health are fine.

## Deploy

```bash
npm run deploy            # scripts/deploy/deploy.sh: ship HEAD of main
npm run deploy:status     # live and previous release, services, newest backup, sites
npm run deploy:rollback   # swap the previous release back
```

`deploy.sh` refuses to run off `main` or with uncommitted changes, and ships the
committed tree only (`git archive HEAD`):

1. The release tarball goes to the server.
2. `remote-stage.sh` builds a clean copy in `/srv/ms-social-pilot.new`
   (`npm ci`, `npm run build` inside `systemd-run` with CPU, memory and IO
   limits so the WordPress sites are not starved). The live app is untouched
   until this succeeds.
3. `remote-swap.sh`: backup, `prisma migrate deploy`, swap the directories,
   restart both services, poll `/api/health`, keep the five newest releases.
   One `curl: (7) Failed to connect` line during the restart is normal.
4. It checks the app and the three WordPress sites and prints `DEPLOY_OK <hash>`.

Build takes 2–3 minutes; downtime is the restart (about 5 seconds). From the
server itself (inside `tmux`): `socialpilot-deploy [branch|tag|commit]`,
`--status`, `--rollback` (`scripts/deploy/server-deploy.sh`).

## Rollback and restore

`npm run deploy:rollback` swaps `.prev` back and restarts. Migrations are not
reversed; they are additive, so the old code runs on the new schema. If a
migration broke data, restore the latest dump, only with the owner's OK:

```bash
ls -t /var/backups/ms-social-pilot/db-*.dump | head -1
systemctl stop social-pilot social-pilot-worker
runuser -u postgres -- pg_restore --clean -d social_pilot <dump>
```

## Migrations

```bash
npx prisma migrate diff --from-migrations rebuild/prisma/migrations \
  --to-schema-datamodel rebuild/prisma/legacy-schema.prisma \
  --shadow-database-url postgresql://postgres:postgres@127.0.0.1:55432/sp_shadow \
  --script > rebuild/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql
npx prisma generate
```

Create the empty shadow database first. Keep migrations additive
(PostgreSQL 15 allows `ALTER TYPE … ADD VALUE`). They run during the swap.

## Root recovery

On the server, in the app directory with its environment loaded:

```bash
npx tsx scripts/admin/set-root.ts someone@example.com      # make another account root
npx tsx scripts/admin/reset-two-step.ts root@example.com   # root lost their second step
```

There is deliberately no web path for either. Other people's second step is
reset from Root › Users.
