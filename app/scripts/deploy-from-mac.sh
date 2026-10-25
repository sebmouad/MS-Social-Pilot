#!/usr/bin/env bash
# Deploy MS Social Pilot from Mac to Remote Production Server
#
# Usage:
#   ./deploy-mac.sh                     # uses defaults (213.246.45.75, root, ~/.ssh/SebMouadSSH)
#   bash app/scripts/deploy-from-mac.sh
#   npm run deploy
#
# Flags:
#   --host <ip_or_domain>   Destination host (default: 213.246.45.75 or $DEPLOY_HOST)
#   --user <username>       SSH user (default: root or $DEPLOY_USER)
#   --key <ssh_key_path>    SSH private key path (auto-detected if omitted)
#   --port <ssh_port>       SSH port (default: 22 or $DEPLOY_PORT)
#   --app-port <port>       Application port on server (default: 3100)
#   --skip-git-check        Skip checking for uncommitted git changes or unpushed commits
#   --auto-push             Automatically push unpushed commits to origin before deploying
#   --help                  Show this help message
set -euo pipefail

# ANSI Color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

log_info()  { printf "${BLUE}${BOLD}[INFO]${RESET} %s\n" "$*"; }
log_step()  { printf "${CYAN}${BOLD}[STEP]${RESET} %s\n" "$*"; }
log_ok()    { printf "${GREEN}${BOLD}[OK]${RESET} %s\n" "$*"; }
log_warn()  { printf "${YELLOW}${BOLD}[WARN]${RESET} %s\n" "$*"; }
log_error() { printf "${RED}${BOLD}[ERROR]${RESET} %s\n" "$*" >&2; }

# Locate repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$SCRIPT_DIR")")"
cd "$REPO_ROOT"

# Default configuration
DEPLOY_HOST="${DEPLOY_HOST:-213.246.45.75}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_KEY="${DEPLOY_KEY:-}"
APP_PORT="${APP_PORT:-3100}"
BUILD_CPU_QUOTA="${BUILD_CPU_QUOTA:-300%}"
BUILD_NICE="${BUILD_NICE:-10}"
SKIP_GIT_CHECK=false
AUTO_PUSH=false

usage() {
  printf "${BOLD}MS Social Pilot — Deploy from Mac${RESET}\n\n"
  printf "${BOLD}Usage:${RESET}\n"
  printf "  %s [options]\n\n" "$0"
  printf "${BOLD}Defaults:${RESET}\n"
  printf "  Host:     %s\n" "$DEPLOY_HOST"
  printf "  User:     %s\n" "$DEPLOY_USER"
  printf "  Key:      ~/.ssh/SebMouadSSH (or ~/.ssh/id_ed25519, ~/.ssh/id_rsa)\n"
  printf "  Port:     %s\n" "$DEPLOY_PORT"
  printf "  App Port: %s\n\n" "$APP_PORT"
  printf "${BOLD}Options:${RESET}\n"
  printf "  --host <ip>         Target server IP or domain (env: DEPLOY_HOST)\n"
  printf "  --user <user>       Target SSH user (env: DEPLOY_USER)\n"
  printf "  --key <path>        SSH private key path (env: DEPLOY_KEY)\n"
  printf "  --port <port>       SSH port (env: DEPLOY_PORT)\n"
  printf "  --app-port <port>   App internal port (env: APP_PORT)\n"
  printf "  --skip-git-check    Bypass git clean working tree and unpushed commits check\n"
  printf "  --auto-push         Automatically git push to origin before deploying\n"
  printf "  -h, --help          Show this help message\n"
}

# Parse CLI arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --host) DEPLOY_HOST="${2:?--host requires a value}"; shift 2 ;;
    --user) DEPLOY_USER="${2:?--user requires a value}"; shift 2 ;;
    --key)  DEPLOY_KEY="${2:?--key requires a path}"; shift 2 ;;
    --port) DEPLOY_PORT="${2:?--port requires a port}"; shift 2 ;;
    --app-port) APP_PORT="${2:?--app-port requires a port}"; shift 2 ;;
    --skip-git-check) SKIP_GIT_CHECK=true; shift ;;
    --auto-push) AUTO_PUSH=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) log_error "Unknown argument: $1"; usage; exit 2 ;;
  esac
done

