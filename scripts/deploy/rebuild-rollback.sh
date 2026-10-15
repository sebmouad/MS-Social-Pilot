#!/usr/bin/env bash
# Deliberately blocked: a rebuild rollback must route traffic to legacy and
# restart its services using reviewed host-specific proxy/unit procedures.
set -euo pipefail

cat >&2 <<'MSG'
REBUILD_ROLLBACK_BLOCKED: no production action was taken.
Do not use scripts/deploy/remote-rollback.sh: it swaps the legacy release
directory and does not restore a rebuild proxy switch or rebuild services.
The reviewed procedure must route traffic to the retained legacy app, reload
OpenLiteSpeed, restart legacy web/worker, and verify public health. Database
restore is a separate decision after reviewing writes since cutover.
See rebuild/docs/CUTOVER.md.
MSG
exit 78
