# Stored Ads comparison

Interactive UI, HTTP JSON, MCP JSON and CSV now load the same stored levels for
both equal-length periods: account totals plus the selected campaign/ad-set/ad
level. Object baselines use account ID and object ID, never names or another
account's matching object ID. The existing read service rechecks current
workspace authorization, selected resources, provider availability and credential
ceilings on every read. There is no live provider request.

Each object has a shared-table disclosure showing current/previous figures and
percentage changes, plus all stored daily flows and recomputed ratios. Missing
baselines and zero denominators remain unavailable; missing days are not filled
with zero. Across-account mode shows daily detail without a prior-period table.
English/French copy and existing theme tokens apply. Interactive object counts
remain bounded by the existing analysis policy; CSV continues to export the full
selection or refuse an oversized result. Reading additional baseline rows can
now hit the existing dataset ceiling: narrow the date/account filters to recover.

Tests cover exact-object baselines at all three levels through HTTP and MCP,
account identity isolation, bounded exports, bilingual rendering and missing
figures. This is local mocked-service/render evidence. Browser, PostgreSQL,
live-provider synchronization and production proof remain separate work.

No new Root keys, registry edits, migration or provider-specific shared rule.
