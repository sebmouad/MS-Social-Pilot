# Analytics explorer implementation plan

**Goal:** One scoped Analytics read path with honest UTC comparisons and reachable metric details.
**Architecture:** Product-owned reads authorize current identity, entitlements, membership and caller channel constraints. Installed adapters alone normalize provider storage. UI, HTTP, CSV and MCP use the same snapshot; presentation pagination never changes aggregation.
**Spec:** ARCHITECTURE_CONTRACT.md sections 3, 6–9; DESIGN.md and UX-CONTRACT.md. Existing approved navigation and themes remain authoritative.

## Constraints and review focus

- Facebook logic remains inside its platform module; no new provider is advertised.
- Root owns window, selection, search, chart and pagination limits through registry version 39.
- Invalid dates, duplicate scalar inputs, unknown selected IDs and revoked permissions fail safely.
- Empty channel selection must not hide independently authorized ad accounts.
- Compare exact covered resource identities and compatible aggregation; missing, partial, zero-baseline and breakdown values never invent growth.
- UTC inclusive calendar dates, previous equal-duration range and clamped prior-year range must not depend on host timezone. Historical audience excludes later snapshots.
- Every stored series/category row remains reachable; pagers, metric search/selection and export are in the contextual sidebar.

## Batches

- [x] Pure comparison helper and tests: exact dates, leap days, resource identities, missing/zero/partial data (`modules/analytics/server/comparison.ts`).
- [x] Provider normalization and tests: unknown/latest metrics, nonadditive reach, mixed payloads, historical audience and ad-only scope (`platforms/facebook/analytics.ts`).
- [x] Shared read/snapshot service and tests: current authorization, strict query validation, stable selection, comparison, metric/detail pagination (`modules/analytics/server/read.ts`, `types.ts`).
- [x] Config, scoped no-store HTTP, CSV and MCP integration; preserve bounded MCP continuation and CSV formula protection.
- [x] Sidebar-driven page and accessible summary/detail UI; test failure/empty/pagination and preserved filters.
- [x] Full automated tests, typecheck, isolated build, real local browser/API/MCP example-data verification, review and documentation.
- [ ] Commit on main, push and verify origin/main. Production remains legacy; no migration or remote content mutation is needed for this read batch.

Execution evidence and remaining limits are recorded in PREVIEW_QA.md and ANALYTICS_READS.md. Publication is verified separately after this plan is saved.
