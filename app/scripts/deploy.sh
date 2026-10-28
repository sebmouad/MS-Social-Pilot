#!/usr/bin/env bash
# Standard MS Social Pilot deployment & server bootstrap script (install + update + admin).
#
# Zero hardcoded hosts or keys: supply connection details via CLI flags or env vars.
#
# Examples:
#   # Deploy/install using SSH private key:
#   bash app/scripts/deploy.sh --host 203.0.113.10 --user root --key ~/.ssh/id_ed25519
#
#   # Deploy/install using SSH password:
#   bash app/scripts/deploy.sh --host 203.0.113.10 --user root --pass "your-ssh-password"
#
#   # Direct on-server install/update (no SSH):
#   sudo bash app/scripts/deploy.sh --local
#
#   # Admin helpers:
#   bash app/scripts/deploy.sh --host 203.0.113.10 --key ~/.ssh/id_ed25519 --set-root you@example.com
#   bash app/scripts/deploy.sh --host 203.0.113.10 --key ~/.ssh/id_ed25519 --reset-2fa you@example.com
set -euo pipefail

cd "$(dirname "$0")/.."   # app/

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_KEY="${DEPLOY_KEY:-}"
DEPLOY_PASS="${DEPLOY_PASS:-}"
APP_PORT="${APP_PORT:-3100}"
BUILD_CPU_QUOTA="${BUILD_CPU_QUOTA:-300%}"
BUILD_NICE="${BUILD_NICE:-10}"
MODE="remote"
ADMIN_ACTION=""
ADMIN_EMAIL=""

usage() {
  cat <<'EOF'
Usage:
  bash app/scripts/deploy.sh --host <ip_or_domain> [--user <ssh_user>] [--key <ssh_key_path> | --pass <ssh_password>] [--port <ssh_port>] [--app-port <port>]
  sudo bash app/scripts/deploy.sh --local [--app-port <port>]

Admin commands:
  bash app/scripts/deploy.sh --host <ip> [--key <path> | --pass <pw>] --set-root <email>
  bash app/scripts/deploy.sh --host <ip> [--key <path> | --pass <pw>] --reset-2fa <email>

Environment variables (alternatives to flags):
  DEPLOY_HOST, DEPLOY_USER (default: root), DEPLOY_PORT (default: 22),
  DEPLOY_KEY, DEPLOY_PASS, APP_PORT (default: 3100)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) DEPLOY_HOST="${2:?--host requires a value}"; shift 2 ;;
    --user) DEPLOY_USER="${2:?--user requires a value}"; shift 2 ;;
    --port) DEPLOY_PORT="${2:?--port requires a value}"; shift 2 ;;
    --key) DEPLOY_KEY="${2:?--key requires a path}"; shift 2 ;;
    --pass) DEPLOY_PASS="${2:?--pass requires a password}"; shift 2 ;;
    --app-port) APP_PORT="${2:?--app-port requires a port}"; shift 2 ;;
    --local) MODE="local"; shift ;;
    --set-root) ADMIN_ACTION="set-root"; ADMIN_EMAIL="${2:?--set-root requires an email}"; shift 2 ;;
    --reset-2fa) ADMIN_ACTION="reset-2fa"; ADMIN_EMAIL="${2:?--reset-2fa requires an email}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$MODE" = "local" ]; then
  exec "$(dirname "$0")/deploy-from-server.sh" "$@"
fi

[ -n "$DEPLOY_HOST" ] || { echo "Error: --host <ip_or_domain> (or DEPLOY_HOST) is required." >&2; usage >&2; exit 2; }
if [[ "$DEPLOY_HOST" == *@* ]]; then
  TARGET="$DEPLOY_HOST"
else
  TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
fi

SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
ASKPASS_SCRIPT=""
cleanup_askpass() { [ -z "$ASKPASS_SCRIPT" ] || rm -f "$ASKPASS_SCRIPT"; }
trap cleanup_askpass EXIT

if [ -n "$DEPLOY_KEY" ]; then
  SSH_OPTS+=(-i "$DEPLOY_KEY")
  SCP_OPTS+=(-i "$DEPLOY_KEY")
fi

if [ -n "$DEPLOY_PASS" ]; then
  ASKPASS_SCRIPT="$(mktemp)"
  chmod 700 "$ASKPASS_SCRIPT"
  cat > "$ASKPASS_SCRIPT" <<EOF
#!/usr/bin/env sh
printf '%s\n' '$DEPLOY_PASS'
EOF
  export SSH_ASKPASS="$ASKPASS_SCRIPT"
  export SSH_ASKPASS_REQUIRE=force
  export DISPLAY="${DISPLAY:-:0}"
