#!/usr/bin/env bash
# Deploy the current commit (HEAD of main) to production.
#
#   scripts/deploy/deploy.sh            # full deploy
#   scripts/deploy/deploy.sh --rollback # put the previous release back
#
# Requirements on this machine: git, ssh, curl, and the SSH key below.
# Override with DEPLOY_HOST / DEPLOY_KEY. See docs/ai/RELEASE.md.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@213.246.45.75}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/SebMouadSSH}"
D=/root/deploy-socialpilot-20261009
SSH=(ssh -i "$KEY" -o ServerAliveInterval=30 "$HOST")
HERE="$(cd "$(dirname "$0")" && pwd)"

check_sites() {
  local failed=0
  for url in https://social.newsgeet.com/api/health https://recettes.newsgeet.com https://desomemes.com https://goltaf.com; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
    echo "$code $url"
    [ "$code" = "200" ] || failed=1
  done
  return $failed
}

if [ "${1:-}" = "--rollback" ]; then
  "${SSH[@]}" 'bash -s' < "$HERE/remote-rollback.sh"
  check_sites
  exit
fi

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean: commit first (only committed code is deployed)." >&2
  exit 1
fi
H=$(git rev-parse --short HEAD)
echo "Deploying $H"
git push -q origin HEAD:main || echo "warning: push failed; deploying anyway"

"${SSH[@]}" "mkdir -p $D"
git archive HEAD | "${SSH[@]}" "cat > $D/release-$H.tar"

stage_out=$( { printf 'H=%s\n' "$H"; cat "$HERE/remote-stage.sh"; } | "${SSH[@]}" 'bash -s' 2>&1 )
echo "$stage_out" | tail -12
echo "$stage_out" | grep -q '^BUILD_OK' || { echo "Build failed on the server; the live app was not touched." >&2; exit 1; }

"${SSH[@]}" 'bash -s' < "$HERE/remote-swap.sh"
check_sites && echo "DEPLOY_OK $H"
