#!/usr/bin/env bash
# Build the rebuild package locally without touching production or a database.
# Self-contained: installs and builds from rebuild/ only (no root package).
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"   # rebuild/
cd "$APP"

if [ ! -f package-lock.json ]; then
  echo "Missing rebuild/package-lock.json; cannot create a reproducible build." >&2
  exit 1
fi

export NEXT_TELEMETRY_DISABLED=1
export DATABASE_URL="${REBUILD_BUILD_DATABASE_URL:-postgresql://build:build@127.0.0.1:1/rebuild_build_only}"

npm ci --no-audit --no-fund
npx prisma generate --schema prisma/schema.prisma
npm run typecheck
npm run build

test -s .next/BUILD_ID || {
  echo "Build did not produce rebuild/.next/BUILD_ID" >&2
  exit 1
}
printf 'REBUILD_BUILD_OK %s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo working-tree)"
