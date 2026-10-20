#!/usr/bin/env bash
# Production cutover (release gate C) with automatic rollback. Owner-approved 2026-10-20.
# 1 fresh backup  2 stop legacy worker  3 migrate live DB (rehearsed order)  4 build rebuild,
# stop legacy web, start rebuild web+worker on 3100  5 health checks.
# Any failure after step 1 -> stop rebuild, restore DB from the fresh backup, restart legacy.
# Usage (from app/): bash rebuild/scripts/prod-cutover.sh
set -euo pipefail
HOST="${PROD_HOST:-$(grep -o 'root@[0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
COMMIT="$(git rev-parse origin/main)"
echo "Cutover commit: $COMMIT"

ORDER_FILE="$(mktemp)"; APPROVED="$(mktemp)"; ALL="$(mktemp)"
grep -o 'migration_dir/[0-9a-z_]*/migration.sql' rebuild/scripts/cutover-rehearsal.sh | sed 's#migration_dir/##;s#/migration.sql##' > "$APPROVED"
ls prisma/migrations | grep -E '^[0-9]{14}_' | sort > "$ALL"
{ grep -vxF -f "$APPROVED" "$ALL" | grep -v '_rebuild_' || true; cat "$APPROVED"; grep -vxF -f "$APPROVED" "$ALL" | grep '_rebuild_' || true; } > "$ORDER_FILE"

# Ship migrations (one archive) and the release archive.
tar -C prisma/migrations -cf - $(cat "$ORDER_FILE") | ssh -i "$KEY" "$HOST" 'rm -rf /var/tmp/cutover-migrations && mkdir -m 755 /var/tmp/cutover-migrations && tar -x -C /var/tmp/cutover-migrations'
scp -q -i "$KEY" "$ORDER_FILE" "$HOST:/var/tmp/cutover-migrations/ORDER"
ssh -i "$KEY" "$HOST" 'rm -rf /srv/ms-social-pilot-rebuild.new && mkdir -p /srv/ms-social-pilot-rebuild.new'
git archive --format=tar "$COMMIT" | ssh -i "$KEY" "$HOST" 'tar -x -C /srv/ms-social-pilot-rebuild.new'
echo "Shipped migrations and release."

ssh -i "$KEY" "$HOST" "COMMIT=$COMMIT bash -s" <<'REMOTE'
set -uo pipefail
cd /tmp
T=$(date +%Y%m%d-%H%M%S); B=/var/backups/socialpilot-cutover-$T; mkdir -m 700 -p "$B"
NEW=/srv/ms-social-pilot-rebuild.new; LIVE=/srv/ms-social-pilot-rebuild
LEGACY_ENV=/srv/ms-social-pilot/.env
step() { echo "== $*"; }

rollback() {
  echo "!! ROLLBACK: $*"
  systemctl stop social-pilot-rebuild social-pilot-rebuild-worker 2>/dev/null || true
  systemctl disable social-pilot-rebuild social-pilot-rebuild-worker 2>/dev/null || true
  if [ -s "$B/social_pilot.dump" ]; then
    sudo -u postgres pg_restore --clean --if-exists --no-owner -d social_pilot < "$B/social_pilot.dump" >/dev/null 2>&1 \
      && echo "Database restored from $B" || echo "!! DATABASE RESTORE REPORTED ERRORS - check manually: $B"
  fi
  systemctl start social-pilot social-pilot-worker
  sleep 5
  echo "Legacy after rollback: $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
  curl -s -o /dev/null -w "Public site after rollback: %{http_code}\n" https://social.newsgeet.com/ || true
  exit 1
}

step "1. Fresh backup ($B)"
sudo -u postgres pg_dump -Fc social_pilot > "$B/social_pilot.dump" && chmod 600 "$B/social_pilot.dump" || { echo "Backup failed; nothing changed"; exit 1; }
cp "$LEGACY_ENV" "$B/app.env"; chmod 600 "$B/app.env"
( cd "$B" && sha256sum * > SHA256SUMS ); echo "Backup sha256: $(sha256sum "$B/social_pilot.dump" | cut -c1-64)"

step "2. Build the rebuild before touching live services"
[ -f "$NEW/rebuild/package.json" ] || { echo "Release archive missing; nothing changed"; exit 1; }
DBURL="$(grep '^DATABASE_URL=' "$LEGACY_ENV" | cut -d= -f2-)"
{ grep -E '^(ENCRYPTION_KEY|SESSION_SECRET)=' "$LEGACY_ENV"; echo "DATABASE_URL=$DBURL"; echo "NODE_ENV=production"; echo "PORT=3100"; } > "$NEW/rebuild/.env.production.local"
chmod 600 "$NEW/rebuild/.env.production.local"; chown -R socialpilot:socialpilot "$NEW"
sudo -u socialpilot bash -c "cd $NEW && npm ci --no-audit --no-fund >/tmp/cutover-npm.log 2>&1 && cd rebuild && npx prisma generate >/dev/null && npx next build >/tmp/cutover-build.log 2>&1" \
  || { echo "Build failed; nothing changed"; tail -n 20 /tmp/cutover-build.log; exit 1; }
