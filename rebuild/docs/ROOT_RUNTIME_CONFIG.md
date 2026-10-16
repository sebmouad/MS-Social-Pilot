# Root runtime configuration

Registry entries retain literal key types and infer value types from their
validation schemas. Server readers accept these typed keys; dynamic keys still
pass through the same runtime validation.

Legacy Facebook configuration and authentication environment settings can be mapped into this registry on a
staging copy with `node --env-file-if-exists=../.env --import tsx
scripts/import-legacy-config.ts` from `app/rebuild`. The default is a dry run
that prints only source and destination key names. `--apply` validates every
candidate, skips Root keys already present, encrypts the app secret again, and
records value-free changes under the installation owner. It must be rehearsed
on a production-shaped copy before any production use. The importer never
enables ads management automatically.
If `SECURITY_TWO_STEP`, `LOGIN_ATTEMPTS`, or `LOGIN_WINDOW_MINUTES` is set,
the importer validates and records it before the rebuild stops reading those
legacy environment values. Missing values use the registry defaults.
An explicitly set but unrecognized legacy two-step value imports as `everyone`,
matching the legacy sign-in policy's fail-closed behavior.

The private `/root/config` screen is guarded by the installation owner flag (`User.isInstanceOwner`) and the validated session cookie. Its API returns 404 to signed-in non-owners. Secret values are write-only: the API reports only whether a value is set, never its plaintext or ciphertext. The screen groups settings in a sidebar and supports key/description search.

`src/lib/config/registry.ts` is the single definition point. Each entry declares its typed schema, default, group, UI control, and consumption status. `CONFIG_SCHEMA_VERSION` identifies the registry representation in API responses and config-change audit details; bump it when keys or stored representations change. Zod validation runs at the save boundary. Ordinary values are stored in the existing `app_settings` table. Secret values use the installation `ENCRYPTION_KEY` with AES-256-GCM in the `v1:<iv>:<tag>:<ciphertext>` envelope. Root changes append a `config.changed` record to `root_activities`; audit detail contains only the key, change type, and schema version.

The registry covers security, API endpoints and OAuth scopes, sync schedules and retry/concurrency/lease/heartbeat/polling/record limits, API request budgets, installation entitlement defaults, retention, logging, MCP, theme defaults, and operations contact details. Retry base and maximum delays control the exponential wait between transient provider failures. The worker poll interval controls how often its process checks schedules and Root settings. Meta settings include app ID, encrypted app secret, callback URL, API base URL/version, and separate Page/Instagram, ads read, and ads management scope arrays. MCP settings include permitted role defaults, request size, request budget, result-size limits, and active key count, maximum key lifetime, and per-key request budgets. Module and feature keys are generated from `src/lib/product.ts`; theme choices come from the rebuild theme catalog. Text lists use JSON arrays, and schedules use five-field cron strings. The registry validates values but does not launch a scheduler or configure provider-side quotas.

Consumption labels are operationally significant:

- **Active** means a rebuild runtime path reads the saved setting now. This includes sign-in/session controls, the two-step policy, OAuth state lifetime, and module/feature availability.
- **Stored; runtime wiring pending** means a consumer exists but coverage is incomplete. Settings must be checked individually before relying on them.
- **Stored; consumer not implemented** means the setting validates, persists, and audits, but no runtime code consumes it yet. Scheduled sync, retention, logging, and support contact still fall here.

Module and feature availability is generated from manifests and enforced by `src/server/entitlements/index.ts` alongside workspace, member, and plan rules. A saved false disables the module or feature from the next request. The Root default theme applies when a visitor has no theme cookie; an unavailable registry read falls back to the first bundled theme. Root settings marked pending must not be presented as live controls.

This registry does not configure `DATABASE_URL`, `ENCRYPTION_KEY`, session authentication, or process-level logging sinks. Runtime settings must not be presented as active until the corresponding consumer reads and validates the persisted setting.

Registry version 28 restores the shared `ads.managementEnabled` policy used by Ads services and connection scope selection. It is a validated Root boolean, defaults off, and is audited through the normal configuration write service. Enabling it does not grant roles, account access or provider permissions. A source-read regression check now rejects unregistered literal runtime setting reads.

Registry version 29 adds `connections.statusLabels`, the active customer-facing labels for connected, expired and revoked sources. Root may change these bounded labels without altering connection health, permissions or module availability. The server and selection dialog use the same health classification; expiry prevents new selection while stored history remains readable.

Registry version 30 removes the unused `x.oauthScopes` placeholder because X is not an installed module. Its stored historical values are not deleted. Facebook OAuth labels now describe Facebook scopes only; later providers supply their own module settings.

Registry version 31 introduced active `root.activityPageSize` (default 50, validated integer 1–1000). Version 32 extends it to cursor-paginated audit history across UI, HTTP and MCP: omitted limits use the configured value, larger positive integer limits clamp to it, and malformed values are rejected. The MCP result cap can reduce it further.

