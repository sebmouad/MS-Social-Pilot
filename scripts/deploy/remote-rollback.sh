#!/usr/bin/env bash
# Runs ON THE SERVER. Puts the previous release back (/srv/ms-social-pilot.prev).
# Database migrations are NOT reversed: they are additive in this project, so
# the previous code runs on the newer schema. Restore a dump from
# /var/backups/ms-social-pilot only if a migration itself was the problem.
set -euo pipefail
test -d /srv/ms-social-pilot.prev || { echo "NO_PREVIOUS_RELEASE"; exit 1; }
rm -rf /srv/ms-social-pilot.failed
mv /srv/ms-social-pilot /srv/ms-social-pilot.failed
mv /srv/ms-social-pilot.prev /srv/ms-social-pilot
systemctl restart social-pilot social-pilot-worker
for i in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:3100/api/health 2>/dev/null && break; sleep 1; done
curl -sS http://127.0.0.1:3100/api/health; echo
systemctl is-active social-pilot social-pilot-worker
