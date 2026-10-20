# Facebook data coverage — worker inventory, 2026-10-20

Integrator: copy this inventory to `rebuild/docs/FACEBOOK_DATA_COVERAGE.md` and
update architecture/handoff evidence. This worker may write only Facebook source
and `tests/facebook-*.test.ts`; the requested docs destination is outside ownership.

## Evidence and permission limits

Inspected current source, not live Root values or tokens. Root **defaults** request:
`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`;
Inbox adds `pages_messaging` / `pages_manage_engagement`; Ads reporting requires
`ads_read`, management `ads_management`. Configured required scopes are read from
Root at existing job/service authorization boundaries, and recorded connection
grants must match. Requested scopes do not establish actual granted scopes, app
review, Page tasks, account access, token validity or metric eligibility.

Configured Graph version default: v25.0. Official references attempted on this
run returned HTTP 429, so no exhaustive current metric whitelist was verified:
- https://developers.facebook.com/docs/graph-api/reference/insights/
- https://developers.facebook.com/docs/graph-api/reference/video/video_insights/
- https://developers.facebook.com/docs/marketing-api/insights/breakdowns/
- https://developers.facebook.com/docs/graph-api/reference/page/conversations/
- https://developers.facebook.com/docs/graph-api/reference/object/comments/
- https://developers.facebook.com/docs/graph-api/reference/object/reactions/
- https://developers.facebook.com/docs/graph-api/changelog/

These are reference locations, not claims of successfully retrieved documentation.
Metric examples below reflect source or protocol knowledge, not a verified current
provider guarantee. Historical reach/impression/fan/demographic/video metrics are
version-sensitive and **uncertain**; do not blindly enable a historical metric list.

## Have / added / unavailable

| Area | Have before batch | Added by batch | Still unavailable / uncertain and reason |
| --- | --- | --- | --- |
| Page insights | Root `meta.pageInsightMetrics`: defaults `page_follows`, `page_media_view`, `page_post_engagements`, `page_views_total`; separate per-metric reads; dated numeric/maps in `page_insights`; neutral catalog and audience | Root periods; `total_value.value`; total-value dimension results; nested category leaves; safe partial failure metadata | Exact metric eligibility and period combinations need current official docs/live Page proof. Undated totals require explicit requested end time; totals are range snapshots, never daily flows. |
| Post insights | Locally published post status and existing stored per-post snapshots are readable by post explorer; no general discovered-post insights collector | Opt-in `posts` discovery and configured `insights` metric/period reads; object identity retained in namespaced PageInsight records | Complete post explorer integration needs a neutral content identity contract; these observations currently appear in general analytics. Unknown metric semantics default conservatively to stock. |
| Video/Reel insights | Publication/status paths exist, no general video insight collection | Opt-in `videos` / `video_reels` discovery; configured `video_insights` or `insights` reads, lifetime snapshots | No speculative defaults: exact Reels/video metric names, period support, edge eligibility and deprecations require verification. No claim of full video/retention coverage. |
| Stories | Status proof/readback in separate worker-owned publishing files | Opt-in `stories` collection, configurable fields and insight edge requests | Story insight support/metric names are uncertain. Root cannot create an unsupported endpoint. Expired Stories may not remain discoverable. No archive/backfill guarantee. |
| Audience/demographics | Historical audience rows, latest follower/likes totals, category snapshot history emitted by neutral catalog | Nested categories and total-value dimension results retained/emitted | Historical `page_fans_*` / age/gender/city/country metrics cannot be assumed supported. Privacy thresholds and discontinued metrics are not recoverable through a Root switch. No people identities inferred. |
| Comments/reactions | Inbox fetches comments/replies, parent identity, author, like/reply counts and hidden state for locally stored published posts | Configured content fields retain nested comments/reactions summaries and aliases, e.g. Root may configure documented field expansions after version verification | No universal comment discovery/backfill or complete paginated reactions/user roster. Nested field pagination is retained as metadata but is not followed; summary totals are snapshots. Actual availability of per-reaction expansions must be verified. |
| Conversations/messages | Page conversations, snippets, timestamps, unread/message counts, bounded message pages; shared Inbox service stores messages | No new conversation behavior | All attachment/participant/message metadata is not yet retained. Engine is in excluded `publishing.ts`; expanding its protocol/interface and Inbox storage needs coordination. Configured Inbox read grants are not a claim of unlimited Messenger history. |
| Ads insights | Root `meta.adInsightFields`; daily account level, explicit date range; baseline numeric columns plus full raw fields/actions JSON; neutral extra field/action emission | Separate configurable delivery breakdown combinations; preserve daily/account/currency/category provenance in baseline JSON; emit neutral breakdown history, exclude from baseline totals | Provider forbids some field/breakdown combinations; no claim every combination works. One rejected configured combination fails that refresh (no silently complete partial sync). No campaign/ad-set/ad-level historical collection added. |
| Ads action breakdowns | Actions/action-values arrays retained and normalized when returned by configured fields | Action arrays inside delivery breakdown rows emitted separately | Explicit `action_breakdowns`, attribution windows/report time, async reports and all hierarchy-level queries remain unimplemented. Need individually verified query policies and storage semantics. |

