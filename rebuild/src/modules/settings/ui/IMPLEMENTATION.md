# Settings, Tasks and Agency UI lane handoff

Scoped source/UI batch, 2026-10-20. The complete rebuild and this lane's final UX acceptance remain incomplete. Only the assigned UI/API paths and their tests were edited. No new Root registry keys or schema-version changes; no server, production, deployment, push, package install or whole-suite run.

## Result

- Shared Settings/Tasks/Agency PageHeaders and module icon chips.
- Shared responsive DataTables for connections (grouped by platform), account sessions, team, invitations, MCP keys, notifications, Tasks list, Agency workspaces and client directories. Existing tenant/role gates, unknown/withheld counts, selection/discovery metadata, secret masking and receipt checks remain.
- Connection row menus expose reconnect, resource selection and disconnect. Disconnect retains its retain/delete selection and deletion preview before a named shared confirmation. Reconnect starts OAuth; no unsupported customer token-refresh operation was invented.
- Both OAuth start routes call the same existing HTTP/service handler. Connection selection PATCH calls the same confirmed, Root-bounded service as MCP, with an exact changed-count confirmation. No-op selections do not write.
- Theme RadioCards with catalog swatches, display-mode SegmentedControl and live ThemeProvider updates. Save persists through the existing appearance service, with toast failure/retry and no reload.
- Shared role Selects, invitation review Drawer, named member/invitation/session/key/data/export/task/comment/group confirmations, immediate notification preference Switches, toast feedback and retained failure context.
- Tasks board/list Tabs, InlineEdit title updates with expectedUpdatedAt, due Badges and assignee initials. Shared AutoTextarea keeps multiline inputs usable. Sidebar FilterPanels/Selects and active FilterChips preserve applied scope and pagination resets.
- Agency MetricCards and a comparison BarChart of scheduled and failed posts per visible workspace. Missing/withheld values remain null and the failed-post window remains visible. No trend/delta/history was fabricated.

## Verification

Run from rebuild:

- `npx tsc --noEmit -p .`: zero errors.
- `npx vitest run --no-cache` with the 31 targeted files below: 295 tests passed, zero failures. Cache disabled because the linked node_modules cache resolves outside writable roots.
- `git diff --check`: passed.
- Premium static audit invoked with `--mode strict --no-write`; project-wide violations remain outside this lane. This is static analysis, not browser evidence.

Targeted files:

```text
tests/settings-lane-shared-ui.test.ts
tests/agency-shared-screen.test.ts
tests/parity-appearance-ui-round2.test.ts
tests/tasks76-ui.test.ts
tests/agency-ui.test.ts
tests/settings-form-validation.test.ts
tests/team-controls.test.ts
tests/notifications-ui73.test.ts
tests/settings-copy-parity.test.ts
tests/connection-selection-ui.test.ts
tests/connection-oauth-routes.test.ts
tests/connection-api-errors.test.ts
tests/workspace-export-surfaces.test.ts
tests/parity-oauth-round2-transports.test.ts
tests/parity-oauth-round2-service.test.ts
tests/parity-connection-selection.test.ts
tests/agency-service.test.ts
tests/agency-route.test.ts
tests/agency-mcp.test.ts
tests/tasks-route.test.ts
tests/tasks-service.test.ts
tests/account-settings.test.ts
tests/mcp-key-management.test.ts
tests/team-route.test.ts
tests/team-invitations.test.ts
tests/parity-appearance-round2.test.ts
tests/connections-mcp.test.ts
tests/channel-profiles-surfaces.test.ts
tests/workspace-operations-shortener-ui.test.ts
tests/workspace-operations.test.ts
tests/workspace-policy.test.ts
```

## Open gaps and integration outside ownership

