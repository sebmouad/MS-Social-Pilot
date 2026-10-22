# Root legacy operations (W4)

Status: host-integrated batch 65. Synthetic local HTTP/MCP/PostgreSQL probe passed with exact fixture and configuration cleanup. Desktop privileges page inspected in Chrome: filters and confirmed CSV control occupy the contextual sidebar. No production/provider changes or backup archive verification. Final batch checks are recorded in the handoff.

Private installation-owner operations carried over from legacy Root: plans and
privileges, account/workspace lifecycle, error log, backup status and diagnostics.
All of it is Root-only: authority is the signed-in account's current
`isInstanceOwner` and not-disabled state (re-read inside each mutation's
transaction). Workspace roles, memberships and API keys never qualify; HTTP routes
read only the browser session and MCP rejects any call carrying `apiKeyId`.

## Source map

| Area | Path |
| --- | --- |
| Services | `src/modules/root/server/admin/{plans,privileges,lifecycle,errors,backups,sessions,connections}.ts` |
| Copy (en/fr) | `src/modules/root/server/admin/copy.ts` (Accept-Language selects; used by sessions/connections screens) |
| Shared vocabulary (client-safe) | `src/modules/root/server/admin/shared.ts` (confirmations, schemas, per-module plan feature catalog) |
| Config tuple | `src/modules/root/server/admin/config.ts`; runtime policy in `policy.ts` |
| MCP definitions | `src/modules/root/server/admin/mcp.ts` (`rootAdminToolDefinitions`, `rootAdminResources`, `callRootAdminTool`) |
| HTTP | `src/app/api/root/{plans,privileges,lifecycle,errors,backups,sessions,connections}/**`, wrapper `modules/root/server/admin/http.ts` |
| UI | `src/app/root/{plans,privileges,lifecycle,errors,backups,sessions,connections}/**` |
| Tests | `tests/root-admin-services.test.ts`, `tests/root-admin-http-mcp.test.ts`, `tests/root-admin-sessions-connections.test.ts` (mocked database) |

## Behavior

- **Plans**: catalog with subscriber counts; edit limits/prices/features per plan; assign or clear a
  plan per account; history from `root_activities`. Features are grouped by owning module
  (shared, Publishing, Inbox, Analytics, Ads, Settings, and one `platform_<id>` group per installed
  platform). New feature keys must be in that catalog; keys already on a plan are preserved.
  Confirmations: `UPDATE PLAN <key>`, `SET DEFAULT PLAN <key>`, `ASSIGN PLAN <key> TO <email>`,
  `REMOVE PLAN FROM <email>`. The default plan cannot be unset directly. Prices are display only.
- **Privileges**: paged read of member, role and channel scope across workspaces (owners/admins
  always shown as all channels), filters, spreadsheet-safe CSV export bounded by Root: complete or refused, never silently truncated. Role change: `CHANGE ROLE <email> IN <workspaceId> TO <role>`; the last
  active owner cannot be demoted; blocked while workspace data deletion is queued.
- **Lifecycle**: lists disabled accounts, suspended workspaces and queued deletions. Disable/enable
  and suspend/restore delegate to the existing `setRootUserDisabled` / `setRootWorkspaceAccess`
  (one implementation of locks, session revocation, audit). New: workspace ownership transfer
  `TRANSFER WORKSPACE <workspaceId> TO <email>` (active existing account; previous owners stay
  or become admins; workspace row locked; membership and audit atomic). No deletion of accounts,
  workspaces or data is implemented; the screen says so.
- **Errors**: grouped `error_events`, filters (status, source, search), redacted and truncated
  messages, stack only in detail, resolve/reopen (audited; MCP requires the exact RESOLVE/REOPEN ROOT ERROR confirmation). Missing
  table is reported unavailable, never as an empty log.
- **Backups and diagnostics**: read-only. Reports what the server scripts recorded in
  `backup_runs` (recent/stale/failed/never recorded against Root thresholds) plus open
  `system_alerts` and error counts. It always states that archive contents, restorability and
  provider health are not verified here. There is no start/restore API, MCP tool or button.
