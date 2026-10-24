#!/usr/bin/env bash
# Unified MS Social Pilot deployment script (install + update).
#
# Modes:
#   1. Remote install or update from a developer checkout (default):
#        bash app/scripts/deploy.sh
#   2. Direct on-server install or update on Debian/Ubuntu:
#        sudo bash app/scripts/deploy.sh --local
#
# On first run against a fresh server, installs Node.js 22, PostgreSQL, system user,
# database, bootstrap .env.production.local, and systemd units (web + worker).
# On subsequent runs, takes a pg_dump backup, performs an incremental CPU-capped build,
# applies any new additive SQL migrations, swaps the release directory, restarts services,
# and verifies local + public /api/health and /api/auth/sign-in Origin protection.
set -euo pipefail

cd "$(dirname "$0")/.."   # app/
BASELINE=20261103000000_baseline
BASELINE_SHA256=8abd5224f753f0cb845f9bd748e12e8db3cb7dbb4f1348c714e1d62231e0f8dd

verify_baseline() {
  local path="prisma/migrations/$BASELINE/migration.sql" actual
  [ -f "$path" ] || { echo "Baseline migration missing: $path" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$path" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$path" | awk '{print $1}')"
  fi
  [ "$actual" = "$BASELINE_SHA256" ] || { echo "Baseline checksum mismatch: $actual != $BASELINE_SHA256" >&2; exit 1; }
}
verify_baseline

if [ "${1:-}" = "--local" ]; then
  [ "$EUID" -eq 0 ] || { echo "Run with sudo: sudo bash app/scripts/deploy.sh --local" >&2; exit 1; }
  APP_DIR="$(pwd)"
  APP_USER="${APP_USER:-socialpilot}"
  DB_NAME="${DB_NAME:-social_pilot}"
  DB_USER="${DB_USER:-socialpilot}"
  PORT="${PORT:-3100}"

  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg git openssl build-essential postgresql postgresql-contrib rsync
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    chmod a+r /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq && apt-get install -y -qq nodejs
  fi

  id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
  systemctl enable --now postgresql

  if [ ! -f "$APP_DIR/.env.production.local" ]; then
    DB_PASS="$(openssl rand -hex 24)"
    sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
      || sudo -u postgres psql -q -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
    sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
      || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
    sudo -u postgres psql -q -c "ALTER DATABASE $DB_NAME SET timezone TO 'UTC'"
    umask 077
    cat > "$APP_DIR/.env.production.local" <<ENV
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"
NODE_ENV="production"
PORT="${PORT}"
ENV
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env.production.local"
  fi

  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npx prisma generate && npm run build"
  exit 0
fi

BUILD_CPU_QUOTA="${BUILD_CPU_QUOTA:-300%}"
BUILD_NICE="${BUILD_NICE:-10}"
HOST="${PROD_HOST:-root@213.246.45.75}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
COMMIT="$(git rev-parse origin/main)"
echo "Release commit: $COMMIT"

ORDER_FILE="$(mktemp)"
ls prisma/migrations | grep -E '^[0-9]{14}_' | sort > "$ORDER_FILE"
COPYFILE_DISABLE=1 tar --no-xattrs -C prisma/migrations -cf - $(cat "$ORDER_FILE") 2>/dev/null \
  | ssh -i "$KEY" "$HOST" 'rm -rf /var/tmp/deploy-migrations && mkdir -m 755 /var/tmp/deploy-migrations && tar -x -C /var/tmp/deploy-migrations 2>/dev/null'
scp -q -i "$KEY" "$ORDER_FILE" "$HOST:/var/tmp/deploy-migrations/ORDER"
rm -f "$ORDER_FILE"

ssh -i "$KEY" "$HOST" 'rm -rf /var/tmp/deploy-src && mkdir -p /var/tmp/deploy-src'
git -C "$(git rev-parse --show-toplevel)" archive --format=tar --prefix=app/ "$COMMIT:app" \
  | ssh -i "$KEY" "$HOST" 'tar -x -C /var/tmp/deploy-src'

ssh -i "$KEY" "$HOST" "COMMIT=$COMMIT BUILD_CPU_QUOTA=$BUILD_CPU_QUOTA BUILD_NICE=$BUILD_NICE bash -s" <<'REMOTE'
set -uo pipefail
cd /tmp
NEW=/srv/ms-social-pilot-rebuild.new; LIVE=/srv/ms-social-pilot-rebuild; PREV=/srv/ms-social-pilot-rebuild.prev
BUILD=/srv/ms-social-pilot-rebuild-build

