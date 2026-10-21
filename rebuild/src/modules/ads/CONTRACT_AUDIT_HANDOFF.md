# Contract audit lane handoff — 2026-10-21

Worker scope: Ads, Facebook analytics **copy only**, global loading and Root error screens. Changes are uncommitted; no push, server, deployment, production or live-provider action. Registry schema version remains **122**, untouched by this worker.

## Audit row dispositions

The audit report itself is outside the explicitly owned paths. Integrator: annotate the following rows in `docs/CONTRACT_AUDIT_2026-10-21.md`; do not mark the last two fully closed before registration.

| Baseline finding | Disposition and evidence |
| --- | --- |
| Ads recovery note 500 | Fixed at source: `ads.managementPolicy.recoveryNoteMaxCharacters`; service/REST/MCP enforce it; page serializes it to ChangeHistory. Non-default service, REST, MCP and textarea tests. |
| Creative 5000/200/2048 | Fixed in owned product paths: three validated Root policy fields, used by shared preview/apply parsing and serialized creative sources. UI consumes the same fields. Existing adapter ceilings remain an independent stricter guard; neutral platform limit descriptors remain an adapter-owner follow-up if broader formats/ceilings are introduced. |
| Parent ID 100 | Fixed: `ads.managementPolicy.parentIdMaxCharacters`; directory UI and shared directory service use the minimum of this and report-filter policy; management creation parser also checks it. MCP uses that same service. |
| Facebook normalized Ads English copy | Fixed at source: bilingual `ads.*` presentation entries in existing extensible `meta.metricLabels`, localized metric labels, categories and overlap notes; includes delivery breakdowns and unknown currency. French and custom Root override tests. Registering these defaults in the owning Facebook config improves Root discoverability; see below. |
| Customer locale to platformAds | Fixed: shared Ads snapshot establishes validated HTTP locale (preserves standalone MCP host scope); management and campaign UI explicitly pass locale to host lookup. REST/MCP-to-host and nested service locale tests. |
| Management route literals | Fixed: stable bilingual Ads catalog keys, including origin refusal and safe fallback text. Real route tests cover French and customized Root values. |
| Campaign table caption | Fixed: `resultsCaption` and `accountFallback` in `ads.customerCopy`. |
| Global loading | Bilingual/config-reading consumer implemented and tested. **Pending shared registry registration** of `ui.loadingCopy`; current unregistered-key path safely uses bilingual defaults. |
| Root errors | List/detail, metadata, filters, status, empty/failure and resolve-action copy use a typed bilingual catalog. **Pending shared registry registration** of `root.errorCopy`; current unregistered-key path safely uses bilingual defaults. |

## Root settings

Existing registered `ads.managementPolicy` gains these JSON fields (legacy stored policy objects receive schema defaults):

- `recoveryNoteMaxCharacters`: default 500, Root range 1–500.
- `creativeMessageMaxCharacters`: default 5000, Root range 1–5000.
- `creativeTitleMaxCharacters`: default 200, Root range 1–200.
- `creativeUrlMaxCharacters`: default 2048, Root range 1–2048.
- `parentIdMaxCharacters`: default 100, Root range 1–100.

These upper bounds preserve the previous acceptance envelope; the product settings can tighten it. Current provider validation still runs independently and may refuse additional semantics.

Existing `ads.customerCopy` gains `resultsCaption`, `accountFallback`, `managementInvalidView`, `managementLoadFailure`, `managementInvalidRequest`, `managementOriginDenied`, `managementOutcomeUnknown`. `service064` now interpolates `{max}` instead of claiming a fixed note limit.

Existing extensible `meta.metricLabels` accepts these bilingual override entries: `ads.source`, `ads.latest`, `ads.latestDay`, `ads.latestDayNote`, `ads.selectedAccounts`, `ads.perAccount`, `ads.stored`, `ads.unknownCurrency`. Defaults are exported as `FACEBOOK_AD_ANALYTICS_COPY_DEFAULTS` in the owned analytics file. Categories and overlap reuse `meta.pageAnalyticsCopy`.

New top-level keys requiring integration: `root.errorCopy`, `ui.loadingCopy`. Do not bump `CONFIG_SCHEMA_VERSION` until the integration owner combines all lanes.

## Exact outside-owned integration edits

