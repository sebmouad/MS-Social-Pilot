# Ads parity: comparison, directory and management (W3)

Status: **integrated stored reports, durable object/creation services and stored-image creative creation, with scoped mocked verification; incomplete browser/database/live-provider/release coverage.** Management is off by default. The current proof and remaining gaps are recorded below. Target: [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md).

Updated 2026-10-21 against HEAD `ffdb1cdf` (schema **118**). The owner/integrator
records this release as deployed and `20261031180000_rebuild_ads_ad_creation` as
applied in production; this documentation lane made no production calls and has
no fresh migration receipt. Earlier batch sections below retain their dated scope;
the current status here supersedes their local-only/application-pending statements.

## Current ledger, runtime copy and recovery status

- **Ledger gap closed in source:** root migration
  `prisma/migrations/20261031180000_rebuild_ads_ad_creation/migration.sql` extends
  `ads_operations_operation_kind` to accept `ad.create`. SHA-256:
  `1769fa24129e6d74119e84d0677a2baf0c935cb73a4e722ae0a443b7fbc7120f`.
  Source/checksum tests (`ads-ad-create-migration`) and mocked creation/recovery
  tests are distinct from the owner's production-application record. An exact
  database CHECK/history receipt and the cutover-rehearsal allowlist, checksum,
  history-refusal parameters and post-apply probe remain follow-up work.
- **Runtime copy wired at host level:** `configuredOperations(locale)` resolves
  Root `meta.adsCopy` through the neutral platform host into a request-local
  engine. Factory failures fail closed. UI/REST/MCP entry points still default to
  English because they do not pass the customer locale; creation-form consent
  templates must also agree with the live management preview.
- **Round 9 scoped recovery authorization:** `resolveAdsOperation` checks current
  account visibility before revealing state/confirmation, intersects membership
  channel scope and key target/account ceilings, and checks a creative's exact
  target. It repeats manager authorization and visibility after acquiring the
  account/ledger locks, before compare-and-set settlement and audit. Retained
  disabled/invalidated accounts remain eligible for local attestation without
  provider grants or a remote call. Fakes in `ads-parity-management.test.ts` cover
  pending/uncertain operations, scope/role revocation while waiting, empty
  credential ceilings and invisible-account disclosure refusal. This is not
  PostgreSQL concurrency, real-client or live-provider evidence.
- **Remaining policy distinction:** creation of ad sets/ads requires unrestricted
  channel scope; recovery permits a limited administrator whose current scope
  reaches a target on the account connection (the round 9 tests explicitly allow
  it). It does not repeat the creation-only unrestricted check. Do not describe
  this as full creation/recovery policy equivalence; reconcile that policy with
  the owning service/README before declaring parity complete.
- Management remains off by default; live `ads_management` grant, paused creation,
  edits, recovery, remote outcome verification and cleanup remain unproven.
  Browser round 5 covers local synthetic Ads routes only, before rounds 6–9;
  it is not management-write or current-copy browser evidence.

## What exists

| Area | Path | Notes |
| --- | --- | --- |
| Pure analysis | `src/modules/ads/analysis/metrics.ts` | Totals recomputed from additive flows; ratios never averaged; reach never totalled; unknown is `null`; findings with sample-size gates; sort with nulls last; freshness; previous-window math. |
| Comparison service | `analysis/server.ts` | Previous-period or across-accounts comparison, daily trend, findings, sorted objects. One group per currency (currencies never summed). Uses `authorizeAdsRead` and `getAdsDataset` (selected, scoped accounts only). Reports whether account-level totals are actually available; if only object rows exist, those remain visible with a clear missing-account-aggregate state and object-row freshness. |
| Directory | `src/modules/ads/directory/server.ts` | Campaign/ad set/ad browsing from stored rows with search, sort, paging, parent filter via optional neutral provider resolver, last delivery day, freshness; object detail with best-effort live status and optional management metadata. Scoped stored detail remains usable without management host/config/table, with change actions and history hidden. |
| Management | `src/modules/ads/management/{types,registry,server,config,mcp}.ts` | Neutral operations (`status.set`, `budget.set`, `rename`, `creative.assign`, `delete`), module-owned exact confirmations, durable ledger, resolution, creative browsing. |
| Facebook | `src/platforms/facebook/ads-ops/{index,transport}.ts` | Implements all five operations plus `listCreatives`. Signed Graph form writes; ownership read-before-write; definite-rejection classification. |
| API | `src/app/api/ads/{compare,directory,management}/route.ts` | Thin, same-origin POSTs, no-store. |
| UI | `src/app/ads/compare`, `src/app/ads/objects` | Filters in the sidebar; confirmation dialog; change history with resolve. |
| MCP | `analysis/mcp.ts`, `directory/mcp.ts`, `management/mcp.ts` | Definitions and executors dispatched by the authenticated central MCP host with feature/write gates. |
| Config | `analysis/config.ts` (`ads.analysisPolicy`), `management/config.ts` (`ads.managementPolicy`) | Registered Root policies, validated and consumed. |

