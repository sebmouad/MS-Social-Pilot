# Contract compliance audit — 2026-10-21

Audited source baseline: `24a28eecfd9316d8c63b28b39356488ae6fdf214`.
Scope: static review of the whole `rebuild/src` tree against
`ARCHITECTURE_CONTRACT.md` and the lane owner's rules. The original audit edited only this report; the bounded implementation follow-up below records later source changes.
The architecture, design, UX contract, goal, delivery plan and handoff informed
the review; their historical deployment statements were not independently verified.

## Method and confidence

- Recursive grep scans covered provider names/enums/scopes, provider comparisons,
  numeric limits, timers, validation schemas, UI attributes and route persistence.
- A TypeScript compiler-API traversal parsed 1,300 `.ts`/`.tsx` files (excluding
  files ending `.test.ts`) and found 256 JSX-text candidates. Candidate counts
  include Root and bilingual strings: they are **not violation counts**.
- Traced selected candidates through owning configuration, callers and services.
  Findings below cite positive source evidence, not absence inferred from grep.
- This is broad discovery plus selective manual verification, not an exhaustive
  capability/authorization proof. No browser, database, live provider, MCP client,
  server, deployment or production action occurred.

Severity: **High** means a cross-interface contract difference or a shared defect
affecting many customer workflows; **Medium** means a confirmed ownership,
configuration or localization defect; **Low** means a bounded presentation gap.
No exploitable authorization bypass is asserted by this report.
Paths and line numbers below are relative to `rebuild/` at the baseline.

## Prioritized confirmed findings

