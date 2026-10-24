#!/usr/bin/env bash
# Copy the newest local backup off the server, encrypted, and prune old copies.
#
# Runs from cron after /usr/local/sbin/ms-social-pilot-backup (see
# install-offsite.sh). Needs `age` and `rclone`, and /etc/ms-social-pilot/offsite.env:
#
#   RCLONE_REMOTE="b2:my-bucket/ms-social-pilot"   # any rclone remote (B2, S3, Google Drive…)
#   AGE_RECIPIENT="age1…"                          # PUBLIC key; the owner keeps the private key off the server
#   DATABASE_URL="postgresql://…"                  # to record the result for the root section
#   BACKUP_DIR="/var/backups/ms-social-pilot"      # optional
#
# Keeps 30 daily copies and 12 monthly ones (the first backup of each month).
# The server can encrypt but never decrypt: a stolen server or bucket alone
# does not give the data away.
set -euo pipefail

CONFIG=/etc/ms-social-pilot/offsite.env
# shellcheck disable=SC1090
source "$CONFIG"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ms-social-pilot}"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

record() { # status, detail
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
    -v kind=offsite -v status="$1" -v detail="$2" -v started="$STARTED" <<'SQL' || true
INSERT INTO backup_runs (id, kind, status, detail, "startedAt", "finishedAt")
VALUES (md5(random()::text || clock_timestamp()::text), :'kind', :'status', :'detail', :'started'::timestamptz, now());
SQL
}
trap 'record failed "offsite-backup.sh stopped at line $LINENO"' ERR

latest() { ls -t "$BACKUP_DIR"/$1 2>/dev/null | head -1; }
DB="$(latest 'db-*.dump')"
MEDIA="$(latest 'media-*.tar.gz')"
ENVFILE="$(latest 'env-*')"
[ -n "$DB" ] || { record failed "no local database dump in $BACKUP_DIR"; exit 1; }

DAY="$(date -u +%Y-%m-%d)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TOTAL=0
for file in "$DB" "$MEDIA" "$ENVFILE"; do
  [ -n "$file" ] || continue
  out="$WORK/$(basename "$file").age"
  age -r "$AGE_RECIPIENT" -o "$out" "$file"
  TOTAL=$((TOTAL + $(stat -c %s "$out")))
done

rclone copy "$WORK" "$RCLONE_REMOTE/daily/$DAY" --quiet
if [ "$(date -u +%d)" = "01" ]; then
  rclone copy "$WORK" "$RCLONE_REMOTE/monthly/$(date -u +%Y-%m)" --quiet
fi

# Retention: 30 daily folders, 12 monthly ones.
prune() { # folder, keep
  rclone lsf --dirs-only "$RCLONE_REMOTE/$1" 2>/dev/null | sort -r | tail -n +"$(($2 + 1))" | while read -r dir; do
    rclone purge "$RCLONE_REMOTE/$1/$dir" --quiet
  done
}
prune daily 30
prune monthly 12

COUNT="$(rclone lsf "$RCLONE_REMOTE/daily/$DAY" | wc -l)"
record ok "$COUNT files, $((TOTAL / 1024 / 1024)) MB encrypted, to $RCLONE_REMOTE/daily/$DAY"
echo "offsite backup ok: $DAY"
