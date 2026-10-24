#!/usr/bin/env bash
# Recovery smoke test; run from anywhere in the checkout. Restores the newest
# deploy backup into a scratch database and starts the installed app
# release against it with a read-only role. Never swaps releases or starts workers.
# Safety targets are deliberately fixed bootstrap values, not application/Root policy.
# Usage: bash app/scripts/prod-rollback-drill.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # app/
HOST="${PROD_HOST:-$(grep -o 'root@[0-9][0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
[ -n "$HOST" ] || { echo 'ROLLBACK DRILL FAIL: no production host' >&2; exit 1; }
ssh -i "$KEY" "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
umask 077
# Clear inherited libpq routing/credentials, including service files and socket overrides.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS
export PGSYSCONFDIR=/nonexistent PGPASSFILE=/dev/null
readonly DB=social_pilot_drill
readonly REBUILD_PORT=3121
readonly REBUILD=/srv/ms-social-pilot-rebuild/app
readonly ROLE=social_pilot_drill_role
readonly TIMEOUT=120 CURL_TIMEOUT=5 POLL_SECONDS=2
START=$(date +%s); RESTORE_SECONDS=not_run; REBUILD_SECONDS=not_run
DB_CREATED=0 ROLE_CREATED=0 COMPLETE=0 TMP=''
STARTED_UNITS=()
fail() { echo "$*" >&2; exit 1; }
pg() { sudo -u postgres /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/psql -X -h /var/run/postgresql -p 5432 -d postgres -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  rc=$?; trap - EXIT INT TERM HUP; set +e
  # Only units attempted by this invocation are eligible for cleanup.
  for unit in "${STARTED_UNITS[@]}"; do
    systemctl stop "$unit" >/dev/null 2>&1
    state=$(systemctl show -p ActiveState --value "$unit" 2>/dev/null)
    case "$state" in inactive|failed) ;; *) rc=1; echo "Cleanup failed: $unit shutdown unconfirmed" >&2;; esac
  done
  if [ "$DB_CREATED" = 1 ]; then
    sudo -u postgres /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/dropdb -h /var/run/postgresql -p 5432 --force "$DB" || rc=1
  fi
  if [ "$ROLE_CREATED" = 1 ]; then pg -q -c "DROP ROLE $ROLE" || rc=1; fi
  [ -z "$TMP" ] || rm -rf -- "$TMP" || rc=1
  echo "restore_seconds=$RESTORE_SECONDS rebuild_seconds=$REBUILD_SECONDS total_seconds=$(( $(date +%s) - START ))"
  if [ "$rc" = 0 ] && [ "$COMPLETE" = 1 ]; then
    echo 'ROLLBACK DRILL PASS: backup restored; installed rebuild HTTP/DB checks passed; scratch resources removed'
  else
    echo 'ROLLBACK DRILL FAIL: recovery unproven; inspect private host evidence and cleanup failures' >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
[ "$EUID" = 0 ] || fail 'Refusing: remote root required'
# Fail closed even if a later edit accidentally changes a safety target.
[ "$DB" = social_pilot_drill ] && [ "$DB" != social_pilot ] &&
  [ "$REBUILD_PORT" = 3121 ] && [ "$REBUILD_PORT" != 3100 ] || fail 'Refusing: unsafe database or port'