Root navigation comes from the private `src/modules/root/manifest.ts`, outside the customer module registry. `/root` reads installation counts; `/root/operations` contains the existing worker health view; `/root/activity` reads searchable cursor-paginated audit history with allowlisted numeric/boolean details. Every route checks instance-owner access before loading its data. Configuration search and categories share the contextual sidebar through `SidebarDock`. Missing worker tables produce an explicit unavailable state rather than invented operational health. These surfaces do not complete the legacy Root inventory.

Root directory search uses the contextual sidebar. Workspace access controls now suspend/restore through an audited private service and the same authenticated Root MCP service. Existing `data.workspaceOperationTimeoutMs` and `data.workspaceOperationLockWaitMs` govern the access transaction and shared operation lock; that workspace-access batch did not change the then-current version 31 registry representation. Version 32 introduced the later audit limits below. Customer operations and background provider sync reject suspended workspaces; private Root inspection/restoration retain access. This does not complete workspace deletion, billing/plans, backups or the remaining legacy operator controls.

Registry version 32 adds active `root.activitySearchMaxCharacters` (default 200, integer 1–2000) for action/person and workspace-ID filters, and `root.activityCursorMaxCharacters` (default 4096, integer 512–65536) for accepted/generated encoded pagination tokens. They apply from the next service call through UI, HTTP and MCP. The cursor format itself remains version 1, canonical base64url JSON with millisecond UTC timestamps, stable IDs, direction and a SHA-256 filter digest; tokens do not grant privileges. Invalid/mismatched tokens expose a reset path rather than silently showing another history segment. No schema migration is involved.

Private installation MCP is now independent of `mcp.authenticatedRoles`, which governs workspace identities and keys only. `mcp.enabled`, `mcp.maxRequestBytes`, `mcp.maxResultItems` and `mcp.requestsPerMinute` still govern session transport; installation requests share a fixed per-owner rate identity. Explicit workspace scope never upgrades to Root, and workspace API keys cannot choose installation scope. The role/request-byte defaults are read from the validated registry without duplicate source fallbacks. No key or stored representation changed for this context batch; registry version 32 remains current. Root configuration MCP writes validate the same registry and exact confirmation, then rely on the shared service's atomic value-free audit rather than a second after-commit write.

Workspace bearer keys and explicit workspace sessions resolve entitlements with installation inspection disabled. An owner-created key therefore cannot bypass workspace suspension; private inspection remains a verified installation-owner session privilege.


Registry version 33 adds active `root.userSearchMaxCharacters` (default 200; 1–2000), `root.accountOperationTimeoutMs` (default 15000; 1000–300000) and `root.accountOperationLockWaitMs` (default 5000; 1000–300000). They bound private user reads and account action transactions; the latter is Prisma's transaction acquisition wait, not a provider timeout. These controls do not grant Root authority or bypass confirmation/last-owner protections.


Registry version 34 adds safe definition ownership metadata (`shared`, `product` or `platform` with stable module ID). This does not change stored key/value formats or move encrypted records. Adapter-owned configuration takes precedence over product prefixes. Product ownership comes from module declarations and generated module/feature availability. Root Shared configuration, product module screens and platform module screens partition this registry by owner; changes still use the same validation and audited persistence service. Root is the managing interface, not the parent source folder.

Registry version 35 adds active Shared controls:

- `diagnostics.enabled` (true): private diagnostic runs; does not enable customer features or start a worker.
- `diagnostics.minimumIntervalSeconds` (30, 1–86400): scope-wide start cooldown.
- `diagnostics.incompleteRunStaleSeconds` (600, 10–86400): minimum incomplete-run recovery age. Effective recovery is at least the original total deadline plus two database timeouts; a start persists that floor, and later shorter settings cannot shorten it.
- `diagnostics.runTimeoutMs` (60000, 1000–300000): total preparation/check deadline. Provider transport receives combined suite/request cancellation; remaining checks are skipped on expiry. Completion auditing may use another database timeout.
- `diagnostics.databaseTimeoutMs` (5000, 1000–30000): statement/transaction wait bounds for database probes and start/completion audits. Ordinary configuration/history reads retain their existing database-client behavior.
- `diagnostics.historyLimit` (10, 1–100): recent starts/results and connection choices per scope; MCP caps can reduce it.
- `root.operationsRecentLimit` (25, 1–200): replacement job attempts per health view.
- `root.workerStaleSeconds` (180, 10–86400): replacement-heartbeat freshness threshold.
- `jobs.order` (original posts/analytics/inbox/purges/media-cleanup priority): unique installed job names in dispatch order; unlisted installed jobs follow in manifest order. This preserves previous priority after consolidating declarations.
- `root.operationalTimezone` (UTC): validated IANA timezone for diagnostics and worker telemetry presentation; API timestamps stay UTC. Other Root date surfaces are not yet converted.

Configuration validation checks only the current owner’s registry entries and decryptability of saved secrets. It names an invalid registered key without its value. Missing optional configuration is not treated as remote readiness. Adapter diagnostics remain owned by that adapter; Facebook uses its existing endpoint, version, timeout, scope and pagination settings. No diagnostic URL overrides are accepted. Fixed audit action names, persisted worker identity prefix, advisory-lock namespace and confirmation shape are internal protocols, not independently editable transport targets.
