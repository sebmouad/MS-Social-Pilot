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
| MCP | `analysis/mcp.ts`, `directory/mcp.ts`, `management/mcp.ts` | Definitions plus executors, exported, not wired. |
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

Known remaining behaviour: there is no request-level idempotency key. A replay of an identical confirmed request after a recorded success executes again (status/budget/rename are naturally idempotent on the provider; a repeated delete is rejected by it). Overlapping in-flight requests are refused by the open-object unique index. Adding an idempotency key needs a ledger column (migration below would need extending) and is not implemented.

## Proposed migration (not applied)

Canonical migration: `prisma/migrations/20261018170000_rebuild_ads_operations/migration.sql` in the application repository. It includes immutable request identity/hash, per-actor request uniqueness, the open-object hold and resolution-shape constraints. Do not apply older proposal SQL from worker handoffs.


Without this table every write fails closed (`unavailable`) before any provider call.

## Current host wiring

- Registry 67 includes analysis and management policies; management stays off by default.
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


## Batch 74 integration in progress (2026-10-18)

The platform host has a neutral optional operations engine, assembled inside
Facebook. Root registers `ads.managementPolicy` (schema 67); management remains
off by default. Object details, neutral metadata/limits, reviewed changes,
creatives and history use shared services. API/MCP paths pass request identity
and scope; older status/budget API and MCP shapes now delegate to the same ledger.
Campaign/ad-set creation remains on its existing separate path and still needs
equivalent durable creation/recovery integration before complete Ads parity.

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
