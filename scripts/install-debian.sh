#!/usr/bin/env bash
#
# Install MS Social Pilot on a fresh Debian 12 (bookworm) or Debian 13 server.
#
#   sudo bash scripts/install-debian.sh
#
# Installs Node.js 22, PostgreSQL 16, and the packages the build needs; creates
# a database and a role; writes .env with freshly generated secrets; installs
# dependencies; applies the migrations; and offers to install systemd units for
# the web app and the worker.
#
# Safe to run again. Every step checks for its own result first, so a re-run
# after a failure resumes rather than starting over, and nothing that already
# exists is recreated. It never overwrites an existing .env or an encryption
# key already in use.

set -euo pipefail

DB_NAME="${DB_NAME:-social_pilot}"
DB_USER="${DB_USER:-social_pilot}"
APP_USER="${APP_USER:-$(logname 2>/dev/null || echo root)}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE_MAJOR="${NODE_MAJOR:-22}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/install-debian.sh" >&2
  exit 1
fi

if ! grep -qi debian /etc/os-release 2>/dev/null; then
  note "This is written for Debian. Continuing anyway; apt package names may differ."
fi

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# openssl for the secrets, git to update in place, ca-certificates so the
# Node and Postgres repository keys verify, build-essential because some
# dependencies compile.
apt-get install -y -qq \
  ca-certificates curl gnupg git openssl build-essential postgresql postgresql-contrib

# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------

installed_node_major() {
  command -v node >/dev/null 2>&1 || return 1
  node -p 'process.versions.node.split(".")[0]'
}

if [[ "$(installed_node_major || echo 0)" -ge "$NODE_MAJOR" ]]; then
  say "Node.js $(node -v) already installed"
else
  say "Installing Node.js ${NODE_MAJOR}"
  # Debian's own node package lags several major versions behind what this app
  # needs, so the NodeSource repository is used instead.
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi

# ---------------------------------------------------------------------------
# PostgreSQL role and database
# ---------------------------------------------------------------------------

say "Preparing PostgreSQL"
systemctl enable --now postgresql

psql_as_postgres() { su - postgres -c "psql -tAc \"$1\""; }

if [[ "$(psql_as_postgres "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" == "1" ]]; then
  note "Role ${DB_USER} already exists; leaving its password alone"
  DB_PASSWORD=""
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

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

cd "$APP_DIR"

say "Installing dependencies"
# `npm ci` when there is a lockfile: it is reproducible and considerably
# faster than resolving the tree again.
if [[ -f package-lock.json ]]; then
  su "$APP_USER" -c "cd '$APP_DIR' && npm ci"
else
  su "$APP_USER" -c "cd '$APP_DIR' && npm install"
fi

say "Writing .env"
su "$APP_USER" -c "cd '$APP_DIR' && npm run --silent setup" || true

if [[ -n "${DB_PASSWORD}" ]]; then
  # Only when this run created the role: on a re-run the password is not known
  # here, and rewriting the line with a blank one would break a working install.
  new_url="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"${new_url}\"|" .env
  note "DATABASE_URL points at ${DB_NAME}"
fi

say "Applying migrations"
su "$APP_USER" -c "cd '$APP_DIR' && npx prisma migrate deploy"

say "Building"
su "$APP_USER" -c "cd '$APP_DIR' && npm run build"

# ---------------------------------------------------------------------------
# systemd
# ---------------------------------------------------------------------------

say "systemd units"
read -r -p "    Install and start systemd units for the app and the worker? [y/N] " reply
if [[ "${reply:-}" =~ ^[Yy]$ ]]; then
  cat > /etc/systemd/system/social-pilot.service <<UNIT
[Unit]
Description=MS Social Pilot web
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
# So PORT=80 or 443 in .env works without running the whole app as root.
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

  # A separate unit rather than a second process inside one: a slow publish
  # must never block a page load, and either can be restarted on its own.
  cat > /etc/systemd/system/social-pilot-worker.service <<UNIT
[Unit]
Description=MS Social Pilot scheduler worker
After=network.target postgresql.service social-pilot.service
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
  systemctl enable --now social-pilot social-pilot-worker
  note "systemctl status social-pilot social-pilot-worker"
else
  note "Skipped. Start by hand with: npm start   and   npm run worker"
fi

say "Done"
cat <<SUMMARY

    Open http://$(hostname -I 2>/dev/null | awk '{print $1}')

    1. Create the first account. It becomes the owner.
    2. The Setup screen asks for your Meta app ID and secret.
    3. Connect a Facebook account from Connections.

    Set APP_URL in ${APP_DIR}/.env to the address people will actually use,
    including https://, before connecting Facebook — the OAuth redirect has to
    match it exactly.

    The app listens on PORT (80 by default) and serves plain HTTP. HTTPS is
    terminated in front of it — Cloudflare, or another proxy — because the app
    has no certificate handling of its own. The unit installed here carries the
    capability to bind port 80 without running as root.

SUMMARY