## Root settings and behavior

New keys, declared in Facebook `config.ts` and aggregated in `module.ts`:
- `meta.pageInsightPeriods`: default `["day"]`.
- `meta.contentInsightCollections`: default `[]`. Entries declare `edge`,
  `insightEdge`, `metrics`, `periods`, optional Graph `fields`. Discovery always
  includes protocol identity `id`. Root can include nested summaries/aliases;
  full raw fields persist, numeric leaves emit and nonnumeric leaves remain unknown.
- `meta.adInsightBreakdowns`: default `[]`; each entry is a combination of dimension
  names. For example `[["age","gender"],["publisher_platform","platform_position"]]`
  describes separate requests, **not verified eligibility for this app/version**.

Existing Root controls still govern endpoints, version, signing, timeout,
pagination, page size, Page metrics, Ads fields, scope gates and lookback.
Content object discovery is bounded by the existing page count/page size and
fails explicitly when pagination cannot complete. There is no unbounded crawl,
no new database schema and no shared-provider branch.

New collection runs through `configuredFacebookEngine` inside the existing
selected-resource, current-grant, workspace-authorized jobs, persistence guards
and neutral analytics loader. UI/REST/MCP consume that same stored catalog. No new
customer write operation or separate API/MCP business rule was introduced. Direct
legacy `createFacebookEngine` consumers remain unchanged; these are not a second
source of collection configuration. The adapter's simple live `getAnalytics`
summary remains the older numeric-only method and needs integration if exposed
as a customer path.

Content identity is namespaced in the metric key, preventing separate objects
from overwriting each other; unknown/lifetime content metrics are stock values.
Content category totals are withheld because raw snapshot fields may include
non-additive values or dimension coordinates. Range-total series preserve the requested start in the period identity and use
the explicit end as snapshot time. Ads dimensional history does not overwrite
account totals; currency series remain separate and dimensional totals are
withheld. Raw nested fields are retained, including nonnumeric metadata, but the
neutral numeric catalog does not render all text fields.

## Verification for this worker batch

From `rebuild/`: `npx tsc --noEmit -p .` passed with zero errors.
Targeted Vitest (cache disabled to avoid the existing dependency-link cache error):
`facebook-data-coverage.test.ts`, `facebook-analytics-selection.test.ts`,
`facebook-signing-runtime.test.ts`, `facebook-job-freshness.test.ts`,
`facebook-engine.test.ts`: 71 passed across 5 files.
No full suite, servers, deployments, push, database or live-provider reads.

## Remaining integration work

1. Copy this document to the requested docs location, update architecture/status
   and continuation docs, and coordinate the central config schema version bump.
