#!/usr/bin/env bash
# Rebuild a local preview/test database from scratch: drop, create, apply the
# baseline plus every post-baseline migration in timestamp order, and record
# them in _prisma_migrations the same way scripts/prod-deploy.sh does.
#
# This exists because docs/PREVIEW.md used to apply only the baseline, which
# silently drifted local databases behind the code (missing tables/columns).
#
# Safety: refuses anything that is not a loopback URL with a _preview/_test
# database name, and requires QA_DB_REBUILD_CONFIRM=REBUILD_LOCAL_QA.
# Usage: QA_DB_REBUILD_CONFIRM=REBUILD_LOCAL_QA scripts/dev/qa-db.sh "$DATABASE_URL"
set -euo pipefail

confirm_ok() { [ "${QA_DB_REBUILD_CONFIRM:-}" = "REBUILD_LOCAL_QA" ]; }
url_ok() {
  case "$1" in
    postgresql://*@127.0.0.1[:/]*|postgresql://*@localhost[:/]*) ;;
    *) return 1;;
  esac
  case "$1" in
    */*_preview|*/*_preview\?*|*/*_test|*/*_test\?*) ;;
    *) return 1;;
  esac
}

if [ "$#" -ne 1 ]; then echo "Usage: QA_DB_REBUILD_CONFIRM=REBUILD_LOCAL_QA scripts/dev/qa-db.sh <loopback DATABASE_URL>" >&2; exit 1; fi
URL="$1"
if ! url_ok "$URL"; then echo "Refusing: URL must be loopback (127.0.0.1/localhost) with a _preview/_test database." >&2; exit 1; fi
if ! confirm_ok; then echo "Refusing: set QA_DB_REBUILD_CONFIRM=REBUILD_LOCAL_QA to confirm the local rebuild." >&2; exit 1; fi

DB_NAME="$(printf '%s' "$URL" | sed -e 's#.*/\([^/?]*\).*#\1#')"
USE_DOCKER=0
if ! command -v psql >/dev/null 2>&1; then
  # No local client: run inside scripts/dev/test-db.sh's container, which only
  # serves 127.0.0.1:55432. Any other loopback port would hit the wrong server.
  case "$URL" in *:55432/*) ;; *) echo "Refusing: without a local psql only 127.0.0.1:55432 (msp-test-pg) is reachable." >&2; exit 1;; esac
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'msp-test-pg'; then USE_DOCKER=1;
  else echo "psql not found and container msp-test-pg is not running (see scripts/dev/test-db.sh)." >&2; exit 1; fi
fi
# db_sql <db> -c <sql>... | db_file <db> <file>: same call shape on either path.
# docker exec stdin is closed so -c calls inside the migration loop cannot eat it.
db_sql() { local db="$1"; shift; if [ "$USE_DOCKER" = 1 ]; then docker exec -i msp-test-pg psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q "$@" </dev/null; else psql "${URL%%/*}/$db" -v ON_ERROR_STOP=1 -q "$@" </dev/null; fi; }
db_file() { local db="$1" file="$2"; if [ "$USE_DOCKER" = 1 ]; then docker exec -i msp-test-pg psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q < "$file"; else psql "${URL%%/*}/$db" -v ON_ERROR_STOP=1 -q -f "$file"; fi; }

echo "Rebuilding local database $DB_NAME (drop + migrate + record)."
db_sql postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" -c "CREATE DATABASE \"$DB_NAME\";"
db_sql "$DB_NAME" -c 'CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "applied_steps_count" INTEGER NOT NULL DEFAULT 0)'

# Fresh databases run the baseline first, then the rest in timestamp order.
# (Production runs a different order because it already holds squashed history.)
ORDER="$(ls prisma/migrations | grep -E '^[0-9]{14}_' | sort)"
if ! printf '%s\n' "$ORDER" | grep -qx '20261103000000_baseline'; then echo "Baseline migration missing; aborting." >&2; exit 1; fi
{
  echo "20261103000000_baseline"
  printf '%s\n' "$ORDER" | grep -vx '20261103000000_baseline'
} | while read -r m; do
  f="prisma/migrations/$m/migration.sql"
  # No single-transaction flag: migrations may contain ALTER TYPE ... ADD VALUE.
  db_file "$DB_NAME" "$f" >/dev/null || { echo "Migration $m failed." >&2; exit 1; }
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  db_sql "$DB_NAME" -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) values (gen_random_uuid()::text, '$sum', now(), '$m', null, null, now(), 1)" >/dev/null
  echo "applied $m"
done
echo "Rebuilt $DB_NAME; seed it with scripts/seed-preview.ts."
