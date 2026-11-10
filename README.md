# MS Social Pilot (`v1.0.0`)

Multi-workspace social media publishing, visual scheduling, unified inbox, analytics, paid ads management, WordPress/RSS CMS automation, and AI content studio built with **Next.js 15**, **React 19**, **TypeScript**, and **PostgreSQL (Prisma)**.

---

## Repository Structure

Only three root documentation files are kept at the repository root so AI coding agents and developers can orient with minimal context overhead:

- [`README.md`](./README.md) — Setup, architecture, CMS & platform connectors, and single-script production deployment (`app/scripts/deploy.sh`).
- [`AGENT.md`](./AGENT.md) — Complete engineering playbook, module map, database conventions, and coding rules for AI agents.
- [`PLAN.md`](./PLAN.md) — Competitor-inspired Product, Design & UX Master Plan (`v1.1+`) with file-by-file execution checklists.
- [`app/`](./app) — Next.js 15 application, background worker (`scripts/worker.ts`), Prisma schema & migrations (`prisma/`), and unified deployment script (`scripts/deploy.sh`).

---

## Core Capabilities

- **Publishing & Visual Calendar**: Multi-channel composer with media library, scheduled first comments, approval workflows, queue slots, bulk CSV import, and Month/Week/Day calendar.
- **Standard WordPress REST & RSS CMS Connector (`/content/feeds`)**:
  - **WordPress REST Recipe & Article Planner**: Connects to any standard WordPress site over HTTPS (`/wp-json/wp/v2/`) with **zero direct MariaDB/MySQL dependency**. Supports public WordPress REST APIs out-of-the-box or authenticated endpoints via WordPress Application Passwords (`username:xxxx`) / Bearer tokens. Automatically extracts custom post meta, featured media, Schema.org `Recipe` JSON-LD, WP Recipe Maker (WPRM) blocks, or standard post excerpts, and keeps daily channel time slots filled with scheduled posts and formatted first comments.
  - **RSS / Atom Feed Ingestion**: Polls external RSS/Atom feeds on a schedule and converts new items into drafts or scheduled posts.
- **Social Platform Connectors (`/channels`, `/root/platforms`)**:
  - **Primary (Enabled by default)**: **Facebook** (Pages, Reels, Stories, Native Scheduling, Inbox, Reviews, Insights, Meta Ads) and **Instagram** (Feed, Carousels, Reels, Stories, Inbox, Insights).
  - **Secondary (Toggled in `/root/platforms` or `/root/config`)**: **YouTube**, **TikTok**, **Pinterest**, **LinkedIn**, **X**, **Threads**, **Bluesky**, **Mastodon**, and **Telegram**.
- **Unified Social Inbox**: Comments, Messenger/Instagram DMs, saved replies, sentiment tagging, moderation rules, team assignment, and internal `@mention` notes.
- **Analytics, Reports & Meta Ads**: Cross-channel KPIs, daily/weekly rollups, custom metric alerts, scheduled PDF/HTML reports, and Meta Ads campaign/ad-set/ad management.
- **AI Content Studio**: Caption generation, custom brand voice writing agents, A/B hook testing, translation variants, and short-form video assembly.
- **Root Instance Administration (`/root`)**: Instance-wide runtime configuration, platform toggles, user/workspace governance, job health monitoring, and backup tracking.

---

## Local Development

### Prerequisites
- **Node.js** `>= 20.11`
- **PostgreSQL** `>= 15`

### Quick Start

```bash
cd app
npm install

# Configure environment variables (.env)
cat << EOF > .env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/social_pilot?schema=public"
SESSION_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -base64 32)"   # base64 of exactly 32 bytes
EOF

# Build the database from the SQL migrations & generate the Prisma client
for f in prisma/migrations/*/migration.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
npx prisma generate

# Start the web server (http://localhost:3200) and background worker
npm run dev
npm run worker
```

### Verification Scripts
```bash
cd app
npm run typecheck   # TypeScript strict verification (tsc --noEmit)
npm run lint        # ESLint (errors fail CI; warnings are reported)
npm test            # node --test suite
npm run build       # Prisma client generation + Next.js production build
```

---

## Production Deployment & Updates (`app/scripts/deploy.sh`)

A single unified script (`app/scripts/deploy.sh`) handles **fresh server installation**, **idempotent code/database updates**, and **administrator account management**. No server IPs, domains, or SSH keys are hardcoded.

