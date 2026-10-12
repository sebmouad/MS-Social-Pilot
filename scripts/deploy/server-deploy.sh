#!/usr/bin/env bash
# Deploy from ON THE SERVER, pulling from GitHub. Installed as
# /usr/local/sbin/socialpilot-deploy (each deploy installs its own new copy).
#
#   socialpilot-deploy             # deploy the latest main from GitHub
#   socialpilot-deploy <ref>       # deploy a branch, tag or commit
#   socialpilot-deploy --status    # what is live, services, newest backup, sites
#   socialpilot-deploy --rollback  # put the previous release back
#
# Uses the same remote-stage.sh / remote-swap.sh as deploy.sh on the Mac, taken
# from the commit being deployed. GitHub access: read-only deploy key
# /root/.ssh/socialpilot_deploy (host alias github-socialpilot in /root/.ssh/config).
set -euo pipefail
REPO=/root/ms-social-pilot.git
URL=git@github-socialpilot:sebmouad/MS-Social-Pilot.git
D=/root/deploy-socialpilot-20261009
L=/srv/ms-social-pilot

check_sites() {
  local failed=0
  for url in https://social.newsgeet.com/api/health https://recettes.newsgeet.com https://desomemes.com https://goltaf.com; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
    echo "$code $url"
    [ "$code" = "200" ] || failed=1
  done
  return $failed
}

case "${1:-}" in
  --status)
    echo "live:     $(cat $L/RELEASE 2>/dev/null || echo unknown)"
    echo "previous: $(cat $L.prev/RELEASE 2>/dev/null || echo none)"
    echo "services: $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
    echo "backup:   $(ls -t /var/backups/ms-social-pilot/db-*.dump | head -1 | xargs ls -lh | awk '{print $5, $9}')"
    check_sites
    exit ;;
  --rollback)
    bash "$L/scripts/deploy/remote-rollback.sh"
    check_sites
    exit ;;
  -h|--help)
    sed -n '2,10p' "$0"; exit ;;
esac

# One deploy at a time.
exec 9>/run/socialpilot-deploy.lock
flock -n 9 || { echo "Another deploy is running." >&2; exit 1; }

REF="${1:-main}"
[ -d "$REPO" ] || git clone --quiet --bare "$URL" "$REPO"
git -C "$REPO" fetch --quiet --prune origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
H=$(git -C "$REPO" rev-parse --short "$REF^{commit}")
echo "Deploying $H: $(git -C "$REPO" log -1 --format=%s "$H")"
echo "Live now: $(cat $L/RELEASE 2>/dev/null || echo unknown)"

mkdir -p "$D"
git -C "$REPO" archive "$H" > "$D/release-$H.tar"

stage_out=$( { printf 'H=%s\n' "$H"; git -C "$REPO" show "$H:scripts/deploy/remote-stage.sh"; } | bash 2>&1 ) || true
echo "$stage_out" | tail -12
echo "$stage_out" | grep -q '^BUILD_OK' || { echo "Build failed; the live app was not touched." >&2; exit 1; }

git -C "$REPO" show "$H:scripts/deploy/remote-swap.sh" | bash
install -m 755 "$L/scripts/deploy/server-deploy.sh" /usr/local/sbin/socialpilot-deploy
check_sites && echo "DEPLOY_OK $H"
