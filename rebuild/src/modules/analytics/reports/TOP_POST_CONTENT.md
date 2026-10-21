# Top post content — local parity round 7

Legacy reference: `src/lib/reports.ts` `TopPost`, `rankTopPosts`, and the Reports
screen's media/article presentation. This slice restores three details in the
existing Top posts section: saved destination-specific text, ordered media with
optional image previews, and saved article link/title/description.

`generation/document.ts` uses the neutral installed platform ranking hook, then
`server/top-post-content.ts` enriches only that ranked channel's currently
published rows in the requested inclusive UTC period. Workspace predicates bind
posts and targets. Destination messageOverride (including an intentionally empty
string) and skipMedia are respected. Missing/unpublished destinations are dropped
rather than using stale adapter content. These are current saved values, not
immutable publication snapshots or proof that remote content matches.

UI Prepare report, session REST `/api/analytics/report-workflows/run`, key REST
`/api/v1/analytics/generate_report` and MCP `generate_report` retain their shared
confirmed, authorized and audited `runReportNow`/generator workflow. No new route,
authorization exception, confirmation or provider-specific rule is introduced.
CSV/JSON carry explicit content/media/link records; printable HTML has a native
content disclosure, image previews and attachment/article links. Text reports
include the same context. Images are references, not embedded file copies. No
media or article is fetched by report generation. Preview images load only in the
viewing browser; Root can disable images while preserving attachment links.

Root `analytics.reports.topPostContent` owns posts, textCharacters, mediaPerPost,
urlCharacters, previewCharacters, imagePreviews and mediaUrlTemplate. It is typed,
validated and read with runtimeConfig. The existing `app.publicOrigin` turns valid
local media UUID references into absolute authenticated application links. Empty
or invalid origin means local media references are omitted and clipping is
reported. Local media still requires current workspace access. Unsafe schemes,
credential-bearing URLs and overlong URLs are omitted. SQL limits text/JSON
projection and media count before returning rows; private storage keys and
provider errors are never selected. Unicode text cuts preserve whole characters.

Existing Root EN/FR document/UI catalogs provide labels, context and clipping
notices. CSV formula escaping, HTML escaping and UTF-8 output bounds remain in the
shared renderer. The platform ranking request respects the smaller of Root's post
count and the caller's result ceiling. Schema version is intentionally unchanged.

Evidence: targeted unit, query-shape, fake-database confirmed service/MCP workflow,
UI-render and HTTP/MCP host tests; TypeScript. These do not prove PostgreSQL SQL
execution, real MCP/REST clients, browser download/disclosure/image behavior,
provider completeness or production. Signed external media URLs may expire;
authenticated local media is not portable to recipients without workspace access.

Integrator changes outside this worker's ownership: bump CONFIG_SCHEMA_VERSION
for the new setting/catalog entries; add this source/test scope and pending
PostgreSQL/browser/client checks to ARCHITECTURE.md and continuation docs. Do not
claim all report, analytics or legacy parity complete.

Local verification (2026-10-21): `npx tsc --noEmit -p .` — 0 errors.
`npx vitest run --cache=false` with the following targeted files — 12 files,
193 tests passed:

- `tests/report-top-post-content.test.ts`
- `tests/report-top-post-content-workflow.test.ts`
- `tests/report-top-posts.test.ts`
- `tests/report-document-copy.test.ts`
- `tests/report-publication-details.test.ts`
- `tests/analytics-parity-report-generation.test.ts`
- `tests/analytics-parity-reports.test.ts`
- `tests/reports82-http-host.test.ts`
- `tests/reports82-mcp-host.test.ts`
- `tests/reports82-ui.test.ts`
- `tests/report82-engine-manual.test.ts`
- `tests/ui-copy-coverage.test.ts`

Caching was disabled because the dependency symlink points outside the writable
worktree; the first run passed assertions but failed to write Vitest's cache.
No whole suite, server, live remote call, deployment, commit or push was run.
