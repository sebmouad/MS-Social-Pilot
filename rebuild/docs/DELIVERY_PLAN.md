# Shared delivery plan

Updated 2026-10-21 against local HEAD `1240a9ce`; reviewed merges since `8852d367`.
Goal remains active: [GOAL.md](GOAL.md). Binding target:
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md), unchanged. Current source
and evidence: [ARCHITECTURE.md](ARCHITECTURE.md).

## Position

Owner-recorded cutover occurred 2026-10-20; rebuild serves social.newsgeet.com,
legacy web/worker are recorded disabled, releases use `rebuild/scripts/prod-deploy.sh`
and legacy deployment is guarded. Preserve one publisher and rollback assets.
RELEASE_GATES_PLAN's dated results are evidence, not proof every gate passed or
that every later commit/migration is deployed. This lane made no production calls.

Merged progress since the prior snapshot:

- Root EN/FR catalogs cover Publishing/Inbox/Analytics/Ads/Home/Tasks/Agency, then
  Feeds/Media/Sharing; `configOrDefault` validates runtime/default catalogs and
  display policies, while `configValueOrDefault` checks outer shape. Feeds/Media/
  Sharing service/public errors are localized. Residual strings/policies remain.
- Appearance shell/Settings/session REST/MCP now share confirmed account theme/mode
  persistence, audited writes and Root-lifetime cache cookies; layout falls back
  to validated-session preferences. The former cookie-only gap is superseded.
- Inbox bulk REST exists; Publishing draft aliases/canonical tools/session REST
  share confirmed lifecycle boundaries, and v1 create forwards exact consent.
  The guard maps 238 customer/person and 51 Root tools, with 24 exact protocol/
  authority exceptions. All 48 former private Root REST exemptions are closed;
  workspace create/rename MCP and directory GET exist. Structural mapping does
  not prove service-owned authority/confirmation parity everywhere.
- Recipe source/image/planning and first-day 07:00/11:00 batches (10/10 each with
  comments) are owner-recorded live outcomes; the article link was removed from
  comments by owner request. Date ordering, retry, pause-cancel, pool estimates,
  worker summaries and origin/status badges are newer source/unit slices.
- Live Graph v26.0 post metrics: media views, unique media views, reactions by
  type, clicks and clicks by type accepted; impressions, unique impressions and
  engaged users rejected. Time-window paging fixes are merged. Summary-edge
  reaction mismatch and exhaustive collection remain open.
- Worker fetch-then-write now covers Inbox, Page analytics/history and Ads, with
  write-time binding/access checks. Signal/drain/abort/lease handling exists;
  production stop-time and contention measurements are still needed.
- Recent-table/account data-control audit, supplementary export/delete hooks,
  partial account-export adapters and OAuthCode/profile purge guards exist.
  Public export registration/UI and rehearsal/database proof remain pending.
- Performance migration adds three Posts indexes and one Page-insights index;
  scoped read reuse/request memoization and parallel Home cards reduce redundant
  work in source tests, without measured production speedup.
- Legacy response rounds 1–3 add stored root-comment waits, slowest/business-hours
  measures, period context and historical resolution/reopening cycles, then
  independent comment/conversation and member business-hours breakdowns. All use
  the shared report generator; history/volume/live/download limits remain.

## Next reviewable batches

| Order | Work | Required evidence / owner |
| --- | --- | --- |
| 1 | Reconcile deployed release, migrations and recovery | Release owner checks deployed SHA, target migration/ownership, restorable database/media backup and post-cutover rollback. Check recent purge-gate and read-index migrations explicitly; do not replay cutover or infer application from pinned files |
| 2 | Finish service/transport boundaries | Settings owner wires single MCP selection/disconnect to confirmed wrappers and fixes browser disconnect phrase. Root owner moves workspace identity/limits and directory authority into services, unifies config confirmation/availability and error-resolution policy. Agency/Sharing owners resolve remaining confirmation differences. Run real scoped MCP/client checks |
| 3 | Expose partial account export and prove data controls | Settings owner adds session-only route/MCP registration and bilingual download/error UI; extend parity mappings. Release owner pins supplementary purge gates in rehearsal. Prove recent-table export/erasure, account deletion and trigger concurrency on isolated PostgreSQL; keep coverage explicitly partial |
| 4 | Fix and rerun browser findings | App/auth/module owners fix themed EN/FR 404/error pages and soft statuses, misleading two-step errors, raw failure text, queue/Root activity input loss, calendar contrast and tokenless join. Rerun missing-image and saved-view session feedback fixes. Migrate synthetic preview DB before Feeds checks |
| 5 | Verify scheduling and recipe recovery | Publishing/Feeds/Facebook owners exercise mixed native/app holds, approval, cancel/reschedule, first comments, retry uncertain claims, pause-cancel refused batches and supply exhaustion. Preserve ledger/locks and clean up identifiable test effects; live first batches do not prove recovery |
| 6 | Verify reliability and performance at runtime | Worker owner measures stop/drain versus systemd timeout, DB contention and stale binding/purge races. Database owner applies/reviews index migration, checks query plans and representative volume/timing; retain authorization/resource checks |
| 7 | Complete legacy/provider/configuration scope | Per-module work in LEGACY_CAPABILITY_PARITY; full Facebook collection/metadata, remaining connectors/format eligibility, live mail/security, complete Root/copy controls, report history/scale and actual REST/MCP/provider outcomes with cleanup remain explicit |

## Browser evidence and limits

[BROWSER_MATRIX_2026-10-21.md](BROWSER_MATRIX_2026-10-21.md) records local production-build
Chromium with synthetic PostgreSQL data. Round 1: 992 cells, no overflow after
shared CSS fixes, 176 remaining findings. Round 2: dynamic/session/not-found/empty,
representative system mode, keyboard walks and injected failures; scoped system
and keyboard checks passed, but module/app defects remain. Feeds table was absent.
Neither round verifies production/provider outcomes, every later merge, other
browsers, screen readers or every confirmed write. Historical matrices remain dated.

## Delivery discipline

Current schema version is 111; this documentation lane adds no Root keys and does
not edit registry version. Historical lane instructions to bump old versions are
not current integration work. Recheck current source instead of replaying reports.
Product logic belongs to modules, Facebook rules to its platform, shared hosts
stay neutral. Services own current auth/scope, exact consent and domain audit.
Keep source, automated, browser, provider and production evidence distinct; no
invented completion percentages. Lane authorization: owned documentation only,
no whole suite, servers, deploy, push or production. Leave verified working-tree
changes for integration if Git metadata is outside writable roots.
