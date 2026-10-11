#!/usr/bin/env bash
# One-time setup of off-site backups on the server (run as root):
#   1. apt-get install -y age rclone
#   2. rclone config            # create the remote (B2, S3, Google Drive…) with the owner's key
#   3. write /etc/ms-social-pilot/offsite.env (see offsite-backup.sh)
#   4. bash install-offsite.sh  # installs the scripts and the cron entries
set -euo pipefail
cd "$(dirname "$0")"
install -m 0750 offsite-backup.sh /usr/local/sbin/ms-social-pilot-offsite
install -m 0750 restore-test.sh /usr/local/sbin/ms-social-pilot-restore-test
chmod 0600 /etc/ms-social-pilot/offsite.env
cat > /etc/cron.d/ms-social-pilot-offsite <<'CRON'
# After the local backup (04:15): copy it off the server, encrypted.
45 4 * * * root /usr/local/sbin/ms-social-pilot-offsite >> /var/log/ms-social-pilot-offsite.log 2>&1
# Monthly: prove the newest dump restores.
30 5 1 * * root /usr/local/sbin/ms-social-pilot-restore-test >> /var/log/ms-social-pilot-offsite.log 2>&1
CRON
echo "installed; first run: /usr/local/sbin/ms-social-pilot-offsite"
