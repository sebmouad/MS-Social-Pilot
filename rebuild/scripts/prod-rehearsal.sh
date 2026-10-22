#!/usr/bin/env bash
# Production-host rehearsal (release gates B1-B4): runs on the production server via SSH.
# Reads the live database only; all writes go to a scratch database `social_pilot_rehearsal`
# and /var/tmp, which are removed at the end. The live app, its services and its database
# are not modified or restarted. Customer data never leaves the server.
#
# Usage (any directory in the checkout): bash rebuild/scripts/prod-rehearsal.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # rebuild/
HOST="${PROD_HOST:-$(grep -o 'root@[0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
ORDER_FILE="$(mktemp)"
# Every migration in the repo, in name order. The server skips those already recorded in
# _prisma_migrations, so production's missing legacy migrations are applied first, in order.
APPROVED="$(mktemp)"
grep -o 'migration_dir/[0-9a-z_]*/migration.sql' scripts/cutover-rehearsal.sh \
  | sed 's#migration_dir/##;s#/migration.sql##' > "$APPROVED"
ALL="$(mktemp)"; ls prisma/migrations | grep -E '^[0-9]{14}_' | sort > "$ALL"
# Dependency-correct order: legacy migrations first (name order), then the reviewed rebuild
# order from cutover-rehearsal.sh, then any newer rebuild migrations not yet pinned there.
{ grep -vxF -f "$APPROVED" "$ALL" | grep -v '_rebuild_' || true; cat "$APPROVED"; grep -vxF -f "$APPROVED" "$ALL" | grep '_rebuild_' || true; } > "$ORDER_FILE"
echo "Repository migrations: $(wc -l < "$ORDER_FILE")"

# 1. Copy only the rebuild migration SQL files to a private temp folder on the server.
ssh -i "$KEY" "$HOST" 'rm -rf /var/tmp/rebuild-migrations && mkdir -m 700 /var/tmp/rebuild-migrations'
while read -r m; do
  scp -q -i "$KEY" "prisma/migrations/$m/migration.sql" "$HOST:/var/tmp/rebuild-migrations/$m.sql"
done < "$ORDER_FILE"
scp -q -i "$KEY" "$ORDER_FILE" "$HOST:/var/tmp/rebuild-migrations/ORDER"

# 2. On the server: dump live DB (read-only), restore into scratch, apply migrations, report.
ssh -i "$KEY" "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /tmp
echo "Live services before: $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
sudo -u postgres pg_dump -Fc social_pilot > /var/tmp/rehearsal-src.dump
chmod 600 /var/tmp/rehearsal-src.dump
echo "Source dump sha256: $(sha256sum /var/tmp/rehearsal-src.dump | cut -c1-64)"
sudo -u postgres dropdb --if-exists social_pilot_rehearsal
sudo -u postgres createdb social_pilot_rehearsal
sudo -u postgres pg_restore -d social_pilot_rehearsal --no-owner < /var/tmp/rehearsal-src.dump
count() { sudo -u postgres psql -d "$1" -Atc "select string_agg(t||'='||c, ',' order by t) from (select table_name t, (xpath('/row/c/text()', query_to_xml('select count(*) c from public.'||quote_ident(table_name), false, true, '')))[1]::text c from information_schema.tables where table_schema='public' and table_type='BASE TABLE') x"; }
[ "$(count social_pilot)" = "$(count social_pilot_rehearsal)" ] && echo "Restore: row counts match live" || echo "Restore: ROW COUNT MISMATCH"
applied=0; failed=0; skipped=0
DONE="$(sudo -u postgres psql -d social_pilot_rehearsal -Atc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null" 2>/dev/null || true)"
while read -r m; do
  if printf '%s\n' "$DONE" | grep -qx "$m"; then skipped=$((skipped+1)); continue; fi
  if sudo -u postgres psql -d social_pilot_rehearsal -v ON_ERROR_STOP=1 -q -1 < "/var/tmp/rebuild-migrations/$m.sql" >/dev/null 2>/var/tmp/rebuild-migrations/err.txt; then
    applied=$((applied+1))
  else
    failed=$((failed+1)); echo "FAILED: $m"; head -3 /var/tmp/rebuild-migrations/err.txt
  fi
done < /var/tmp/rebuild-migrations/ORDER
echo "Already on production: $skipped; applied now: $applied; failed: $failed"
echo "Tables after migration: $(sudo -u postgres psql -d social_pilot_rehearsal -Atc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
echo "Live services after: $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
REMOTE

echo
echo "Scratch database social_pilot_rehearsal is kept for the verifier step."
echo "To remove it and the temp files afterwards:"
echo "  ssh -i $KEY $HOST 'cd /tmp; sudo -u postgres dropdb --if-exists social_pilot_rehearsal; rm -rf /var/tmp/rehearsal-src.dump /var/tmp/rebuild-migrations'"