# Auto-detect SSH Key if not provided
if [ -z "$DEPLOY_KEY" ]; then
  if [ -f "$HOME/.ssh/SebMouadSSH" ]; then
    DEPLOY_KEY="$HOME/.ssh/SebMouadSSH"
  elif [ -f "$HOME/.ssh/id_ed25519" ]; then
    DEPLOY_KEY="$HOME/.ssh/id_ed25519"
  elif [ -f "$HOME/.ssh/id_rsa" ]; then
    DEPLOY_KEY="$HOME/.ssh/id_rsa"
  fi
fi

# SSH Options
SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
if [ -n "$DEPLOY_KEY" ]; then
  SSH_OPTS+=(-i "$DEPLOY_KEY")
  SCP_OPTS+=(-i "$DEPLOY_KEY")
fi
TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

run_ssh() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
run_scp() { scp -q "${SCP_OPTS[@]}" "$@"; }

# Pre-deploy Git Verification
log_step "Verifying Git state..."
CURRENT_COMMIT="$(git rev-parse HEAD)"
SHORT_COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$SKIP_GIT_CHECK" = false ]; then
  if ! git diff-index --quiet HEAD --; then
    log_warn "You have unstaged or uncommitted changes in your workspace!"
    git status --short
    printf "${YELLOW}Deploy anyway with committed HEAD (${SHORT_COMMIT})? [y/N]: ${RESET}"
    read -r answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
      log_error "Deployment cancelled. Commit or stash your changes before deploying."
      exit 1
    fi
  fi

  # Check unpushed commits
  UNPUSHED="$(git log @{u}..HEAD --oneline 2>/dev/null || true)"
  if [ -n "$UNPUSHED" ]; then
    log_warn "You have local commits that are not yet pushed to origin:"
    echo "$UNPUSHED"
    if [ "$AUTO_PUSH" = true ]; then
      log_info "Auto-pushing commits to origin/$BRANCH..."
      git push origin "$BRANCH"
    else
      printf "${YELLOW}Push commits to origin/$BRANCH before deploying? [Y/n]: ${RESET}"
      read -r answer
      if [[ "$answer" =~ ^[Nn]$ ]]; then
        log_warn "Proceeding with deployment without pushing to origin."
      else
        git push origin "$BRANCH"
        log_ok "Pushed to origin/$BRANCH."
      fi
    fi
  fi
fi

log_info "Connecting to ${BOLD}$TARGET${RESET} (SSH Port: $DEPLOY_PORT)..."
if ! run_ssh "true" 2>/dev/null; then
  log_error "Could not connect to $TARGET via SSH."
  [ -n "$DEPLOY_KEY" ] && log_error "Check SSH key at $DEPLOY_KEY or specify with --key."
  exit 1
fi
log_ok "SSH connection established."

log_step "Uploading migrations and source for commit ${BOLD}$SHORT_COMMIT${RESET}..."

# 1. Package and upload Prisma migrations
ORDER_FILE="$(mktemp)"
if [ -d "app/prisma/migrations" ]; then
  MIG_DIR="app/prisma/migrations"
else
  MIG_DIR="prisma/migrations"
fi

ls "$MIG_DIR" | grep -E '^[0-9]+_' | sort > "$ORDER_FILE"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$MIG_DIR" -cf - $(cat "$ORDER_FILE") 2>/dev/null \
  | run_ssh 'rm -rf /var/tmp/deploy-migrations && mkdir -m 755 /var/tmp/deploy-migrations && tar -x -C /var/tmp/deploy-migrations 2>/dev/null'
run_scp "$ORDER_FILE" "$TARGET:/var/tmp/deploy-migrations/ORDER"
rm -f "$ORDER_FILE"

# 2. Package and upload app source archive
run_ssh 'rm -rf /var/tmp/deploy-src && mkdir -p /var/tmp/deploy-src'
git archive --format=tar --prefix=app/ "$CURRENT_COMMIT:app" \
  | run_ssh 'tar -x -C /var/tmp/deploy-src'

# 3. Synchronize server deployment script to /usr/local/bin/socialpilot-deploy
if [ -f "app/scripts/deploy-from-server.sh" ]; then
  run_scp "app/scripts/deploy-from-server.sh" "$TARGET:/usr/local/bin/socialpilot-deploy"
  run_ssh "chmod +x /usr/local/bin/socialpilot-deploy; ln -sf /usr/local/bin/socialpilot-deploy /usr/local/bin/deploy"
fi

log_step "Executing remote server build and atomic deployment..."

