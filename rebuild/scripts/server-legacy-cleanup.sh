#!/usr/bin/env bash
# Server-side legacy removal (lane 47); run from anywhere in the checkout.
# Owner approved 2026-10-22. Removes the retired legacy release from the
# production host: old systemd units, old release directories, the old deploy
# guard, and the five legacy-only database tables. Idempotent: every step
# checks state first and prints what it does. Never touches the rebuild
# release, the rebuild units, backups, or /var/lib/ms-social-pilot/media.
#
# Protected (never removed by this script):
#   /srv/ms-social-pilot-rebuild*  /var/lib/ms-social-pilot/media
#   /var/backups/*  social-pilot-rebuild* units  the social_pilot database itself
set -euo pipefail
: "${LEGACY_CLEANUP_CONFIRM:?Set LEGACY_CLEANUP_CONFIRM=YES to remove the legacy release}"
[ "$LEGACY_CLEANUP_CONFIRM" = YES ] || { echo 'Refusing: LEGACY_CLEANUP_CONFIRM must be YES' >&2; exit 1; }
cd "$(dirname "$0")/.."   # rebuild/
HOST="${PROD_HOST:-$(grep -o 'root@[0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
[ -n "$HOST" ] || { echo 'LEGACY CLEANUP FAIL: no production host' >&2; exit 1; }
# Ship the mapped schema so the server verifies every dropped table is
# unmapped before dropping anything.
tar -czf - prisma/schema.prisma | ssh -i "$KEY" "$HOST" 'mkdir -p /var/tmp/legacy-cleanup && tar -xzf - -C /var/tmp/legacy-cleanup'
ssh -i "$KEY" "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
fail() { echo "LEGACY CLEANUP FAIL: $*" >&2; exit 1; }
[ "$EUID" = 0 ] || fail 'remote root required'
# Never strand the server without the app: the rebuild must be serving first.
systemctl is-active --quiet social-pilot-rebuild || fail 'rebuild web unit is not active'
systemctl is-active --quiet social-pilot-rebuild-worker || fail 'rebuild worker unit is not active'
echo 'rebuild units active; legacy removal may proceed'
echo 'media root /var/lib/ms-social-pilot/media will not be touched'

# Fresh backup before any destructive step.
STAMP="$(date -u +%Y%m%d%H%M%S)"
DUMP_DIR="/var/backups/legacy-cleanup-$STAMP"
mkdir -p "$DUMP_DIR"
sudo -u postgres pg_dump -Fc -f "$DUMP_DIR/social_pilot.dump" social_pilot
[ -s "$DUMP_DIR/social_pilot.dump" ] || fail 'fresh backup is missing or empty'
echo "fresh backup: $DUMP_DIR/social_pilot.dump ($(du -h "$DUMP_DIR/social_pilot.dump" | cut -f1))"

# Drop list (lane 47): the production tables that the rebuild schema does not
# map and that no rebuild source references. Derivation is recorded in
# docs/LEGACY_DATA_MIGRATION.md; the unmapped property is re-verified below
# against the shipped schema.prisma before anything is dropped.
TABLES='workspace_exports "OAuthClient" "OAuthCode" api_tokens snippets'
MAPS="$(grep -o '@@map("[^"]*")' /var/tmp/legacy-cleanup/prisma/schema.prisma | sed 's/@@map("//;s/"//')"
for t in $TABLES; do
  bare="$(printf '%s' "$t" | tr -d '"')"
  printf '%s\n' "$MAPS" | grep -qx "$bare" && fail "refusing: $t is mapped by the rebuild schema"
done
echo 'all five drop candidates confirmed unmapped by the rebuild schema'
# Evidence first: row counts (or already-missing) for each candidate.
for t in $TABLES; do
  bare="$(printf '%s' "$t" | tr -d '"')"
  exists="$(sudo -u postgres psql -d social_pilot -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='$bare'")"
  if [ "$exists" = 1 ]; then
    rows="$(sudo -u postgres psql -d social_pilot -Atc "SELECT count(*) FROM public.$t")"
    echo "table $t exists with $rows rows"
  else
    echo "table $t already absent"
  fi
done
# One transaction for all drops; IF EXISTS keeps reruns quiet.
sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
DROP TABLE IF EXISTS public.workspace_exports, public."OAuthClient", public."OAuthCode", public.api_tokens, public.snippets;
COMMIT;
SQL
echo 'legacy-only tables dropped (single transaction)'

# Old systemd units: stop, disable, remove the unit files.
for unit in social-pilot.service social-pilot-worker.service; do
  if systemctl list-unit-files "$unit" >/dev/null 2>&1 && systemctl list-unit-files "$unit" | grep -q "$unit"; then
    systemctl stop "$unit" >/dev/null 2>&1 || echo "$unit was not running"
    systemctl disable "$unit" >/dev/null 2>&1 || echo "$unit was not enabled"
    rm -f "/etc/systemd/system/$unit"
    echo "removed unit file /etc/systemd/system/$unit"
  else
    echo "unit already absent: $unit"
  fi
done
systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true
echo 'systemd reloaded'

# Old release directories (exact paths only).
for dir in /srv/ms-social-pilot /srv/ms-social-pilot.prev; do
  if [ -e "$dir" ]; then
    rm -rf -- "$dir"
    echo "removed $dir"
  else
    echo "already absent: $dir"
  fi
done

# Old deploy guard (exact path only).
if [ -e /usr/local/sbin/socialpilot-deploy ]; then
  rm -f /usr/local/sbin/socialpilot-deploy
  echo 'removed /usr/local/sbin/socialpilot-deploy'
else
  echo 'already absent: /usr/local/sbin/socialpilot-deploy'
fi

rm -rf /var/tmp/legacy-cleanup
echo 'rebuild units still: '"$(systemctl is-active social-pilot-rebuild social-pilot-rebuild-worker | tr '\n' ' ')"
echo 'LEGACY CLEANUP OK: legacy release removed; media, backups and rebuild untouched'
REMOTE
