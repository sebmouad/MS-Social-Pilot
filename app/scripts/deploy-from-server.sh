#!/usr/bin/env bash
# Deploy MS Social Pilot directly on the Server (Local Server Deploy)
#
# Can be run directly on the server as:
#   socialpilot-deploy                 # pulls latest main, backups DB, builds, migrates, restarts
#   socialpilot-deploy --branch <name> # deploy specific branch
#   socialpilot-deploy --status        # check services, memory, commit, DB backups
#   socialpilot-deploy --rollback      # restore previous release
#   socialpilot-deploy --restart       # restart services & verify health
#   socialpilot-deploy --logs          # live web logs
#   socialpilot-deploy --logs-worker   # live worker logs
#   socialpilot-deploy --install       # install global /usr/local/bin/socialpilot-deploy command
set -euo pipefail

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

# Require root
if [ "$EUID" -ne 0 ]; then
  log_error "This script must be run as root (or with sudo)."
  echo "Try: sudo $0 $*" >&2
  exit 1
fi

# Switch working directory to /tmp to avoid sudo -u postgres /root cwd permission warnings
cd /tmp

REPO_URL="https://github.com/sebmouad/MS-Social-Pilot.git"
REPO_DIR="/srv/ms-social-pilot-repo"
LIVE_DIR="/srv/ms-social-pilot"
BUILD_DIR="/srv/ms-social-pilot-build"
PREV_DIR="/srv/ms-social-pilot.prev"
NEW_DIR="/srv/ms-social-pilot.new"
APP_USER="socialpilot"
DB_NAME="social_pilot"
APP_PORT="${APP_PORT:-3100}"
BUILD_CPU_QUOTA="${BUILD_CPU_QUOTA:-300%}"
BUILD_NICE="${BUILD_NICE:-10}"
BRANCH="${BRANCH:-main}"

usage() {
  printf "${BOLD}MS Social Pilot — Server Deployment & Management Utility${RESET}\n\n"
  printf "${BOLD}Usage:${RESET}\n"
  printf "  socialpilot-deploy [options]\n"
  printf "  bash %s [options]\n\n" "$0"
  printf "${BOLD}Commands / Actions:${RESET}\n"
  printf "  (no args)             Pull latest code from '%s', backup DB, build, migrate, and deploy\n" "$BRANCH"
  printf "  --branch <name>       Deploy a specific branch or commit from git (default: main)\n"
  printf "  --commit <hash>       Deploy a specific commit hash\n"
  printf "  --status              Show deployment status, services, health, and recent backups\n"
  printf "  --rollback            Quick rollback to the previous release\n"
  printf "  --restart             Restart web and worker services without rebuilding\n"
  printf "  --logs                View live logs for the web service\n"
  printf "  --logs-worker         View live logs for the worker service\n"
  printf "  --install             Install this script globally as /usr/local/bin/socialpilot-deploy\n"
  printf "  -h, --help            Show this help message\n"
}

# Subcommand: install globally
install_global() {
  log_step "Installing global command..."
  CURRENT_SCRIPT="$(readlink -f "${BASH_SOURCE[0]}")"
  cp "$CURRENT_SCRIPT" /usr/local/bin/socialpilot-deploy
  chmod +x /usr/local/bin/socialpilot-deploy
  ln -sf /usr/local/bin/socialpilot-deploy /usr/local/bin/deploy
  log_ok "Installed successfully!"
  echo "You can now run '${BOLD}socialpilot-deploy${RESET}' or '${BOLD}deploy${RESET}' from any directory."
}