exec 9>/run/lock/socialpilot-rollback-drill.lock
flock -n 9 || fail 'Refusing: another rollback drill holds the lock'
for command in systemd-run systemctl ss curl openssl sha256sum pg_restore; do command -v "$command" >/dev/null || fail "Missing tool: $command"; done
[ -z "$(ss -H -ltn "sport = :$REBUILD_PORT")" ] || fail 'Refusing: port already listening'
[ "$(pg -Atc "SELECT count(*) FROM pg_database WHERE datname='$DB'")" = 0 ] || fail 'Refusing: scratch database already exists'
[ "$(pg -Atc "SELECT count(*) FROM pg_roles WHERE rolname='$ROLE'")" = 0 ] || fail 'Refusing: scratch role already exists'
ARTIFACTS=$(sha256sum "$REBUILD/.next/BUILD_ID")
[ -s "$REBUILD/.next/BUILD_ID" ] && [ -f "$REBUILD/node_modules/next/dist/bin/next" ] || fail 'Refusing: installed release artifact missing'
echo "Release artifact: $REBUILD"
sha256sum "$REBUILD/.next/BUILD_ID"
# Newest dump by mtime, not a directory name or an older fallback after failure.
DUMP=$(find /var/backups -maxdepth 2 -type f -path '/var/backups/socialpilot-deploy-*/social_pilot.dump' -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p')
[ -n "$DUMP" ] && [ -s "$DUMP" ] || fail 'Refusing: newest deploy dump missing/empty'
echo "Backup: $DUMP"
sha256sum "$DUMP"
# No archive-created databases, restored grants, ownership or migrations.
t=$(date +%s)
sudo -u postgres /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/createdb -h /var/run/postgresql -p 5432 --template=template0 "$DB"
DB_CREATED=1
sudo -u postgres /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/pg_restore --exit-on-error --no-owner --no-acl -h /var/run/postgresql -p 5432 --dbname="$DB" < "$DUMP" 2>/dev/null || fail 'Restore failed (database will be removed)'
RESTORE_SECONDS=$(( $(date +%s) - t ))
# A fresh, read-only role has no membership in any live application's role.
PASSWORD=$(openssl rand -hex 32)
pg -q <<SQL
CREATE ROLE $ROLE LOGIN PASSWORD '$PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
SQL
ROLE_CREATED=1
pg -q -c "ALTER ROLE $ROLE SET default_transaction_read_only=on; GRANT CONNECT ON DATABASE $DB TO $ROLE;"
sudo -u postgres /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/psql -X -h /var/run/postgresql -p 5432 -d "$DB" -v ON_ERROR_STOP=1 -q <<SQL
GRANT USAGE ON SCHEMA public TO $ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO $ROLE;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO $ROLE;
SQL
TMP=$(mktemp -d /run/socialpilot-rollback-drill.XXXXXX)
# Do not copy the live env or encryption/provider/session credentials.
ENVF=$TMP/rebuild.env
{
  echo "DATABASE_URL=postgresql://$ROLE:$PASSWORD@127.0.0.1:5432/$DB?application_name=rollback-rebuild"
  echo "DIRECT_URL=postgresql://$ROLE:$PASSWORD@127.0.0.1:5432/$DB?application_name=rollback-rebuild"
  echo 'NODE_ENV=production'
  echo 'NEXT_TELEMETRY_DISABLED=1'
  echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
  echo "SESSION_SECRET=$(openssl rand -hex 32)"
} > "$ENVF"
unset PASSWORD
# Next must never load release .env files; hide them in the unit mount namespace.
HIDDEN=''
for base in /srv/ms-social-pilot-rebuild "$REBUILD"; do
  for name in .env .env.local .env.production .env.production.local; do HIDDEN="$HIDDEN -$base/$name"; done
done
run_release() {
  local label=$1 release=$2 port=$3 endpoint=$4 unit t deadline code connections
  unit="socialpilot-rollback-$label-$$.service"
  [ "$(systemctl show -p LoadState --value "$unit" 2>/dev/null || true)" != loaded ] || fail 'Refusing: transient unit already exists'
  STARTED_UNITS+=("$unit")
  t=$(date +%s)
  # Egress blocked except loopback Postgres/probes. No worker, writable release, or live env.
  systemd-run --quiet --collect --unit="$unit" --uid=socialpilot --gid=socialpilot \
    --working-directory="$release" -p EnvironmentFile="$TMP/$label.env" \
    -p "Environment=PORT=$port HOSTNAME=127.0.0.1" \
    -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes \
    -p NoNewPrivileges=yes -p RestrictSUIDSGID=yes -p 'CapabilityBoundingSet=' \
    -p 'IPAddressDeny=any' -p 'IPAddressAllow=localhost' \
    -p "InaccessiblePaths=$HIDDEN" -p RuntimeMaxSec="$(( TIMEOUT * 2 + 30 ))" \
    -p 'StandardOutput=null' -p 'StandardError=null' \
    /usr/bin/node "$release/node_modules/next/dist/bin/next" start -H 127.0.0.1 -p "$port"
  deadline=$(( t + TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code=$(curl --noproxy '*' --silent --max-time "$CURL_TIMEOUT" -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$endpoint" || true)
    if [ "$code" = 200 ]; then
      connections=$(pg -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname='$DB' AND usename='$ROLE' AND application_name='rollback-$label'")
      if [ "$connections" -gt 0 ] && systemctl is-active --quiet "$unit"; then
        elapsed=$(( $(date +%s) - t ))
        echo "$label: HTTP 200 and scratch DB connection confirmed (${elapsed}s)"
        return
      fi
    fi
    systemctl is-active --quiet "$unit" || fail "$label: transient service exited"
    sleep "$POLL_SECONDS"
  done
  fail "$label: HTTP/DB readiness timed out"
}
run_release rebuild "$REBUILD" "$REBUILD_PORT" /api/health
REBUILD_SECONDS=$elapsed
# Ensure the release is still healthy after the check.
curl --noproxy '*' --fail --silent --max-time "$CURL_TIMEOUT" -o /dev/null "http://127.0.0.1:$REBUILD_PORT/api/health" || fail 'Rebuild did not remain healthy'
[ "$(sha256sum "$REBUILD/.next/BUILD_ID")" = "$ARTIFACTS" ] || fail 'Release changed during drill; rerun without concurrent deployment'
COMPLETE=1
REMOTE
