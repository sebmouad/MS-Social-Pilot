#!/usr/bin/env bash
# Deliberately blocked: no production activation until host-specific switching
# and migration/recovery commands are reviewed and rehearsed.
set -euo pipefail

cat >&2 <<'MSG'
REBUILD_CUTOVER_BLOCKED: production was not changed.
Required before enabling this command:
  - reviewed rebuild web/worker systemd unit definitions and environment paths
  - verified OpenLiteSpeed proxy target, config path, and reload procedure
  - approved migration plan compatible with legacy rollback
  - sanitized production-shaped staging workflow and authorization evidence
  - successful backup/restore and proxy/service rollback rehearsal
See rebuild/docs/CUTOVER.md. This guard must be replaced with reviewed
host-specific operations before any production cutover is attempted.
MSG
exit 78