### 1. Deploy or Update from Your Local Machine

Provide your target server IP/hostname (`--host`), SSH user (`--user`), and either an SSH private key (`--key`) or SSH password (`--pass`):

```bash
# Deploy using an SSH private key
bash app/scripts/deploy.sh --host <SERVER_IP> --user root --key ~/.ssh/id_ed25519

# Deploy using an SSH password (uses OpenSSH SSH_ASKPASS_REQUIRE=force)
bash app/scripts/deploy.sh --host <SERVER_IP> --user root --pass 'YOUR_SSH_PASSWORD'

# Custom SSH port or internal app port
bash app/scripts/deploy.sh --host <SERVER_IP> --user root --key ~/.ssh/id_ed25519 --port 2222 --app-port 3100
```

You can also pass parameters via environment variables:
```bash
DEPLOY_HOST=<SERVER_IP> DEPLOY_USER=root DEPLOY_KEY=~/.ssh/id_ed25519 bash app/scripts/deploy.sh
```

### 2. Run Directly on the Target Server (`--local`)

If you clone the repository directly onto your Linux server:
```bash
bash app/scripts/deploy.sh --local
```

### 3. Admin Account Helpers (`--set-root` & `--reset-2fa`)

```bash
# Promote a registered user to Instance Owner (Root Admin)
bash app/scripts/deploy.sh --host <SERVER_IP> --key ~/.ssh/id_ed25519 --set-root admin@example.com

# Reset two-factor authentication (2FA / TOTP) for a user
bash app/scripts/deploy.sh --host <SERVER_IP> --key ~/.ssh/id_ed25519 --reset-2fa admin@example.com
```

### What a deploy does
1. **First run**: installs Node.js, PostgreSQL and tools if missing; creates the system user `socialpilot`, the database `social_pilot`, the media directory `/var/lib/ms-social-pilot/media` and the environment file with generated secrets.
2. **Build apart**: builds the new version in its own directory as the `socialpilot` user and runs `npm test`; the running version is untouched until this passes.
3. **Backup, then migrations**: dumps the database to `/var/backups/ms-social-pilot/db/` and only then applies the pending SQL files of `app/prisma/migrations/`. If the dump fails, nothing is changed.
4. **Switch and check**: swaps the release, restarts `social-pilot.service` (web, `127.0.0.1:3100`) and `social-pilot-worker.service`, checks `/api/health`, and puts the previous release back if the check fails.

### On the server: `socialpilot-deploy`

`app/scripts/deploy-from-server.sh` is the script the server itself runs; a deploy installs it as `socialpilot-deploy` (`--status`, `--rollback`, `--restart`, `--logs`, `--logs-worker`). `deploy.sh` and `deploy-from-mac.sh` start a deploy over SSH from another machine.

### Automatic updates

A push to `main` is recorded by `POST /api/updates/github` (signed with the secret saved in Root › Configuration › Updates) and installed by the `social-pilot-updater` timer. The updater runs as root, so it only ever runs the scripts **installed on the server**, never a script taken from the pushed commit: a push can change the app, not what root executes. When a version changes the server scripts, the update log says so; run `socialpilot-deploy` on the server once to adopt them.

### Backups

`social-pilot-backup.timer` runs `app/scripts/backup.sh` every night: a compressed database dump (the last 14 are kept) and a copy of the uploaded media, under `/var/backups/ms-social-pilot/`. These sit on the same disk as the app. For a copy that survives losing the server, set `BACKUP_RSYNC_TARGET="user@host:/path"` in `/etc/ms-social-pilot-backup.conf`; each run then sends the backups there and Root › Backups shows the result.

```bash
socialpilot-deploy --status                       # services, health, running commit
bash /usr/local/lib/social-pilot-backup.sh --list # dumps kept on this server
sudo -u postgres pg_restore --clean --if-exists -d social_pilot /var/backups/ms-social-pilot/db/<file>.dump   # restore (stop the services first)
```

### Database schema

The SQL files in `app/prisma/migrations/` are the source of truth and are applied by the deploy script. `app/prisma/schema.prisma` is introspected from the resulting database and must describe every table; CI fails when they differ. Never run `prisma db push` or `prisma migrate dev` against a real database. After adding a migration, run `npx prisma db pull` against a migrated database and commit the schema with it.
