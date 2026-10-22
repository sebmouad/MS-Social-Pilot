# Channel and paid reporting boundary

Owner decision: channel/Page/post reporting and Ads reporting are separate experiences.

- Routes moved to `/insights/*` in design v2 B5 (`/analytics/*` and `/ads/*` redirect, 308); the boundary below is unchanged. `/insights` and `/insights/explore` use the shared channel-only `server/read.ts` service. Overview, detail, comparison, pins and overview CSV exports inherit the same boundary through UI, session REST and MCP/key REST callers.
- The service requests an empty selected ad-account list and an empty allowed-account ceiling on discovery, current and comparison reads. It also omits normalized `resourceKind: ad-account` metrics before aggregation. This uses neutral provider metadata; no provider/source-label rules are introduced.
- Explicit nonempty legacy ad-account filters are refused rather than silently changed. Empty legacy filters remain accepted for saved channel-only queries. Response ad-account arrays remain empty for transport shape compatibility.
- Paid account reporting stays separate (now `/insights/ads`, the Ads tab), with its existing date/account filters, spend, CPC, reach, actions, daily details and export. The former `/analytics/ads` route (now `/insights/ads/analysis`) is the clearly named **Ads reporting** experience for campaign/ad-set/ad detail, with independent account/date filters and its existing shared `readAdObjects` UI/REST/MCP service. No routes, entitlements or tool names move in this batch.
- Existing Root range, paging, chart, search, export and bilingual copy settings remain authoritative. No new Root keys. Catalog identities remain compatible with saved copy; shipped overview empty-state wording now refers only to channels. Root overrides can still choose custom wording.

Verification is mocked service/provider-port and rendered UI evidence only; no browser, live provider or production verification. The overview headline is owned by a parallel worker and is unchanged here. Integrator should record this boundary and test receipts in `docs/ARCHITECTURE.md`, `UX-CONTRACT.md`, `docs/DELIVERY_PLAN.md` and `docs/AGENT_HANDOFF.md`, which are outside this lane's ownership.

## Targeted verification

From `rebuild/`:

- `npx tsc --noEmit -p .`: passed, zero errors.
- `npx vitest run --no-cache tests/analytics-read.test.ts tests/analytics-explorer.test.ts tests/analytics-explorer-page.test.ts tests/mcp-analytics-account-scope80.test.ts tests/parity-analytics-export.test.ts tests/analytics-http.test.ts tests/analytics-overview-live-defects2.test.ts tests/analytics-copy.test.ts tests/ads-module-ui.test.ts tests/ads-report-read.test.ts tests/ads-report-routes.test.ts tests/analytics-comparison.test.ts`: 12 files, 96 tests passed. Cache disabled because dependencies are symlinked outside the writable checkout.
- `npx vitest run --no-cache --config src/modules/analytics/ad-objects/vitest.config.ts src/modules/analytics/ad-objects/surfaces.test.tsx`: 6 tests passed, covering the independent paid-reporting UI/REST/MCP surface.
- `git diff --check`: passed.
- Premium strict static audit: 31 existing static findings across the project; the touched explorer filter form declares `noValidate` and relies on the shared service validation. Audit JSON is local at `/private/tmp/msp-adssplit-ui-audit.json`. No full application static-audit clearance is claimed.

Known integration follow-up: previously saved Root overview/records copy overrides can retain old wording. Review those configured entries before browser verification; shipped defaults are bilingual and accurate. No live settings were changed. Existing consumer tests that intentionally fake a mixed Analytics snapshot are transport fixtures, not proof that the channel service returns paid metrics.

## Changed files

Under `src/modules/analytics/`: `server/read.ts`, `manifest.ts`, `mcp.ts`, `explorer-mcp.ts`, `comparison/mcp.ts`, `overview-copy.ts`, `records-copy.ts`, `ui/AnalyticsScreen.tsx`, `ui/explorer/ExplorerScreen.tsx`, `ui/explorer/sidebar.tsx`, and this document.

Under `tests/`: `analytics-read.test.ts`, `analytics-explorer-page.test.ts`, `mcp-analytics-account-scope80.test.ts`, `parity-analytics-export.test.ts`.

Documentation: affected rows in `docs/MCP_PARITY.md`.