1. **Root copy/config coverage is incomplete.** Appearance already consumes `settings.appearanceCopy`; other Settings catalogs remain source catalogs. Tasks and Agency still have English source copy, including labels added around shared controls. The owning `src/modules/{settings,tasks,agency}/config.ts` files need typed bilingual UI catalogs (suggested keys `settings.uiCopy`, `tasks.uiCopy`, `agency.uiCopy`), and services/screens must pass their runtime values. Those config files were explicitly outside this worker's ownership. These are proposed keys, not installed settings. The integrator must coordinate CONFIG_SCHEMA_VERSION only after actually declaring keys.
2. **Existing operational source literals remain.** Examples: Tasks search lengths and checklist gap default, MCP name input length and export-history polling interval. Expose the relevant policies from owning Root config/service responses rather than copying UI constants. No new operational limit or timeout was introduced here.
3. **Account security Switches need real service support.** The inspected Settings account service supports profile/password/session operations, not a current-user two-factor preference operation. Implement the actual shared security operation and enrollment/recovery flows under `settings/server`, declare REST/MCP/config support, then wire a Switch. No inert two-factor switch was added.
4. **Webhook UI belongs to another owner.** Existing `src/modules/integrations/ui/{WebhooksScreen,WebhookManager,SecretReveal}.tsx` owns the webhook tables/secret flows. Settings already has session-backed webhook-secret service wrappers. Integrations should migrate its UI using those shared services and preserve reveal/rotate authorization. This worker did not edit that directory or clone the screen.
5. **Remaining UI polish.** Add/edit team and invite review still retain existing typed protocol confirmation fields; some critical in-page feedback is retained beside toast feedback. Notification filters still use their existing sidebar section. Complete copy/config migration before claiming all customer jargon and local controls are gone. A shared Avatar primitive is absent; account/assignee initials are used. If desired, the shared-component owner can add an Avatar accepting a safe URL/fallback/name.
6. **Verification gaps.** No server/browser was permitted. Verify all four themes in light/dark, 1440px/390px, keyboard focus, open Select/Menu states, narrow chart labels, slow/error/loading and real authorization/provider behavior. Static/component tests do not prove these.
7. **Host docs.** Integrator should record this source-only evidence and remaining copy/security/webhook/visual gaps in `docs/ARCHITECTURE.md`, `UX-CONTRACT.md`, `docs/DELIVERY_PLAN.md` and `docs/AGENT_HANDOFF.md`. Those documents were outside ownership; no target contract was changed.

## Publication

Changes remain uncommitted in this worker tree. Git metadata resolves to `/Users/mouad/Documents/ChatGPT/MS Social Pilot/app/.git/worktrees/msp-setui`, outside the permitted writable roots. No staging/commit/push was attempted. Preserve the two pre-existing untracked node_modules symlinks. Integrator should review and commit the owned changes from a permitted environment.

## Changed files

All paths below are relative to rebuild. This manifest includes this handoff and the connection handoff.

```text
src/app/api/connections/[platform]/start/route.ts
src/app/api/connections/route.ts
src/modules/agency/ui/AgencyChrome.tsx
src/modules/agency/ui/AgencyExport.tsx
src/modules/agency/ui/AgencyFilters.tsx
src/modules/agency/ui/AgencyScreen.tsx
src/modules/agency/ui/WorkspaceAction.tsx
src/modules/agency/ui/agency.module.css
src/modules/agency/ui/clients/ClientsScreen.tsx
src/modules/settings/ui/IMPLEMENTATION.md
src/modules/settings/ui/_components.tsx
src/modules/settings/ui/account/manager.tsx
src/modules/settings/ui/appearance/appearance.module.css
src/modules/settings/ui/appearance/picker.tsx
src/modules/settings/ui/connections/ConnectionsScreen.tsx
src/modules/settings/ui/connections/IMPLEMENTATION.md
src/modules/settings/ui/connections/manager.tsx
src/modules/settings/ui/connections/row-menu.tsx
src/modules/settings/ui/data/DataScreen.tsx
src/modules/settings/ui/data/controls.tsx
src/modules/settings/ui/data/exports.tsx
src/modules/settings/ui/mcp/keys.tsx
src/modules/settings/ui/notifications/NotificationCenter.tsx
src/modules/settings/ui/profiles/GroupShortcut.tsx
src/modules/settings/ui/profiles/ProfilesManager.tsx
src/modules/settings/ui/team/InvitationControls.tsx
src/modules/settings/ui/team/TeamControls.tsx
src/modules/settings/ui/workspace/operations-form.tsx
src/modules/settings/ui/workspace/policy-form.tsx
src/modules/tasks/ui/TaskBoard.tsx
src/modules/tasks/ui/TaskFilters.tsx
src/modules/tasks/ui/TasksScreen.tsx
src/modules/tasks/ui/tasks.module.css
tests/agency-shared-screen.test.ts
tests/agency-ui.test.ts
tests/channel-profiles-surfaces.test.ts
tests/connection-api-errors.test.ts
tests/connection-oauth-routes.test.ts
tests/connection-selection-ui.test.ts
tests/notifications-ui73.test.ts
tests/parity-appearance-ui-round2.test.ts
tests/settings-lane-shared-ui.test.ts
tests/tasks76-ui.test.ts
tests/team-controls.test.ts
```
