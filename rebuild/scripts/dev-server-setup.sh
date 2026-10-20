#!/usr/bin/env bash
# One-time (re)install of the capped development server on the production host.
# Creates /srv/ms-social-pilot-rebuild-dev from origin/main, installs dependencies at low
# priority, and a systemd unit `msp-dev` running `next dev` on 127.0.0.1:${DEV_PORT}.
# It shares the live database (pre-production), runs NO worker, and is resource-capped so
# other sites on the host are unaffected. Start/stop it with dev-sync.sh or systemctl.
# Usage (from app/): bash rebuild/scripts/dev-server-setup.sh
set -euo pipefail
HOST="${PROD_HOST:-$(grep -o 'root@[0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
DEV_PORT="${DEV_PORT:-3110}"
DEV_CPU_QUOTA="${DEV_CPU_QUOTA:-100%}"   # one core at most
DEV_MEMORY_MAX="${DEV_MEMORY_MAX:-3G}"
DEV_NICE="${DEV_NICE:-15}"
COMMIT="$(git rev-parse origin/main)"
ssh -i "$KEY" "$HOST" 'systemctl stop msp-dev 2>/dev/null || true; mkdir -p /srv/ms-social-pilot-rebuild-dev'
git archive --format=tar "$COMMIT" | ssh -i "$KEY" "$HOST" 'tar -x -C /srv/ms-social-pilot-rebuild-dev'
ssh -i "$KEY" "$HOST" "DEV_PORT=$DEV_PORT DEV_CPU_QUOTA=$DEV_CPU_QUOTA DEV_MEMORY_MAX=$DEV_MEMORY_MAX DEV_NICE=$DEV_NICE bash -s" <<'REMOTE'
set -euo pipefail
D=/srv/ms-social-pilot-rebuild-dev
LIVE_ENV=/srv/ms-social-pilot-rebuild/rebuild/.env.production.local
# Same bootstrap values as live (database, encryption, session); dev mode and port only.
grep -vE '^(NODE_ENV|PORT)=' "$LIVE_ENV" > "$D/rebuild/.env.development.local"
echo "PORT=$DEV_PORT" >> "$D/rebuild/.env.development.local"
chmod 600 "$D/rebuild/.env.development.local"
chown -R socialpilot:socialpilot "$D"
echo "Installing dependencies at low priority…"
sudo -u socialpilot bash -c "cd $D && nice -n 19 npm ci --no-audit --no-fund >/tmp/dev-npm.log 2>&1 && cd rebuild && nice -n 19 npx prisma generate >/dev/null" || { tail -20 /tmp/dev-npm.log; exit 1; }
cat > /etc/systemd/system/msp-dev.service <<UNIT
[Unit]
Description=MS Social Pilot rebuild DEV server (next dev, capped, no worker)
After=network.target postgresql.service
[Service]
User=socialpilot
WorkingDirectory=$D/rebuild
EnvironmentFile=$D/rebuild/.env.development.local
Environment=NODE_ENV=development NEXT_TELEMETRY_DISABLED=1
ExecStart=/usr/bin/env npx next dev -H 127.0.0.1 -p $DEV_PORT
Nice=$DEV_NICE
CPUQuota=$DEV_CPU_QUOTA
MemoryMax=$DEV_MEMORY_MAX
IOSchedulingClass=idle
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
echo "Dev server installed (not started, not enabled at boot). Port $DEV_PORT, CPU $DEV_CPU_QUOTA, memory $DEV_MEMORY_MAX, nice $DEV_NICE."
REMOTE
