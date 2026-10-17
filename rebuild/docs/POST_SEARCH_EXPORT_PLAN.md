# Posts search and CSV export plan

2026-10-17. Continues the approved full rebuild and legacy parity target.
This batch extends existing Publishing reads; it does not change provider
ownership or declare Publishing complete.

## Product behavior

Sidebar search matches literal case-insensitive text in post text or first
comment. Status, channel and search apply before counting and pagination.
Table, Feed and Cards share them; pagination preserves committed filters and
submitting changed filters starts at page one. The existing sidebar/mobile
drawer owns all controls. Invalid searches retain input with useful feedback.

Export downloads matching authorized posts, independent of the displayed page
or view. One row per post contains content, first comment, link, all media,
timestamps, actual status and normalized per-destination delivery/first-comment
outcomes. It contains no credentials or raw provider errors. CSV quotes fields,
preserves Unicode/newlines, and neutralizes spreadsheet formula prefixes.
The file schema is a versioned protocol, not configurable customer copy.

Synchronous exports are complete or refused: exceeding Root's post or UTF-8 byte
ceiling produces a safe error asking for narrower filters, with no partial CSV.
The UI retains filters, blocks duplicate download clicks, validates response
metadata and focuses failure/success feedback. Asynchronous installation-scale
archives remain a separate target requirement, not silently replaced here.

## Shared boundary

`modules/publishing/server/read-query.ts` will own validated text/status/channel
filters and current whole-post scope through `publishingPostReadQuery(actor,
input, feature?)`, returning `{where, filters, channelUnavailable}`. Accepted
input is `{status?: string, channelId?: string, q?: string}`. Export uses this
same query, with no widened tenant or destination access. Existing list date/
status-list semantics remain compatible and reuse literal search validation.

`exportPublishingPosts(actor, input, constraints?)` will own CSV projection,
serialization and Root ceilings. HTTP GET `/api/publishing/posts/export` accepts
q/status/channel; MCP `export_posts` accepts q/status/channelId and intersects
its caller result cap. Both require Publishing read permission. The neutral
service performs no remote request and introduces no DDL.

Registry 47 introduces consumed Publishing-owned search and export limits:
`publishing.searchMaxCharacters` (200, valid 1–2000),
`publishing.exportMaxPosts` (5000, valid 1–50000), and
`publishing.exportMaxBytes` (10485760, valid 1024–52428800).
`publishing.exportBatchSize` (100, valid 1–1000) bounds snapshot read batches.
Limits appear under the private Root Publishing module through its manifest.

## Batches and ownership

1. Lower-cost read/config agent: shared filter/query helper, list/page/data
   search integration, registry and focused scope/literal/config tests.
2. Lower-cost export agent: CSV service and HTTP endpoint with full-match
   ceilings, safe projection/formula handling and boundary tests. Depends on
   the query helper signature above; no duplicate authorization fork.
3. Parent: sidebar/page/download UX, HTTP read and MCP integration, docs,
   actual PostgreSQL + local browser/API/MCP verification and final review.

## Proof and review focus

- Literal %, _, backslash and mixed-case search; first-comment matches;
  query composition cannot overwrite the visibility OR; identical count/list.
- Foreign, mixed hidden and unselected posts absent from exported rows/counts;
  revoked access applied on each read; read-only callers may export only reads.
- No arbitrary Prisma fields, unsupported filters or invalid status bypass.
- Formula prefixes after whitespace, quotes/newlines/Unicode, all media and
  normalized outcomes; raw credential/provider error fields excluded.
- Complete-or-refused row/byte bounds, including actual UTF-8 byte length;
  UI handles safe failures without navigating to a JSON error page.
- Search retained across pagination/views, no page overflow, desktop/phone,
  light/dark themes, keyboard focus and failure/pending/download behavior.
- Full rebuild tests, typecheck, isolated build, disposable-data cleanup,
  documentation and exact GitHub main publication. Production stays legacy.

Implementation refinement: the query helper also returns its resolved
`scope:{targetIds,authorId?}`. The data layer always conjoins its mandatory
workspace/resource/author predicate with additional filters. CSV batches run
inside one RepeatableRead transaction governed by the existing Publishing
transaction timeout/wait settings. Incremental UTF-8 accounting stops at the
configured byte ceiling without repeatedly scanning the accumulated CSV.
Search length uses the same UTF-16 units as native HTML maxLength.
