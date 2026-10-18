# Ads and Analytics read workflows — batch 68

Status: integrated stored-data workflows; not full Ads management, Analytics parity,
Facebook completion or release readiness. Production remains legacy.

## Delivered boundaries

Ads owns comparison with a previous period or across accounts, daily trends,
sample-size-aware findings, freshness and sorted campaign/ad-set/ad figures.
Different currencies remain separate; missing account aggregates remain unknown
while stored object rows remain visible. `/ads/objects` provides scoped stored
object search, parent filtering, sorting and paging. Parent identities are resolved
by an optional platform contract; Facebook alone interprets its provider fields.
Management actions/history remain hidden without a registered management engine.

Analytics owns `/analytics/demographics`, `/analytics/compare` and
`/analytics/pins`. Breakdowns retain units, coverage, timestamps and explicit row
bounds. Category dimensions group related displays only: they do not prove
measurement compatibility. Distinct breakdown metrics stay separate; no combined
country/age/etc total is invented from shared labels or overlapping populations. Comparisons withhold differences for incompatible or incomplete measures.
Channel-group comparison explicitly excludes ad accounts. Audience sums covered
selected channels and does not claim deduplicated people. Personal pins preserve
legacy preference entries; values and pin eligibility use the current workspace
and resource authority. Comparison filters show only the active mode, retaining
drafts when switching. Audience read errors retain correction and reset controls.

Registry version 62 installs module-owned analysis, demographic, comparison and
pin settings. Manifests, current entitlement/permission aliases, HTTP and workspace
MCP dispatch use canonical feature IDs. MCP resource scope is passed through to
shared readers; bounded results are complete or refused rather than silently
changing totals. Pin writes require exact confirmations and transactional audits.
No migration or live provider write belongs to this batch.

## Evidence

The isolated staged-source snapshot passed 2,122 tests in 275 files with guarded
synthetic PostgreSQL tests enabled, production build and subsequent serial
typecheck. Independent lower-cost Ads and Analytics review found no remaining
important issue; a suspected channel/ad-account comparison issue was disproved
against the reader and protected by a regression.

Chrome inspected the approved desktop two-sidebar navigation and synthetic Ads
comparison figures, the audience invalid-date correction state, and the 390px
comparison drawer. The drawer measured 330px and document width stayed 390px.
Changing comparison mode omitted inactive fields from FormData. Grove and a
non-persisted Nightfall preview were inspected; this is not full theme, keyboard,
offline or stale-response coverage. The temporary theme was restored to Grove.

`scripts/verify-read-workflows.ts` contains a guarded local HTTP/MCP/PostgreSQL
probe with disposable tenants/resources, confirmation and authorization refusals,
persisted pins and exact fixture/settings cleanup. Its final execution passed Ads comparison/directory, Analytics reads and pin
writes, feature/permission/foreign-resource refusals and exact cleanup. This is
synthetic local evidence; it is not live provider or production evidence. The
strict static UI audit has zero findings on changed routes and 38 elsewhere in
the working tree. Its JSON remains local verification evidence, not a claim of
whole-app design compliance.

## Remaining work

Full Ads creation/edit/delete, durable management operation recovery and real
provider permission/testing remain separate. Report templates, generation,
scheduling, email delivery and legacy Analytics sections are unfinished source,
not exposed by this batch. Large report continuation and richer comparison
eligibility need further work; refusal of an oversized MCP report is not access
to every metric at arbitrary size. General UI copy is not yet a complete
Root-managed catalog. Full browser state/theme coverage, resource-revocation
concurrency, live Facebook operations, migration/restore rehearsal and production
cutover remain required by ARCHITECTURE_CONTRACT.md.


## Batch 70 — no unproven demographic sums

An independent semantic review found that adding every count-valued country
breakdown could mix fans, impressions or overlapping populations. The neutral
MetricView contract has no measurement/taxonomy/period/contribution proof that
would justify this cross-metric operation. Grouped responses now return
`combined: null`, retaining every individual metric, row, share and coverage.
This does not change the required selected-channel audience total or aggregation
of one normalized metric across its eligible resources. Any future cross-metric
combination needs explicit neutral compatibility and disjointness evidence.

The extended synthetic read-workflows probe stores country fans (US 12/CA 8)
and country impressions (US 31/CA 69) for the same channel. HTTP and MCP must
return both independent sets and no combined total. Unit regressions also cover
unknown and overlapping resource coverage. The final isolated batch passed 2,134 tests / 276 files, production build and
subsequent serial typecheck. The final local HTTP/MCP/PostgreSQL probe passed
and verified exact fixture/audit/settings cleanup.
No schema, Root setting definition or production/provider state changes.
