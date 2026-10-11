#!/usr/bin/env bash
# Runs ON THE SERVER (piped over ssh by scripts/deploy/deploy.sh), as root.
# Builds the release tarball $H into /srv/ms-social-pilot.new without touching
# the live app. Prints BUILD_OK on success. Expects: H=<short commit hash>.
set -euo pipefail
: "${H:?H (release hash) must be set}"
D=/root/deploy-socialpilot-20261009
N=/srv/ms-social-pilot.new
rm -rf "$N"
# Start from the live tree: keeps .env, node_modules cache and .next cache.
cp -a /srv/ms-social-pilot "$N"
tar -xf "$D/release-$H.tar" -C "$N"
chown -R socialpilot:socialpilot "$N"
cd "$N"
# Limited CPU/RAM/IO so the WordPress sites on the same box stay responsive.
RUN=(systemd-run --quiet --wait --pipe --collect --uid=socialpilot --gid=socialpilot
  -p WorkingDirectory="$N" -p CPUQuota=300% -p MemoryMax=6G -p Nice=10 -p IOWeight=20
  -E HOME=/var/lib/ms-social-pilot -E NEXT_TELEMETRY_DISABLED=1)
"${RUN[@]}" /usr/bin/npm ci --no-audit --no-fund 2>&1 | tail -3
"${RUN[@]}" /usr/bin/npm run build 2>&1 | tail -8
test -f "$N/.next/BUILD_ID" || { echo "BUILD_FAILED: no .next/BUILD_ID"; exit 1; }
echo BUILD_OK
