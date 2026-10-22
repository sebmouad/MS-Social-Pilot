#!/usr/bin/env bash
# Post-cutover fix (2026-10-20): the cutover applied migrations as the postgres superuser,
# so new tables/functions were owned by postgres and the app role got "permission denied"
# (e.g. workspace_data_purges), breaking sign-in. Transfers every postgres-owned object in
# schema public to the app role (owner of the existing tables), then restarts the rebuild.
# Usage (any directory in the checkout): bash rebuild/scripts/prod-fix-ownership.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # rebuild/
HOST="${PROD_HOST:-$(grep -o 'root@[0-9][0-9.]*' docs/OPERATIONS.md | head -1)}"
KEY="${PROD_KEY:-$HOME/.ssh/SebMouadSSH}"
ssh -i "$KEY" "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /tmp
APP_ROLE="$(sudo -u postgres psql -d social_pilot -Atc "select tableowner from pg_tables where schemaname='public' and tablename='users'")"
[ -n "$APP_ROLE" ] && [ "$APP_ROLE" != postgres ] || { echo "Could not determine app role"; exit 1; }
echo "App role: $APP_ROLE"
echo "Before: $(sudo -u postgres psql -d social_pilot -Atc "select string_agg(tableowner||'='||c, ' ') from (select tableowner, count(*) c from pg_tables where schemaname='public' group by 1) x")"
sudo -u postgres psql -d social_pilot -v ON_ERROR_STOP=1 -1 -q -v role="$APP_ROLE" <<'SQL'
SELECT set_config('fix.role', :'role', false);
DO $$ DECLARE r record; target text := current_setting('fix.role'); BEGIN
  FOR r IN SELECT c.oid::regclass AS n, c.relkind FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = 'postgres'::regrole
             AND c.relkind IN ('r','p','v','m') LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, r.n, target);
  END LOOP;
  -- Sequences owned by a table column follow the table; transfer any standalone ones.
  FOR r IN SELECT c.oid::regclass AS n FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = 'postgres'::regrole AND c.relkind = 'S'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'a') LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO %I', r.n, target);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proowner = 'postgres'::regrole LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.f, target);
  END LOOP;
END $$;
SQL
echo "After: $(sudo -u postgres psql -d social_pilot -Atc "select string_agg(tableowner||'='||c, ' ') from (select tableowner, count(*) c from pg_tables where schemaname='public' group by 1) x")"
echo "Functions still owned by postgres: $(sudo -u postgres psql -d social_pilot -Atc "select count(*) from pg_proc where pronamespace='public'::regnamespace and proowner='postgres'::regrole")"
systemctl restart social-pilot-rebuild social-pilot-rebuild-worker
sleep 10
echo "Services: $(systemctl is-active social-pilot-rebuild social-pilot-rebuild-worker | tr '\n' ' ')"
curl -s -o /dev/null -w "Local /sign-in: %{http_code}\n" http://127.0.0.1:3100/sign-in
REMOTE