2. Verify current official metric names/periods/field/dimension combinations for
   v25.0 and actual recorded grants; enable verified Root collections. No real
   provider read or customer-data access was attempted by this worker.
3. Extend neutral catalog/service locale support for bilingual configurable metric
   labels and provenance. Current catalog has only `label`/`sourceLabel`, no locale
   input; existing/new dynamic labels therefore retain the existing English
   fallback. Do not claim complete French analytics copy.
4. Publishing-engine owner: expand conversations/messages metadata and reaction
   pagination through neutral interfaces; coordinate the simple adapter summary
   path. Product owners: content explorer and persisted metadata presentation.
5. Live-provider, actual database, browser and MCP transport evidence remains open.
   Mock tests cannot prove exhaustive permission-readable coverage.

## Round 2 — 2026-10-20 worker changes

Page analytics now also collects `published_posts` (Root may choose `feed`) into
`external_posts`, with an explicit lookback and per-target feed-page budget. A
stable since/until interval and cursor are stored under a workspace/target/provider
identity in `app_settings`. Cursor and post writes share the existing selected
resource transaction; final current access/grant checks still guard commit. The
collector uses cursor values, never stored provider URLs or tokens. Completed
intervals restart at the latest window next run. Invalid/expired cursors fail
without advancing; an operator must clear that progress record to restart.

Per-post configured lifetime metrics preserve numeric/map values; known metrics
normalize to reach, impressions, engagement, clicks and video views/watch time.
Configured reaction types follow cursor pagination within `meta.maxPages`; failed
or truncated counts are unknown, never invented zeros. Comments/shares summaries
are retained when present. Partial metric failures are stored explicitly in
`collectionFailures` and reported by the job; those posts are revisited in the
next complete sweep, not retried automatically in the current interval.

Post performance now unions external history with local published posts before
sorting/pagination and suppresses duplicate remote identities. Parameterized SQL
is used because this checkout's generated Prisma client lacks `externalPost`,
although the root schema contains it. No schema/client generation was performed.
The existing neutral `measures[].labelFr` contract carries configured bilingual
extra metric labels. No neutral contract file was changed. Other dynamic analytics
catalog labels still need neutral locale plumbing; this is not full French coverage.

Ads adds separately paginated campaign/adset/ad daily reads with identity, raw
actions/action-values and configurable action breakdowns. Rows persist with their
actual level and object ID, preventing overwrite of account totals. The existing
Analytics catalog still selects account rows only: hierarchy report presentation
and selection remain an integration gap, not a completed customer capability.

New Root keys (integrator must coordinate registry schema version):
- `meta.postHistoryPolicy`: lookbackDays, pageBudget, edge, fields, metrics,
  reactionTypes. Existing pageSize/maxPages/timeout/signing settings are reused.
- `meta.adHierarchyPolicy`: levels and actionBreakdowns.
- `meta.metricLabels`: normalized metric to `{ en, fr }` labels.

Conversation participants/attachments/full metadata remain unchanged: engine
`publishing.ts` is explicitly outside this lane, and existing Inbox persistence
has no such fields. Its owner must extend engine responses and neutral Inbox
storage/presentation together. Architecture/handoff updates also belong to the
integrator, outside this lane. No live metric whitelist, grants, provider history,
database SQL, browser/MCP transport or production proof is claimed. The default
metric list remains subject to provider version/permission eligibility, with
failed metrics explicitly recorded. Full requirement remains incomplete.

Round-2 verification: `npx tsc --noEmit -p .` passed with zero errors;
`npx vitest run tests/facebook-job-freshness.test.ts tests/facebook-post-history.test.ts tests/facebook-data-coverage.test.ts tests/facebook-analytics-selection.test.ts tests/facebook-signing-runtime.test.ts tests/facebook-engine.test.ts --no-cache` passed 76 tests across six files. `git diff --check` passed.
The signing runtime test mock was updated for the existing runtimeConfigBatch
consumer. Only mocked Graph/service evidence; no full suite or servers run.