Directory management reads use `directory/management-port.ts`, an optional neutral registration boundary. It defaults to absent; the host should register describe/history callbacks only after its management engine and journal are ready. UI report reads and object details do not import management services.

## Write safety

1. Caller must be an active owner/admin with `ads/campaigns` write, entitlement, channel scope, platform capability, ready module, grants, and `ads.managementEnabled`.
2. Operation must be advertised by the account's module for that object type; the object must exist in the account's stored insights.
3. Caller repeats the exact confirmation produced by the module (`preview`). Spend-changing operations are flagged.
4. A `pending` ledger row is inserted **before** the remote call. A partial unique index allows one open (`pending`/`uncertain`) row per object, so a second change is refused (`conflict`) until resolved, and the provider is not contacted.
5. After the call: success -> `succeeded` + audit in one transaction; definite rejection (no write sent, or an explicit Graph rejection code) -> `rejected`; everything else (timeout, 5xx, uncoded 4xx, unreadable or unconfirmed 200) -> `uncertain`. No automatic retry anywhere.
6. Unknown outcomes require explicit human attestation. Orphaned pending rows use a distinct RECOVER confirmation and can settle only while holding the same account lock as dispatch; an in-flight dispatch refuses recovery. Dispatch rechecks ledger state under that lock before sending. No age-based release or automatic provider retry exists. History and recovery include retained disabled accounts under current workspace/key scope.
7. Settlement and resolution are compare-and-set inside one interactive transaction: `UPDATE ... WHERE status = <expected>` must affect exactly one row before the audit row is written in the same transaction; zero rows means no audit, no overwrite of later evidence, and an honest `recorded: false` / `conflict` result. Mocked only; unexecuted against Postgres.

8. Root-managed bounds (`ads.managementPolicy`: `nameMaxCharacters`, `maxBudgetMinor`, page sizes) are loaded for every preview/apply and enforced in shared code before the module's own validation; the module receives them as `AdsOpsLimits` and may only be stricter (Facebook keeps its 100-character protocol ceiling). An unreadable policy fails closed before the ledger insert and provider call. `maxBudgetMinor` is a typo guard for one confirmed change, not a platform limit.
9. A module classifier that throws, or returns anything other than `rejected`, is recorded as `uncertain` (held), never as an unrecorded exception.
10. Preview returns `blockedByOpenChange` (true/false, or null when the ledger cannot be read), `spendChanging` and `irreversible` so callers can warn before the confirmation step. Capabilities return neutral per-operation `inputs` (choice, money-minor with budget kinds, text, creative-ref) and the active `limits`, so shared UI/MCP render forms without provider knowledge; the Facebook module alone fills them.

Request identities bind to a normalized payload hash. Replays return the recorded outcome without sending another provider write; changed payloads under an existing identity are refused. Pending/uncertain creations retain their hold. A human attestation is not a provider receipt and does not assert a remote identity or current paused state.

## Initial ledger migration (historical local-preview record)

Canonical migration: `prisma/migrations/20261018170000_rebuild_ads_operations/migration.sql` in the application repository. It includes immutable request identity/hash, per-actor request uniqueness, the open-object hold and resolution-shape constraints. Do not apply older proposal SQL from worker handoffs.


