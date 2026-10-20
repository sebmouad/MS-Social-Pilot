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

## Wave 3 additions (2026-10-20)

- Open registration end to end in the browser (dev server, `_preview`): with Root
  mail temporarily pointed at a loopback SMTP capture and `auth.openRegistration`
  on, `/sign-up` accepted a synthetic account; a real SMTP message carried the
  one-use link; `/verify-email` confirmed it; sign-in landed in the new owner
  workspace with the connect-channels prompt; the sign-in page showed "Create an
  account" only while open. Afterwards the account, workspace, tokens, sessions and
  email log were deleted and the nine temporary `app_settings` rows removed
  (preview had none before); `/api/auth/register` again reports unavailable.
- Real PostgreSQL: registration (`tests/registration-postgres.integration.test.ts`),
  Root workspace deletion incl. feeds/webhooks, Root account deletion, the automatic
  moderation pass, and the async workspace export lifecycle
  (`tests/workspace-export-postgres.integration.test.ts`, which caught a second
  void-lock defect, fixed in `21fe110d`). `tests/raw-sql-void-guard.test.ts` now
  blocks that defect class statically.
- Not covered: team invitation email acceptance in the browser, Root deletion
  buttons in the browser, themes other than the default, production build.
- Team invitation end to end in the browser: with temporary loopback SMTP and
  `settings.invitationsEnabled`, the owner invited a new address as Contributor;
  the real email's `/join` link let the person create an account and join
  (membership created, email verified, invitation accepted). Copy that wrongly said
  invitees needed an existing account was corrected.
- Root deletion buttons in the browser: the invitee (disabled) was deleted from
  `/root/lifecycle`, then a suspended synthetic workspace; both were gone in the
  database. Wide Root tables keep their documented local horizontal scroll, so the
  Action column can sit past the scroll edge at narrow desktop widths.
- Cleanup: Root grant reverted (one installation owner), invitation, email logs,
  test audit rows and nine temporary `app_settings` rows removed; 111 tables.
- Legacy migration verifier (`scripts/verify-legacy-migration.ts`, Codex) run against
  the synthetic `_preview` database as both source baseline and target: 602 checks,
  601 pass; the one failure is `posts.media_reference_present` (4) because the run
  deliberately used an empty media root, which proves missing restored media is
  detected. Not yet run against a production-shaped restored copy.
- Whole-app browser matrix (`scripts/verify-browser-matrix.ts`, dev server, synthetic
  QA owner, `_preview`): 43 routes × 4 themes × 1440/390 = 328 cells, all completed.
  First clean run found Settings pages broken only by stale untracked drafts (moved out),
  overflow on 3 routes, a console error on /settings/account and 13 routes without a
  verifiable keyboard main action. After round-9 fixes: remaining real finding is
  page-level horizontal overflow on /settings/team (8 cells); /settings/profiles errors
  in that run came from a merge in progress and the route returns 200 now.
- Final browser matrix at `28e3050e` (dev server, synthetic `_preview`, synthetic QA
  owner): **PASS, 328/328 cells**: 41 routes × Grove/Coast/Clay/Nightfall × 1440/390,
  with zero console errors, hydration warnings, page overflow, missing accessible names
  or keyboard main-action/dialog failures. Production build, Root routes and live
  provider data were not part of this run.
