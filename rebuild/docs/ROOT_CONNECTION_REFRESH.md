# Root connection token renewal

2026-10-20, branch `codex/root-refresh`. Source and synthetic evidence only.

Root `/root/connections` has Refresh token beside Disconnect. The shared
`useConfirm` dialog requires exactly `REFRESH CONNECTION <socialAccountId>`,
with English/French pending, unconfirmed and outcome copy. Unknown expiry is
Not available. A failed or nonrenewable outcome never claims renewal succeeded.

UI POST `/api/root/connections/[id]/refresh` and installation MCP
`refresh_root_connection` call `server/root/legacy/connection-refresh.ts`.
The service rechecks current installation-owner/disabled state, locks the actor,
workspace, bound selected resources and connection, rejects suspended/purging
workspaces, and scopes credential reads/writes to the resolved workspace and ID.
Workspace keys and workspace roles cannot acquire Root authority. HTTP uses the
existing private same-origin/no-store wrapper. Root can maintain an installed
module independently of customer feature enablement; there is no customer
entitlement bypass into product operations.

`PlatformHost.connection.renewToken` is optional and server-only. Null, an absent
hook/module or an invalidated connection yields `not_renewable`. Hook/decryption
failures or invalid token/expiry responses yield `failed`, retaining credentials.
A valid result yields `renewed`, encrypting the returned token/optional refresh
token and recording its expiry. It never clears invalidation, changes grants,
activates resources, rediscovers channels or replaces channel-specific tokens.
Facebook owns the hook and calls its existing `exchangeForLongLivedToken` engine
operation using current app configuration and the stored user token. Transport
receives the cancellation signal; provider rules stay inside the module.

Outcome and credential persistence commit with a content/credential-free audit.
Audit actions `root.connection_refresh.renewed`,
`root.connection_refresh.not_renewable` and `root.connection_refresh.failed`
make the outcome visible even through the existing allowlisted activity view.
Detail contains only connection/workspace IDs, outcome and nullable renewed
expiry. Raw provider errors, request URLs, credentials and grants are never
returned or audited. Database/audit/transaction failure produces an unconfirmed
error rather than a success receipt; a remote exchange cannot be rolled back,
so inspect current state before retrying an unconfirmed result.

Root keys, owned by `server/root/legacy/config.ts`:

- `root.legacy.connectionRefreshTimeoutMs`: provider deadline, default 60000.
- `root.legacy.connectionRefreshGraceMs`: finalization reserve, default 5000.
- `root.legacy.connectionRefreshMaxWaitMs`: transaction wait, default 5000.

The transaction budget is deadline plus grace; the module receives an abort
signal for the deadline. The registry aggregator is untouched as instructed;
coordinate the configuration schema-version change with its owner. No migration.

Verification from `rebuild/`: Root and related MCP/Facebook targeted Vitest suite,
raw SQL void guard and `npx tsc --noEmit -p .`. New tests cover current and revoked
Root authority, exact confirmation, scope, locks, suspension/purge, missing and
nonrenewable connections, encrypted persistence, malformed/provider failures,
audit failures, HTTP/MCP dispatch and key denial, installation MCP transport,
en/fr DOM confirmation, retained failure context and explicit outcome display.
Facebook exchange uses mocked transport. No install, Prisma generation, server,
push, deploy, browser, real PostgreSQL or live-provider run. Database integration
cases remain opt-in and skipped in this environment. This closes the scoped
source-level refresh gap only; full Root/rebuild parity remains incomplete.

Final verification: 535 tests passed, 13 opt-in database cases skipped across 69 files; TypeScript and `git diff --check` passed. No full-repository suite or build was run.
