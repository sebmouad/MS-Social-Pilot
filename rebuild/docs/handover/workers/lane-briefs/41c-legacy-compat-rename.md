LANE: remove legacy naming/compat from rebuild. Follow rebuild/docs/LEGACY_REMOVAL_PLAN.md "Compatibility code" rows. Rename rebuild/src/server/root/legacy/** into normal module locations (Root owns them; no 'legacy' in paths, identifiers, copy or Root keys except DB table names that cannot change). Remove one-time bridges that are complete: server/config/legacy-import.ts, scripts/import-legacy-config.ts, verify-facebook-live-*.mjs that import root src/, legacy-round* tests names (keep assertions under new names). Keep auth compatibility for stored credential/cookie formats but rename identifiers. Nothing may import from repository-root src/. Full suite + tsc must pass.


REDO on current HEAD (rebuild is now self-contained: rebuild/prisma, rebuild/package-lock). Ignore earlier attempt. Never stage node_modules or *.patch.

Decisions: add the idempotent app_settings rename migration (under rebuild/prisma/migrations); keep the live Facebook verify scripts but switch credential loading to the Facebook module. Perform the edits (use sed/scripts freely), run typecheck + full suite.
