# Five OAuth connectors — lane 46 (2026-10-22)

Mastodon, LinkedIn, Threads, X and Pinterest are installed at source through
provider-owned `module.ts` declarations in `PLATFORM_MODULES` and shared host
dispatch. Each `platforms.<id>.enabled` defaults to false. This closes G3's staged
installation work; it does not establish live-provider or release readiness.
Facebook Groups remain dropped; this batch adds no Groups support.

## Shared workflow and ownership

Settings Connections, REST `POST /api/connections/[platform]/start` (including the
OAuth compatibility entry point) and MCP `start_connection` call `startConnection`
with exact `START CONNECTION <platform>` confirmation. The service retains current tenant,
role, entitlement and module checks and audit. Browser consent remains interactive.
The callback URL derives from Root `app.publicOrigin`, including behind a proxy.
LinkedIn/Pinterest own their callback exchange and discovery; Mastodon/Threads/X
configure the platform-neutral token connection host from inside their modules.
Callback state is authenticated and discovery credentials are encrypted.

Discovered resources remain disabled until the existing checkbox selection flow
calls `changeConnectionSelections`; reconnect does not silently enable stale
resources. UI, REST and MCP use the same selection and disconnect services.
Disconnect requires explicit retain-or-delete-related-data consent and reports
local consequences without promising remote revocation. Publishing uses existing
shared services and module capability descriptors, so unsupported formats/actions
remain unavailable. No shell/composer redesign, standalone provider screen or new
customer MCP tool belongs to this batch. Existing EN/FR Connections and
module-owned copy supply the customer flow; visual browser verification is pending.

Module-owned renewal jobs handle supported refresh/expiry behavior. Shared
`storeRenewedToken` rotates account and destination credentials together. LinkedIn
refresh depends on grants actually provided by the provider; an expired connection
without renewable credentials requires consent again. Mastodon credentials belong
to the single Root-configured instance. Supporting the legacy arbitrary-instance
registration flow remains a separate parity gap.

## Legacy credentials to enter in Root

Only source key names were inspected (`src/lib/env.ts`,
`src/lib/settings/definitions.ts`, `src/lib/networks/mastodon.ts`); no production
setting values or secrets were read. Legacy credentials stay in production
`app_settings`; this batch neither imports nor changes them. The owner enters
these values through Root's encrypted configuration controls.

| Provider | Legacy app_settings key | Root key |
| --- | --- | --- |
| LinkedIn | `linkedin.clientId` | `linkedin.clientId` |
| LinkedIn | `linkedin.clientSecret` | `linkedin.clientSecret` |
| Threads | `threads.clientId` | `threads.appId` |
| Threads | `threads.clientSecret` | `threads.appSecret` |
| X | `x.clientId` | `x.clientId` |
| X | `x.clientSecret` | `x.clientSecret` |
| Pinterest | `pinterest.clientId` | `pinterest.clientId` |
| Pinterest | `pinterest.clientSecret` | `pinterest.clientSecret` |
| Mastodon | No installation-level credential key: legacy registers an app per instance and stores its credentials with the account | Set `mastodon.instanceUrl` and an app registered for that instance in `mastodon.clientId` / `mastodon.clientSecret`; do not copy an unrelated account's app credentials |

Legacy `networks.<id>` availability toggles map to
`platforms.<id>.enabled`, subject to explicit review; do not automatically enable
them. Root access policy also uses `platforms.<id>.includedByDefault` and
`platforms.<id>.planFeatures`. Review OAuth scopes inside `<id>.policy` and register
the callback based on the configured public origin. Provider credentials/scopes,
URLs, request/media bounds and bilingual feedback stay in each module's typed
`config.ts`; existing Root keys are consumed rather than copied into shared code.

Schema version is intentionally unchanged in this lane. The integrator must bump
`CONFIG_SCHEMA_VERSION` and its config-validation expectation once for the merged
configuration changes, per the owner's hard rule. New registered keys: `mastodon.instanceUrl`, `mastodon.clientId`,
`mastodon.clientSecret`, `mastodon.maxResponseBytes`, `mastodon.connectionPolicy`,
`threads.connectionPolicy`, and `x.connectionPolicy`. Existing
`linkedin.policy` / `pinterest.policy` gain backward-compatible `renewLeadSeconds`.
The new connection policies own state/code bounds and bilingual publication labels;
Threads/X also own their renewal lead time.

## Verification and remaining gates

Final `npx tsc --noEmit -p .` exits 0 with zero errors.
Focused `npx vitest run ... --cache=false`: 11 files, 183 tests passed,
including parity guard (22) and config validation (9). Files: token-connection,
platform-modules, config-validation, parity-guard, oauth-two-install,
networks-linkedin-pinterest, networks-connection, oauth-three-install,
mastodon-platform, threads-platform and x-platform (all `.test.ts`).
Required full `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --cache=false`:
711 files passed, one failed, 49 skipped; 11,511 tests passed, five failed,
2,553 skipped. All five failures are unchanged `facebook-native-http.test.ts`
loopback probes blocked by sandbox `listen EPERM ::1`. The full suite is **not
green**; rerun those probes where sockets are permitted. Cache is disabled because
the dependency installation is a read-only symlink. Whitespace checks pass.
Prior sweep and q-31 fixture counts are historical.
No server, browser, production database, provider call, deploy, commit or push was
performed by this documentation lane. Changes remain uncommitted as requested.

