# Root runtime configuration

Registry entries retain literal key types and infer value types from their
validation schemas. Server readers accept these typed keys; dynamic keys still
pass through the same runtime validation.

The private `/root/config` screen is guarded by the installation owner flag (`User.isInstanceOwner`) and the validated session cookie. Its API returns 404 to signed-in non-owners. Secret values are write-only: the API reports only whether a value is set, never its plaintext or ciphertext. The screen groups settings in a sidebar and supports key/description search.

`src/lib/config/registry.ts` is the single definition point. Each entry declares its typed schema, default, group, UI control, and consumption status. `CONFIG_SCHEMA_VERSION` identifies the registry representation in API responses and config-change audit details; bump it when keys or stored representations change. Zod validation runs at the save boundary. Ordinary values are stored in the existing `app_settings` table. Secret values use the installation `ENCRYPTION_KEY` with AES-256-GCM in the `v1:<iv>:<tag>:<ciphertext>` envelope. Root changes append a `config.changed` record to `root_activities`; audit detail contains only the key, change type, and schema version.

The registry covers security, API endpoints and OAuth scopes, sync schedules and retry/concurrency/lease/heartbeat/record limits, API request budgets, installation entitlement defaults, retention, logging, MCP, theme defaults, and operations contact details. Meta settings include app ID, encrypted app secret, callback URL, API base URL/version, and separate Page/Instagram, ads read, and ads management scope arrays. MCP settings include permitted role defaults, request size, request budget, result-size limits, and active key count, maximum key lifetime, and per-key request budgets. Module and feature keys are generated from `src/lib/product.ts`; theme choices come from the rebuild theme catalog. Text lists use JSON arrays, and schedules use five-field cron strings. The registry validates values but does not launch a scheduler or configure provider-side quotas.

Consumption labels are operationally significant:

- **Active** means a rebuild runtime path reads the saved setting now. This includes sign-in/session controls, the two-step policy, OAuth state lifetime, and module/feature availability.
- **Stored; runtime wiring pending** means a consumer exists but coverage is incomplete. Settings must be checked individually before relying on them.
- **Stored; consumer not implemented** means the setting validates, persists, and audits, but no runtime code consumes it yet. Scheduled sync, retention, logging, and support contact still fall here.

Module and feature availability is generated from manifests and enforced by `src/server/entitlements/index.ts` alongside workspace, member, and plan rules. A saved false disables the module or feature from the next request. The Root default theme applies when a visitor has no theme cookie; an unavailable registry read falls back to the first bundled theme. Root settings marked pending must not be presented as live controls.

This registry does not configure `DATABASE_URL`, `ENCRYPTION_KEY`, session authentication, or process-level logging sinks. Runtime settings must not be presented as active until the corresponding consumer reads and validates the persisted setting.