Without this table every write fails closed (`unavailable`) before any provider call.

## Historical host wiring (batches 74–75; superseded above)

- Published registry 67 includes analysis and management policies; pending creation integration adds version 68. Management stays off by default.
- Facebook-owned host assembly provides its optional neutral object-operations engine.
- Shared service paths back the Objects/Campaigns UI, management HTTP API and MCP tools.
- The older status/budget API/MCP shape delegates to the same durable service.
- The checksum-pinned additive ledger migration is in the cutover allowlist; it has been applied only to local preview after backup/scratch verification.
- Campaign/ad-set and creative creation share the durable journal; the 2026-10-20 creative checkpoint below adds independently committed remote receipts. Database/browser/provider evidence and release cutover remain pending.

## Limitations

- Worker handoffs were independently verified and integrated; see the current verification scope below. Mocked tests do not establish provider approval or live behavior.

- Stored data only; no new sync. Previous-period coverage is shown via day counts and "no earlier data", not a sync-window check. Comparison totals and daily trends require account-level insight rows; when those rows are missing, the UI shows object evidence while stating account totals are unavailable.
- Directory parent links depend on `campaign_id`/`adset_id` being present in stored row fields.
- Creative support creates unattached image/link creatives from stored workspace images and assigns existing account creatives to ads. Editing creative content, automatic orphan cleanup and live-provider verification remain open. Assignment is spend changing because it may affect a delivering ad.
- Facebook `delete` posts `status=DELETED` (irreversible) -- confirmed by text only; campaign budgets apply only to budget-owning campaigns, otherwise Graph rejects.
- No live Facebook call or spend belongs to the report/export work. Stored comparison object trends/deltas and findings CSV are implemented in the local coverage update below; browser/provider/release evidence remains separate.


## Batch 74 historical integration record (2026-10-18)

The platform host has a neutral optional operations engine, assembled inside
Facebook. Root registers `ads.managementPolicy` (schema 67); management remains
off by default. Object details, neutral metadata/limits, reviewed changes,
creatives and history use shared services. API/MCP paths pass request identity
and scope; older status/budget API and MCP shapes now delegate to the same ledger.
At batch 74, campaign/ad-set creation remained on a separate path. Batch 75 below
records its ongoing durable integration; live/provider/release proof remains open.

Request IDs bind workspace, actor, account and normalized payload. Pending intent
commits before dispatch. Dispatch and recovery serialize through the selected
account lock; dispatch rechecks pending state and current authority. A pending
record can be explicitly recovered only after acquiring that lock, so an active
dispatch refuses recovery. History/attestation covers retained disabled accounts.
Connection deletion refuses unsettled operations. No operation is auto-retried
after an ambiguous outcome. A terminal not-applied replay releases the UI hold
without sending; a new explicit preview is required for a new request identity.

The ledger migration was fresh-backup/scratch-restored and scratch-applied before
local preview application, preserving legacy counts/settings. Three actual local
PostgreSQL tests pass for request uniqueness, uncertain holds/retained receipts,
active-dispatch lock exclusion, tenant lock independence and subsequent recovery
lock acquisition. Fixtures rolled back. These do not prove end-to-end HTTP/MCP,
full service concurrency, live Facebook operations or production rollback.
Focused service/transport/UI/MCP tests and typecheck pass at their recorded scope;
the broader provider-write/browser/release checks remain pending (isolated suite/build and read-only browser evidence are recorded below). No provider
or production write belongs to this batch so far. Keep unrelated slices excluded.


### Batch 74 verification update

The isolated snapshot passed 2,284 tests across 288 files, production build and
serial typecheck. Chrome verified desktop object details with unavailable writes
hidden. A 390px phone check exposed intrinsic grid expansion (676px layout);
the shared one-column page grid now uses `minmax(0, 1fr)` and `min-width:0`.
Chrome then measured 390px page/client/scroll width and a 320px table viewport.
The final CSS snapshot passed its rebuilt production build and serial typecheck.