fi

run_ssh() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
run_scp() { scp -q "${SCP_OPTS[@]}" "$@"; }

if [ "$ADMIN_ACTION" = "set-root" ]; then
  run_ssh "sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -v email='$ADMIN_EMAIL' <<'SQL'
BEGIN;
UPDATE users SET \"isInstanceOwner\" = false WHERE \"isInstanceOwner\" = true;
UPDATE users SET \"isInstanceOwner\" = true, \"disabledAt\" = NULL WHERE lower(email) = lower(:'email');
INSERT INTO root_activities (id, \"actorId\", action, detail, \"createdAt\")
VALUES (gen_random_uuid()::text, NULL, 'root.transferred', jsonb_build_object('to', :'email'), NOW());
COMMIT;
SQL"
  echo "Root assigned to $ADMIN_EMAIL."
  exit 0
fi

if [ "$ADMIN_ACTION" = "reset-2fa" ]; then
  run_ssh "sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -v email='$ADMIN_EMAIL' <<'SQL'
BEGIN;
UPDATE users SET \"totpSecret\" = NULL, \"totpPendingSecret\" = NULL, \"totpEnabledAt\" = NULL, \"totpLastStep\" = NULL WHERE lower(email) = lower(:'email');
DELETE FROM recovery_codes WHERE \"userId\" IN (SELECT id FROM users WHERE lower(email) = lower(:'email'));
DELETE FROM passkeys WHERE \"userId\" IN (SELECT id FROM users WHERE lower(email) = lower(:'email'));
DELETE FROM trusted_devices WHERE \"userId\" IN (SELECT id FROM users WHERE lower(email) = lower(:'email'));
DELETE FROM sessions WHERE \"userId\" IN (SELECT id FROM users WHERE lower(email) = lower(:'email'));
INSERT INTO root_activities (id, \"actorId\", action, detail, \"createdAt\")
VALUES (gen_random_uuid()::text, NULL, 'user.twoStepReset', jsonb_build_object('email', :'email'), NOW());
COMMIT;
SQL"
  echo "Two-step authentication cleared for $ADMIN_EMAIL."
  exit 0
fi

COMMIT="$(git rev-parse HEAD)"
echo "Deploying commit $COMMIT to $TARGET (app port $APP_PORT)..."

ORDER_FILE="$(mktemp)"
ls prisma/migrations | grep -E '^[0-9]+_' | sort > "$ORDER_FILE"
COPYFILE_DISABLE=1 tar --no-xattrs -C prisma/migrations -cf - $(cat "$ORDER_FILE") 2>/dev/null \
  | run_ssh 'rm -rf /var/tmp/deploy-migrations && mkdir -m 755 /var/tmp/deploy-migrations && tar -x -C /var/tmp/deploy-migrations 2>/dev/null'
run_scp "$ORDER_FILE" "$TARGET:/var/tmp/deploy-migrations/ORDER"
rm -f "$ORDER_FILE"

run_ssh 'rm -rf /var/tmp/deploy-src && mkdir -p /var/tmp/deploy-src'
git -C "$(git rev-parse --show-toplevel)" archive --format=tar --prefix=app/ "$COMMIT:app" \
  | run_ssh 'tar -x -C /var/tmp/deploy-src'

run_ssh "COMMIT=$COMMIT APP_PORT=$APP_PORT BUILD_CPU_QUOTA=$BUILD_CPU_QUOTA BUILD_NICE=$BUILD_NICE bash -s" <<'REMOTE'
set -uo pipefail
cd /tmp
NEW=/srv/ms-social-pilot.new; LIVE=/srv/ms-social-pilot; PREV=/srv/ms-social-pilot.prev
BUILD=/srv/ms-social-pilot-build

if [ -d /srv/ms-social-pilot-rebuild ] && [ ! -d "$LIVE" ]; then
  mv /srv/ms-social-pilot-rebuild "$LIVE"
fi
if [ -d /srv/ms-social-pilot-rebuild-build ] && [ ! -d "$BUILD" ]; then
  mv /srv/ms-social-pilot-rebuild-build "$BUILD"
fi
rm -rf /srv/ms-social-pilot-rebuild.prev /srv/ms-social-pilot-rebuild.new

# First-time server bootstrap if Node.js 22 or PostgreSQL are missing
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ] || ! command -v psql >/dev/null 2>&1; then
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
mkdir -p "$LIVE/app" "$BUILD" /var/backups /var/lib/ms-social-pilot
chown -R socialpilot:socialpilot /var/lib/ms-social-pilot

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
PORT="${APP_PORT}"
ENV
  chown socialpilot:socialpilot "$ENVF"
fi


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
INIT_MIG=0001_init
if ! printf '%s\n' "$DONE" | grep -qx "$INIT_MIG" && [ -d "/var/tmp/deploy-migrations/$INIT_MIG" ]; then
  EXISTING_TABLES="$(sudo -u postgres psql -d social_pilot -Atc "select count(*) from information_schema.tables where table_schema='public' and table_name='users'")"
  if [ "$EXISTING_TABLES" -gt 0 ]; then
    f="/var/tmp/deploy-migrations/$INIT_MIG/migration.sql"
    sudo -u postgres psql -d social_pilot -q -c "DELETE FROM _prisma_migrations; INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, '$(sha256sum "$f" | cut -d' ' -f1)', now(), '$INIT_MIG', 'initial v1.0.0 schema marked applied', null, now(), 1)" >/dev/null
    DONE="$INIT_MIG"
    echo "Initial migration $INIT_MIG marked applied on existing database."
  fi
fi
applied=0
while read -r m; do
  printf '%s\n' "$DONE" | grep -qx "$m" && continue
  f="/var/tmp/deploy-migrations/$m/migration.sql"
  sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>/tmp/deploy-mig-err.txt || { echo "Migration $m failed; live release untouched"; head -5 /tmp/deploy-mig-err.txt; exit 1; }
  sudo -u postgres psql -d social_pilot -q -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$(sha256sum "$f" | cut -d' ' -f1)', now(), '$m', null, null, now(), 1)" >/dev/null
  applied=$((applied+1))
done < /var/tmp/deploy-migrations/ORDER
APP_ROLE="$(sudo -u postgres psql -d social_pilot -Atc "select tableowner from pg_tables where schemaname='public' and tablename='users'")"
[ -n "$APP_ROLE" ] || APP_ROLE=socialpilot
sudo -u postgres psql -d social_pilot -Atc "select format('ALTER %s %s OWNER TO %I;', case relkind when 'v' then 'VIEW' else 'TABLE' end, oid::regclass, '$APP_ROLE') from pg_class where relnamespace='public'::regnamespace and relowner='postgres'::regrole and relkind in ('r','p','v') union all select format('ALTER FUNCTION %s OWNER TO %I;', oid::regprocedure, '$APP_ROLE') from pg_proc where pronamespace='public'::regnamespace and proowner='postgres'::regrole" \
  | sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -1 -q >/dev/null
echo "Migrations applied: $applied"

if [ -f /etc/systemd/system/social-pilot-rebuild.service ]; then
  systemctl stop social-pilot-rebuild social-pilot-rebuild-worker 2>/dev/null || true
  systemctl disable social-pilot-rebuild social-pilot-rebuild-worker 2>/dev/null || true
  rm -f /etc/systemd/system/social-pilot-rebuild.service /etc/systemd/system/social-pilot-rebuild-worker.service
fi

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
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
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
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable social-pilot social-pilot-worker >/dev/null 2>&1 || true

PUBLIC_ORIGIN="$(sudo -u postgres psql -d social_pilot -Atc "select value #>> '{}' from app_settings where key='app.publicOrigin'" 2>/dev/null || true)"
rm -rf "$PREV"; mv "$LIVE" "$PREV"; mv "$NEW" "$LIVE"
systemctl restart social-pilot social-pilot-worker
ok=0; for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/api/health" || true); [ "$c" = 200 ] && { ok=1; break; }; sleep 2; done
csrf=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${APP_PORT}/api/auth/sign-in" -H "Origin: ${PUBLIC_ORIGIN:-http://127.0.0.1:${APP_PORT}}" -H 'Content-Type: application/json' -d '{"email":"deploy-probe@example.invalid","password":"x"}' || true)
pub=skipped; [ -n "$PUBLIC_ORIGIN" ] && pub=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_ORIGIN/api/health" || true)
if [ $ok = 1 ] && [ "$csrf" = 401 ] && { [ "$pub" = 200 ] || [ "$pub" = skipped ]; }; then
  echo "DEPLOY OK $COMMIT: local 200, sign-in origin check $csrf (expects 401), public $pub; services $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
else
  echo "!! Health failed (local ok=$ok, sign-in=$csrf, public=$pub); restoring previous release"
  rm -rf "$NEW"; mv "$LIVE" "$NEW"; mv "$PREV" "$LIVE"; systemctl restart social-pilot social-pilot-worker
  echo "Previous release restored."; exit 1
fi
REMOTE
