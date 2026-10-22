# Lane 44: close every remaining legacy sweep row
rebuild/docs/LEGACY_SWEEP_2026-10-21.md still has 16 "missing" and 29 "partial" rows. Many are stale (features merged by lanes 26-43: chart notes, AI agents, AI video polling, caption-test job, API tokens, exports, settings/history, chat channels, structured data, translations...). For EACH missing/partial row:
1. Verify against current source (grep, tests). If implemented, update the row to done with evidence paths.
2. If truly missing, IMPLEMENT it in the rebuild (module-owned, Root config, EN/FR, UI/REST/MCP parity, tests). Legacy config keys (scheduler.*, analytics.*Hours, email.*, retention.*, media.*, operator.*, limits.*, i18n.*) need an equivalent Root key or an explicit documented mapping to the existing rebuild key.
3. Only a row with an explicit owner decision may stay "dropped" (Facebook Groups). Host bootstrap/install scripts: replace with rebuild equivalents under rebuild/scripts.
End state: zero missing/partial rows. Bump CONFIG_SCHEMA_VERSION if keys added (+ tests/config-validation.test.ts line 47). typecheck + full suite green. Leave uncommitted.
OWNERSHIP (authoritative, do not ask): every path under rebuild/. Never stage node_modules or *.patch. Never ask questions; use sed/scripts freely.
