# Ads parity: comparison, directory and management (W3)

Status: **integrated stored reports and durable object-operation services, with scoped local verification; incomplete live-provider/creation/release coverage.** Management is off by default. The current proof and remaining gaps are recorded below. Target: [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md).

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

## Ledger migration (local preview only)

Canonical migration: `prisma/migrations/20261018170000_rebuild_ads_operations/migration.sql` in the application repository. It includes immutable request identity/hash, per-actor request uniqueness, the open-object hold and resolution-shape constraints. Do not apply older proposal SQL from worker handoffs.


Without this table every write fails closed (`unavailable`) before any provider call.

## Current host wiring

- Published registry 67 includes analysis and management policies; pending creation integration adds version 68. Management stays off by default.
- Facebook-owned host assembly provides its optional neutral object-operations engine.
- Shared service paths back the Objects/Campaigns UI, management HTTP API and MCP tools.
- The older status/budget API/MCP shape delegates to the same durable service.
- The checksum-pinned additive ledger migration is in the cutover allowlist; it has been applied only to local preview after backup/scratch verification.
- Complete creation journaling, provider/live evidence and the release cutover remain pending.

## Limitations

- Worker handoffs were independently verified and integrated; see the current verification scope below. Mocked tests do not establish provider approval or live behavior.

- Stored data only; no new sync. Previous-period coverage is shown via day counts and "no earlier data", not a sync-window check. Comparison totals and daily trends require account-level insight rows; when those rows are missing, the UI shows object evidence while stating account totals are unavailable.
- Directory parent links depend on `campaign_id`/`adset_id` being present in stored row fields.
- Creative support assigns an *existing* account creative to an ad; creating or editing creative content is not implemented and not advertised.
- Facebook `delete` posts `status=DELETED` (irreversible) -- confirmed by text only; campaign budgets apply only to budget-owning campaigns, otherwise Graph rejects.
- No live Facebook call, spend or browser check has been made. CSV export of comparison and per-day compare charts remain open.


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
