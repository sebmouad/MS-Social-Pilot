# Settings round 2 continuation — 2026-10-21

Security services/transports, webhook shared controls and runtime bilingual Settings copy were already merged. This continuation changes tests and this handoff only.

Changed tests:
- `tests/invitation-controls.test.ts`: shared ConfirmDialog consent, exact POST/DELETE confirmation strings, canonical email, no request before consent, pending duplicate suppression, failed/uncertain email outcomes, reissue link invalidation, accepted/unavailable state, cancellation, failed request retention and mismatched revoke receipt.
- `tests/settings-round2-ui.test.ts`: disable authenticator password/code gating, exact REST confirmation, refreshed switch, password clearing and session-refresh callback.

Server confirmation checks are unchanged. Existing tests verify enrollment, hashed recovery codes, passkey removal, policy enforcement and replay rejection; REST/MCP share the security service. Webhook UI tests verify named confirmation, reveal-once secret, test-delivery feedback and failed-dialog retention. Copy tests verify runtime label overrides and bilingual schema.

No new Root keys. Inherited round-2 keys for integrator version coordination: `settings.uiCopy`, `settings.accountPasskeyLimit`, `settings.accountAuthenticatorIssuer`, `integrations.webhookCopy`. CONFIG_SCHEMA_VERSION unchanged.

Verification from rebuild, Vitest with --no-cache:
- 20 Settings/team/invitation/account files: 198 passed.
- Six invitation/round-2 UI/integrations files: 134 passed, including new disable case. Totals overlap.
- npx tsc --noEmit -p .: zero errors.
- git diff --check: clean.

Team MCP tests emit missing DATABASE_URL diagnostics while passing with fallback configuration. No actual database, browser, SMTP/provider or MCP transport evidence. No full suite, servers, deployment, production or push.

Remaining gaps: browser themes/viewports/keyboard/clipboard/failure verification; actual database concurrency and live transport checks. Existing operational literals remain in invitation email maxLength/default role, MCP key name maxLength and export polling; no claim of complete Settings hardcoding compliance.

Outside-owned edits for integrator: update docs/ARCHITECTURE.md, docs/DELIVERY_PLAN.md, docs/AGENT_HANDOFF.md and affected UX evidence; coordinate registry schema version for inherited keys if still needed. No outside-owned files edited.

Work remains uncommitted: linked Git metadata is outside permitted writable roots. No commit or push attempted. Preserve the pre-existing node_modules links.
