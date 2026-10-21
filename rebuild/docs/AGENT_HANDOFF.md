# Shared agent handoff

Updated 2026-10-21. Documentation truth pass against local HEAD `8852d367`;
`git log --since=2026-10-20 --stat`, lane reports and selected service/transport
source inspected. Earlier batch continuations are superseded by this handoff;
detailed safety/evidence remains in feature documents and Git history. No fresh
production, database, browser or provider observation was made in this lane.

## Required context

Read ARCHITECTURE_CONTRACT.md, ARCHITECTURE.md and GOAL.md; follow DELIVERY_PLAN.md,
LEGACY_CAPABILITY_PARITY.md and MCP_PARITY.md. UI work also reads ../DESIGN.md,
../UX-CONTRACT.md, DESIGN_COMPONENTS.md and CHARTS.md. Migration/release work reads
CUTOVER.md and the results sections of RELEASE_GATES_PLAN.md. The binding target
is unchanged; full objective remains active despite deployment.

## Production facts and limits

Owner-recorded cutover: **2026-10-20 22:09 CEST**, release `5f1e52d7` via
`rebuild/scripts/prod-cutover.sh`; live origin `https://social.newsgeet.com`.
Rebuild web/worker active/enabled; legacy web/worker inactive/disabled. Legacy
release retained at `/srv/ms-social-pilot` for rollback. Use
`rebuild/scripts/prod-deploy.sh` for releases. Legacy `socialpilot-deploy` refuses
while rebuild is enabled, except status or deliberate legacy override.

RELEASE_GATES_PLAN records backup, 34 applied migrations, health, ownership repair,
passkey/storage Root settings, origin repair, imported Meta configuration and
owner Chrome sign-in. `app.publicOrigin` is the proxy-facing same-origin source,
loaded/refreshed process-wide; do not replace it with internal listener URLs.
Do not infer all later commits or migrations deployed from that cutover SHA.
New schema/ownership changes need exact-release backup/restore and target checks.
Last recorded unresolved operations: mail, live Facebook writes, post-cutover
rollback drill, Inbox transaction duration and worker graceful shutdown.

## Integrated changes since the old handoff

- Themes: Vivid, Meta blue, Warm, Clean, each light/dark plus system mode;
  shared Tabler icons, components and lazy ECharts library. Old theme names in
  historical tests do not prove the new palette matrix. Recent screens adopt the
  library; still verify browser/theme/viewport/keyboard/failure flows.
- Publishing: app versus Meta-native scheduling per destination, queue and
  mix/recycle hand-off, REST v1 scheduling and shared MCP; formats/history/retry,
  best-time suggestions and short links are integrated source. Per-destination
  migration/runtime/live checks remain open in PARITY_PUBLISHING_INBOX.md.
- Inbox: nested replies/reviews, quick filters, stored contact/sentiment details,
  bulk moderation, saved replies drawer/limits and shortcuts. Contact REST added
  in `8852d367`; no REST bulk route exists. See module ui/IMPLEMENTATION.md.
- Analytics/Ads: previous-period chart points, hierarchy/audience/post charts,
  reports/download polish and shared session REST/MCP; key REST v1 now exposes
  their declared operations via the MCP host. See INTEGRATIONS.md and
  PARITY_ANALYTICS_ADS_SETTINGS.md; mocked transports are not live evidence.
- Settings: account security/session/key tools, appearance, team/invitation/UI
  refinements; confirmed batch selection REST/UI now use the module wrapper.
  OAuth compatibility startup now delegates to `connectionStartHttp` too.
  Remaining confirmation and global appearance gaps are in MCP_PARITY.md.
- Agency overview person credentials, session Clients/workspace switching,
  Tasks confirmed writes, Root registration MCP, Root refresh and
  disconnect-with-delete exist; do not repeat earlier missing-source claims.
- AI: OpenAI/Gemini/Anthropic adapters with Root provider settings. Recorded live
  OpenAI/Gemini success; Anthropic blocked on account credit. Recap/sentiment
  automation still needs scope-specific runtime evidence.