1. `src/lib/config/shared-config.ts`: register `root.errorCopy` with the schema/defaults/entry prepared in `src/app/root/errors/config.ts` (`ROOT_ERROR_CONFIG`). Prefer moving that declaration into shared config ownership (`src/lib/config/root-error-copy.ts`) and updating the two owned imports in errors/copy.ts and ResolveError.tsx plus tests. It is not currently registered.
2. Same shared config: register `ui.loadingCopy`, kind `json`, default `{ en: 'Loading your workspace…', fr: 'Chargement de votre espace de travail…' }`, schema matching loading.tsx: strict object with en/fr trimmed non-empty strings, max 4000. Prefer a shared config-owned exported catalog/schema used by loading.tsx. It is not currently registered.
3. Optional discoverability improvement in `src/platforms/facebook/config.ts`: move/export `FACEBOOK_AD_ANALYTICS_COPY_DEFAULTS` there, spread it into `FACEBOOK_METRIC_LABEL_DEFAULTS`, and import it from analytics.ts. Existing `meta.metricLabels` already validates arbitrary bilingual entries and the consumer already merges them, so saved overrides work without that move. Do not import analytics.ts into config.ts (it imports config and server data).
4. `docs/CONTRACT_AUDIT_2026-10-21.md`: annotate rows per table above. `docs/ARCHITECTURE.md`, `docs/DELIVERY_PLAN.md`, `docs/AGENT_HANDOFF.md`: record source/test evidence and pending registrations, not production completion.
5. Adapter ownership remains unchanged: `src/platforms/facebook/ads-ops/index.ts` still independently enforces its existing creative ceilings. No protocol/transport code was changed in this copy-only lane.

## Verification

From `rebuild/`: `npx tsc --noEmit -p .` passed with zero errors. Targeted Vitest runs use `--no-cache` because the pre-existing node_modules symlink points to a cache location this sandbox cannot write. Eleven distinct targeted files passed, **242 tests** total; no full suite. Affected tests were rerun after the policy-field rename.

- ads-parity-management.test.ts: 158
- ads-copy-catalog.test.ts: 4
- ads-parity-directory.test.ts: 17
- ads-creative-ui.test.ts: 4
- facebook-analytics-live-defects.test.ts: 7
- ads-management-ui74.test.ts: 5
- ads-creation-recovery.test.ts: 11
- contract-audit-shell.test.ts: 5
- ads-route-errors.test.ts: 23
- ads-creative-surfaces.test.ts: 5
- ads-management-transport-copy.test.ts: 3

`git diff --check` passed. Evidence is unit/mock/jsdom/static rendering only. No browser, database, live provider, MCP-client, build or production verification is claimed. Pre-existing tests exercise safe fallback when DATABASE_URL is absent; that does not constitute database evidence.

## Files changed

- `src/app/api/ads/management/route.ts`
- `src/app/loading.tsx`
- `src/app/root/errors/ResolveError.tsx`
- `src/app/root/errors/[id]/page.tsx`
- `src/app/root/errors/page.tsx`
- `src/modules/ads/copy.ts`
- `src/modules/ads/directory/server.ts`
- `src/modules/ads/management/config.ts`
- `src/modules/ads/management/server.ts`
- `src/modules/ads/server/copy.ts`
- `src/modules/ads/server/errors.ts`
- `src/modules/ads/ui/CreativeCreateForm.tsx`
- `src/modules/ads/ui/campaigns/CampaignsScreen.tsx`
- `src/modules/ads/ui/objects/ChangeHistory.tsx`
- `src/modules/ads/ui/objects/ObjectsScreen.tsx`
- `src/platforms/facebook/analytics.ts`
- `tests/ads-copy-catalog.test.ts`
- `tests/ads-creation-recovery.test.ts`
- `tests/ads-creative-ui.test.ts`
- `tests/ads-management-ui74.test.ts`
- `tests/ads-parity-directory.test.ts`
- `tests/ads-parity-management.test.ts`
- `tests/facebook-analytics-live-defects.test.ts`
- `src/app/root/errors/config.ts`
- `src/app/root/errors/copy.ts`
- `tests/contract-audit-shell.test.ts`
- `tests/ads-management-transport-copy.test.ts`
- `src/modules/ads/CONTRACT_AUDIT_HANDOFF.md`