`scripts/verify-ads-recovery.ts` passed actual synthetic HTTP/MCP/PostgreSQL
history, read-only/confirmation/foreign-ID refusals, pending recovery and uncertain
attestation after local account disable/invalidation, stored outcomes and operator
audits, and feature-off refusal. Both tenants, users, resources, keys, sessions,
operation rows and both audit stores were cleaned; five captured Root settings
were restored exactly. A private recovery ledger precedes fixture/settings writes.
An initial probe queried the wrong audit store; two orphan disposable audit rows
were subsequently removed with exact action/prefix/missing-workspace guards. The
corrected final probe verifies both stores. This is not arbitrary-kill recovery
proof or end-to-end provider mutation/status verification. Management remained
disabled throughout the probe. Live spend-changing operations, creative creation,
complete creation journaling and the wider Facebook/release gates remain open.

## Batch 75 — creation integration (validation in progress)

Campaign/ad-set creation now uses the same durable Ads ledger and selected-account
lock as object edits. Facebook creates paused objects; ad sets additionally require
unrestricted resource scope and stored plus live parent-account ownership checks.
UI, HTTP and MCP carry stable request identities. Unknown responses keep input and
hold the request; human attestations are presented without claiming remote creation.
Root `meta.adsCreationUi` validates current labels, supported objective/goal subsets,
defaults and name bounds. Confirmation protocol templates remain module invariants.

The eleventh checksum-pinned migration extends operation kinds. A fresh local
preview backup restored and migrated successfully before preview application;
legacy user/workspace/post counts and settings digest matched. This does not prove
a full production-shaped eleven-migration cutover or live Ads creation. Production
is unchanged. Full-suite/build/review results will be recorded after completion.

Batch 75 actual local HTTP/MCP probe verified creation pending recovery and
uncertain attestation without invented remote creation receipts, alongside
read-only/incorrect-confirmation/foreign-ID refusals, retained-account access,
audit persistence and feature-off behavior. Both synthetic workspaces and all
fixtures were removed; exact prior Root settings were restored and verified.
No provider operation was sent. This is recovery evidence, not live creation.

Creation request identity (follow-up hardening, source and mocked/jsdom tests only; the
tests were not executed in the editing session). A reviewed creation keeps one request id and a
count of how many times it was sent, persisted per user, workspace and account (or campaign) in
the tab's session storage. A refusal marked `attempt: "not_dispatched"` describes that single
send only; it is not proof that an earlier send of the same id was never recorded. The form
releases an identity on such a refusal only when that was its first and only send. Any
identity sent more than once, or restored after a reload, stays held until a recorded
terminal result (success, rejected, or an attested resolution). An intent commit that fails
with an unobserved outcome carries no marker. HTTP and MCP failures carry the same marker
(MCP `apply_ads_change` documents it); a replayed success says the object was created paused
and that its delivery status may have changed. Still open: durable server-side lookup of
history by request id, real browser proof and live provider creation.

### Batch 75 verified scope — 2026-10-18

Final isolated runtime snapshot passed 2346 tests across 291 files with no skips,
including guarded PostgreSQL integration, plus production build and serial
typecheck. Subsequent visual-only shared button/theme corrections passed focused
UI regressions (25 tests), followed by a passing production build and serial typecheck.
Chrome at 390px confirmed required-field focus/validation, dialog focus containment,
Escape cancellation with input retained, an offline send held without HTTP/provider
write, and reload restoring the original disabled request/input. Desktop 1440px
retained two sidebars without page overflow. Ad-set review displayed USD 12.50,
country and goal correctly. Four-theme creation-form text contrast measured at
least 11.87:1. Undefined surface/border tokens were replaced with shared tokens;
creation and dialog actions use shared button classes. Nightfall dialog was
visually inspected after the correction. Fake-credential-only UI settings were
captured privately and restored byte-for-byte in their stored representation.

