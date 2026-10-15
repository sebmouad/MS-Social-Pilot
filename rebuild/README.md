# Social Pilot rebuild

**Start here:** [agent instructions](AGENTS.md), [mandatory architecture contract](docs/ARCHITECTURE_CONTRACT.md), and [current implementation/gaps](docs/ARCHITECTURE.md). The contract defines the target; partial implementation is not a replacement specification.

This is a new Next.js application with a new route map, shell, design system, and feature pages. It is isolated from the production app. The legacy app remains the live service while replacement capabilities are built and verified.

## Local checks

```sh
npm install
npx prisma generate --schema prisma/schema.prisma
npm run typecheck
npm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npm run build
```

Set `DATABASE_URL` to a non-production copy of the existing schema for interactive testing. The Prisma schema maps selected existing tables; the rebuild already writes sessions, draft posts, selections, and Root settings. Never run `db push` or migrations from `rebuild` against the existing database without a reviewed migration and backup.

## Data and authorization

The new app reads existing users, sessions, memberships, workspaces, posts, channels, social connections, and ad accounts by their original IDs. Existing fully verified browser sessions are accepted on the same hostname. Password sign-in now routes accounts requiring two-step verification to TOTP or recovery-code verification; accounts without an enrolled TOTP factor receive an enrollment flow. Passkey verification and account recovery are still cutover gaps. Every workspace read starts from a validated membership and an entitlement check. Only owners and admins may enter the preview until finer-grained permissions are mapped. Provider credentials are not selected into frontend views.

## Current limits before cutover

This remains an isolated candidate, not the live service. The rebuild has browser and bearer-key MCP tools for workspace publishing, inbox actions, connection selection, and data controls, plus private signed-in Root configuration tools. MCP data export and deletion use the same workspace-scoped service as the UI; deletion requires `DELETE WORKSPACE DATA <workspaceId>` and records the bearer key ID in its transactional audit event. Analytics reads stored Page, Instagram account, and ad-account metrics; selected Page and Instagram follower snapshots contribute to the audience total. The browser ZIP export includes workspace media but its database snapshot still omits legacy feature tables; the manifest states this limit. Workspace erasure has a resumable database and file cleanup job with a database write gate. Broader provider coverage, comprehensive analytics/ads coverage, live platform testing, functional and authorization checks against migrated production data, and a tested cutover/rollback remain. No customer traffic should be routed here until those gates pass.

See `docs/DATA_COMPATIBILITY.md` and `docs/AUTH_COMPATIBILITY.md` for migration boundaries. The replacement worker and its database lease/audit tables are described in `docs/BACKGROUND_JOBS.md`; apply its additive migration only through the reviewed deployment process.
