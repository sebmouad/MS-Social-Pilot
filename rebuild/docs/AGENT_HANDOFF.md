# Shared agent handoff

Updated 2026-10-21 against local HEAD `1240a9ce`, reviewing
`git log 8852d367..HEAD --stat`, lane reports and selected current service/transport
source. This supersedes the previous `8852d367` continuation. The binding contract
is unchanged; the full goal remains active. No fresh database, browser, provider
or production observation was made by this documentation worker.

## Required context

Read ARCHITECTURE_CONTRACT.md, ARCHITECTURE.md and GOAL.md; follow DELIVERY_PLAN.md,
LEGACY_CAPABILITY_PARITY.md and MCP_PARITY.md. UI work reads ../DESIGN.md and
../UX-CONTRACT.md; migration/release work reads CUTOVER.md and the dated results
in RELEASE_GATES_PLAN.md. Revalidate deployed SHA and migration ownership before
release work; source and historical receipts do not identify current deployment.

## Production record

Owner cutover: 2026-10-20 22:09 CEST, release `5f1e52d7`, via
`rebuild/scripts/prod-cutover.sh`, origin https://social.newsgeet.com. Rebuild
web/worker recorded active/enabled; legacy inactive/disabled, retained for rollback
at `/srv/ms-social-pilot`. Releases use `rebuild/scripts/prod-deploy.sh`; legacy
`socialpilot-deploy` is guarded. Keep one publisher. `app.publicOrigin` is the
proxy-facing same-origin source; do not substitute internal listener addresses.

The dated release log records backup/migrations/ownership repair, owner sign-in,
AI checks and Chrome sweep, then MariaDB read-only access, image/JPEG storage and
80 planned recipe posts across 10 Pages. First live 07:00 Europe/Paris batch:
10/10 published, 10/10 comments, one Page inspected in owner browser. The current
owner task report also records first-day 11:00: 10/10 with comments. The original
comment included an article preview; the owner subsequently removed the link.
`2e23223a` records backed-up/audited updates to 80 scheduled comments and changes
truncation to preserve a link only when the template contains `{link}`. Do not
restore that link based on old prose or equate planning with delivery.

Live Graph v26.0 post-insights probe accepts `post_media_view`,
`post_total_media_view_unique`, `post_reactions_by_type_total`, `post_clicks`,
`post_clicks_by_type`; rejects `post_impressions`, `post_impressions_unique`,
`post_engaged_users`. `63207a7c`/`954e80cb` fix time-window paging. Recorded probe:
no failures, views/unique 3, one like; summary edge 0 versus insight 1 remains
unexplained (lag is a hypothesis). This is limited eligibility evidence, not full
history/metric coverage. OpenAI/Gemini have earlier limited live success;
Anthropic was blocked by account credit. Mail/rollback/live recovery remain open.

## Integrated source and automated scope

- Copy (`38ab34f4`, `fb42b056`, `93944199`, `5e6841ee`): typed Root EN/FR catalogs
  across Publishing, Inbox, Analytics, Ads, Home, Tasks, Agency, Feeds, Media and
  Sharing; last three include service/public error localization. `configOrDefault`
  validates runtime or registry default; `configValueOrDefault` checks outer shape
  only. Residual literals/prompts/dynamic labels and stale OAuth metadata remain
  in CONFIG_LITERAL_AUDIT. Schema version is now **111**, not 104–110.
- Appearance (`2b42470b`): global shell and Settings save through confirmed
  appearance service; theme in users, mode under exact account key, transaction
  audit, Root-lifetime cookie cache and validated-session fallback in layout.
  Former direct-cookie/cookie-only missing-source claims are superseded.
- Parity (`f5c21c96`, `acb56bd7`, `e105bff5`, `8f423ec7`): Inbox bulk REST exists;
  draft aliases and canonical session REST/MCP share api-writes lifecycle, and
  v1 create now requires exact CREATE POST consent. Guard checks 238 customer/
  person tools plus 51 Root tools and resource mappings. All 48 former Root
  exceptions removed; 24 exact auth/protocol exceptions remain. Root create/
  rename MCP and workspace directory GET added. Inventory closure does not prove
  all services own identity/limits/confirmation; follow MCP_PARITY boundary list.
- Recipes (`d68fc5c1`, `e43d16d2`, `6c2b7a6f`): date/ID order, retry/reconciliation,
  pause-cancel via Publishing, cached pool estimates, worker summaries, origin
  badges/filters, Feeds sidebar link, bilingual status/supply/next-time card and
  Root visibility bounds. Fake/unit/render evidence for follow-ups, not live
  recovery. Refused first cancel batches can starve later posts; slot matching
  can accept manual posts or miss cancelled drafts. Preserve uncertain ledgers.
- Reliability (`e0584777`, `d511e39c`): Facebook Inbox, Page analytics/history and
  Ads fetch outside locked writes; current binding/access/purge rechecks before
  persistence. Signals stop claims, request safe stops, drain with Root grace/
  poll settings, then abort/release abandoned leases. Unit evidence supersedes
  missing-source reports; production stop duration/systemd/DB contention unproven.
- Data (`4b13204b`, `83b26ba9`): recent-table ownership catalog and explicit OAuth/
  profile/account hooks, exact appearance cleanup, Root/unverified deletion hooks.
  Partial account export service/HTTP/MCP adapters exist but are **unregistered**:
  no public GET, installed group or customer control. Supplementary purge migration
  `20261031150000_rebuild_supplementary_purge_gates` needs rehearsal pins and
  PostgreSQL proof. Optional database tests skipped in lane; no complete export.
