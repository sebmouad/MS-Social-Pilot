# Lane 43: close lane-42 leftovers
Read briefs/_common.md. On current HEAD:
1. Caption tests: add starting a test from raw caption variants (create the variant posts via Publishing services) to modules/caption-tests, with UI, REST and MCP parity, EN/FR, Root config, exact confirmation.
2. Chat channels (modules/notifications/chat-channels): add event producers so saved Slack/Telegram subscriptions actually deliver (publish failures, inbox alerts, operator incidents), via worker job with leases/idempotency; move its module tests under rebuild/tests so the main suite runs them.
3. Merge notifications.systemAlert* (Root Alerts) into lane-37 Root operator monitoring so there is ONE operator alert system (monitoring delivers to email + chat channels); remove the duplicate keys, bump CONFIG_SCHEMA_VERSION and tests/config-validation.test.ts line 47.
4. Update LEGACY_SWEEP / parity docs.
Run npm run typecheck and full suite (npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --testTimeout 30000) green. Leave uncommitted.
OWNERSHIP (authoritative, do not ask): every path under rebuild/src, rebuild/tests, rebuild/docs, rebuild/scripts, prisma/. Never ask questions. Never stage node_modules.
