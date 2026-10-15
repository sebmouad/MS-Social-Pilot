# Root runtime configuration

The private `/root/config` screen is guarded by the installation owner flag (`User.isInstanceOwner`) and the validated legacy session cookie. Its API returns 404 to signed-in non-owners. Secret values are write-only: the API reports only whether a value is set, never its plaintext or ciphertext.

`src/lib/config/registry.ts` is the single definition point. Each entry declares its typed schema, default, group, UI control, and consumption status. `CONFIG_SCHEMA_VERSION` identifies the registry representation in API responses and config-change audit details; bump it when keys or stored representations change. Zod validation runs at the save boundary. Ordinary values are stored in the existing `app_settings` table. Secret values use the installation `ENCRYPTION_KEY` with AES-256-GCM in the `v1:<iv>:<tag>:<ciphertext>` envelope. Root changes append a `config.changed` record to `root_activities`; audit detail contains only the key, change type, and schema version.

The registry covers security, API endpoints and OAuth scopes, sync schedules and retry/concurrency limits, API request budgets, installation entitlement defaults, retention, logging, MCP, theme defaults, and operations contact details. Meta settings include app ID, encrypted app secret, callback URL, API base URL/version, and separate Page/Instagram, ads read, and ads management scope arrays. MCP settings include permitted role defaults, request size, request budget, and result-size limits. Module and feature keys are generated from `src/lib/product.ts`; theme choices come from the rebuild theme catalog. Text lists use JSON arrays, and schedules use five-field cron strings. The registry validates values but does not launch a scheduler or configure provider-side quotas.

Consumption labels are operationally significant:

- **Active in rebuild** means a rebuild runtime path reads the saved setting now. Currently this covers sign-in attempt limits and the two-step policy.
- **Stored; runtime wiring pending** marks configuration used by a contract or provider integration that is not yet wired to the rebuild runtime. Meta endpoint/version and app secret are in this state.
- **Stored; consumer not implemented** means the setting validates, persists, and audits, but no runtime code consumes it yet. This currently includes scheduled sync, API scopes and provider defaults, installation entitlement overrides, retention, logging, MCP controls, the theme fallback, and support contact.

The availability catalog remains a read-only reference. Persisted module and feature defaults are not yet applied by `src/server/entitlements/index.ts`; current access continues to come from workspace, member, and plan data. The MCP endpoint does not yet read its Root controls. The theme cookie still falls back to Grove. Treat these settings as staged configuration until their consumers are implemented.

This registry does not configure `DATABASE_URL`, `ENCRYPTION_KEY`, session authentication, or process-level logging sinks. Runtime settings must not be presented as active until the corresponding consumer reads and validates the persisted setting.
