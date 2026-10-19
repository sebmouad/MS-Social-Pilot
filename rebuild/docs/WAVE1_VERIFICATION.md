# Wave 1 verification (2026-10-20)

Scope: Inbox moderation, Posts saved views and bulk actions, Root sessions and
connections. Synthetic local `_preview` database only (container `msp-test-pg`,
port 55432). No live provider request, no production change.

## Real PostgreSQL

`tests/wave1-postgres.integration.test.ts` (runs when `REBUILD_PREVIEW_DATABASE_URL`
points at the guarded `_preview` database; authority ports stubbed, SQL real):

- Saved views: create, list, cross-user isolation, wrong confirmation, delete. Pass.
- Moderation rules: create, read, update, delete, and the three audit rows. Pass
  after fix `af70d4a5`: `pg_advisory_xact_lock` returns `void`, which Prisma
  `$queryRaw` cannot read, so every rule write failed on a real database.

## Browser (dev server, localhost:3200, synthetic QA owner)

- `/inbox/moderation`: add rule, saved and listed; delete through the shared dialog.
  Fix `451d0120`: Delete did nothing where native `window.confirm` is suppressed,
  and Inbox prompts showed raw confirmation tokens. New shared `useConfirm` hook;
  only destructive actions ask, in plain words.
- `/publishing/posts` at 1440px: row checkbox, bulk Duplicate ("1 done"), then bulk
  Delete locally of the copy ("1 done"); database confirmed the copy removed and the
  original kept. This runs the real per-post duplicate/delete services.
- `/root/sessions` and `/root/connections` at 1440px: render with data, no console
  errors. Root was granted to the synthetic QA user only for this check, then reverted.
- 390px: no page-level horizontal overflow on all four screens; Posts table scrolls
  inside its panel.

## Not covered

Bulk reschedule and retry in the browser; moderation "Run rules now" against real
comments; the four themes (only the default theme was viewed); keyboard-only runs;
production build (dev server used); MCP calls with real keys; live Facebook.
