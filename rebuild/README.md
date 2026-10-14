# Social Pilot rebuild

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

This is a reviewable foundation, not a production replacement. Local draft CRUD and local channel/ad-account selection work. A typed Root configuration slice, four selectable themes, read-only MCP, feature entitlements, and initial Facebook Page publishing contract are present. Published-post remote deletion, disconnect with retain/delete, OAuth discovery, passkey verification, account recovery, background jobs, complete analytics/ads data coverage, inbox interactions, scoped role access, comprehensive Root controls, MCP write parity, and live integration tests remain. No customer traffic should be routed here until these flows work with existing production data and a tested rollback path.

See `docs/DATA_COMPATIBILITY.md` and `docs/AUTH_COMPATIBILITY.md` for migration boundaries.
