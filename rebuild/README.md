# Social Pilot rebuild

This is a new Next.js application with a new route map, shell, design system, and feature pages. It is isolated from the production app. The legacy app remains the live service while replacement capabilities are built and verified.

## Local checks

```sh
npm install
npx prisma generate --schema prisma/schema.prisma
npm run typecheck
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npm run build
```

Set `DATABASE_URL` to a non-production copy of the existing schema for interactive testing. This Prisma schema is a read-only client view. Never run `db push` or migrations from `rebuild` against the existing database.

## Data and authorization

The new app reads existing users, sessions, memberships, workspaces, posts, channels, social connections, and ad accounts by their original IDs. Existing fully verified browser sessions are accepted on the same hostname. Password sign-in works only when the account does not require a second factor; TOTP, passkeys, and recovery verification remain cutover gates. Every workspace read starts from a validated membership. Until Page-level access and client screen scopes are implemented, only owners and admins may enter the preview. Provider credentials are not selected into frontend views.

## Current limits before cutover

This is a reviewable foundation, not a production replacement. Local draft CRUD and local channel/ad-account selection work, but published-post remote deletion, disconnect with retain/delete, OAuth discovery, two-factor challenge, account recovery, background jobs, complete analytics/ads data coverage, inbox interactions, scoped role access, feature entitlement, and integration tests remain to be implemented. No customer traffic should be routed here until these flows work with existing production data and a tested rollback path.

See `docs/DATA_COMPATIBILITY.md` and `docs/AUTH_COMPATIBILITY.md` for migration boundaries.
