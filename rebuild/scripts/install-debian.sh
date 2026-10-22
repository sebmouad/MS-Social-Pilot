#!/usr/bin/env bash
#
# Install the MS Social Pilot rebuild on a fresh Debian 12 or 13 server.
#
#   sudo bash rebuild/scripts/install-debian.sh
#
# Installs Node.js 22 and PostgreSQL, creates a database and role (UTC), writes
# rebuild/.env with freshly generated bootstrap secrets (database URL and
# ENCRYPTION_KEY only; everything else is configured by Root at /root/config),
# installs dependencies, applies rebuild/prisma/migrations, builds, and offers
# systemd units for the web app and the single worker.
#
# Safe to run again: each step checks for its own result first, nothing that
# exists is recreated, and an existing .env or encryption key is never replaced.
# This script does not touch the legacy app, a proxy, or production data. A
# production cutover still follows docs/CUTOVER.md (prod-cutover.sh).

set -euo pipefail

DB_NAME="${DB_NAME:-social_pilot_rebuild}"
DB_USER="${DB_USER:-social_pilot_rebuild}"
APP_USER="${APP_USER:-$(logname 2>/dev/null || echo root)}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PORT="${PORT:-3200}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash rebuild/scripts/install-debian.sh" >&2
  exit 1
fi

grep -qi debian /etc/os-release 2>/dev/null || note "Written for Debian; apt package names may differ here."

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git openssl build-essential postgresql postgresql-contrib

installed_node_major() {
  command -v node >/dev/null 2>&1 || return 1
  node -p 'process.versions.node.split(".")[0]'
}

if [[ "$(installed_node_major || echo 0)" -ge "$NODE_MAJOR" ]]; then
  say "Node.js $(node -v) already installed"
else
  say "Installing Node.js ${NODE_MAJOR}"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi

say "Preparing PostgreSQL"
systemctl enable --now postgresql
psql_as_postgres() { su - postgres -c "psql -tAc \"$1\""; }

DB_PASSWORD=""
if [[ "$(psql_as_postgres "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" == "1" ]]; then
  note "Role ${DB_USER} already exists; leaving its password alone"
else
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  su - postgres -c "psql -q -c \"CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}'\""
  note "Created role ${DB_USER}"
fi
if [[ "$(psql_as_postgres "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" == "1" ]]; then
  note "Database ${DB_NAME} already exists"
else
  su - postgres -c "createdb -O ${DB_USER} ${DB_NAME}"
  note "Created database ${DB_NAME}"
fi
# Timestamps are stored as UTC and compared with NOW() in SQL.
su - postgres -c "psql -q -c \"ALTER DATABASE ${DB_NAME} SET timezone TO 'UTC'\""

cd "$APP_DIR"

say "Writing .env (bootstrap values only)"
if [[ -f .env ]]; then
  note ".env exists; not replaced"
else
  if [[ -z "$DB_PASSWORD" ]]; then
    echo "The role exists but .env does not: create .env by hand with DATABASE_URL and ENCRYPTION_KEY." >&2
    exit 1
  fi
  umask 077
  cat > .env <<ENV
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
PORT=${PORT}
ENV
  chown "$APP_USER" .env
  note "Wrote .env. Back up ENCRYPTION_KEY: stored secrets cannot be read without it."
fi

say "Installing dependencies"
su "$APP_USER" -c "cd '$APP_DIR' && npm ci"

say "Applying migrations"
su "$APP_USER" -c "cd '$APP_DIR' && set -a && . ./.env && set +a && npx prisma migrate deploy --schema prisma/schema.prisma"

say "Building"
su "$APP_USER" -c "cd '$APP_DIR' && npm run build"

say "systemd units"
read -r -p "    Install and start systemd units for the web app and the worker? [y/N] " reply
if [[ "${reply:-}" =~ ^[Yy]$ ]]; then
  cat > /etc/systemd/system/social-pilot-rebuild.service <<UNIT
[Unit]
Description=MS Social Pilot rebuild web
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  # Exactly one worker publishes: never enable this beside the legacy worker.
  cat > /etc/systemd/system/social-pilot-rebuild-worker.service <<UNIT
[Unit]
Description=MS Social Pilot rebuild worker
After=network.target postgresql.service social-pilot-rebuild.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now social-pilot-rebuild social-pilot-rebuild-worker
  note "systemctl status social-pilot-rebuild social-pilot-rebuild-worker"
else
  note "Skipped. Start by hand with: npm start   and   npm run worker"
fi

say "Done"
cat <<SUMMARY

    Open http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}

    1. Register the first account, then make it Root from the shell:
         cd ${APP_DIR} && npx tsx scripts/admin/set-root.ts you@example.com
    2. Sign in and open /root/config: set app.publicOrigin to the public https
       address, then the Facebook app, mail and AI providers.
    3. Lost two-step sign-in for Root:
         npx tsx scripts/admin/reset-two-step.ts you@example.com

    HTTPS is terminated in front of the app by a proxy. Check readiness at
    /api/health. Migrating existing data and cutover: docs/CUTOVER.md.

SUMMARY
