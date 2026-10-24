# Published post explorer

`/analytics/posts` and `GET /api/analytics/posts` share `readPosts` with the
`get_analytics_posts` MCP tool. The service checks active account, current
entitlements, role permissions, workspace purge state and the intersection of
current channel grants with the credential ceiling. The existing Analytics
catalog supplies currently selected, usable resources from entitled platforms.
Only platforms implementing `postPerformance` are included.

Publication dates use the existing validated inclusive UTC Analytics range.
Measures and their timestamps are stored snapshots, not period deltas. Unknown
values remain null. Each destination is a separate row; multi-channel posts are
not deduplicated. The provider hook accepts a neutral measure key, direction and
offset. The explorer merges the first offset + page size + 1 rows from each
channel, with stable post/channel tie ordering and unknown measures last. The
existing ranking behavior remains available to report callers without a sort.
Rows whose destination was published from this workspace link to the internal
post page (which re-checks post scope); imported history shows no link.

Root key: `analytics.postsPageSize` (default 25, range 1–200), declared in the
Analytics owning config. MCP additionally caps rows by the current result limit.
CSV exports the complete selection, independent of current page, bounded by the
existing `analytics.reportExportRows`. Oversized exports are refused and ask the
user to narrow the period/channels; they are never silently truncated. CSV cells
escape quotes and neutralize spreadsheet formulas.

## Evidence and integration

Module-local tests use `npx vitest run --config
src/modules/analytics/explorer-posts/vitest.config.ts
src/modules/analytics/explorer-posts/service.test.ts` from `rebuild/`. The local
config is necessary because the repository default includes only `tests/**`,
outside this task's file ownership. Unit tests use synthetic mocked data. No
server, database, browser, live provider or production verification is claimed.

The new `analytics/posts` manifest feature requires central entitlements and
permissions mappings to the `analytics/overview` switch, plus the corresponding
MCP-security feature fixture and navigation expectation. These files are outside
the explicitly assigned ownership and require integration by their owner or a
scope expansion. Until then typecheck and the manifest expectation cannot pass.
The module code is a reviewable integration candidate, not release-ready.