# First-time server bootstrap if not yet installed
if ! command -v node >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg git openssl build-essential postgresql postgresql-contrib rsync
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq && apt-get install -y -qq nodejs
  systemctl enable --now postgresql
fi
id -u socialpilot >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash socialpilot
mkdir -p "$LIVE/app" "$BUILD" /var/backups

if [ -d "$LIVE/rebuild" ] && [ ! -f "$LIVE/app/.env.production.local" ]; then
  rm -rf "$LIVE/app" && mv "$LIVE/rebuild" "$LIVE/app"
fi
if [ -d "$BUILD/rebuild" ] && [ ! -d "$BUILD/app" ]; then
  mv "$BUILD/rebuild" "$BUILD/app"
fi

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
PORT="3100"
ENV
  chown socialpilot:socialpilot "$ENVF"
fi

T=$(date +%Y%m%d-%H%M%S); B=/var/backups/socialpilot-deploy-$T; mkdir -m 700 -p "$B"
sudo -u postgres pg_dump -Fc social_pilot > "$B/social_pilot.dump" && chmod 600 "$B/social_pilot.dump" || { echo "Backup failed; nothing changed"; exit 1; }
echo "Backup: $B"

rm -rf "$BUILD/node_modules" "$BUILD/rebuild"
rsync -a --delete --exclude 'app/node_modules' --exclude 'app/.next' --exclude 'app/generated' --exclude 'app/.lock-sum' /var/tmp/deploy-src/ "$BUILD/"
cp "$ENVF" "$BUILD/app/.env.production.local"; chmod 600 "$BUILD/app/.env.production.local"
chown -R socialpilot:socialpilot "$BUILD"
LOCK_SUM="$(cat "$BUILD/app/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1)"
INSTALL=1; [ -d "$BUILD/app/node_modules" ] && [ "$(cat "$BUILD/app/.lock-sum" 2>/dev/null)" = "$LOCK_SUM" ] && INSTALL=0
start=$(date +%s)
systemd-run --quiet --wait --collect --uid=socialpilot --gid=socialpilot -p CPUQuota="$BUILD_CPU_QUOTA" -p Nice="$BUILD_NICE" -p IOSchedulingClass=idle --working-directory="$BUILD" \
  /bin/bash -c "set -e; cd app; if [ $INSTALL = 1 ]; then npm ci --no-audit --no-fund >/tmp/deploy-npm.log 2>&1; fi; npx prisma generate >/dev/null; npm run build >/tmp/deploy-build.log 2>&1" \
  || { echo "Build failed; nothing changed"; tail -n 25 /tmp/deploy-build.log; exit 1; }
echo "$LOCK_SUM" > "$BUILD/app/.lock-sum"
echo "Build: OK in $(( $(date +%s) - start ))s (dependencies $( [ $INSTALL = 1 ] && echo reinstalled || echo reused ))"
rm -rf "$NEW"; cp -a "$BUILD" "$NEW"

sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q -c 'CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "applied_steps_count" INTEGER NOT NULL DEFAULT 0)' >/dev/null
DONE="$(sudo -u postgres psql -d social_pilot -Atc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
BASELINE=20261103000000_baseline
if ! printf '%s\n' "$DONE" | grep -qx "$BASELINE" && [ -d "/var/tmp/deploy-migrations/$BASELINE" ]; then
  OLD_COUNT="$(sudo -u postgres psql -d social_pilot -Atc "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null and migration_name <> '$BASELINE'")"
  if [ "$OLD_COUNT" -gt 0 ]; then
    f="/var/tmp/deploy-migrations/$BASELINE/migration.sql"
    sudo -u postgres psql -d social_pilot -q -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$(sha256sum "$f" | cut -d' ' -f1)', now(), '$BASELINE', 'baseline marked applied: squashed history already recorded', null, now(), 1)" >/dev/null
    DONE="$(sudo -u postgres psql -d social_pilot -Atc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
    echo "Baseline $BASELINE marked applied ($OLD_COUNT squashed migrations already recorded); not re-run."
  fi