echo "Build: OK"

step "3. Stop legacy worker (single publisher)"
systemctl stop social-pilot-worker

step "4. Migrate live database"
DONE="$(sudo -u postgres psql -d social_pilot -Atc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
applied=0
while read -r m; do
  printf '%s\n' "$DONE" | grep -qx "$m" && continue
  f="/var/tmp/cutover-migrations/$m/migration.sql"
  sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -q -1 < "$f" >/dev/null 2>/tmp/cutover-mig-err.txt || { head -5 /tmp/cutover-mig-err.txt; rollback "migration $m failed"; }
  sum=$(sha256sum "$f" | cut -d' ' -f1)
  sudo -u postgres psql -d social_pilot -q -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$sum', now(), '$m', null, null, now(), 1)" >/dev/null || rollback "could not record $m"
  applied=$((applied+1))
done < /var/tmp/cutover-migrations/ORDER
echo "Migrations applied: $applied"
# Migrations run as postgres; hand new objects to the app role or the app gets "permission denied".
APP_ROLE="$(sudo -u postgres psql -d social_pilot -Atc "select tableowner from pg_tables where schemaname='public' and tablename='users'")"
sudo -u postgres psql -d social_pilot -Atc "select format('ALTER %s %s OWNER TO %I', case relkind when 'v' then 'VIEW' else 'TABLE' end, oid::regclass, '$APP_ROLE') from pg_class where relnamespace='public'::regnamespace and relowner='postgres'::regrole and relkind in ('r','p','v') union all select format('ALTER FUNCTION %s OWNER TO %I', oid::regprocedure, '$APP_ROLE') from pg_proc where pronamespace='public'::regnamespace and proowner='postgres'::regrole" \
  | sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -1 -q >/dev/null || rollback "could not transfer ownership to $APP_ROLE"

step "5. Switch web: stop legacy web, start rebuild on 3100"
rm -rf "$LIVE.prev"; [ -d "$LIVE" ] && mv "$LIVE" "$LIVE.prev"; mv "$NEW" "$LIVE"
cat > /etc/systemd/system/social-pilot-rebuild.service <<UNIT
[Unit]
Description=MS Social Pilot rebuild web
After=network.target postgresql.service
[Service]
User=socialpilot
WorkingDirectory=$LIVE/rebuild
EnvironmentFile=$LIVE/rebuild/.env.production.local
ExecStart=/usr/bin/env npx next start -H 127.0.0.1 -p 3100
Restart=on-failure
MemoryMax=2G
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/social-pilot-rebuild-worker.service <<UNIT
[Unit]
Description=MS Social Pilot rebuild worker
After=network.target postgresql.service
[Service]
User=socialpilot
WorkingDirectory=$LIVE/rebuild
EnvironmentFile=$LIVE/rebuild/.env.production.local
ExecStart=/usr/bin/env node --import tsx scripts/worker.ts
Restart=on-failure
MemoryMax=1G
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl stop social-pilot
systemctl start social-pilot-rebuild || rollback "rebuild web did not start"

step "6. Health checks"
ok=0; for i in $(seq 1 60); do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/sign-in || true); [ "$code" = 200 ] && { ok=1; break; }; sleep 2; done
[ $ok = 1 ] || rollback "local /sign-in not 200 (last $code)"
api=$(curl -s http://127.0.0.1:3100/api/auth/register || true); echo "$api" | grep -q '"available"' || rollback "API probe failed: $api"
pub=$(curl -s -o /dev/null -w '%{http_code}' https://social.newsgeet.com/sign-in || true)
[ "$pub" = 200 ] || rollback "public /sign-in returned $pub"
echo "Local /sign-in 200, API OK, public /sign-in 200"

step "7. Start rebuild worker; keep legacy disabled"
systemctl start social-pilot-rebuild-worker || rollback "rebuild worker did not start"
sleep 10
[ "$(systemctl is-active social-pilot-rebuild-worker)" = active ] || rollback "rebuild worker not active"
systemctl enable social-pilot-rebuild social-pilot-rebuild-worker >/dev/null 2>&1
systemctl disable social-pilot social-pilot-worker >/dev/null 2>&1
echo "CUTOVER COMPLETE. Rebuild: $(systemctl is-active social-pilot-rebuild social-pilot-rebuild-worker | tr '\n' ' '); legacy: $(systemctl is-active social-pilot social-pilot-worker | tr '\n' ' ')"
echo "Backup for rollback: $B (legacy release still at /srv/ms-social-pilot)"
REMOTE
