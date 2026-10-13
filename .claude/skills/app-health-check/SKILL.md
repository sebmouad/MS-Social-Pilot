---
name: app-health-check
description: Review the Meta app's settings, security and compliance, and MS Social Pilot's production health — use before a review submission, after an incident, or periodically.
---

# App and production health check

Meta side (DevTools MCP, app 699780715171676):
- `devtools_app basic_settings` (status, domains, privacy/terms/data-deletion
  URLs, icon), `security` (app secret proof required, server IP allowlist),
  `restrictions`, `advanced_settings`.
- `devtools_compliance` — open violations or required actions.
- `devtools_api_usage` — rate limits.

Production side (see `docs/OPERATIONS.md`):
- `https://social.newsgeet.com/api/health` → web and worker ok.
- `systemctl is-active social-pilot social-pilot-worker`, recent errors in
  `journalctl -u social-pilot-worker --since -1h`.
- In-app: Setup screen (`/setup`) checks and Connections → Run checks.
- Backups present in `/var/backups/ms-social-pilot` (nightly 04:15).
- WordPress sites on the same box answer 200.
Report findings with severity and the fix; don't change Meta settings without the
owner's OK.
