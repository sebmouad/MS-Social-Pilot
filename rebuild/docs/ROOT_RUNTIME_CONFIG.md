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