Before enabling any connector, verify real OAuth consent/state/replay/refusal,
discovery and explicit selection, role and cross-workspace denial, refresh/expiry
and reconnect, supported publication/status/delete with remote outcome checks and
cleanup, real REST/MCP clients, and EN/FR browser keyboard/theme/phone/desktop
behavior. Root credentials, provider approvals and all release/cutover gates still
apply. Synthetic fixture results do not satisfy these live gates.

Outside-owned edit required: `src/modules/root/server/admin/connection-refresh.ts`
currently updates only the social account token. Root manual refresh must
atomically update destination credential copies and `meta.accessTokenExpiresAt`,
and preserve each provider's grant expiry contract rather than substituting access
token expiry for neutral OAuth `tokenExpiresAt`. Automatic renewal already uses
`storeRenewedToken`; manual Root refresh needs the same consistency plus regression
tests. Do not treat that manual operation as verified lifecycle parity.

## Visible behavior and design rules

No screen component or shell was edited. Once Root enables a configured module,
Settings Connections reuses the current connect action and checkbox discovery
modal, including existing retain/delete confirmations. Publishing receives the
provider-owned supported format descriptors and EN/FR labels. The four required
skills were read: taste-skill (match the established app system),
web-design-guidelines (retain accessible existing controls and feedback),
composition-patterns (extend through the host contract instead of provider UI
branches), react-best-practices (keep provider credentials/server engines out of
client bundles). This is source integration; no new visual design or browser
inspection is claimed. The task prohibits starting a preview server.

## Changed files

- `rebuild/docs/AGENT_HANDOFF.md`
- `rebuild/docs/ARCHITECTURE.md`
- `rebuild/docs/CONNECTORS_LANE_46.md`
- `rebuild/docs/DELIVERY_PLAN.md`
- `rebuild/docs/LEGACY_SWEEP_2026-10-21.md`
- `rebuild/docs/MCP_PARITY.md`
- `rebuild/src/platforms/index.ts`
- `rebuild/src/platforms/linkedin/README.md`
- `rebuild/src/platforms/linkedin/adapter.ts`
- `rebuild/src/platforms/linkedin/config.ts`
- `rebuild/src/platforms/linkedin/connection.ts`
- `rebuild/src/platforms/linkedin/host.ts`
- `rebuild/src/platforms/linkedin/jobs.ts`
- `rebuild/src/platforms/linkedin/manifest.ts`
- `rebuild/src/platforms/linkedin/module.ts`
- `rebuild/src/platforms/mastodon/README.md`
- `rebuild/src/platforms/mastodon/adapter.ts`
- `rebuild/src/platforms/mastodon/config.ts`
- `rebuild/src/platforms/mastodon/connection.ts`
- `rebuild/src/platforms/mastodon/host.ts`
- `rebuild/src/platforms/mastodon/manifest.ts`
- `rebuild/src/platforms/mastodon/runtime.ts`
- `rebuild/src/platforms/mastodon/transport.ts`
- `rebuild/src/platforms/pinterest/README.md`
- `rebuild/src/platforms/pinterest/adapter.ts`
- `rebuild/src/platforms/pinterest/config.ts`
- `rebuild/src/platforms/pinterest/connection.ts`
- `rebuild/src/platforms/pinterest/host.ts`
- `rebuild/src/platforms/pinterest/jobs.ts`
- `rebuild/src/platforms/pinterest/manifest.ts`
- `rebuild/src/platforms/pinterest/module.ts`
- `rebuild/src/platforms/threads/README.md`
- `rebuild/src/platforms/threads/adapter.ts`
- `rebuild/src/platforms/threads/config.ts`
- `rebuild/src/platforms/threads/connection.ts`
- `rebuild/src/platforms/threads/host.ts`
- `rebuild/src/platforms/threads/jobs.ts`
- `rebuild/src/platforms/threads/module.ts`
- `rebuild/src/platforms/threads/runtime.ts`
- `rebuild/src/platforms/x/README.md`
- `rebuild/src/platforms/x/adapter.ts`
- `rebuild/src/platforms/x/config.ts`
- `rebuild/src/platforms/x/connection.ts`
- `rebuild/src/platforms/x/host.ts`
- `rebuild/src/platforms/x/jobs.ts`
- `rebuild/src/platforms/x/manifest.ts`
- `rebuild/src/platforms/x/runtime.ts`
- `rebuild/src/server/platforms/index.ts`
- `rebuild/src/server/platforms/token-connection.ts`
- `rebuild/tests/mastodon-platform.test.ts`
- `rebuild/tests/networks-connection.test.ts`
- `rebuild/tests/networks-linkedin-pinterest.test.ts`
- `rebuild/tests/oauth-three-install.test.ts`
- `rebuild/tests/oauth-two-install.test.ts`
- `rebuild/tests/platform-modules.test.ts`
- `rebuild/tests/threads-platform.test.ts`
- `rebuild/tests/token-connection.test.ts`
- `rebuild/tests/x-platform.test.ts`
