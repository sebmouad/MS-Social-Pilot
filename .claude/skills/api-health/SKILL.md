---
name: api-health
description: Inspect Graph API rate limits, usage and deprecation warnings affecting MS Social Pilot, and plan version bumps.
---

# Graph API health

1. Usage: DevTools MCP `devtools_api_usage` for app 699780715171676; in code the
   `x-app-usage` budget in `src/lib/facebook/budget.ts` (background jobs pause
   when it is high — check worker logs for "stood aside").
2. Deprecations: `devtools_api_changelog` for the pinned version
   (`FACEBOOK_GRAPH_VERSION`) and the next ones; cross-check every metric in
   `src/lib/facebook/metrics.ts` (`deprecatedFrom`) and `docs/META_API_NOTES.md`.
3. Live coverage: Analytics → Overview → Technical details shows which metrics
   Facebook still serves for a real Page (probed by the worker's first read).
4. Version bump plan: change `FACEBOOK_GRAPH_VERSION` in Configuration, run the
   coverage test, fix renamed metrics (keep old names as fallbacks for stored
   data), run the suites, deploy, verify numbers against Facebook.