Browser request storage is scoped by user/workspace/account/kind/parent. A write
is refused before fetch if storage cannot retain its identity. After a lost
response, later per-send refusals cannot release the held original identity;
only recorded terminal outcomes clear it. Replayed creation receipts report the
historical creation without promising current delivery status. Clearing browser
storage or starting an independent tab does not deduplicate a new intentional
request; callers must preserve requestId and inspect history after uncertainty.
Live campaign/ad-set writes, creative creation, complete provider capability
coverage and production data/media/service rollback remain unverified.

## Legacy read/report parity — wave 2 (Session B)

Compared legacy `ads/page.tsx`, `ads-analysis.ts` and `messages/{en,fr}` with the module. Already present before this batch: sortable objects (nulls last), freshness, findings, previous-period deltas, one group per currency, per-day trend and the stored-row CSV (`/api/ads/report/export`).

Added (read-only, stored data, no provider call, no new setting; the CSV reuses `ads.exportMaxBytes` and `ads.exportFileName`):

| Item | Where |
| --- | --- |
| Share of spend per object, CPM and peak-day reach columns, per-object and account action totals | `analysis/server.ts`, `analysis/metrics.ts` (`spendSharePercent`, `sumActions`, `peakReach`) |
| Last-synced time per account and stored data coverage (first/last day) | `analysis/server.ts`, Compare screen |
| Comparison CSV export (HTTP `?format=csv`; MCP `compare_ads_performance` with `format: "csv"`) | `analysis/csv.ts`, `exportAdsComparison`, `api/ads/compare/route.ts`, `analysis/mcp.ts` |
| en/fr copy catalog; Compare screen follows `Accept-Language` | `analysis/copy.ts` (`adsCopy`, `adsText`), `ui/compare/CompareScreen.tsx` |

Reach stays a peak single day, never a sum; unknown figures are empty or "Unknown", never zero. Tests: `tests/ads-comparison-parity.test.ts` (mocked data only: no PostgreSQL, browser or live provider run).

Still open versus legacy: parent campaign name column for ad sets and ads (stored rows carry no parent name; needs a Facebook-owned resolver), clickable column-header sorting (sorting is by sidebar select), spend-share and daily charts (tables only), en/fr copy for the Campaigns/Objects/Directory screens, and a browser check of the Compare screen (four themes, 1440px/390px). The MCP csv result is capped by row count only.

## Local report/export coverage — 2026-10-20

Legacy review: `src/app/(app)/ads/page.tsx` exposes account/date-scoped CSV,
level selection, sorting, account trends and previous-window KPIs; `src/lib/ads-analysis.ts`
produces threshold-gated findings. The rebuild already had a comparison CSV, but
it exported only the display slice and omitted object baselines, deltas, daily
trends and findings.

`analysis/server.ts` now exports every matching campaign, ad set or ad within the
existing stored report row ceiling (`ads.reportMaxRows` per dataset query), independent
of the interactive `ads.analysisPolicy.maxObjects` display cap. Export reads include
previous-period rows for the selected object level; interactive reports retain their
account-only baseline query. Object identities include account and object ID. The
CSV adds previous values, percentage changes for spend/impressions/clicks/CTR/CPC/CPM,
and `daily_trend_json` (stored days only, recomputed ratios). Missing scalar values
are **Not available**; unknown JSON ratio values remain null. A zero baseline has
no percentage change. Previous-only objects are not invented as current zero rows.
Reach remains highest single day, and currencies remain separate.

UI downloads, `GET /api/ads/compare?format=csv`, and MCP
`compare_ads_performance` with `format: "csv"` share `exportAdsComparison`.
They accept the same report filters and current Ads read authorization, selected
resources and credential account/channel scope. `exportKind: "findings"` selects
a separate CSV with group/currency/account IDs, level, current/previous ranges,
finding key, tone, parameters and localized message; `locale` accepts `en` or `fr`
(default `en`). HTTP uses query parameters with the same names. Export options
are rejected for JSON requests. The comparison screen exposes both downloads
with shared Button/RouteNotice components, en/fr pending/success/error copy and its
current filters. Refused downloads retain those filters; response format, filename
and byte receipts are checked before download, and obsolete requests are aborted. No provider calls were added.

