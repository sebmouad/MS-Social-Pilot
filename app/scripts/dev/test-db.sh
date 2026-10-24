#!/usr/bin/env bash
# Start the throwaway Postgres the unit and browser tests use (port 55432).
# Docker Desktop must be running (`open -a Docker` on macOS).
set -euo pipefail
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop first." >&2; exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -q '^msp-test-pg$'; then
  docker run -d --rm --name msp-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=social_pilot_test \
    -p 127.0.0.1:55432:5432 postgres:16-alpine >/dev/null
  for i in $(seq 1 30); do docker exec msp-test-pg pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  sleep 2
fi
echo "test database ready on 127.0.0.1:55432"
