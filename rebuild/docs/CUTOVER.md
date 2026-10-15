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
4. Run `scripts/cutover-rehearsal.sh` against a sanitized custom-format dump
   from a staging copy, using a local throwaway PostgreSQL server. The script
   rejects non-loopback database URLs, restores the staging dump into a named
   scratch database, checks the rebuild's mapped columns, makes a second dump,
   restores it into a second scratch database, compares representative table
   counts, and removes both databases. Inside the provided PostgreSQL
   container, set `CUTOVER_ADMIN_URL` to
   `postgresql://postgres@/postgres?host=/var/run/postgresql`. This only checks
   schema and restore compatibility; it does not apply a rebuild migration or
   exercise app writes. Then start both apps against the isolated copy and
   complete the workflow checks below.
5. Before the production swap, record the current release hash, run and verify
   the server backup, and retain the prior release. The deployment command is
   `socialpilot-deploy`; `socialpilot-deploy --status` and
   `socialpilot-deploy --rollback` are the existing release controls.
6. After the swap, test sign-in and two-step, module navigation, one read and
   one reversible write per module, MCP authentication and scope, worker/jobs,
   `/api/health`, and the connected remote platform. If these fail, roll back
   application code immediately. Database restore is a separate, destructive
   operation and requires comparing the backup against writes since cutover.

## Current deployment and migration gaps

- `scripts/deploy/remote-stage.sh` archives the repository root into
  `/srv/ms-social-pilot.new`, runs `npm ci`, and builds the root package. It
  does not install or build `rebuild/`. `remote-swap.sh` then runs the root
  Prisma migrations before swapping the release. No deployment script stages
  the rebuild package or its generated Prisma client.
- `rebuild/prisma/schema.prisma` is a partial mapped client view. It has no
  `rebuild/prisma/migrations/` directory and is explicitly not a database
  migration schema. Do not run `db push` or `migrate deploy` from this app.
  There is no reviewed DDL, data migration, forward/rollback migration plan,
  or proof that rebuild writes are safe against a production-shaped copy.
- The rebuild Prisma enums include `WorkspaceRole.viewer` and
  `WorkspaceRole.client`, plus `TargetType.telegram`, `youtube`, and `tiktok`.
  The checked-in legacy migrations add those values on 2026-10-17 and
  2026-10-18, after the current 2026-10-15 review date. Confirm production's
  actual enum labels and migration ledger before connecting the rebuild. The
  rehearsal rejects a staging copy that lacks any mapped enum value. This is
  a concrete schema compatibility gap, not a planned migration.
- Existing application rollback swaps the previous code release back, while
  leaving the database schema as-is. That is not a database rollback plan for
  data writes or an incompatible migration. A database restore requires
  separate review of writes since the backup and cutover.
- The rehearsal ran against a throwaway PostgreSQL 16 database built from all
  93 checked-in legacy migration SQL files, with fabricated rows in the 13
  representative tables. Mapped-column and enum checks passed, and a second
  custom dump restored with matching counts. The script removed its scratch
  databases. This verifies the checked-in migration schema and restore
  mechanics; it does not substitute for a sanitized production staging dump.
- The current restore-test cron script creates a fixed scratch database named
  `msp_restore_test`, drops it before and after use, and verifies only a few
  row counts. It does not test the rebuild schema or compare the restore with
  the source database. Run it only after confirming that fixed database name
  is reserved for this test on the host.

No rebuild migration or production deployment has run. The existing
`socialpilot-deploy` command still deploys the legacy app; the cutover checklist
is gated until a rebuild-specific stage/build/restart/health path, migration
decision, tested backup/restore, app workflow coverage, and rollback procedure
are reviewed and rehearsed.