run_ssh "COMMIT=$CURRENT_COMMIT APP_PORT=$APP_PORT BUILD_CPU_QUOTA=$BUILD_CPU_QUOTA BUILD_NICE=$BUILD_NICE bash -s" <<'REMOTE'
set -euo pipefail
cd /tmp
NEW=/srv/ms-social-pilot.new
LIVE=/srv/ms-social-pilot
PREV=/srv/ms-social-pilot.prev
BUILD=/srv/ms-social-pilot-build

# Bootstrap directories
id -u socialpilot >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash socialpilot
mkdir -p "$LIVE/app" "$BUILD" /var/backups /var/lib/ms-social-pilot
chown -R socialpilot:socialpilot /var/lib/ms-social-pilot

ENVF=$LIVE/app/.env.production.local
if [ ! -f "$ENVF" ]; then
  DB_PASS="$(openssl rand -hex 24)"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='socialpilot'" | grep -q 1 \
    || sudo -u postgres psql -q -c "CREATE ROLE socialpilot LOGIN PASSWORD '$DB_PASS'"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='social_pilot'" | grep -q 1 \
    || sudo -u postgres createdb -O socialpilot social_pilot
  sudo -u postgres psql -q -c "ALTER DATABASE social_pilot SET timezone TO 'UTC'"
  umask 077
  cat > "$ENVF" <<ENV
DATABASE_URL="postgresql://socialpilot:${DB_PASS}@127.0.0.1:5432/social_pilot?schema=public"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"
NODE_ENV="production"
PORT="${APP_PORT}"
ENV
  chown socialpilot:socialpilot "$ENVF"
fi

# Step A: Safe database backup
T=$(date +%Y%m%d-%H%M%S)
B=/var/backups/socialpilot-deploy-$T
mkdir -m 700 -p "$B"
sudo -u postgres pg_dump -Fc social_pilot > "$B/social_pilot.dump" && chmod 600 "$B/social_pilot.dump" || {
  echo "Database backup failed; deployment aborted before any changes." >&2
  exit 1
}
echo "✓ Database backup saved to: $B"
# Keep last 10 backups
ls -dt /var/backups/socialpilot-deploy-* 2>/dev/null | tail -n +11 | xargs -r rm -rf

# Step B: Prepare build directory
rm -rf "$BUILD/rebuild"
rsync -a --delete --exclude 'app/node_modules' --exclude 'app/.next' --exclude 'app/generated' --exclude 'app/.lock-sum' /var/tmp/deploy-src/ "$BUILD/"
cp "$ENVF" "$BUILD/app/.env.production.local"
chmod 600 "$BUILD/app/.env.production.local"
chown -R socialpilot:socialpilot "$BUILD"

LOCK_SUM="$(cat "$BUILD/app/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1)"
INSTALL=1
[ -d "$BUILD/app/node_modules" ] && [ "$(cat "$BUILD/app/.lock-sum" 2>/dev/null)" = "$LOCK_SUM" ] && INSTALL=0

start=$(date +%s)
echo "Building Next.js application (CPU limit: $BUILD_CPU_QUOTA, nice: $BUILD_NICE)..."
systemd-run --quiet --wait --collect --uid=socialpilot --gid=socialpilot \
  -p CPUQuota="$BUILD_CPU_QUOTA" -p Nice="$BUILD_NICE" -p IOSchedulingClass=idle --working-directory="$BUILD" \
  /bin/bash -c "set -e; cd app; if [ $INSTALL = 1 ]; then npm ci --no-audit --no-fund >/tmp/deploy-npm.log 2>&1; fi; npx prisma generate >/dev/null; npm run build >/tmp/deploy-build.log 2>&1" \
  || { echo "Build failed! Logs:"; tail -n 35 /tmp/deploy-build.log; exit 1; }

echo "$LOCK_SUM" > "$BUILD/app/.lock-sum"
echo "✓ Build completed in $(( $(date +%s) - start ))s (dependencies $( [ $INSTALL = 1 ] && echo reinstalled || echo reused ))"
rm -rf "$NEW"
cp -a "$BUILD" "$NEW"

# Step C: Database migrations
sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q -c 'CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "applied_steps_count" INTEGER NOT NULL DEFAULT 0)' >/dev/null
DONE="$(sudo -u postgres psql -d social_pilot -Atc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null")"

