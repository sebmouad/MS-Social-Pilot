#!/usr/bin/env bash
# Read-only staging smoke check. No sign-in, writes, SSH, or production defaults.
set -euo pipefail

URL="${REBUILD_STAGING_URL:-http://127.0.0.1:3200}"
case "$URL" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*|https://*) ;;
  *) echo "Use a loopback HTTP URL or an explicit HTTPS staging URL." >&2; exit 2 ;;
esac
case "$URL" in
  https://*)
    case "$URL" in *production*|*social.newsgeet.com*) echo "Production URL is not an allowed staging target." >&2; exit 2 ;; esac
    ;;
esac

health="$(curl --fail --silent --show-error --max-time 10 "${URL%/}/api/health")" || {
  echo "Rebuild health endpoint failed: $URL/api/health" >&2
  exit 1
}
printf '%s\n' "$health"
node -e 'const h=JSON.parse(process.argv[1]); if (h.status !== "ok") process.exit(1)' "$health" || {
  echo "Health JSON did not report status=ok." >&2
  exit 1
}

printf 'REBUILD_STAGING_HEALTH_OK %s\n' "$URL"