| File:line | Rule violated and source evidence | Severity | Suggested fix | Owner module |
| --- | --- | --- | --- | --- |
| **Service fixed; AppShell integration pending** `src/modules/agency/server/workspace-selection.ts:27`; `src/modules/agency/mcp.ts:61`; `src/app/api/workspaces/select/route.ts:22` | Same confirmation policy in the service (§4/§9): service accepts omitted confirmation, REST forwards that input, MCP separately requires it. The service comment explicitly describes this interface difference. Membership checks exist; this is consent-policy parity, not a membership bypass. | High | Make the service require the same exact confirmation for every caller; remove the independent MCP presence rule after updating browser submission. If the product intends no confirmation, obtain an explicit common policy decision and change every surface consistently. | Agency |
| **Partial — EN/FR helper fixed; Root delivery pending** `src/lib/ui/form-validation.ts:33`; `src/lib/ui/form-validation.ts:42` | Customer EN/FR and Root copy (§6/§8): shared native-constraint feedback is authored in English, including “Choose an option”, email/URL errors and interpolated length/range errors. No locale/catalog parameter exists. This is application feedback, not browser-owned native popup text. | High | Define typed shared bilingual validation copy in shared configuration; serialize the selected catalog into `FormValidation` and pass it to these helpers. Keep native validity checks unchanged. | Shared UI/config infrastructure |
| **Fixed (source/unit, this lane)** `src/server/connection-mutations.ts:18`; `src/server/connection-mutations.ts:77` | Product encapsulation (§2/§4): the shared server file implements connection selection and disconnect-related product queries, role checks, persistence and resource policy, rather than just infrastructure or re-exports. Its imported product guards do not make the implementation module-owned. | Medium | Move connection lifecycle/selection logic into Settings `server/`; retain a temporary re-export if needed and update callers together. Keep genuine generic locking infrastructure shared. | Settings / Connections |
| **Fixed (source/unit, this lane)** `src/server/post-mutations.ts:15`; `src/server/post-mutations.ts:46`; `src/server/post-mutations.ts:81` | Product encapsulation (§2): actual draft create/edit/delete implementation, role policy, version recording and audit remain outside Publishing. A source-reference search found definitions but no current call sites, so this is residual implementation ownership, not proof of an exposed duplicate endpoint. | Medium | Establish whether these helpers are obsolete; remove after verifying consumers, or move to Publishing and consolidate with canonical draft services. Do not wire them into new routes as a shortcut. | Publishing |
| **Fixed (source/unit, this lane)** `src/server/account-settings.ts:7`; `src/server/account-settings.ts:16`; `src/server/account-settings.ts:22` | Product encapsulation (§2): account password policy and profile-name/password validation are Settings product helpers in shared server code. Shared audit primitives in the same file are a separate responsibility. | Medium | Move account validation/policy to Settings `server/`; separate reusable audit infrastructure and update imports. Existing runtime limits should be preserved, not replaced. | Settings / Account |
| `src/modules/ads/management/server.ts:520`; `src/modules/ads/ui/objects/ChangeHistory.tsx:83` | Root-managed operational limits (§8): recovery-note length is independently fixed to 500 in service and textarea. `ads.managementPolicy` declares history/creative page limits, name length and budget ceiling, not this note limit. | Medium | Add a typed recovery-note limit to Ads config; read it in the service and return it to the UI. Test a non-default value through both callers. | Ads |
| `src/modules/ads/ui/CreativeCreateForm.tsx:125`; `src/modules/ads/ui/CreativeCreateForm.tsx:126` | Root-managed UI limits (§8): message/title/link URL ceilings are fixed at 5000/200/2048. The form receives runtime name limits but these fields ignore configurable descriptors. Even a provider protocol ceiling needs platform-owned metadata rather than a shared UI literal. | Medium | Expose effective field limits from Ads service/platform creative descriptors, bounded by documented adapter protocol invariants and Root policy. Use the same limits in validation and UI. | Ads + Facebook creative adapter |
| `src/modules/ads/ui/objects/ObjectsScreen.tsx:47` | Root-managed limits (§8): parent-ID input hardcodes `maxLength={100}`, while the adjacent search input uses `policy.maxFilterCharacters`. | Medium | Supply an identifier ceiling from the owning validated policy; align UI, REST/MCP and service validation. | Ads |
| **Partial — consumer fixed; Root registration pending** `src/modules/publishing/server/media/storage.ts:23`; `src/modules/publishing/server/media/storage.ts:159` | Root-managed result bounds (§8): `HOLDERS_PER_IMAGE = 5` limits the visible usage-holder list independently of runtime configuration. The total count is separate, so this is an unconfigurable display bound, not a false total allegation. | Medium | Declare an owning media usage-preview bound in Publishing/Media config and consume it when projecting holders. Preserve visibility filtering and total counts. | Publishing media / Media |
| **Partial — consumer fixed; Root registration pending** `src/modules/publishing/server/media/storage.ts:40`; `src/modules/publishing/server/media/storage.ts:143` | Root-managed presentation/storage policy (§8): sanitized filenames truncate at 180 and usage preview text at 80/79. Runtime configuration in the file covers storage root, MIME/bytes and orphan retention, not these lengths. | Medium | Declare typed filename/usage-preview limits in owning config; retain safety sanitization and filesystem-safe upper bounds as documented invariants. | Publishing media / Media |
| `src/platforms/facebook/analytics.ts:178`; `src/platforms/facebook/analytics.ts:224`; `src/platforms/facebook/analytics.ts:301` | Root copy and EN/FR (§6/§8): normalized Ads measures embed English `Advertising`, `Reach · Latest per ad account`, ratio explanations, `Per-account values` and `Stored values`, despite an available presentation locale/catalog. Source line 402 reads Root metric/Page catalogs but these branches use literals. | Medium | Extend Facebook-owned bilingual presentation copy, reuse metric labels consistently, and localize every emitted customer label/note. Verify French normalized output and non-default Root labels. | Facebook analytics |
| `src/modules/ads/management/server.ts:146`; `src/modules/ads/ui/campaigns/CampaignsScreen.tsx:76` | EN/FR runtime integration (§6): calls to `platformAds` omit customer locale. Registry line 42 defaults to ambient `platformAdsLocale()`. These paths do not establish that scope; the screen computes `locale` at line 39 but does not pass it. Thus the configured host can resolve English copy for French customers. | Medium | Carry validated locale through the shared service context and host lookup for UI/REST/MCP, or establish the neutral host locale scope once at the service boundary. Test the real caller path, not just the host factory. | Ads / neutral platform host |
| `src/app/api/ads/management/route.ts:28`; `src/app/api/ads/management/route.ts:45` | Root copy and EN/FR (§6/§8): route-authored invalid-view/request and fallback failure messages are fixed English; no locale/catalog read exists in this entry point. Domain service copy extraction does not cover these transport branches. | Medium | Map stable transport issue codes through the owning bilingual Ads catalog; keep domain validation and consent in services. | Ads |
| `src/modules/ads/ui/campaigns/CampaignsScreen.tsx:115` | Customer EN/FR and Root copy (§6/§8): table caption interpolates localized level labels into the fixed English phrase `results for`, with fixed `ad account` fallback. Captions are customer/accessibility text. | Low | Add a parameterized bilingual Ads caption key and catalog fallback label. | Ads |
| `src/app/loading.tsx:4` | Customer EN/FR and Root copy (§6/§8): global loading state displays literal `Loading your workspace…` without locale selection or configured copy. | Low | Use a shared loading component with serialized locale/catalog, or an appropriate server-readable shared catalog. | Shared app shell |
| `src/app/root/errors/page.tsx:26`; `src/app/root/errors/[id]/page.tsx:20` | Root-configurable labels (§8; owner's labels rule): Root error list/detail have source-authored status/filter/unavailable labels. Root is not a customer screen, so this row does **not** assert a customer French violation. | Low | Add/use an owning Root error-screen catalog and consume it in list/detail rendering. | Root |

## Provider isolation and rejected candidates

No forbidden `provider === 'facebook'`/`instagram` business-rule branch was
confirmed in shared code by this scan. This is a scoped negative result, not
proof that every indirect provider dependency is neutral.

- `src/server/platforms/index.ts:3` and `publication-recovery.ts:3` explicitly
  register installed Facebook implementations: allowed by §3.
- `src/server/config/legacy-import.ts` and provider-named tables in
  `src/server/data-control/` are legacy compatibility/export boundaries: provider
  names alone do not establish a violation. Connection deletion's legacy
  Instagram-table handling also needs preservation until migration/parity is
  proved; do not remove it merely to satisfy grep.
- `src/modules/feeds/wordpress/config.ts` declares configurable legacy WordPress
  meta-field names containing `facebook`. This is source-site field mapping,
  not a Facebook transport branch. Recipe copy mentioning Facebook warrants
  product wording review, but is not counted as provider protocol leakage.
- `src/modules/ads/copy.ts` has provider-named historical message identifiers;
  their neutral validation wording alone does not prove provider logic.
- Calendar/date representation constants, UUID slices, HTTP statuses, zero/one
  arithmetic, ISO country lengths and adapter protocol constants were not counted
  as operational settings merely because they contain numbers.
- Collaboration schemas have fixed defensive maxima, but owning runtime policy
  also declares queue/recycle/bulk/variant limits. Finding those schemas alone
  does not prove runtime limits are ignored; no duplicate finding is filed.
- `t("English key")` JSX is not automatically untranslated: many such calls
  resolve through existing Root-backed catalogs. The AST candidates were triage
  inputs, not automatic findings.

## Thin entry points and capability parity coverage

Sampled Ads management and workspace-selection routes call shared services;
they are not independently accused of duplicating persistence. Route schemas
and protocol guards alone do not violate thinness. The confirmed Agency
confirmation difference above demonstrates that calling the same service is
insufficient when consent still differs at entry points.

Source scans cannot establish full UI/REST/MCP operation parity, resource-scope
enforcement, live confirmations or audit atomicity across every module. This
review did not manufacture a missing-capability claim from tool-name mismatches.
A follow-up owner should inventory each manifest operation, its shared service,
UI control, REST route, MCP handler, actor/scope checks, confirmation and audit,
then run the cross-interface refusal/success matrix. Existing parity documents
remain context, not fresh execution evidence.

## Verification and integration handoff

- From `rebuild/`: `npx tsc --noEmit -p .` — **PASS, exit 0, zero errors**.
- No source/test files changed or added, so no targeted Vitest file is applicable;
  no whole suite was run. No test-pass claim is made for audit recommendations.
- `git diff --check` and an explicit `git diff --no-index --check /dev/null`
  check of this new report — **PASS**, no whitespace errors.
- New Root keys: **none**. Suggested policy/catalog additions above are proposals,
  not registered keys; `CONFIG_SCHEMA_VERSION` is untouched.
- No safe source fix is possible within this lane: every source path is read-only.
  At the original audit baseline all rows remained open; the implementation follow-up below supersedes that status for this lane.
- Integrator should add the prioritized residuals and this report link to
  `ARCHITECTURE.md`, `DELIVERY_PLAN.md` and `AGENT_HANDOFF.md`, then assign bounded
  implementation batches. Those documents are outside this lane's ownership.
- Changes remain uncommitted for integration under the explicit worker no-push
  instruction. Pre-existing untracked node_modules links are untouched.


## Encapsulation/forms/media/agency implementation follow-up

Source and targeted unit/mocked evidence only. No browser, database, provider,
server, deployment, push or production verification. The source baseline row
numbers above are retained; status annotations identify the subsequent changes.

- Settings owns connection lifecycle/selection in
  `src/modules/settings/server/connection-mutations.ts`; the old shared path is
  a re-export. Existing legacy storage compatibility and generic shared locks
  are preserved.
- Publishing owns the residual draft helpers in
  `src/modules/publishing/server/post-mutations.ts`; the shared path is a
  re-export. These are retained for compatibility/tests, not connected to new
  entry points or claimed as canonical authoring parity.
- Settings owns account validation/password policy in
  `src/modules/settings/server/account-policy.ts`. The shared account file
  retains reusable audit primitives and re-exports account policy. Runtime and
  synchronous-policy limits are preserved.
- Form validation has a typed EN/FR catalog and schema in its owned helper;
  `collectFormErrors(form, customErrors, selectedCopy)` accepts serialized Root
  copy. Existing callers select defaults using the form/document language.
  Native validity, disabled fields, password whitespace and custom-error priority
  are unchanged. Root registration/delivery is still incomplete.
- Agency's service requires exact `SELECT WORKSPACE <id>` before membership
  lookup, persistence, audit or cookie mutation. MCP delegates the same rule.
  Agency `WorkspaceAction` sends that confirmation. The shared AppShell picker
  remains an integration dependency and will receive a refusal until updated.
- Media storage consumes a validated `storage.mediaPresentationPolicy` through
  `runtimeConfig`: `holdersPerImage`, `fileNameMaxCharacters`,
  `usagePreviewMaxCharacters`, `fallbackFileName`. Non-default tests retain total
  counts, apply visibility before the holder bound and preserve sanitization.
  Display names never become storage paths: the existing validated UUID path
  invariant remains. If configuration cannot load, shipped defaults preserve
  availability; Root registration is still incomplete. The definition is staged
  in owned `server/media/config.ts`, separate from its runtime reader.

Required integration edits outside this lane's ownership:

1. `src/modules/publishing/config.ts`: import `MEDIA_PRESENTATION_CONFIG` from
   `./server/media/config` and spread it into `PUBLISHING_CONFIG`. This registers
   `storage.mediaPresentationPolicy`; until then only its shipped defaults apply.
2. `src/lib/config/shared-config.ts`: register proposed JSON key
   `shared.formValidationCopy`, with `formValidationCopy` as default and
   `formValidationCopySchema` as schema, exported from
   `@/lib/ui/form-validation`. Root registration has not been made by this lane.
3. Shared server layouts must load that catalog with `runtimeConfig`, select the
   validated customer locale and serialize it through a client validation-copy
   context. `src/components/FormValidation.tsx` must read that context and pass
   its messages as the third `collectFormErrors` argument. Include public auth
   layouts as well as authenticated/Root layouts; document language is only the
   shipped-default fallback, not proof of Root copy delivery.
4. `src/components/AppShell.tsx`: change the existing workspace POST body to
   `JSON.stringify({ workspaceId: nextId, confirmation: `SELECT WORKSPACE ${nextId}` })`.
   Retain existing explicit selection, pending and error behavior. Do this before
   releasing the Agency service change.
5. Architecture/delivery/handoff owners should record these three closed
   encapsulation findings and the pending integration dependencies. The
   integrator owns any `CONFIG_SCHEMA_VERSION` bump; this lane leaves it intact.

Validation: `npx tsc --noEmit -p .` passed with zero errors. Targeted Vitest
checks pass with caching disabled (`--no-cache`): 102 tests across 13 files
(95 service/validation/media/policy assertions and 7 Agency UI assertions).
The initial run could not write its symlinked external cache (EPERM); disabling
that cache avoids writing outside this worktree. The full suite was not run.