Both exports refuse the complete request above `ads.exportMaxBytes`, measured in
UTF-8 including headers. Text cells use existing spreadsheet escaping. MCP applies
its credential row ceiling, including nested object trends for object exports.
Existing `ads.exportFileName` supplies the filename stem. **No new Root keys.**

Local verification from `rebuild/`:

- `npx vitest run --config src/modules/ads/analysis/export.vitest.config.ts src/modules/ads/analysis/export.test.ts src/modules/ads/analysis/export-ui.test.ts tests/ads tests/raw-sql-void-guard.test.ts` — **359 passed, 5 skipped** (33 passing files, one skipped database integration file).
- `npx tsc --noEmit -p .` — passed.
- Full suite with the module config — **3,538 passed, 220 skipped** (366 passing
  files), before the final four download UI tests; those four passed in the final
  targeted run above.

Module-local regression tests/config stay within the assigned Ads ownership boundary.
The dedicated Vitest config includes those fixtures plus the normal repository tests.
This is mocked service/HTTP/MCP and automated UI regression evidence only. No server,
live provider, browser, production or PostgreSQL integration run was performed.
Stored windows are bounded queries, not an atomic snapshot across requests. Async
exports, live freshness/sync proof, broader management/creative parity and release
gates remain open.


## Stored-image creative creation — 2026-10-20 (`codex/ads-creative`)

`creative.create` is a neutral, strictly parsed operation: `objectType: creative`,
name, selected `targetId`, stored workspace `mediaId`, `format: image|link`, message,
title, and an HTTPS destination for link creatives. It accepts no delivery status,
remote channel identity, image URL or account credentials. The selected account's
operations host validates and maps it; all Facebook protocol rules stay in
`src/platforms/facebook/ads-ops/{index,creative}.ts`.

UI (`CampaignsScreen` / `CreativeCreateForm`), HTTP (`/api/ads/management`) and MCP
(`preview_ads_change` / `apply_ads_change`) call the same management service.
`list_ads_creative_sources` and HTTP `view=creative-sources` return paged selected
channels and stored images, with resource/key ceilings and private preview reads.
The form uses shared validation, Button, AutoTextarea and `useConfirm`, with en/fr
copy, retained failed input, typed exact confirmation and no automatic resend.
A reviewed request is saved per user/workspace/account before sending; reload and
lost responses keep its original identity and payload. Successful replays do not
claim current delivery state. Unpersisted settlement stays held; human attestation
never invents a creative identity. Exact Facebook confirmations bind all creative
content through a digest, including destination, title and message.

Creation stays **unattached**: standalone Facebook creatives have no `PAUSED`
delivery status. This flow creates no ad, assigns nothing and starts no delivery
or spend. Existing campaign/ad-set creation still explicitly sends `PAUSED`.
Assignment to an existing ad is now correctly advertised as spend changing and
uses its separate exact confirmation. This is a protocol distinction, not a new
ability to bypass delivery confirmation.

The durable pending intent precedes the first provider write. Account and selected
channel locks cover current authority checks and dispatch. Facebook uploads the
stored bytes to the account, then independently commits the image-hash receipt
before creating the creative. The final creative receipt commits independently
before normal settlement. These bounded receipts live in the existing
`root_activities` journal as `ads.creation_receipt`, tied to workspace/account/
operation, and appear in scoped history/recovery reads. No bytes or credentials
are journaled. Campaign/ad-set final receipts also use this checkpoint.

Any unknown upload/final response, failed receipt checkpoint, or failure after a
successful upload remains uncertain and held, including a definite rejection of
the second write. Nothing is retried or remotely cleaned up automatically. A
manager must inspect both any uploaded image and creative before attesting an
outcome. A replay may return its recorded outcome after the local image has been
removed, without uploading again. Creative history and recovery additionally
check the exact channel ceiling, rather than merely another channel on the same
connection.

Migration: `prisma/migrations/20261030110000_rebuild_ads_creative_creation/migration.sql`
adds creative operation/object checks and the receipt lookup index. **Authored,
not applied**; no Prisma schema/client regeneration is required. Apply it through
the documented migration gates before enabling writes. Without the journal checks
in place, intent insertion fails closed before provider dispatch.