applied=0
while read -r m; do
  [ -z "$m" ] && continue
  printf '%s\n' "$DONE" | grep -qx "$m" && continue
  f="/var/tmp/deploy-migrations/$m/migration.sql"
  sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>/tmp/deploy-mig-err.txt || {
    echo "Migration $m failed! Live release untouched." >&2
    head -10 /tmp/deploy-mig-err.txt >&2
    exit 1
  }
  sudo -u postgres psql -d social_pilot -q -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$(sha256sum "$f" | cut -d' ' -f1)', now(), '$m', null, null, now(), 1)" >/dev/null
  applied=$((applied+1))
done < /var/tmp/deploy-migrations/ORDER

APP_ROLE="$(sudo -u postgres psql -d social_pilot -Atc "select tableowner from pg_tables where schemaname='public' and tablename='users'")"
[ -n "$APP_ROLE" ] || APP_ROLE=socialpilot
sudo -u postgres psql -d social_pilot -Atc "select format('ALTER %s %s OWNER TO %I;', case relkind when 'v' then 'VIEW' else 'TABLE' end, oid::regclass, '$APP_ROLE') from pg_class where relnamespace='public'::regnamespace and relowner='postgres'::regrole and relkind in ('r','p','v') union all select format('ALTER FUNCTION %s OWNER TO %I;', oid::regprocedure, '$APP_ROLE') from pg_proc where pronamespace='public'::regnamespace and proowner='postgres'::regrole" \
  | sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -1 -q >/dev/null
echo "✓ Migrations verified (applied: $applied)"

# Step D: Systemd service configuration
cat > /etc/systemd/system/social-pilot.service <<UNIT
[Unit]
Description=MS Social Pilot web
After=network.target postgresql.service
[Service]
User=socialpilot
WorkingDirectory=/srv/ms-social-pilot/app
EnvironmentFile=/srv/ms-social-pilot/app/.env.production.local
ExecStart=/usr/bin/env npx next start -H 127.0.0.1 -p ${APP_PORT}
Restart=on-failure
MemoryMax=2G
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/social-pilot-worker.service <<'UNIT'
[Unit]
Description=MS Social Pilot worker
After=network.target postgresql.service
[Service]
User=socialpilot
WorkingDirectory=/srv/ms-social-pilot/app
EnvironmentFile=/srv/ms-social-pilot/app/.env.production.local
ExecStart=/usr/bin/env node --import tsx scripts/worker.ts
Restart=on-failure
MemoryMax=1G
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable social-pilot social-pilot-worker >/dev/null 2>&1 || true

# Step E: Atomic release switch & service restart
PUBLIC_ORIGIN="$(sudo -u postgres psql -d social_pilot -Atc "select value #>> '{}' from app_settings where key='app.publicOrigin'" 2>/dev/null || true)"
rm -rf "$PREV"
mv "$LIVE" "$PREV"
mv "$NEW" "$LIVE"
systemctl restart social-pilot social-pilot-worker

# Step F: Health verification
ok=0
for i in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/api/health" || true)
  if [ "$c" = 200 ]; then
    ok=1
    break
  fi
  sleep 2
done

csrf=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${APP_PORT}/api/auth/sign-in" -H "Origin: ${PUBLIC_ORIGIN:-http://127.0.0.1:${APP_PORT}}" -H 'Content-Type: application/json' -d '{"email":"deploy-probe@example.invalid","password":"x"}' || true)
pub=skipped
[ -n "$PUBLIC_ORIGIN" ] && pub=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_ORIGIN/api/health" || true)

if [ $ok = 1 ] && [ "$csrf" = 401 ] && { [ "$pub" = 200 ] || [ "$pub" = skipped ]; }; then
  echo "✓ Health checks passed: local 200, CSRF origin check 401, public $pub"
  echo "✓ Services active: $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
else
  echo "!! Health checks failed (local ok=$ok, csrf=$csrf, public=$pub). Rolling back..." >&2
  rm -rf "$NEW"
  mv "$LIVE" "$NEW"
  mv "$PREV" "$LIVE"
  systemctl restart social-pilot social-pilot-worker
  echo "Rolled back to previous release. Database backup preserved at: $B" >&2
  exit 1
fi
REMOTE

printf "\n${GREEN}${BOLD}====================================================${RESET}\n"
printf "${GREEN}${BOLD}✓ DEPLOY SUCCESSFUL: Commit %s active on %s${RESET}\n" "$SHORT_COMMIT" "$DEPLOY_HOST"
printf "${GREEN}${BOLD}====================================================${RESET}\n"