# Subcommand: status
show_status() {
  printf "\n${BOLD}=== MS Social Pilot Server Status ===${RESET}\n\n"
  
  # Active commit
  if [ -d "$LIVE_DIR/app" ]; then
    printf "${CYAN}Current Release:${RESET}\n"
    if [ -f "$LIVE_DIR/app/.current-commit" ]; then
      cat "$LIVE_DIR/app/.current-commit"
    elif [ -d "$REPO_DIR" ]; then
      git -C "$REPO_DIR" log -1 --format="Commit: %h - %s (%cr) by %an" 2>/dev/null || echo "Unknown"
    fi
    echo ""
  fi

  # Service statuses
  printf "${CYAN}Services:${RESET}\n"
  for s in social-pilot social-pilot-worker postgresql; do
    status=$(systemctl is-active "$s" 2>/dev/null || echo "inactive")
    if [ "$status" = "active" ]; then
      printf "  %-22s ${GREEN}${BOLD}%s${RESET}\n" "$s:" "$status"
    else
      printf "  %-22s ${RED}${BOLD}%s${RESET}\n" "$s:" "$status"
    fi
  done
  echo ""

  # Health check
  printf "${CYAN}Health Probes:${RESET}\n"
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || echo "error")
  if [ "$code" = "200" ]; then
    printf "  Local HTTP probe:     ${GREEN}${BOLD}HTTP 200 (Healthy)${RESET}\n"
  else
    printf "  Local HTTP probe:     ${RED}${BOLD}HTTP %s (Unhealthy)${RESET}\n" "$code"
  fi

  PUBLIC_ORIGIN="$(sudo -u postgres psql -d "$DB_NAME" -Atc "select value #>> '{}' from app_settings where key='app.publicOrigin'" 2>/dev/null || true)"
  if [ -n "$PUBLIC_ORIGIN" ]; then
    pub_code=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_ORIGIN/api/health" 2>/dev/null || echo "error")
    if [ "$pub_code" = "200" ]; then
      printf "  Public Origin (%s): ${GREEN}${BOLD}HTTP 200 (Healthy)${RESET}\n" "$PUBLIC_ORIGIN"
    else
      printf "  Public Origin (%s): ${RED}${BOLD}HTTP %s${RESET}\n" "$PUBLIC_ORIGIN" "$pub_code"
    fi
  fi
  echo ""

  # Memory usage
  printf "${CYAN}Memory & Resources:${RESET}\n"
  free -h | awk 'NR<=2 {print "  " $0}'
  echo ""

  # Recent backups
  printf "${CYAN}Recent Database Backups:${RESET}\n"
  if ls -dt /var/backups/socialpilot-deploy-* >/dev/null 2>&1; then
    ls -dt /var/backups/socialpilot-deploy-* | head -n 5 | while read -r b; do
      size=$(du -sh "$b" 2>/dev/null | cut -f1)
      printf "  %-35s (%s)\n" "$(basename "$b")" "$size"
    done
  else
    echo "  No backups found in /var/backups/"
  fi
  echo ""
}

# Subcommand: rollback
rollback() {
  log_step "Executing rollback to previous release..."
  if [ ! -d "$PREV_DIR" ] || [ ! -d "$PREV_DIR/app" ]; then
    log_error "No previous release found in $PREV_DIR to roll back to!"
    exit 1
  fi

  rm -rf "$NEW_DIR"
  mv "$LIVE_DIR" "$NEW_DIR"
  mv "$PREV_DIR" "$LIVE_DIR"
  systemctl restart social-pilot social-pilot-worker

  log_info "Verifying health after rollback..."
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || echo "error")
  if [ "$code" = "200" ]; then
    log_ok "Rollback completed successfully! Service is active and healthy."
  else
    log_error "Service unhealthy after rollback (HTTP $code). Check logs with 'socialpilot-deploy --logs'."
    exit 1
  fi
}

# Subcommand: restart
restart_services() {
  log_step "Restarting MS Social Pilot services..."
  systemctl restart social-pilot social-pilot-worker
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || echo "error")
  if [ "$code" = "200" ]; then
    log_ok "Services restarted successfully (HTTP 200)."
  else
    log_error "Service unhealthy after restart (HTTP $code)."
    exit 1
  fi
}

# Parse flags
ACTION="deploy"
TARGET_REF=""

while [ $# -gt 0 ]; do
  case "$1" in
    --status) ACTION="status"; shift ;;
    --rollback) ACTION="rollback"; shift ;;
    --restart) ACTION="restart"; shift ;;
    --logs) ACTION="logs"; shift ;;
    --logs-worker) ACTION="logs-worker"; shift ;;
    --install) ACTION="install"; shift ;;
    --branch) BRANCH="${2:?--branch requires a name}"; shift 2 ;;
    --commit) TARGET_REF="${2:?--commit requires a hash}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) log_error "Unknown argument: $1"; usage; exit 2 ;;
  esac
done

case "$ACTION" in
  status) show_status; exit 0 ;;
  rollback) rollback; exit 0 ;;
  restart) restart_services; exit 0 ;;
  logs) journalctl -u social-pilot -f; exit 0 ;;
  logs-worker) journalctl -u social-pilot-worker -f; exit 0 ;;
  install) install_global; exit 0 ;;
  deploy) ;; # continue below
esac

# ==================== MAIN DEPLOYMENT FLOW ====================

log_step "Starting MS Social Pilot deployment on server..."