fi
applied=0
while read -r m; do
  printf '%s\n' "$DONE" | grep -qx "$m" && continue
  f="/var/tmp/deploy-migrations/$m/migration.sql"
  # No single-transaction flag: migrations may contain ALTER TYPE ... ADD VALUE.
  sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>/tmp/deploy-mig-err.txt || { echo "Migration $m failed; live release untouched"; head -5 /tmp/deploy-mig-err.txt; exit 1; }
  sudo -u postgres psql -d social_pilot -q -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$(sha256sum "$f" | cut -d' ' -f1)', now(), '$m', null, null, now(), 1)" >/dev/null
  applied=$((applied+1))
done < /var/tmp/deploy-migrations/ORDER
APP_ROLE="$(sudo -u postgres psql -d social_pilot -Atc "select tableowner from pg_tables where schemaname='public' and tablename='users'")"
[ -n "$APP_ROLE" ] || APP_ROLE=socialpilot
sudo -u postgres psql -d social_pilot -Atc "select format('ALTER %s %s OWNER TO %I;', case relkind when 'v' then 'VIEW' else 'TABLE' end, oid::regclass, '$APP_ROLE') from pg_class where relnamespace='public'::regnamespace and relowner='postgres'::regrole and relkind in ('r','p','v') union all select format('ALTER FUNCTION %s OWNER TO %I;', oid::regprocedure, '$APP_ROLE') from pg_proc where pronamespace='public'::regnamespace and proowner='postgres'::regrole" \
  | sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -1 -q >/dev/null
echo "Migrations applied: $applied"

cat > /etc/systemd/system/social-pilot-rebuild.service <<'UNIT'
[Unit]
Description=MS Social Pilot web
After=network.target postgresql.service
[Service]
User=socialpilot
WorkingDirectory=/srv/ms-social-pilot-rebuild/app
EnvironmentFile=/srv/ms-social-pilot-rebuild/app/.env.production.local
ExecStart=/usr/bin/env npx next start -H 127.0.0.1 -p 3100
Restart=on-failure
MemoryMax=2G
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/social-pilot-rebuild-worker.service <<'UNIT'
[Unit]
Description=MS Social Pilot worker
After=network.target postgresql.service
[Service]
User=socialpilot
WorkingDirectory=/srv/ms-social-pilot-rebuild/app
EnvironmentFile=/srv/ms-social-pilot-rebuild/app/.env.production.local
ExecStart=/usr/bin/env node --import tsx scripts/worker.ts
Restart=on-failure
MemoryMax=1G
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable social-pilot-rebuild social-pilot-rebuild-worker >/dev/null 2>&1 || true

PUBLIC_ORIGIN="$(sudo -u postgres psql -d social_pilot -Atc "select value #>> '{}' from app_settings where key='app.publicOrigin'")"
[ -n "$PUBLIC_ORIGIN" ] || echo "Note: Root app.publicOrigin is empty; set it in Root > Shared controls before browsers can sign in behind the proxy."
rm -rf "$PREV"; mv "$LIVE" "$PREV"; mv "$NEW" "$LIVE"
systemctl restart social-pilot-rebuild social-pilot-rebuild-worker
ok=0; for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health || true); [ "$c" = 200 ] && { ok=1; break; }; sleep 2; done
csrf=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3100/api/auth/sign-in -H "Origin: $PUBLIC_ORIGIN" -H 'Content-Type: application/json' -d '{"email":"deploy-probe@example.invalid","password":"x"}' || true)
pub=skipped; [ -n "$PUBLIC_ORIGIN" ] && pub=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_ORIGIN/api/health" || true)
if [ $ok = 1 ] && [ "$csrf" = 401 ] && { [ "$pub" = 200 ] || [ "$pub" = skipped ]; }; then
  echo "DEPLOY OK $COMMIT: local 200, sign-in origin check $csrf (expects 401), public $pub; services $(systemctl is-active social-pilot-rebuild social-pilot-rebuild-worker | tr '\n' ' ')"
else
  echo "!! Health failed (local ok=$ok, sign-in=$csrf, public=$pub); restoring previous release"
  rm -rf "$NEW"; mv "$LIVE" "$NEW"; mv "$PREV" "$LIVE"; systemctl restart social-pilot-rebuild social-pilot-rebuild-worker
  echo "Previous release restored. Database backup: $B"; exit 1
fi
REMOTE
