# Release, Deployment & Rollback

Production runs MS Social Pilot (`app/`) at `https://social.newsgeet.com`.

## Release Procedure

All production deployments run through `app/scripts/prod-deploy.sh`:

1. Ensure `npm run typecheck` and `npm test` pass from `app/` (see [TESTING.md](TESTING.md)).
2. Push verified commits to `origin/main`.
3. Run `bash app/scripts/prod-deploy.sh`:
   - Ships `app/` and `app/prisma/migrations` from `origin/main` to the production server.
   - Creates a pre-deploy `pg_dump` backup in `/var/backups/socialpilot-deploy-<timestamp>/social_pilot.dump`.
   - Performs an incremental build in `/srv/ms-social-pilot-rebuild-build/app`.
   - Applies any new migrations and records them in `_prisma_migrations`.
   - Swaps `/srv/ms-social-pilot-rebuild` and restarts `social-pilot-rebuild` and `social-pilot-rebuild-worker`.
   - Verifies local `/api/health`, `/api/auth/sign-in` Origin validation, and public `/api/health`.

## Rollback & Recovery Verification

- **Automatic Code Rollback**: If any post-swap health check fails during `prod-deploy.sh`, the script automatically restores `/srv/ms-social-pilot-rebuild.prev` and restarts the services.
- **Isolated Rollback Drill**: `bash app/scripts/prod-rollback-drill.sh` restores the newest production dump into a temporary `social_pilot_drill` database and boots the installed release on port `3121` with a read-only PostgreSQL role, proving backup integrity without touching live traffic.
- **Local Migration Rehearsal**: `bash app/scripts/cutover-rehearsal.sh` applies the checksum-pinned baseline migration to an empty local scratch database, verifies all required tables, columns, constraints, and triggers, and confirms `pg_dump` / `pg_restore` row-count parity.
