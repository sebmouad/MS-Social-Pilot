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
cat << 'EOF' > .env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/social_pilot?schema=public"
APP_URL="http://localhost:3200"
SESSION_SECRET="replace-with-at-least-32-random-bytes-hex"
CREDENTIAL_ENCRYPTION_KEY="replace-with-64-hex-chars-for-aes-256-gcm"
MEDIA_STORAGE_ROOT="/tmp/ms-social-pilot-media"
EOF

# Apply database migrations & generate Prisma client
npx prisma migrate deploy
npx prisma generate

# Start the web server (http://localhost:3200) and background worker
npm run dev
npm run worker
```

### Verification Scripts
```bash
cd app
npm run typecheck   # TypeScript strict verification (tsc --noEmit)
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
bash app/scripts/deploy.sh --host <SERVER_IP> --user root --key ~/.ssh/id_ed25519 --port 2222 --app-port 3200
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

### What `deploy.sh` Automates
1. **System Provisioning (First Run)**: Installs Node.js 20, PostgreSQL, `rsync`, and `openssl` if missing; creates system user `socialpilot`, PostgreSQL database `social_pilot`, media directory `/var/lib/ms-social-pilot`, and `/etc/ms-social-pilot.env` with auto-generated cryptographic secrets.
2. **Code Sync & Build**: Syncs `app/` to `/srv/ms-social-pilot/app`, installs dependencies (`npm install`), generates the Prisma client, and compiles the production Next.js build (`npm run build`).
3. **Database Migrations**: Applies all pending SQL migrations in `app/prisma/migrations/` (`npx prisma migrate deploy`), including automatic migration of any legacy table names.
4. **Systemd Services & Health Check**: Configures and restarts `social-pilot.service` (Next.js server on `127.0.0.1:3200`) and `social-pilot-worker.service` (background job runner), then verifies `http://127.0.0.1:3200/api/health`.
