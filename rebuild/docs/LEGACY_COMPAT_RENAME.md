# Administration naming cleanup — 2026-10-22

Completed the partial administration move into `src/modules/root/server/admin/`, rewrote consumers, renamed Root settings and auth helper identifiers without changing stored credential/cookie formats, removed the completed one-time importer and its tests, and renamed the Root/round regression tests while retaining assertions. Schema version is 132. No new capabilities or tables.

The saved-key migration is under `rebuild/prisma/migrations/20261022200000_root_admin_settings/`. It is repeatable and skips a source key when its canonical destination already exists, preserving both values on collision. No migration was applied here.

The live Facebook read/media probes now load configuration and credential decoding from the Facebook module. Their existing journal, endpoint/signing guards and remote cleanup logic remain. Module-owned probe configuration explicitly clears any bundled app secret when current Root signing material is unavailable, preventing stale-secret fallback; regression tests cover current policy, absent secrets and policy-read errors. They were not executed against a provider. Historical configuration mapping survives only as a read-only migration verification helper; there is no importer or apply command.

## Verification

- `npm run typecheck`: passed, zero errors.
- `npx tsc --noEmit -p .`: passed, zero errors.
- `npx vitest run --no-cache --exclude "**/facebook-diagnostic-transport.test.ts"`: 701 files passed, 1 failed, 49 skipped; 11,374 tests passed, 5 failed, 2,525 skipped. All five failures are `facebook-native-http.test.ts`, sandbox `listen EPERM ::1`. This is not a green full-suite result; rerun with loopback permission.
- Focused parity/config/Root services/Root sessions and connections/Root HTTP-MCP/round9 UI/auth/Facebook live-media canary/probe credentials/saved-key migration: 10 files and 164 tests passed.
- Automated `root-admin-settings-migration.test.ts` in-memory SQLite execution of the actual migration SQL (Node built-in SQLite; skipped on unsupported Node versions): passed rename, canonical collision, metadata preservation, unrelated-key and repeat-execution assertions. This is not PostgreSQL evidence.
- Final metadata/verifier/probe/migration rerun: 5 files, 29 tests passed; both typecheck commands and whitespace checks passed again.
- `node --check` for both live probes and a no-I/O `node --import tsx` credential-module import: passed.
- `git diff --check`: passed. No source or script references to repository-root credential/settings modules remain.

## Root settings

No added operational controls; these existing keys are renamed from `root.legacy.*` to:

- `root.admin.connectionRefreshTimeoutMs`
- `root.admin.connectionRefreshGraceMs`
- `root.admin.connectionRefreshMaxWaitMs`
- `root.admin.privilegeExportMaxBytes`
- `root.admin.searchMaxCharacters`
- `root.admin.planCatalogLimit`
- `root.admin.subscriberListLimit`
- `root.admin.planHistoryLimit`
- `root.admin.privilegePageSize`
- `root.admin.privilegeExportMaxRows`
- `root.admin.lifecycleListLimit`
- `root.admin.errorPageSize`
- `root.admin.errorMessageMaxCharacters`
- `root.admin.errorStackMaxCharacters`
- `root.admin.backupRunHistoryLimit`
- `root.admin.offsiteBackupMaxAgeHours`
- `root.admin.restoreTestMaxAgeDays`
- `root.admin.openAlertLimit`

## UI and skills

Screen imports and the plans stylesheet filename were updated mechanically. Existing composition, data fetching, accessible controls, focus behavior and styling are retained (taste-skill, web-design-guidelines, composition-patterns, react-best-practices). Root sessions/connections French copy now uses narrow nonbreaking spaces before high punctuation, caught by the catalog quality guard. This is the only intended visible difference. No screen redesign or browser verification; servers were prohibited.

The compatibility follow-up also removes residual auth/configuration comments, verifies canonical Root settings are registered, fixes mechanically altered comment grammar, and restores normal source whitespace around JavaScript operators in the copy helper. The four renamed test files retain their assertion counts (11, 80, 127 and 43 `expect` calls).

| Affected screen | Applied skill rules / visible result |
| --- | --- |
| Root overview, backups, configuration, connections, errors list/detail, lifecycle, module settings, plans, privileges, registration, sessions and publication recovery | Taste: retain the established app hierarchy, tokens and tables. Web guidelines: retain labels, focus and exact-confirmation dialogs. Composition: preserve shared controls and state ownership. React: retain server data loading and client boundaries. Module/import/stylesheet renames have no intended visible effect. |
| Root connections and sessions (French) | Web typography: narrow nonbreaking spaces keep punctuation attached. Existing shared components, layout and fetching remain. |
| Integration authorization | Composition/React: renamed session helper keeps the existing authorization and rendering boundary. No intended visible effect. |

No browser or visual-design clearance is claimed; the user prohibited servers.

## Remaining evidence and scope