- Performance (`245683ce`): migration `20261031160000_rebuild_read_path_indexes`
  under root prisma/migrations adds three Posts and one Page-insights indexes;
  Analytics exact-scope read reuse/request limits, Publishing adapter reuse and
  parallel Home cards/channel histories. Source/query-shape tests only; no applied
  target receipt, EXPLAIN/volume/timing evidence or measured production gain.
- Legacy (`23b7be84`, `6ef753e4`, `b725c415`): response reports add stored root-
  comment replies/slowest and business-hour response/resolution, pre-period
  context and audited historical reopen/resolve cycles, then source-specific
  comment/conversation shares/durations and member business-hour medians. Same
  UI/REST/MCP report workflow, bilingual artifacts, unknown/zero and partial-history
  semantics; unit/mocked evidence, no complete provider history/live downloads.
- Responsive/CSS (`78493189`, `eff49d35`, `4cccd55f`): shared phone layout, border-
  box, sidebar contrast, hidden-table overflow and Home/calendar contrast fixes.
  `6fb0e57f` fixes Ads client directive and guards top-level directives.
  `36946d9e` adds missing-image fallback and saved-view expired-session feedback;
  those latest fixes have unit evidence without a browser rerun.

## Browser evidence, not an all-green gate

BROWSER_MATRIX_2026-10-21 records Chromium/local production build/synthetic preview
PostgreSQL. Round 1: 992/992 cells across four themes × light/dark × desktop/phone,
41 customer/16 Root/five public pages. Final run has no overflow/name/theme/status
failures but 176 findings. Round 2 adds dynamic (160), states (176), not-found
(128), empty (656), system (768), keyboard (656 + 672) and failure (640) cells.
Scoped system-mode comparisons/live changes and keyboard walks passed; 121
injected-failure probes preserved input/dialogs. Calendar contrast still fails
in some combinations after the earlier fix. No recipe table in preview: Feeds
paths not exercised. Read the report for exact routes/checks rather than summing
cells into a completion percentage.

Unresolved findings: soft/default unthemed English-only 404/error pages, misleading
two-step failure, raw server errors, lost queue/Root activity input, calendar
contrast, tokenless join and synthetic share-media 404s. Saved-view/session and
missing-image fixes need rerun. Firefox/Safari, screen readers, long content,
server-rendered 500s, confirmed provider forms and every later merge stay outside
this evidence. Historical production Chrome and WAVE1 checks retain their dates.

## Next actions / edits outside this documentation lane

1. Release owner verifies exact deployed SHA/migrations/ownership, restorable
   backup/media and post-cutover rollback, plus worker/systemd shutdown timing.
2. Settings callers: single-selection MCP must call `changeConnectionSelections`,
   disconnect MCP `changeConnectionDisconnect`; browser manager must send exact
   retain/delete-related-data phrase. Root workspace services must own current
   identity/limits; directory must accept/check actor. Unify Root config consent/
   availability and error-resolution policy; resolve Agency/Sharing differences.
3. Expose partial account export: add GET `src/app/api/settings/account/export/route.ts`
   calling `accountHttp(request, 'export')`; register `ACCOUNT_EXPORT_MCP` in
   Settings mcp.ts; add Root EN/FR download/coverage/error UI and broaden archive
   byte-setting description. Extend MCP_PARITY mappings/guard when installed.
   Pin supplementary purge gates/checksum/functions in cutover rehearsal as
   specified in `src/server/data-control/README.md`. Prove isolated PostgreSQL
   triggers/deletion/export and concurrency; no secrets in artifacts.
4. App/auth/module owners fix browser findings and rerun synthetic matrix on a
   migrated preview DB, including Feeds and latest media/session fixes. Verify
   cross-device appearance and report downloads separately.
5. Integration owner tests mixed scheduling and recipe retry/pause/recovery,
   metrics/history, live REST/MCP scope, provider outcomes/cleanup and index plans/
   volume. Preserve unresolved photo-canary ledger/Page lock; failed Graph lookup
   is not absence proof. Unknown remote effects must not be blindly resent.
6. Documentation outside ownership: FEEDS.md and RELEASE_GATES_PLAN.md need the
   owner's 11:00 batch and link-removal outcome, plus recipe visibility/retry status;
   retain original linked-comment observation as history. CONFIG_LITERAL_AUDIT
   needs latest catalogs/error localization and residual review. Existing legacy
   round narratives contain historical bump instructions; version 111 is current.
   PARITY_PUBLISHING_INBOX needs confirmed draft/v1 update; operation docs should
   add data gates/read-index migration status without claiming target application.

## Current lane validation

Only the six assigned docs are owned; LEGACY_CAPABILITY_PARITY changes are limited
to existing Rebuild state cells. No contract, registry, source/test, migration,
server, deploy, push or production edits/calls. No new Root keys. Pre-existing
untracked node_modules and rebuild/node_modules links are not task changes.
Validation from rebuild/: `npx tsc --noEmit -p .` passed, zero errors;
`npx vitest run tests/parity-guard.test.ts --no-cache` passed, 21 tests / one file.
`git diff --check` passed. Local Markdown link targets resolve; a comparison to
HEAD confirms all 21 legacy inventory rows and all non-status text are unchanged.
Exactly the six owned documents changed; ARCHITECTURE_CONTRACT is unchanged.
No tests were edited/added, no whole suite or runtime verification was performed.
Linked Git metadata resolves outside writable roots to the primary checkout's
.git/worktrees/msp-docs3; commits cannot be written in this sandbox. Changes remain
uncommitted in this worktree for integration; nothing was pushed.
