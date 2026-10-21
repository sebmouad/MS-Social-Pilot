#!/usr/bin/env bash
# Rebuild release to production (post-cutover). Builds origin/main next to the live copy,
# applies any new migrations (as postgres, then hands ownership to the app role), swaps,
# restarts web+worker and health-checks. No settings are written here; all values come from Root. On failure after the swap it restores the
# previous release folder and restarts it. Database restore is NOT automatic: a fresh
# dump is taken first and its path printed.
# Incremental: a persistent build folder keeps node_modules and .next/cache, so npm ci runs
# only when package-lock.json changes; the build runs at low priority under a CPU cap so
# other sites on the host stay responsive.
# Usage (from app/): bash rebuild/scripts/prod-deploy.sh
set -euo pipefail
BUILD_CPU_QUOTA="${BUILD_CPU_QUOTA:-300%}"   # at most 3 of the host's cores
BUILD_NICE="${BUILD_NICE:-10}"
HOST="${PROD_HOST:-$(grep -o 'root@[0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
COMMIT="$(git rev-parse origin/main)"
echo "Release commit: $COMMIT"
ORDER_FILE="$(mktemp)"; APPROVED="$(mktemp)"; ALL="$(mktemp)"
grep -o 'migration_dir/[0-9a-z_]*/migration.sql' rebuild/scripts/cutover-rehearsal.sh | sed 's#migration_dir/##;s#/migration.sql##' > "$APPROVED"
ls prisma/migrations | grep -E '^[0-9]{14}_' | sort > "$ALL"
{ grep -vxF -f "$APPROVED" "$ALL" | grep -v '_rebuild_' || true; cat "$APPROVED"; grep -vxF -f "$APPROVED" "$ALL" | grep '_rebuild_' || true; } > "$ORDER_FILE"
COPYFILE_DISABLE=1 tar --no-xattrs -C prisma/migrations -cf - $(cat "$ORDER_FILE") 2>/dev/null | ssh -i "$KEY" "$HOST" 'rm -rf /var/tmp/deploy-migrations && mkdir -m 755 /var/tmp/deploy-migrations && tar -x -C /var/tmp/deploy-migrations 2>/dev/null'
scp -q -i "$KEY" "$ORDER_FILE" "$HOST:/var/tmp/deploy-migrations/ORDER"
ssh -i "$KEY" "$HOST" 'rm -rf /var/tmp/deploy-src && mkdir -p /var/tmp/deploy-src'
git archive --format=tar "$COMMIT" | ssh -i "$KEY" "$HOST" 'tar -x -C /var/tmp/deploy-src'

ssh -i "$KEY" "$HOST" "COMMIT=$COMMIT BUILD_CPU_QUOTA=$BUILD_CPU_QUOTA BUILD_NICE=$BUILD_NICE bash -s" <<'REMOTE'
set -uo pipefail
cd /tmp
NEW=/srv/ms-social-pilot-rebuild.new; LIVE=/srv/ms-social-pilot-rebuild; PREV=/srv/ms-social-pilot-rebuild.prev
ENVF=$LIVE/rebuild/.env.production.local
T=$(date +%Y%m%d-%H%M%S); B=/var/backups/socialpilot-deploy-$T; mkdir -m 700 -p "$B"
sudo -u postgres pg_dump -Fc social_pilot > "$B/social_pilot.dump" && chmod 600 "$B/social_pilot.dump" || { echo "Backup failed; nothing changed"; exit 1; }
echo "Backup: $B"
BUILD=/srv/ms-social-pilot-rebuild-build; mkdir -p "$BUILD"
# Mirror the release source into the persistent build folder, keeping dependencies and caches.
rsync -a --delete --exclude node_modules --exclude 'rebuild/node_modules' --exclude 'rebuild/.next' --exclude 'rebuild/generated' /var/tmp/deploy-src/ "$BUILD/"
cp "$ENVF" "$BUILD/rebuild/.env.production.local"; chmod 600 "$BUILD/rebuild/.env.production.local"
chown -R socialpilot:socialpilot "$BUILD"
LOCK_SUM="$(cat "$BUILD/package-lock.json" "$BUILD/rebuild/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1)"
INSTALL=1; [ -d "$BUILD/node_modules" ] && [ -d "$BUILD/rebuild/node_modules" ] && [ "$(cat "$BUILD/.lock-sum" 2>/dev/null)" = "$LOCK_SUM" ] && INSTALL=0
start=$(date +%s)
systemd-run --quiet --wait --collect --uid=socialpilot --gid=socialpilot -p CPUQuota="$BUILD_CPU_QUOTA" -p Nice="$BUILD_NICE" -p IOSchedulingClass=idle --working-directory="$BUILD" \
  /bin/bash -c "set -e; if [ $INSTALL = 1 ]; then npm ci --no-audit --no-fund >/tmp/deploy-npm.log 2>&1; (cd rebuild && npm ci --no-audit --no-fund >>/tmp/deploy-npm.log 2>&1); fi; cd rebuild; npx prisma generate >/dev/null; npx next build >/tmp/deploy-build.log 2>&1" \
  || { echo "Build failed; nothing changed"; tail -n 25 /tmp/deploy-build.log; exit 1; }
