#!/usr/bin/env bash
# Staging drill (release gate B6) on the production host.
# Builds the rebuild from origin/main into /srv/ms-social-pilot-rebuild-drill, runs it as a
# transient service on 127.0.0.1:3110 against the SCRATCH database social_pilot_rehearsal
# (never the live database), checks it answers, then stops and removes it. The live
# services (social-pilot-rebuild and social-pilot-rebuild-worker) are not touched;
# their service start times are compared before and after to prove they never restarted.
#
# Usage (any directory in the checkout): bash rebuild/scripts/prod-stage-drill.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # rebuild/
HOST="${PROD_HOST:-$(grep -o 'root@[0-9][0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
COMMIT="$(git rev-parse origin/main)"
echo "Drill commit: $COMMIT"
# Ship the exact commit as an archive (the server's release folder is not a git checkout).
ssh -i "$KEY" "$HOST" 'rm -rf /srv/ms-social-pilot-rebuild-drill && mkdir -p /srv/ms-social-pilot-rebuild-drill'
git -C "$(git rev-parse --show-toplevel)" archive --format=tar --prefix=rebuild/ "$COMMIT:rebuild" | ssh -i "$KEY" "$HOST" 'tar -x -C /srv/ms-social-pilot-rebuild-drill'
echo "Archive shipped."
ssh -i "$KEY" "$HOST" "COMMIT=$COMMIT bash -s" <<'REMOTE'
set -euo pipefail
cd /tmp
since() { systemctl show -p ActiveEnterTimestamp --value "$1"; }
WEB_BEFORE="$(since social-pilot-rebuild)"; WORKER_BEFORE="$(since social-pilot-rebuild-worker)"
echo "Live services started at: $WEB_BEFORE / $WORKER_BEFORE"
sudo -u postgres psql -lqt | cut -d'|' -f1 | grep -qw social_pilot_rehearsal || { echo "Scratch DB missing: run prod-rehearsal.sh first"; exit 1; }
D=/srv/ms-social-pilot-rebuild-drill
[ -f "$D/rebuild/package.json" ] || { echo "Archive missing"; exit 1; }
chown -R socialpilot:socialpilot "$D"
# Env: live bootstrap material (same envelope), scratch DB, drill port.
LIVE_ENV=/srv/ms-social-pilot-rebuild/rebuild/.env.production.local
DBURL="$(grep '^DATABASE_URL=' "$LIVE_ENV" | cut -d= -f2- | sed 's#/social_pilot\([?"]\|$\)#/social_pilot_rehearsal\1#')"
{ grep -E '^(ENCRYPTION_KEY|SESSION_SECRET)=' "$LIVE_ENV"; echo "DATABASE_URL=$DBURL"; echo "NODE_ENV=production"; echo "PORT=3110"; } > "$D/rebuild/.env.drill"
chmod 600 "$D/rebuild/.env.drill"; chown socialpilot:socialpilot "$D/rebuild/.env.drill"
grep -q 'social_pilot_rehearsal' "$D/rebuild/.env.drill" || { echo "Refusing: drill env does not point at the scratch DB"; exit 1; }
echo "Installing and building (several minutes)…"
sudo -u socialpilot bash -c "cd $D/rebuild && npm ci --no-audit --no-fund >/tmp/drill-npm.log 2>&1 && npx prisma generate >/dev/null && set -a && . ./.env.drill && set +a && npx next build >/tmp/drill-build.log 2>&1" \
  && echo "Build: OK" || { echo "Build: FAILED"; tail -20 /tmp/drill-build.log /tmp/drill-npm.log; exit 1; }
systemd-run --unit=social-pilot-rebuild-drill --uid=socialpilot --gid=socialpilot \
  --property=EnvironmentFile="$D/rebuild/.env.drill" --working-directory="$D/rebuild" \
  /usr/bin/env npx next start -H 127.0.0.1 -p 3110 >/dev/null
ok=0; for i in $(seq 1 60); do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3110/sign-in || true); [ "$code" = 200 ] && { ok=1; break; }; sleep 2; done
[ $ok = 1 ] && echo "Health: /sign-in 200 on 3110" || echo "Health: FAILED (last code $code)"
echo "API probe: /api/auth/register -> $(curl -s http://127.0.0.1:3110/api/auth/register)"
systemctl stop social-pilot-rebuild-drill || true
rm -rf "$D"
echo "Drill removed. Live services still: $(systemctl is-active social-pilot-rebuild social-pilot-rebuild-worker | tr '\n' ' ')"
[ "$(since social-pilot-rebuild)" = "$WEB_BEFORE" ] && [ "$(since social-pilot-rebuild-worker)" = "$WORKER_BEFORE" ] \
  && echo "Live services never restarted: CONFIRMED" || echo "Live service restart detected: CHECK"
curl -s -o /dev/null -w "Public site: %{http_code}\n" https://social.newsgeet.com/ || true
REMOTE
