#!/usr/bin/env bash
# Prove the newest database dump restores: load it into a scratch database,
# count the rows that matter, drop it, and record the result for the root
# section. Runs monthly from cron (install-offsite.sh).
#
# Uses the local unencrypted dump: the server holds only the public half of
# the off-site encryption key, by design. The off-site copy is checked for
# presence and size in the same run.
set -euo pipefail

CONFIG=/etc/ms-social-pilot/offsite.env
# shellcheck disable=SC1090
source "$CONFIG"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ms-social-pilot}"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SCRATCH=msp_restore_test

record() {
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
    -v kind=restore_test -v status="$1" -v detail="$2" -v started="$STARTED" <<'SQL' || true
INSERT INTO backup_runs (id, kind, status, detail, "startedAt", "finishedAt")
VALUES (md5(random()::text || clock_timestamp()::text), :'kind', :'status', :'detail', :'started'::timestamptz, now());
SQL
}
trap 'record failed "restore-test.sh stopped at line $LINENO"' ERR

DB="$(ls -t "$BACKUP_DIR"/db-*.dump | head -1)"
ADMIN_URL="${DATABASE_URL%/*}/postgres"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
SCRATCH_URL="${DATABASE_URL%/*}/$SCRATCH"
pg_restore --no-owner --no-privileges -d "$SCRATCH_URL" "$DB"

COUNTS="$(psql "$SCRATCH_URL" -At -c "SELECT 'users=' || (SELECT count(*) FROM users) || ' workspaces=' || (SELECT count(*) FROM workspaces) || ' posts=' || (SELECT count(*) FROM posts) || ' profiles=' || (SELECT count(*) FROM targets)")"
psql "$ADMIN_URL" -q -c "DROP DATABASE $SCRATCH"

REMOTE="unchecked"
if [ -n "${RCLONE_REMOTE:-}" ]; then
  NEWEST="$(rclone lsf --dirs-only "$RCLONE_REMOTE/daily" | sort -r | head -1)"
  REMOTE="newest off-site copy ${NEWEST%/} ($(rclone size "$RCLONE_REMOTE/daily/$NEWEST" --json | sed -E 's/.*"bytes":([0-9]+).*/\1/') bytes)"
fi
record ok "$(basename "$DB") restored: $COUNTS; $REMOTE"
echo "restore test ok"