echo "$LOCK_SUM" > "$BUILD/.lock-sum"
echo "Build: OK in $(( $(date +%s) - start ))s (dependencies $( [ $INSTALL = 1 ] && echo reinstalled || echo reused ))"
rm -rf "$NEW"; cp -a "$BUILD" "$NEW"
DONE="$(sudo -u postgres psql -d social_pilot -Atc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
applied=0
while read -r m; do
  printf '%s\n' "$DONE" | grep -qx "$m" && continue
  f="/var/tmp/deploy-migrations/$m/migration.sql"
  sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q -1 < "$f" >/dev/null 2>/tmp/deploy-mig-err.txt || { echo "Migration $m failed; live release untouched"; head -5 /tmp/deploy-mig-err.txt; exit 1; }
  sudo -u postgres psql -d social_pilot -q -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$(sha256sum "$f" | cut -d' ' -f1)', now(), '$m', null, null, now(), 1)" >/dev/null
  applied=$((applied+1))
done < /var/tmp/deploy-migrations/ORDER
APP_ROLE="$(sudo -u postgres psql -d social_pilot -Atc "select tableowner from pg_tables where schemaname='public' and tablename='users'")"
sudo -u postgres psql -d social_pilot -Atc "select format('ALTER %s %s OWNER TO %I;', case relkind when 'v' then 'VIEW' else 'TABLE' end, oid::regclass, '$APP_ROLE') from pg_class where relnamespace='public'::regnamespace and relowner='postgres'::regrole and relkind in ('r','p','v') union all select format('ALTER FUNCTION %s OWNER TO %I;', oid::regprocedure, '$APP_ROLE') from pg_proc where pronamespace='public'::regnamespace and proowner='postgres'::regrole" \
  | sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -1 -q >/dev/null
echo "Migrations applied: $applied"
# Public origin is a Root setting (app.publicOrigin); the probe reads it, nothing is hardcoded.
PUBLIC_ORIGIN="$(sudo -u postgres psql -d social_pilot -Atc "select value #>> '{}' from app_settings where key='app.publicOrigin'")"
[ -n "$PUBLIC_ORIGIN" ] || echo "Note: Root app.publicOrigin is empty; set it in Root > Shared controls before browsers can sign in behind the proxy."
rm -rf "$PREV"; mv "$LIVE" "$PREV"; mv "$NEW" "$LIVE"
systemctl restart social-pilot-rebuild social-pilot-rebuild-worker
ok=0; for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/sign-in || true); [ "$c" = 200 ] && { ok=1; break; }; sleep 2; done
csrf=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3100/api/auth/sign-in -H "Origin: $PUBLIC_ORIGIN" -H 'Content-Type: application/json' -d '{"email":"deploy-probe@example.invalid","password":"x"}' || true)
pub=skipped; [ -n "$PUBLIC_ORIGIN" ] && pub=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_ORIGIN/sign-in" || true)
if [ $ok = 1 ] && [ "$csrf" = 401 ] && { [ "$pub" = 200 ] || [ "$pub" = skipped ]; }; then
  echo "DEPLOY OK $COMMIT: local 200, sign-in origin check $csrf (expects 401), public $pub; services $(systemctl is-active social-pilot-rebuild social-pilot-rebuild-worker | tr '\n' ' ')"
else
  echo "!! Health failed (local ok=$ok, sign-in=$csrf, public=$pub); restoring previous release"
  rm -rf "$NEW"; mv "$LIVE" "$NEW"; mv "$PREV" "$LIVE"; systemctl restart social-pilot-rebuild social-pilot-rebuild-worker
  echo "Previous release restored. Database backup: $B"; exit 1
fi
REMOTE
