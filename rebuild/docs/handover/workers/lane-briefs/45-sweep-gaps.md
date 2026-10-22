# Lane 45: close sweep gaps G1, G3, G5, G6, G7 (+ record G2/G4 decisions)
See section 0.4 of rebuild/docs/LEGACY_SWEEP_2026-10-21.md. Implement fully (module-owned, Root config, EN/FR, UI/REST/MCP parity, tests):
- G1 Graph usage: Facebook module records Graph app-usage headers into graph_usage; Root module page + REST + MCP reader.
- G3 Bluesky and Telegram credential flows (app password / bot token), same pattern as other token connections; keep all 7 staged connectors registered and document what live gates remain.
- G5 Alt-text suggestion: add image (vision) input to the AI provider layer for providers that support it; composer suggest alt text, REST + MCP.
- G6 Mail HTTP API provider (email.provider=api) alongside SMTP, Root-configured.
- G7 Unused-media retention sweep (media.retainUnusedDays equivalent) as a leased worker job.
Owner decisions (record in sweep as "dropped by decision 2026-10-22"): G2 legacy api_tokens are retired, scoped person/workspace keys replace them; G4 Facebook text backgrounds dropped (undocumented Meta preset ids).
Bump CONFIG_SCHEMA_VERSION (+ tests/config-validation.test.ts line 47). typecheck + full suite green. Leave uncommitted.
OWNERSHIP (authoritative, do not ask): every path under rebuild/. Never stage node_modules or *.patch. Never ask questions; use sed/scripts freely.