- **Sessions** (2026-10-19): unexpired browser sessions across the installation with account, verification state,
  expiry and a "this browser" marker; search by email/name; bounded by `root.legacy.lifecycleListLimit` and labelled
  truncated. Token hashes and pending challenges are never returned. Sign out one browser with the exact
  `SIGN OUT SESSION <sessionId>` confirmation (dialog, HTTP DELETE body, MCP `sign_out_root_session`); the actor and
  session owner are locked and the delete is audited (`root.session_signed_out`) in one transaction. The account is
  unchanged; disabling an account remains in Users/Lifecycle.
- **Connections** (2026-10-19): read-only directory of every `social_accounts` row across workspaces, paged by
  `root.legacy.privilegePageSize`, filtered by installed platform, state (connected/expired/revoked, from the shared
  `connectionState`) and connection/workspace search. Shows platform name from the installed manifest (uninstalled
  providers are labelled), selected/discovered channel counts, scope count and token expiry; never tokens or scope
  names; invalidation reasons are redacted. Reconnect/disconnect stay in each workspace's own settings, so the Root
  screen does not offer them. Uses existing Root bounds; no registry change.
- **Per-module ownership**: plan features group by owning module; these screens are shared
  installation controls and sit under "Shared controls". Product and platform checks remain in
  each module's own Root pages and diagnostics.

## Host integration

Registry version 60 installs Root-owned settings. Root manifests expose the five shared-control sections; installation MCP installs their tools and resources with current Root authority and result limits. Privilege and error filters use the existing contextual sidebar. CSV exports require the shared confirmed download protocol and row/byte bounds.

## Shared legacy database

Raw SQL reads/writes tables not modelled in the rebuild Prisma schema: `plans`,
`users."planId"`, `error_events`, `backup_runs`, `system_alerts`, `member_page_access`,
`sessions."createdAt"`, `memberships."allPages"`, and the `"WorkspaceRole"` enum type. Column
names come from the legacy `prisma/schema.prisma`. If a table is absent the error and backup
services return an explicit "unavailable"; plans/privileges would fail closed with a generic error.
No migration is needed or proposed.

## Not implemented / limitations

- Transfer of installation Root (legacy required password re-entry and mail) is omitted: it needs a
  password-verification service and a two-sided audit design before it is safe.
- Deleting users or workspaces (legacy danger zone) is intentionally absent.
- Legacy registration (open-registration switch, account and client invitations) is not ported here; workspace invitations live in Settings with `settings.invitationsEnabled`. Root connection health checks/refresh and installation-wide session revocation per account are not added.
- Sessions/connections have mocked-database tests only; no real PostgreSQL, browser or phone verification was run for them.
- Plan creation/removal and feature catalog editing are not provided (legacy edited only).
- Changing plan assignment does not itself notify the user.
- "Last sign-in" is the newest existing session start, not a login history.
- Phone, full keyboard/theme flows and every browser mutation still need verification. The guarded script `scripts/verify-root-operations.ts` exercises real local HTTP/MCP/database operations, not production.

## Review R4 hardening (2026-10-17, account 2)

- Plan catalog and subscriber lists are bounded by Root settings `root.legacy.planCatalogLimit` / `subscriberListLimit` (limit+1 read) and labelled truncated in UI, API and MCP.
- All Root mutations run in `rootTransaction`, using the Root-managed `root.accountOperationTimeoutMs` / `LockWaitMs`; missing or invalid bounds fail closed before any transaction starts.
- Role changes and ownership transfers lock the workspace, the actor, the target and every current owner (re-read after locking; conflict rather than acquiring additional locks out of order), so a concurrent account disable cannot leave a workspace without an active owner. A disabled account cannot be promoted to owner.
- Query strings are parsed strictly: repeated or unknown parameters return 400.
- Error name, message and location (query/fragment stripped) are redacted; release is only sanitised and capped (commit ids are not secrets). Redaction also covers cookie/session/code/credential text.
- Column names were checked read-only against the legacy Prisma schema (plans, users, memberships, member_page_access, sessions, root_activities, error_events, backup_runs, system_alerts, workspace_data_purges); the guarded preview probe subsequently verified the exercised real PostgreSQL workflows.
