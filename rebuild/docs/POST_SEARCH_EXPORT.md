# Posts search and CSV export

Implemented 2026-10-17. These are shared provider-neutral Publishing reads.
They do not prove complete Publishing parity or real Facebook coverage.

## Search and authorization

`modules/publishing/server/read-query.ts` owns validated status, channel and
literal case-insensitive post-text/first-comment search. It refreshes active
account, membership, feature permission, entitlement and selected-resource
scope through the existing Publishing authorization service. A post attached
to any hidden destination is excluded whole. Scoped members' unconnected
drafts remain author-limited; unrestricted members retain the established
workspace policy. Expired credentials do not erase readable stored history.

Visibility and search OR clauses are nested under AND. PostgreSQL LIKE
metacharacters %, underscore and backslash are escaped, not treated as search
wildcards. Search trims outer whitespace, rejects multiline/control input and
uses the configured UTF-16 length bound shared with native input maxLength.
Invalid input keeps the sidebar value and shows safe focused feedback.

Posts count and rows share the predicate before pagination. The low-level
`listPostPage` independently conjoins its mandatory workspace/resource/author
scope; a supplied richer predicate cannot replace that boundary. Queue and
Approvals retain their existing feature/order semantics. Calendar is unchanged.

Sidebar search, channel/status/view selection and page links preserve applied
filters. Table, Feed and Cards share the same results. Search is also supported
by HTTP Posts reads and MCP list_posts. A no-match search is distinct from a
workspace with no posts; failed reads do not render false empty results or
mutation/import controls.

## CSV contract

`modules/publishing/server/export.ts` owns `exportPublishingPosts(actor,input,
constraints?)`. Input accepts only `{q?,status?,channelId?}` with one status.
It uses the same current-authorized query as Posts. Export is independent of
the displayed page/view and makes no provider request or persisted write.

HTTP GET `/api/publishing/posts/export` accepts single q/status/channel query
values and maps channel to the neutral service channelId. It requires a current
Publishing read grant and returns no-store CSV with `posts.csv` disposition.
Success headers are `x-msp-export-format: posts-v1`, `x-msp-post-count` and
`x-msp-export-bytes`. Failures are safe typed no-store JSON. Unsupported or
repeated query parameters are rejected. HTTP `/api/publishing/posts` additionally
accepts q for its paginated JSON read.

MCP export_posts accepts the service's q/status/channelId names and requires
read permission, including read-only keys. It intersects current channel scope
and the configured MCP result-item ceiling with the Publishing export ceiling.
It returns versioned CSV text plus count, UTF-8 byte length, generation time,
applied filters and channel availability. It is absent when read permission is
absent. It does not acquire a mutation lock or record a write audit.

CSV v1 columns are post_id, author_id, message, first_comment, link, media_json,
status, scheduled_at, published_at, created_at and destinations_json. Media
contains every valid stored kind/URL/alt-text reference, without binary files.
Destination JSON contains authorized destination identity, name/type, recorded
status, remote post identity/link and normalized first-comment state/identity/
timestamp/error presence. Raw provider errors, stored credentials and arbitrary
media properties are excluded. Timestamps are ISO UTC. This export schema is
not the bulk-import template and is not a complete workspace archive.

Quoted CSV preserves Unicode, quotes and embedded line breaks using CRLF rows.
An apostrophe protects values that begin with a spreadsheet formula marker,
including after leading whitespace. JSON columns retain nested details as data.

## Root limits, consistency and UX

Registry 47 exposes four consumed Publishing-owned limits: search length,
export post count, UTF-8 byte count and database batch size. Root's existing
Publishing transaction timeout and acquisition wait also bound the read-only
export snapshot. Protocol CSV column names/version and database isolation are
isolated implementation invariants rather than customer/provider settings.

Exports are complete or refused. Ordered createdAt/id keyset batches run
inside one RepeatableRead transaction; count and incremental serialized UTF-8
bytes cannot exceed the applicable ceilings. An additional matching row or
oversized line refuses the operation before any CSV is returned. There is no
silent partial file or invented complete-archive claim. Date/search indexes and
installation-scale asynchronous exports remain separate performance/workflow
work, and a very large individual stored post can still require significant
memory within a bounded batch. Snapshot authorization is resolved at request
start; it is not a long-running continuously reauthorized export job.

The sidebar download control uses applied URL filters, prevents duplicate
clicks, validates format/count/byte headers and actual Blob size, then initiates
the download and releases the object URL on a subsequent task. Focused feedback
says Prepared CSV, rather than claiming that the browser saved a file. Failures
retain filters; phone feedback stays inside its accessible navigation drawer.
New filters must be applied before they affect the export.

PREVIEW_QA.md records actual automated, database, HTTP/MCP and browser evidence.
No migration, provider request or production deployment is part of this batch.
Saved views, bulk operations, scheduled reports/exports, REST v1, wider legacy
parity, live Facebook verification and cutover/rollback gates remain unfinished.