**New Root keys: none.** Existing `ads.managementEnabled` remains false by default;
`ads.managementPolicy` supplies name/page limits, the canonical stored-image reader
consumes Publishing storage policies, and Facebook consumes its existing
`meta.maxImageUploadBytes` / `meta.allowedImageMimeTypes`. The central registry was
not edited. Creative input safety bounds are 5,000 message characters and 200 headline
characters; they do not claim provider acceptance of every such creative.

Mapping reference: Meta's [standalone creative example](https://www.postman.com/meta/facebook-marketing-api/request/2y4pkug/creating-standalone-adcreative-l-1)
and [account image endpoint](https://www.postman.com/meta/facebook-marketing-api/request/i9eqz9q/get-image-hash).
These sources guide the mapping; only mocked transport is exercised here.

Verification and remaining work: final commands/results are recorded below. No
server, provider mutation, migration application or deployment belongs to this
checkpoint. Browser themes/phone/keyboard checks, PostgreSQL concurrency and
migration execution, live grants/creation/cleanup and production release remain
open. This checkpoint does not declare complete Ads or legacy parity. Its next
action is integration review followed by those explicitly separate verification
gates; no production service or existing held remote object was changed.

Final local verification from `rebuild/`:

- `npx vitest run tests/ads-*.test.ts tests/facebook-ads-*.test.ts tests/mcp-security.test.ts tests/mcp-ads-account-scope80.test.ts tests/raw-sql-void-guard.test.ts` — **571 passed, 5 skipped** (40 passing files; guarded database integration skipped).
- `npx tsc --noEmit -p .` — passed.
- `git diff --check` — passed.
- Frontend strict static audit — 44 repository findings, including existing shared
  Button/form detections; no finding in the new creative form or copy. This is
  static evidence only, not a passing whole-application UX audit.

No install, client generation, server, push or deployment was run. Browser,
PostgreSQL migration/concurrency and live-provider evidence remain unverified.

## Management completeness — paused ad creation, missing grant, hierarchy

Status: source and fixture tests only. No live Graph call, browser run, migration
application or production change.

- **Create ad.** Neutral `ad.create` (`parentId` = ad set in stored history, `creativeId`
  = existing account creative, `name`) goes through the same `previewAdsManagement` /
  `performAdsManagement` service as every other change, so the Campaigns UI
  (`AdCreateForm`), session REST (`/api/ads/management`) and MCP (`preview_ads_change` /
  `apply_ads_change`) share parsing, authority, exact confirmation, ledger and recovery.
  The journal key is `@create-ad:<adSetId>` (one unresolved creation per ad set). Scope
  must be unrestricted, as for ad sets. Facebook (`ads-ops/index.ts`) verifies the ad set
  (carries a campaign, is not an ad) and the creative belong to the account, then posts
  `/{act}/ads` with a module-fixed `PAUSED` status; a missing id stays uncertain.
- **Existing objects.** Pause/resume, daily/lifetime budget, rename, creative assign and
  delete keep the shared path; fixtures now exercise every Facebook write body and the
  spend-changing/irreversible confirmations.
- **Missing grant.** `describeAdsManagement` returns `needsReconnect: true` when management
  is withheld by `reconnect_required` (absent `ads_management` grant or invalid
  connection). The object manager and Campaigns screen show a bilingual reconnect notice
  linking to Settings → Connections. The thrown message is in the Ads catalog
  (`grantMissing`), so the service can localize errors; entry-point customer-locale plumbing remains open.
- **Hierarchy.** Campaigns rows show their ancestor path (`Campaign › Ad set`) resolved by
  the platform's neutral `parentObjectId`, are ordered by it, and a note says levels
  overlap and must not be added together.
- **Ledger follow-up closed in round 8.** Migration
  `20261031180000_rebuild_ads_ad_creation` now permits `ad.create`; see current
  status above for the owner-recorded application and remaining rehearsal evidence.
- **New Root keys: none** (customer copy keys were added to the existing `ads.customerCopy`
  default catalog; `CONFIG_SCHEMA_VERSION` untouched).