# Ensure system requirements
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$LIVE_DIR/app" "$BUILD_DIR" /var/backups /var/lib/ms-social-pilot
chown -R "$APP_USER:$APP_USER" /var/lib/ms-social-pilot

# Step 1: Update or Clone Git Repository
log_step "Syncing repository from $REPO_URL..."
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin --prune
fi

if [ -n "$TARGET_REF" ]; then
  git -C "$REPO_DIR" checkout "$TARGET_REF"
else
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"
fi

DEPLOY_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
SHORT_COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
COMMIT_MSG="$(git -C "$REPO_DIR" log -1 --pretty=%B | head -n 1)"
log_info "Deploying commit: ${BOLD}$SHORT_COMMIT${RESET} ('$COMMIT_MSG')"

# Step 2: Database Backup
log_step "Creating safe database backup..."
T=$(date +%Y%m%d-%H%M%S)
B="/var/backups/socialpilot-deploy-$T"
mkdir -m 700 -p "$B"
sudo -u postgres pg_dump -Fc "$DB_NAME" > "$B/social_pilot.dump" && chmod 600 "$B/social_pilot.dump" || {
  log_error "Database backup failed. Aborting deployment."
  exit 1
}
log_ok "Backup saved to: $B"
# Retain last 10 backups
ls -dt /var/backups/socialpilot-deploy-* 2>/dev/null | tail -n +11 | xargs -r rm -rf

# Step 3: Copy Environment
ENVF="$LIVE_DIR/app/.env.production.local"
if [ ! -f "$ENVF" ]; then
  log_warn "Creating initial production environment..."
  DB_PASS="$(openssl rand -hex 24)"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_USER'" | grep -q 1 \
    || sudo -u postgres psql -q -c "CREATE ROLE $APP_USER LOGIN PASSWORD '$DB_PASS'"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || sudo -u postgres createdb -O "$APP_USER" "$DB_NAME"
  sudo -u postgres psql -q -c "ALTER DATABASE $DB_NAME SET timezone TO 'UTC'"
  umask 077
  cat > "$ENVF" <<ENV
DATABASE_URL="postgresql://${APP_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"
NODE_ENV="production"
PORT="${APP_PORT}"
ENV
  chown "$APP_USER:$APP_USER" "$ENVF"
fi

# Step 4: Populate Build Directory
log_step "Preparing build workspace..."
rm -rf "$BUILD_DIR/rebuild"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'generated' \
  --exclude '.lock-sum' \
  "$REPO_DIR/app/" "$BUILD_DIR/app/"

cp "$ENVF" "$BUILD_DIR/app/.env.production.local"
chmod 600 "$BUILD_DIR/app/.env.production.local"

# Record active commit
echo "$SHORT_COMMIT - $COMMIT_MSG ($(date -u +'%Y-%m-%d %H:%M:%SZ'))" > "$BUILD_DIR/app/.current-commit"
chown -R "$APP_USER:$APP_USER" "$BUILD_DIR"

LOCK_SUM="$(cat "$BUILD_DIR/app/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1)"
INSTALL=1
[ -d "$BUILD_DIR/app/node_modules" ] && [ "$(cat "$BUILD_DIR/app/.lock-sum" 2>/dev/null)" = "$LOCK_SUM" ] && INSTALL=0

# Step 5: Build Next.js Application with Resource Throttling
log_step "Building application (CPU Limit: $BUILD_CPU_QUOTA, Nice: $BUILD_NICE)..."
start=$(date +%s)
systemd-run --quiet --wait --collect --uid="$APP_USER" --gid="$APP_USER" \
  -p CPUQuota="$BUILD_CPU_QUOTA" -p Nice="$BUILD_NICE" -p IOSchedulingClass=idle --working-directory="$BUILD_DIR" \
  /bin/bash -c "set -e; cd app; if [ $INSTALL = 1 ]; then npm ci --no-audit --no-fund >/tmp/deploy-npm.log 2>&1; fi; npx prisma generate >/dev/null; npm run build >/tmp/deploy-build.log 2>&1" \
  || { log_error "Build failed! Recent log:"; tail -n 35 /tmp/deploy-build.log; exit 1; }

echo "$LOCK_SUM" > "$BUILD_DIR/app/.lock-sum"
log_ok "Build finished in $(( $(date +%s) - start ))s (dependencies $( [ $INSTALL = 1 ] && echo reinstalled || echo reused ))"

rm -rf "$NEW_DIR"
cp -a "$BUILD_DIR" "$NEW_DIR"

