#!/usr/bin/env bash
# Fast dev loop against the capped server-side dev server (see dev-server-setup.sh).
# Starts msp-dev, opens an SSH tunnel to http://localhost:${DEV_PORT}, and mirrors local
# rebuild/ source edits to the server every second; next dev hot-reloads them.
# Ctrl+C stops syncing, closes the tunnel and stops the dev server (frees its resources).
# Requires Root app.developmentOrigins to contain http://localhost:${DEV_PORT}.
# Usage (from app/): bash rebuild/scripts/dev-sync.sh
set -euo pipefail
HOST="${PROD_HOST:-$(grep -o 'root@[0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
DEV_PORT="${DEV_PORT:-3110}"
SYNC_SECONDS="${SYNC_SECONDS:-1}"
REMOTE_DIR=/srv/ms-social-pilot-rebuild-dev/rebuild/
CTL="$HOME/.ssh/msp-dev-%r@%h:%p"
SSH=(ssh -i "$KEY" -o ControlMaster=auto -o ControlPath="$CTL" -o ControlPersist=10m)

cleanup() {
  echo; echo "Stopping dev server and tunnel…"
  "${SSH[@]}" "$HOST" 'systemctl stop msp-dev' || true
  "${SSH[@]}" -O exit "$HOST" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"${SSH[@]}" "$HOST" 'systemctl start msp-dev'
"${SSH[@]}" -f -N -L "$DEV_PORT:127.0.0.1:$DEV_PORT" "$HOST"
echo "Dev server: http://localhost:$DEV_PORT (first page compile can take ~20 s)"
echo "Syncing rebuild/ every ${SYNC_SECONDS}s. Ctrl+C to stop."
while true; do
  rsync -az --delete -e "${SSH[*]}" \
    --exclude node_modules --exclude .next --exclude generated --exclude '.env*' \
    --exclude test-results --exclude '*.log' \
    rebuild/ "$HOST:$REMOTE_DIR" 2>/dev/null || true
  sleep "$SYNC_SECONDS"
done