No server, deploy, push, production access, real PostgreSQL migration test or live provider call. The integrator must rehearse/apply the migration and rerun socket-based tests where loopback binding is allowed. Read-only historical migration verification and persisted table/data compatibility remain deliberately intact. No additional edits outside this lane are required to integrate the source; release verification remains separate. Changes are unstaged and uncommitted, and node_modules/patch artifacts are excluded from this inventory.

## Changed files

- `rebuild/docs/AGENT_HANDOFF.md`
- `rebuild/docs/ARCHITECTURE.md`
- `rebuild/docs/DELIVERY_PLAN.md`
- `rebuild/docs/FACEBOOK_REQUEST_SIGNING.md`
- `rebuild/docs/FACEBOOK_LIVE_MEDIA_CANARY.md`
- `rebuild/docs/MCP_PARITY.md`
- `rebuild/prisma/migrations/20261022200000_root_admin_settings/migration.sql`
- `rebuild/scripts/import-legacy-config.ts`
- `rebuild/scripts/legacy-data-manifest.ts`
- `rebuild/scripts/migration-setting-expectations.ts`
- `rebuild/scripts/seed-preview.ts`
- `rebuild/scripts/verify-ads-recovery.ts`
- `rebuild/scripts/verify-ads-report-export.ts`
- `rebuild/scripts/verify-ads-report-policy.ts`
- `rebuild/scripts/verify-agency-workflow.ts`
- `rebuild/scripts/verify-analytics.ts`
- `rebuild/scripts/verify-client-sharing79.ts`
- `rebuild/scripts/verify-core-workflows.ts`
- `rebuild/scripts/verify-destination-formats85.ts`
- `rebuild/scripts/verify-facebook-live-media.mjs`
- `rebuild/scripts/verify-facebook-live-read.mjs`
- `rebuild/scripts/verify-facebook-media-cleanup.ts`
- `rebuild/scripts/verify-facebook-media-evidence.ts`
- `rebuild/scripts/verify-facebook-media-resolution.ts`
- `rebuild/scripts/verify-facebook-native-journal89.ts`
- `rebuild/scripts/verify-facebook-native-policy87.ts`
- `rebuild/scripts/verify-facebook-native-status91.ts`
- `rebuild/scripts/verify-facebook-publication-submissions92.ts`
- `rebuild/scripts/verify-facebook-submission-status93.ts`
- `rebuild/scripts/verify-first-comments94.ts`
- `rebuild/scripts/verify-inbox-deletion.ts`
- `rebuild/scripts/verify-inbox-read.ts`
- `rebuild/scripts/verify-inbox-workflow.ts`
- `rebuild/scripts/verify-installation-mcp.ts`
- `rebuild/scripts/verify-invitations.ts`
- `rebuild/scripts/verify-labels-explorer.ts`
- `rebuild/scripts/verify-legacy-migration.ts`
- `rebuild/scripts/verify-notifications.ts`
- `rebuild/scripts/verify-ordered-media.ts`
- `rebuild/scripts/verify-platform-access.ts`
- `rebuild/scripts/verify-post-deletion.ts`
- `rebuild/scripts/verify-post-duplication.ts`
- `rebuild/scripts/verify-post-search-export.ts`
- `rebuild/scripts/verify-publication-recovery.ts`
- `rebuild/scripts/verify-publishing-automation.ts`
- `rebuild/scripts/verify-publishing-collaboration.ts`
- `rebuild/scripts/verify-publishing-history.ts`
- `rebuild/scripts/verify-publishing-reads.ts`
- `rebuild/scripts/verify-publishing.ts`
- `rebuild/scripts/verify-queue-times.ts`
- `rebuild/scripts/verify-read-workflows.ts`
- `rebuild/scripts/verify-reports82.ts`
- `rebuild/scripts/verify-root-operations.ts`
- `rebuild/scripts/verify-tasks-workflow.ts`
- `rebuild/scripts/verify-team-access.ts`
- `rebuild/src/app/api/mcp/route.ts`
- `rebuild/src/app/api/root/backups/route.ts`
- `rebuild/src/app/api/root/changelog/[id]/route.ts`
- `rebuild/src/app/api/root/changelog/route.ts`
- `rebuild/src/app/api/root/config/route.ts`
- `rebuild/src/app/api/root/connections/[id]/refresh/route.ts`
- `rebuild/src/app/api/root/connections/[id]/route.ts`
- `rebuild/src/app/api/root/connections/route.ts`
- `rebuild/src/app/api/root/errors/[id]/route.ts`
- `rebuild/src/app/api/root/errors/route.ts`
- `rebuild/src/app/api/root/installation/route.ts`
- `rebuild/src/app/api/root/lifecycle/ownership/route.ts`
- `rebuild/src/app/api/root/lifecycle/route.ts`
- `rebuild/src/app/api/root/lifecycle/users/[id]/route.ts`
- `rebuild/src/app/api/root/lifecycle/workspaces/[id]/route.ts`
- `rebuild/src/app/api/root/plans/[id]/route.ts`
- `rebuild/src/app/api/root/plans/assign/route.ts`
- `rebuild/src/app/api/root/plans/route.ts`
- `rebuild/src/app/api/root/privileges/export/route.ts`
- `rebuild/src/app/api/root/privileges/route.ts`
- `rebuild/src/app/api/root/publication-attempts/route.ts`
- `rebuild/src/app/api/root/registration/accounts/[id]/route.ts`
- `rebuild/src/app/api/root/registration/invitations/[id]/route.ts`
- `rebuild/src/app/api/root/registration/route.ts`
- `rebuild/src/app/api/root/sessions/[id]/route.ts`
- `rebuild/src/app/api/root/sessions/route.ts`
- `rebuild/src/app/api/root/workspaces/[id]/route.ts`
- `rebuild/src/app/api/root/workspaces/route.ts`
- `rebuild/src/app/api/workspaces/select/route.ts`
- `rebuild/src/app/root/backups/page.tsx`
- `rebuild/src/app/root/config/page.tsx`
- `rebuild/src/app/root/connections/DeleteConnectionData.tsx`
- `rebuild/src/app/root/connections/RefreshConnection.tsx`
- `rebuild/src/app/root/connections/page.tsx`
- `rebuild/src/app/root/errors/[id]/page.tsx`
- `rebuild/src/app/root/errors/page.tsx`
- `rebuild/src/app/root/lifecycle/TransferOwnership.tsx`
- `rebuild/src/app/root/lifecycle/page.tsx`
- `rebuild/src/app/root/modules/ModuleHealth.tsx`
- `rebuild/src/app/root/page.tsx`
- `rebuild/src/app/root/plans/ConfirmAction.tsx`
- `rebuild/src/app/root/plans/AssignPlan.tsx`
- `rebuild/src/app/root/plans/PlanEditor.tsx`
- `rebuild/src/app/root/plans/legacy-ops.css`
- `rebuild/src/app/root/plans/page.tsx`
- `rebuild/src/app/root/plans/root-ops.css`
- `rebuild/src/app/root/privileges/RoleControl.tsx`
- `rebuild/src/app/root/privileges/page.tsx`
- `rebuild/src/app/root/registration/page.tsx`
- `rebuild/src/app/root/sessions/SignOutSession.tsx`
- `rebuild/src/app/root/sessions/page.tsx`
- `rebuild/src/lib/config/registry.ts`
- `rebuild/src/lib/config/shared-config.ts`
- `rebuild/src/modules/agency/server/client-invitations-http.ts`
- `rebuild/src/modules/agency/server/client-invitations.ts`
- `rebuild/src/modules/agency/server/workspace-selection.ts`
- `rebuild/src/modules/history/server/changelog.ts`
- `rebuild/src/modules/integrations/oauth/ui/AuthorizeScreen.tsx`
- `rebuild/src/modules/root/config.ts`
- `rebuild/src/modules/root/server/admin/audit.ts`
- `rebuild/src/modules/root/server/admin/authz.ts`
- `rebuild/src/modules/root/server/admin/backups.ts`
- `rebuild/src/modules/root/server/admin/config.ts`
- `rebuild/src/modules/root/server/admin/connection-refresh.ts`
- `rebuild/src/modules/root/server/admin/connections.ts`
- `rebuild/src/modules/root/server/admin/copy.ts`
- `rebuild/src/modules/root/server/admin/errors.ts`
- `rebuild/src/modules/root/server/admin/http.ts`
- `rebuild/src/modules/root/server/admin/index.ts`
- `rebuild/src/modules/root/server/admin/lifecycle.ts`
- `rebuild/src/modules/root/server/admin/mcp.ts`
- `rebuild/src/modules/root/server/admin/plans.ts`
- `rebuild/src/modules/root/server/admin/policy.ts`
- `rebuild/src/modules/root/server/admin/privileges.ts`
- `rebuild/src/modules/root/server/admin/sessions.ts`
- `rebuild/src/modules/root/server/admin/shared.ts`
- `rebuild/src/modules/root/server/admin/transfer.ts`
- `rebuild/src/modules/root/server/configuration.ts`
- `rebuild/src/modules/root/server/directory.ts`
- `rebuild/src/modules/root/server/errors.ts`
- `rebuild/src/modules/root/server/operator-monitoring.ts`
- `rebuild/src/modules/root/server/workspace-controls.ts`
- `rebuild/src/modules/settings/person-keys/session.ts`
- `rebuild/src/modules/settings/server/account-recovery.ts`
- `rebuild/src/modules/settings/server/account-security.ts`
- `rebuild/src/modules/settings/server/account-session.ts`
- `rebuild/src/modules/settings/server/account.ts`
- `rebuild/src/modules/settings/server/appearance.ts`
- `rebuild/src/modules/settings/server/connection-start.ts`
- `rebuild/src/modules/settings/server/invitations.ts`
- `rebuild/src/modules/settings/server/registration.ts`
- `rebuild/src/platforms/facebook/jobs.ts`
- `rebuild/src/platforms/facebook/probe-credentials.ts`
- `rebuild/src/platforms/facebook/runtime.ts`
- `rebuild/src/server/auth-flow.ts`
- `rebuild/src/server/auth.ts`
- `rebuild/src/server/config/access.ts`
- `rebuild/src/server/config/legacy-import.ts`
- `rebuild/src/server/context.ts`
- `rebuild/src/server/invitation-session.ts`
- `rebuild/src/server/mcp/root-tools.ts`
- `rebuild/src/server/root/RootFrame.tsx`
- `rebuild/src/server/root/RootModuleSettings.tsx`
- `rebuild/src/server/root/RootPublicationAttempts.tsx`
- `rebuild/src/server/root/RootPublicationControls.tsx`
- `rebuild/src/server/root/legacy/audit.ts`
- `rebuild/src/server/root/legacy/authz.ts`
- `rebuild/src/server/root/legacy/backups.ts`
- `rebuild/src/server/root/legacy/config.ts`
- `rebuild/src/server/root/legacy/connection-refresh.ts`
- `rebuild/src/server/root/legacy/connections.ts`
- `rebuild/src/server/root/legacy/copy.ts`
- `rebuild/src/server/root/legacy/errors.ts`
- `rebuild/src/server/root/legacy/http.ts`
- `rebuild/src/server/root/legacy/index.ts`
- `rebuild/src/server/root/legacy/lifecycle.ts`
- `rebuild/src/server/root/legacy/mcp.ts`
- `rebuild/src/server/root/legacy/plans.ts`
- `rebuild/src/server/root/legacy/policy.ts`
- `rebuild/src/server/root/legacy/privileges.ts`
- `rebuild/src/server/root/legacy/sessions.ts`
- `rebuild/src/server/root/legacy/shared.ts`
- `rebuild/src/server/root/legacy/transfer.ts`
- `rebuild/src/server/root/publication-attempts.ts`
- `rebuild/src/server/root/registration-admin.ts`
- `rebuild/src/server/two-step.ts`
- `rebuild/tests/account-settings.test.ts`
- `rebuild/tests/agency-host-integration.test.ts`
- `rebuild/tests/auth.test.ts`
- `rebuild/tests/changelog-service.test.ts`
- `rebuild/tests/config-validation.test.ts`
- `rebuild/tests/contract-audit-shell.test.ts`
- `rebuild/tests/legacy-config-import.test.ts`
- `rebuild/tests/legacy-round9-ui.test.ts`
- `rebuild/tests/mcp-installation-context.test.ts`
- `rebuild/tests/mcp-route-auth.test.ts`
- `rebuild/tests/oauth-authorize-screen.test.ts`
- `rebuild/tests/operator-monitoring.test.ts`
- `rebuild/tests/parity-account-service.test.ts`
- `rebuild/tests/parity-oauth-round2-service.test.ts`
- `rebuild/tests/publication-recovery-routes.test.ts`
- `rebuild/tests/facebook-probe-credentials.test.ts`
- `rebuild/tests/root-admin-settings-migration.test.ts`
- `rebuild/tests/regression-round9-ui.test.ts`
- `rebuild/tests/root-admin-http-mcp.test.ts`
- `rebuild/tests/root-admin-services.test.ts`
- `rebuild/tests/root-admin-sessions-connections.test.ts`
- `rebuild/tests/root-connection-delete-ui.test.ts`
- `rebuild/tests/root-connection-delete.test.ts`
- `rebuild/tests/root-connection-refresh-ui.test.ts`
- `rebuild/tests/root-connection-refresh.test.ts`
- `rebuild/tests/root-connection-transfer-postgres.integration.test.ts`
- `rebuild/tests/root-directory-tables-ui.test.ts`
- `rebuild/tests/root-directory.test.ts`
- `rebuild/tests/root-legacy-http-mcp.test.ts`
- `rebuild/tests/root-legacy-services.test.ts`
- `rebuild/tests/root-legacy-sessions-connections.test.ts`
- `rebuild/tests/root-monitoring-consolidation.test.ts`
- `rebuild/tests/root-overview-ui.test.ts`
- `rebuild/tests/root-recovery-limits.test.ts`
- `rebuild/tests/root-registration-admin.test.ts`
- `rebuild/tests/settings-security-service.test.ts`
- `rebuild/tests/synchronous-policy.test.ts`
- `rebuild/tests/team-invitations.test.ts`
