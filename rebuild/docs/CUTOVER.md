# Rebuild cutover gate

The legacy service remains the production app until this gate is complete. A
successful build or a passing unit suite alone does not authorize the swap.

1. Prepare a staging copy of the production schema and media. Verify the
   rebuild's mapped columns and every write workflow against that copy. Record
   row counts and representative IDs for users, workspaces, memberships,
   social accounts, destinations, ad accounts, posts, inbox, and analytics.
2. Exercise each supported feature as owner, admin, editor, contributor,
   viewer, and client in two workspaces. Denied API and MCP operations must
   also be tested. Confirm no access token appears in HTML, JSON, MCP, logs,
   or audit detail.
3. Use an identifiable test record on each live provider capability, verify
   local and remote state, then clean it up. Confirm status reconciliation and
   deletion after remote success and after remote failure. Do not delete a
   customer's existing content for verification.
4. Rehearse a backup and restore in an isolated database. Verify the rebuild
   can start and the legacy app can start against the migrated schema.
5. Before the production swap, record the current release hash, run and verify
   the server backup, and retain the prior release. The deployment command is
   `socialpilot-deploy`; `socialpilot-deploy --status` and
   `socialpilot-deploy --rollback` are the existing release controls.
6. After the swap, test sign-in and two-step, module navigation, one read and
   one reversible write per module, MCP authentication and scope, worker/jobs,
   `/api/health`, and the connected remote platform. If these fail, roll back
   application code immediately. Database restore is a separate, destructive
   operation and requires comparing the backup against writes since cutover.

The current deployment scripts build the legacy app at the repository root.
They must be updated and rehearsed to stage `rebuild/` before this checklist
can be executed. No rebuild migration or production deployment has run yet.
