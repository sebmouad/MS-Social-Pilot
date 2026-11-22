#!/usr/bin/env bash
# Backs up MS Social Pilot on the server: a compressed dump of the database and a copy of the uploaded media.
# Run as root by social-pilot-backup.timer every night, and by the deploy script before it applies migrations.
#   backup.sh                 # database + media, then prune old dumps
#   backup.sh --database-only # what the deploy script runs before migrations
#   backup.sh --list          # the dumps kept on this server
#   backup.sh --restore-test  # restore the newest dump into a throwaway database and check it (weekly timer)
# Restore a dump (stop the services first):
#   sudo -u postgres pg_restore --clean --if-exists -d social_pilot /var/backups/ms-social-pilot/db/<file>.dump
#
# These copies sit on the same disk as the app. For a copy that survives losing the server, put an rsync destination
# in /etc/ms-social-pilot-backup.conf as BACKUP_RSYNC_TARGET="user@host:/path" (root's SSH key must be accepted there);
# each run then sends the backup directory to it and records the result as the « offsite » check in Root › Backups.
set -uo pipefail
cd /tmp

DB_NAME="${DB_NAME:-social_pilot}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ms-social-pilot}"
MEDIA_DIR="${MEDIA_DIR:-/var/lib/ms-social-pilot/media}"
KEEP_DUMPS="${KEEP_DUMPS:-14}"
AS_POSTGRES="${AS_POSTGRES:-sudo -u postgres}"
BACKUP_RSYNC_TARGET="${BACKUP_RSYNC_TARGET:-}"
[ -f /etc/ms-social-pilot-backup.conf ] && . /etc/ms-social-pilot-backup.conf

mode="${1:-all}"
if [ "$mode" = "--list" ]; then ls -lh "$BACKUP_DIR/db" 2>/dev/null || echo "No dumps yet in $BACKUP_DIR/db."; exit 0; fi

# One line per run in the table Root › Backups reads. A failure to record never fails the backup itself.
record() { # kind, status, detail, started (epoch seconds)
  $AS_POSTGRES psql -d "$DB_NAME" -X -q -v ON_ERROR_STOP=1 -v id="$(cat /proc/sys/kernel/random/uuid)" -v kind="$1" -v status="$2" -v detail="$3" -v started="$4" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO backup_runs (id, kind, status, detail, "startedAt", "finishedAt") VALUES (:'id', :'kind', :'status', :'detail', to_timestamp(:'started'), NOW());
SQL
}

# Restore test (2026-11-22): the newest dump is restored into a throwaway database, its main tables must hold rows, then
# the database is dropped; recorded as « restore_test » in Root › Backups. Run weekly by social-pilot-restore-test.timer.
if [ "$mode" = "--restore-test" ]; then
  rt_started="$(date +%s)"; test_db="${DB_NAME}_restore_test"
  rt_fail() { echo "Restore test FAILED: $1" >&2; $AS_POSTGRES dropdb --if-exists "$test_db" >/dev/null 2>&1 || true; record restore_test failed "$1" "$rt_started"; exit 1; }
  latest="$(ls -1t "$BACKUP_DIR"/db/*.dump 2>/dev/null | head -n 1)"
  [ -n "$latest" ] || rt_fail "No dump to restore in $BACKUP_DIR/db."
  $AS_POSTGRES dropdb --if-exists "$test_db" >/dev/null 2>&1 || true
  $AS_POSTGRES createdb "$test_db" 2>"$BACKUP_DIR/last-error.log" || rt_fail "Could not create the test database."
  # Dumps are readable by root only: the file is fed on standard input.
  $AS_POSTGRES pg_restore --no-owner --no-privileges --exit-on-error -d "$test_db" <"$latest" 2>"$BACKUP_DIR/last-error.log" \
    || rt_fail "$(basename "$latest") did not restore: $(tail -n 1 "$BACKUP_DIR/last-error.log" 2>/dev/null)"
  counts="$($AS_POSTGRES psql -d "$test_db" -X -A -t -F ' ' -c 'SELECT (SELECT COUNT(*) FROM users), (SELECT COUNT(*) FROM posts), (SELECT COUNT(*) FROM post_targets), (SELECT COUNT(*) FROM wordpress_recipe_plans)' 2>"$BACKUP_DIR/last-error.log")" \
    || rt_fail "$(basename "$latest") restored, but its tables could not be read."
  set -- $counts
  [ "${1:-0}" -gt 0 ] && [ "${2:-0}" -gt 0 ] || rt_fail "$(basename "$latest") restored with no users or no posts."
  $AS_POSTGRES dropdb --if-exists "$test_db" >/dev/null 2>&1 || true
  detail="$(basename "$latest") restored: $1 users, $2 posts, $3 post targets, $4 recipe plans."
  echo "Restore test ok: $detail"; record restore_test ok "$detail" "$rt_started"; exit 0
fi

started="$(date +%s)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/media" && chmod 700 "$BACKUP_DIR" || { echo "Cannot create $BACKUP_DIR." >&2; exit 1; }

# Dumps taken before an update are kept apart from the nightly ones, so a busy day of updates never pushes them out.
prefix="$DB_NAME"; [ "$mode" = "--database-only" ] && prefix="pre-update-$DB_NAME"
dump="$BACKUP_DIR/db/$prefix-$stamp.dump"
# Written under a temporary name: a dump cut short by a full disk or a reboot is never mistaken for a good one.
if $AS_POSTGRES pg_dump --format=custom --no-owner "$DB_NAME" >"$dump.part" 2>"$BACKUP_DIR/last-error.log" && [ -s "$dump.part" ]; then
  mv "$dump.part" "$dump"; chmod 600 "$dump"
  size="$(du -h "$dump" | cut -f1)"
  echo "Database dump written: $dump ($size)"
else
  rm -f "$dump.part"
  echo "Database dump FAILED: $(tail -n 3 "$BACKUP_DIR/last-error.log" 2>/dev/null)" >&2
  record local failed "Database dump failed." "$started"
  exit 1
fi
# Keep the newest dumps only.
ls -1t "$BACKUP_DIR"/db/"$prefix"-*.dump 2>/dev/null | tail -n +"$((KEEP_DUMPS + 1))" | while read -r old; do rm -f "$old"; done

if [ "$mode" = "--database-only" ]; then record local ok "Database dump before an update ($size)." "$started"; exit 0; fi

media_note="no media directory"
if [ -d "$MEDIA_DIR" ]; then
  if command -v rsync >/dev/null 2>&1; then rsync -a --delete "$MEDIA_DIR/" "$BACKUP_DIR/media/"; else cp -a "$MEDIA_DIR/." "$BACKUP_DIR/media/"; fi \
    && media_note="media copied ($(du -sh "$BACKUP_DIR/media" | cut -f1))" || media_note="media copy FAILED"
fi
echo "Media: $media_note"
case "$media_note" in *FAILED*) record local failed "Database dump ok ($size); $media_note." "$started"; exit 1 ;; esac
record local ok "Database dump ($size); $media_note." "$started"

if [ -n "$BACKUP_RSYNC_TARGET" ]; then
  off_started="$(date +%s)"
  if rsync -a --delete -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" "$BACKUP_DIR/" "$BACKUP_RSYNC_TARGET/" 2>"$BACKUP_DIR/last-error.log"; then
    echo "Sent to the off-site destination."; record offsite ok "Backup directory sent to the off-site destination." "$off_started"
  else
    echo "Off-site copy FAILED: $(tail -n 2 "$BACKUP_DIR/last-error.log")" >&2; record offsite failed "Could not send the backup to the off-site destination." "$off_started"; exit 1
  fi
fi
