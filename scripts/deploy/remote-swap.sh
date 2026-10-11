#!/usr/bin/env bash
# Runs ON THE SERVER after remote-stage.sh printed BUILD_OK.
# Backup -> migrate -> swap directories -> restart -> health check.
set -euo pipefail
N=/srv/ms-social-pilot.new
test -d "$N/.next" || { echo "NO_STAGED_BUILD"; exit 1; }
/usr/local/sbin/ms-social-pilot-backup && echo BACKUP_OK
cd "$N"
systemd-run --quiet --wait --pipe --collect --uid=socialpilot --gid=socialpilot \
  -p WorkingDirectory="$N" -E HOME=/var/lib/ms-social-pilot \
  /usr/bin/npx prisma migrate deploy 2>&1 | tail -4
rm -rf /srv/ms-social-pilot.prev
mv /srv/ms-social-pilot /srv/ms-social-pilot.prev
mv "$N" /srv/ms-social-pilot
systemctl restart social-pilot social-pilot-worker
# The first curl may fail while Next boots; that is expected.
for i in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:3100/api/health 2>/dev/null && break; sleep 1; done
curl -sS http://127.0.0.1:3100/api/health; echo
systemctl is-active social-pilot social-pilot-worker