# Step 6: Apply Database Migrations
log_step "Verifying and applying database migrations..."
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -c 'CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "applied_steps_count" INTEGER NOT NULL DEFAULT 0)' >/dev/null
DONE="$(sudo -u postgres psql -d "$DB_NAME" -Atc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null")"

MIG_SRC="$REPO_DIR/app/prisma/migrations"
applied=0
if [ -d "$MIG_SRC" ]; then
  for m_dir in "$MIG_SRC"/*; do
    [ -d "$m_dir" ] || continue
    m="$(basename "$m_dir")"
    [[ "$m" =~ ^[0-9]+_ ]] || continue
    printf '%s\n' "$DONE" | grep -qx "$m" && continue
    f="$m_dir/migration.sql"
    [ -f "$f" ] || continue
    
    log_info "Applying migration: $m"
    sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>/tmp/deploy-mig-err.txt || {
      log_error "Migration $m failed! Aborting release."
      head -10 /tmp/deploy-mig-err.txt >&2
      exit 1
    }
    sudo -u postgres psql -d "$DB_NAME" -q -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$(sha256sum "$f" | cut -d' ' -f1)', now(), '$m', null, null, now(), 1)" >/dev/null
    applied=$((applied+1))
  done
fi

APP_ROLE="$(sudo -u postgres psql -d "$DB_NAME" -Atc "select tableowner from pg_tables where schemaname='public' and tablename='users'")"
[ -n "$APP_ROLE" ] || APP_ROLE="$APP_USER"
sudo -u postgres psql -d "$DB_NAME" -Atc "select format('ALTER %s %s OWNER TO %I;', case relkind when 'v' then 'VIEW' else 'TABLE' end, oid::regclass, '$APP_ROLE') from pg_class where relnamespace='public'::regnamespace and relowner='postgres'::regrole and relkind in ('r','p','v') union all select format('ALTER FUNCTION %s OWNER TO %I;', oid::regprocedure, '$APP_ROLE') from pg_proc where pronamespace='public'::regnamespace and proowner='postgres'::regrole" \
  | sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -1 -q >/dev/null
log_ok "Migrations checked (applied: $applied)"

# Step 7: Update Systemd Units
cat > /etc/systemd/system/social-pilot.service <<UNIT
[Unit]
Description=MS Social Pilot web
After=network.target postgresql.service
[Service]
User=$APP_USER
WorkingDirectory=/srv/ms-social-pilot/app
EnvironmentFile=/srv/ms-social-pilot/app/.env.production.local
ExecStart=/usr/bin/env npx next start -H 127.0.0.1 -p ${APP_PORT}
Restart=on-failure
MemoryMax=2G
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/social-pilot-worker.service <<UNIT
[Unit]
Description=MS Social Pilot worker
After=network.target postgresql.service
[Service]
User=$APP_USER
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

# Step 8: Atomic Swap & Restart
log_step "Performing atomic release swap & restarting services..."
PUBLIC_ORIGIN="$(sudo -u postgres psql -d "$DB_NAME" -Atc "select value #>> '{}' from app_settings where key='app.publicOrigin'" 2>/dev/null || true)"
rm -rf "$PREV_DIR"
mv "$LIVE_DIR" "$PREV_DIR"
mv "$NEW_DIR" "$LIVE_DIR"
systemctl restart social-pilot social-pilot-worker

# Step 9: Health Verification
log_step "Verifying application health..."
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
  log_ok "Health check verified: local 200, origin security 401, public $pub"
  log_ok "Active services: $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
else
  log_error "Health checks failed (local ok=$ok, csrf=$csrf, public=$pub). Rolling back to previous release..."
  rm -rf "$NEW_DIR"
  mv "$LIVE_DIR" "$NEW_DIR"
  mv "$PREV_DIR" "$LIVE_DIR"
  systemctl restart social-pilot social-pilot-worker
  log_warn "Previous release restored. Database backup preserved at: $B"
  exit 1
fi

# Ensure global alias is up to date
cp -f "${BASH_SOURCE[0]}" /usr/local/bin/socialpilot-deploy 2>/dev/null || true
chmod +x /usr/local/bin/socialpilot-deploy 2>/dev/null || true
ln -sf /usr/local/bin/socialpilot-deploy /usr/local/bin/deploy 2>/dev/null || true

printf "\n${GREEN}${BOLD}====================================================${RESET}\n"
printf "${GREEN}${BOLD}✓ DEPLOY SUCCESSFUL: Commit %s active on server${RESET}\n" "$SHORT_COMMIT"
printf "${GREEN}${BOLD}====================================================${RESET}\n\n"