- Feeds: WordPress recipe planner with read-only source, caption/image/recipe
  mapping, JPEG conversion, canonical first comment, timezone slots, distinct
  recipes/cooldown and uncertain-outcome ledger; UI/REST/MCP. Defaults disabled,
  new source paused. `mysql2` lockfile integrated in `b940fad9`. FEEDS.md's older
  lockfile warning is superseded, not proof of database/live execution.
- Facebook: resumable Page history, independent failed metrics, reactions,
  hierarchy/action breakdowns and tenant/target history cursor table. The
  supplied three-post/twelve-month result is one Page, not exhaustiveness proof;
  replacement metric candidates are unverified. See FACEBOOK_DATA_COVERAGE.md.
- Root literal work: registry104 in local HEAD; large policy/copy extraction and
  OAuth body/reschedule/recovery follow-ups integrated. Remaining literals,
  inactive metadata and browser/snapshot limitations remain in CONFIG_LITERAL_AUDIT.md.

## Next actions and safeguards

1. Integration owner verifies deployed SHA and target migration state, especially
   `20261031100000_rebuild_destination_schedule_mode`,
   `20261031120000_rebuild_facebook_sync_cursors` and
   `20261031140000_rebuild_wordpress_sources`. Pinned does not mean applied.
2. Add thin Inbox REST bulk surface calling `bulkInboxAction`; reconcile Settings
   selection/disconnect and Sharing/Agency confirmation differences. Do not
   broaden session-only or overview-only credentials to claim parity.
3. Unify shell appearance with the Settings service, finish runtime copy/policy
   consumers and metadata, then run current synthetic UI/browser checks.
4. Verify mixed scheduling, recipe planning and cursor/export/erasure behavior
   on isolated databases; then eligible live provider/MCP outcomes with cleanup.
5. Complete the legacy capability inventory and release evidence at actual scope.
   Preserve unresolved photo-canary ledger/Page lock; never infer absence from
   Graph100/sub33 or retry held remote effects blindly. Keep one publisher.

## Documentation follow-up outside this lane

- RELEASE_GATES_PLAN.md: reconcile the original “nothing run/legacy production”
  introduction and old go/no-go assumptions with its own cutover/results log;
  retain actual unresolved gates and recorded evidence.
- FEEDS.md: remove the stale legacy-production status and recipe lockfile warning;
  `b940fad9` integrated the dependency lockfile. Preserve real source/runtime gaps.
- PARITY_PUBLISHING_INBOX.md: add latest Inbox details/bulk/filter rows, marking
  contact REST present and bulk REST absent; retain scheduling verification limits.
- PARITY_ANALYTICS_ADS_SETTINGS.md: mark OAuth compatibility and batch-selection
  REST/UI wiring done; add current account-security surfaces, preserve remaining
  single-selection/disconnect and shell appearance differences.
- CONFIG_LITERAL_AUDIT.md: mark merged worker/publication prose historical;
  owning Integrations config still needs active metadata for the two now-consumed
  OAuth consent settings. Generalize the REST JSON-byte cap label beyond Posts.
- DESIGN.md / UX-CONTRACT.md: reconcile older English-only/previous-theme-era
  statements with current bilingual catalogs without claiming full localization
  or browser proof. Feature reports remain authoritative for their tested scope.

The current worker owns only the seven assigned status docs (CUTOVER status
sections only). No new Root keys/schema-version edits, source edits, migrations,
servers, whole suite, deploy, push or production calls. Pre-existing untracked
`node_modules` and `rebuild/node_modules` links are not task changes. Linked Git
metadata is outside writable roots; leave documentation changes for the integrator.
Verification: `npx tsc --noEmit -p .` passed with zero errors; `git diff --check`
passed. Local Markdown links resolve, all 20 legacy inventory rows are retained,
and CUTOVER procedures/dated history outside the status sections match HEAD.
No test files changed or were added, so targeted Vitest was not applicable.
No feature-runtime verification is implied by this documentation/type check.
