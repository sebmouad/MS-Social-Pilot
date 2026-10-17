# Synthetic preview evidence

Scope: a fresh loopback PostgreSQL database populated only by `scripts/seed-preview.ts`; no production data or valid provider credentials. Chrome used `http://localhost:3200`. No publishing worker ran. Fake provider endpoints use reserved `.invalid` hosts.

## Observed browser and API results

- Analytics rendered 22 metric groups, audience **2,020** from 1,280 + 740, coverage **2 of 4** selected channels, and missing-audience names. USD 300.00 and EUR 92.40 remained separate. Unknown action/numeric/breakdown fields appeared with coverage. Neither unselected nor invalidated account metrics appeared.
- At 390 × 844, Analytics, Posts, Inbox and Ads had no page-level horizontal overflow. Analytics was visually inspected in Coast and Nightfall on phone and Grove on desktop; desktop Coast was also inspected. This is not an exhaustive theme/accessibility review.
- Posts displayed draft, published and scheduled samples; the expanded fixture also adds pending approval, failed delivery, and a draft first comment. Draft/failed deliveries have no remote IDs.
- Inbox opened a synthetic conversation with its stored history and reply window. Resolve and reopen persisted through the UI; the final fixture conversation remains open. A synthetic channel-authored comment reply is recognized as the channel side.
- Ads rendered campaign, ad-set and ad details for both currencies. A synthetic campaign creation failed as expected against the fake connection. The confirmation dialog remained open with the entered name and an actionable error. No remote campaign was created.
- Connection management showed channel/ad-account checkboxes. Unchecking the EUR account and saving removed it and its monetary series from Analytics; restoring it brought back the third selected account and EUR series. Original selection was restored.
- Authenticated HTTP MCP initialize, tools/list and resources/list returned 200. Sample reads for Analytics, ad accounts, posts and Inbox returned scoped data. Analytics matched the UI: audience 2,020, 22 metrics, three selected ad accounts. Posts exposed six samples including the first comment. Anonymous tools/list returned 401 / -32001. These checks use the browser session; bearer keys, writes, remote outcomes and full MCP parity remain separate gates.

## Defects exposed and repaired

1. Legacy-schema nested post delivery insertion omitted its required `updatedAt`. Rebuild mapping now manages that field; a rollback-only PostgreSQL regression probe verifies real insertion and cleanup.
2. Extra non-monetary advertising metrics showed coverage such as “1 of 0”. The Facebook normalizer now counts all selected ad accounts for non-currency metrics; monetary metrics retain currency-specific denominators. Browser results now show valid coverage such as 1 of 3.
3. Inbox last-sync reading failed after development route recompilation with PostgreSQL `text = jsonb`. Restarting alone gave only temporary relief. The query now uses a bound `text[]` / `ANY` predicate, avoiding a nested generated-client SQL fragment. Resolve/reopen and subsequent navigation succeeded without restarting. A PostgreSQL probe verifies matching workspace and channel audits and rollback; it does not itself reproduce the development bundler mismatch.
4. Ads management read an unregistered `ads.managementEnabled` setting and failed the results page. Registry version 28 adds the Root boolean (default off). Regression checks cover its schema/default and all literal runtime setting reads; Ads now renders the configured synthetic controls.

## Remaining findings and scope limits

- The localhost versus 127.0.0.1 origin mismatch needs explicit canonical-origin/proxy coverage before release.
- Customer copy still includes storage/provider type jargon and raw status codes in some places. Design/copy polish remains incomplete.
- No real remote publishing, remote deletion, inbox reply, ad delivery/change, backup restore, production-shaped migration or cutover was exercised by this synthetic batch. The full architecture and release requirements remain open.

## Automated verification

The integrated batch passed **369 tests in 80 files**, with `REBUILD_PREVIEW_DATABASE_URL` set so both PostgreSQL probes ran, **TypeScript checking**, and **production compilation**. A skipped database probe must never be described as passing. The fixture seeder was executed repeatedly, and its production, remote-host, non-preview-name and host-override refusal paths were checked. It never reads the legacy application `.env`.

## Connection health and inventory follow-up

Home now uses the selected channel loader and the same ad-account predicate as Ads/MCP. In the synthetic browser it displays four channels and three accounts, excluding unselected and revoked sources. MCP `list_pages` returns the same four channel names. Tenant and enabled-platform filters are shared through `selectedResourceConnectionWhere`; expired credentials do not erase retained history.

Connections shows expired and revoked social/ad accounts as **Reconnect needed**. Its status labels come from the Root-managed `connections.statusLabels` registry entry (version 29), with bounded non-empty values. The shared selection service rejects attempts to enable expired/revoked sources or resources from a disabled module; disabling a stale resource remains allowed. The dialog permits undoing an unsaved deselection and omits unchanged items from the request.

Browser checks verified unchecking and restoring an expired channel before saving, with both actions still available. An actual local API request to enable the expired channel returned **409** and the reconnect message. The equivalent MCP ad-account request returned a tool error with the same message. These refusal checks did not change fixture selections. The phone Connections screen fit a 390px viewport without page overflow. The selection dialog was visually inspected in Nightfall at 390 × 844, and the connections table in Grove on phone and desktop. Regression tests cover expiry boundaries, disabled modules, stale-resource removal, selection undo/no-op writes, Home counts, post scope and MCP query bounds.

Follow-up verification: **383 tests in 84 files**, including both PostgreSQL probes, TypeScript checking and production compilation passed. No live provider or production deployment evidence is implied.

## Shared dialog recovery follow-up

The shared native dialog now exposes its busy state, keeps focus inside when its active control becomes disabled, and recovers to a usable safe action after failure. Updating the preferred focus selector no longer closes/reopens the modal or replaces its original return-focus target. The styled Dialog wrapper forwards busy state and disables its close button; Inbox deletion, calendar moves and connection selection consume that behavior.

Inbox comment deletion now retains its confirmation and displays a failure inside it. Previously the failure closed the dialog while leaving its error behind the modal context. A confirmed success still closes/navigates. No service or provider authorization rules changed.

Chrome checks against fake preview connections verified:

- A failed campaign creation kept its name/error/dialog and focused Cancel. Escape closed it and returned focus to the Create paused campaign opener.
- A failed synthetic comment deletion kept the error and focus in the open dialog. Escape returned focus to Delete comment; the example comment remained stored.
- The Inbox error dialog fit at 390 × 844 in Nightfall. Native Shift+Tab wrapped from Close to Delete comment, and Tab wrapped back to Close; focus stayed in the dialog. Desktop recovery was checked in Grove.

Component regressions cover disabled-control fallback, recovery, opener restoration, selector updates without reopening, pending close/Escape protection and failed Inbox deletion context. Native modal behavior is checked in Chrome because JSDOM requires a small modal API shim. This batch did not create or remove remote content and does not establish success-path provider deletion coverage.

Dialog follow-up verification: **388 tests in 86 files**, including both PostgreSQL probes, TypeScript checking and production compilation passed.

## Facebook server-module consolidation

Facebook runtime construction, OAuth state/cookie handling, connection flow and discovery persistence now live under `src/platforms/facebook/`, along with a provider-owned `host.ts` assembling its operations and jobs. The installed server list imports that host; neutral contracts live in `src/server/platforms/host.ts`. Shared adapter contracts no longer declare Facebook campaign objectives. Shared retries consume a generic adapter hint while Facebook retains its own transport/rate-limit classification.

Source boundary regressions reject reintroducing the old provider-specific server files, provider imports in shared retry code, provider enums in shared contracts and inline provider workflow assembly in the installed list. Regression coverage includes generic retry hints plus the existing Facebook HTTP/Graph classifications, OAuth state/session/workspace binding, discovery and enabled-capability dispatch.

After the move, local Connections and Root Platforms rendered, authenticated MCP Analytics still returned audience 2,020 and 22 metrics, and the Root config endpoint returned schema version 30 without the unused uninstalled-provider scope placeholder. These are synthetic fixture smoke checks. No provider credentials, connection records, database schema or production service were changed by the consolidation. Remaining legacy-shaped MCP/error mappings are recorded in the architecture gaps.

The actual local Root API module switch was also exercised and restored: with Facebook disabled, authenticated MCP returned zero selected channels, zero ad accounts and zero metric groups; restoring the prior enabled value returned four channels, audience 2,020 and 22 metrics. Only the synthetic preview instance was affected; value-free configuration audit entries record the two setting changes.

## Inbox policy and MCP visibility

An additional local Root switch check exposed a gap: MCP `list_inbox` still returned one conversation and two visible comments while Facebook was disabled. UI and MCP now share the selected/authorized channel predicate, including parent-workspace ownership, non-revoked connections and enabled Inbox modules. Repeating the actual browser-session MCP call returned **0 conversations / 0 comments** while disabled, then **1 / 2** after restoring the original Root value. The original setting was restored in a `finally` block; fixture records were retained.

Facebook owns Messenger reply-window calculation, its configuration read and safe reply metadata. The neutral Inbox view dispatches through the module host. Chrome showed the synthetic message history and its 24-hour deadline in the workspace time zone. Module dispatch and missing/disabled-provider refusal have regression coverage. This fixture check does not prove a remote reply, remote deletion or full MCP Inbox parity.

The combined suite passed 415 tests across 88 files, including both rollback-only PostgreSQL probes against the dedicated preview database. TypeScript checking, the production build and `git diff --check` passed.

## Typed Ads failures and write shape

Regression tests reproduced raw internal/provider exception exposure through the four Ads HTTP routes, a live-read MCP tool and Ads creation metadata. Shared routes now accept explicitly safe operation errors and mask unknown exceptions, without matching provider strings. Facebook scope-policy failures use availability/reconnect copy rather than Root setup instructions. All MCP Ads tool calls share the boundary and preserve public messages and codes. A failing Ads resource read also has regression coverage for safe JSON-RPC failure responses.

The actual local browser session checked management refusal through HTTP and MCP with `ads.managementEnabled` temporarily off. HTTP returned **409**, MCP returned a tool error, and both carried `code: unavailable` and `Ads management is currently unavailable.` The original Root value was verified and restored in a `finally` block. The open Publishing page was unchanged and no provider mutation was attempted.

Separate regressions caught combined status-and-budget changes accepted by the shared service and numeric-string budgets coerced by MCP despite HTTP rejecting them. The service now enforces exactly one change; MCP rejects non-number budgets. The current full suite passed **442 tests**, with **2 database probes explicitly skipped** because this run omitted their database environment variable. Both probes passed in the preceding Inbox batch. Current TypeScript checking passed. These are synthetic and automated boundary checks, not live provider or full authorization-parity evidence.

Final local HTTP/MCP checks returned `invalid_request` for a string budget; MCP also refused a combined status/budget update before any provider request. The production build passed in an isolated temporary source copy so the user's running preview was not interrupted. Existing Autoprefixer CSS start/end compatibility warnings remain. `git diff --check` passed.

## Core design checkpoint

The user's 2026-10-16 priority is core design before additional Facebook coverage. Navigation, Posts view, Root organization and visual-direction approval forms are pending; [CORE_DESIGN_PLAN.md](CORE_DESIGN_PLAN.md) records the requested legacy-inspired direction and proposed batches. The new shell and post layouts are not implemented by this checkpoint.

Lower-cost agents completed two reviewed foundation fixes: flex alignment keywords now use compatible `flex-start`/`flex-end` values without replacing grid alignment; and the Facebook engine requires explicit `success: true` before confirming comment deletion. Regression tests cover false, missing/malformed, and successful confirmation. Durable deletion reconciliation and new MCP deletion remain open.

A workspace-selection endpoint is ready for the proposed sidebar picker. It verifies same origin, a fully authenticated enabled-user session and current membership before setting the HttpOnly selection cookie. The synthetic browser check refused a non-member workspace with **404** and accepted the current workspace with **200**, without navigation. The combined suite passed **452 tests**, with two opt-in database probes skipped; TypeScript and the isolated production build passed. The build emitted no Autoprefixer start/end warnings after the reviewed CSS changes. This is not complete core-design or live-provider evidence.

Consolidation verification: **406 tests in 87 files**, both PostgreSQL probes, TypeScript checking and production compilation passed. A limited scan of 74 generated browser chunks found none of the checked module-runtime/credential-helper markers; this is supporting boundary evidence, not a complete security audit.


## Approved two-sidebar design batch, 2026-10-16

The four approval forms are now answered: two left sidebars, Table default with Feed and Cards, a grouped private Root center, and refinement of Grove/Coast/Clay/Nightfall. The implementation and remaining design work are recorded in [CORE_DESIGN_PLAN.md](CORE_DESIGN_PLAN.md).

Chrome checks with the synthetic fixture verified:

- Desktop Posts has a narrow module rail, contextual workspace/New post/pages/filters sidebar, a default six-row Table, collapsed Manage post actions and collapsed CSV import. There is no always-expanded composer or third settings menu.
- Switching Feed to Cards and choosing Draft through the sidebar produced `?view=cards&status=draft&channel=`, retained both selections and rendered one draft with its first comment. Feed also showed per-destination state and published links where stored.
- At 1200px desktop and 390 × 844 phone widths, Cards rendered all six examples without page-level horizontal overflow in each of the four themes. Theme variants were applied temporarily to the DOM for layout checks; this does not constitute a theme-preference persistence test. Screenshots were visually reviewed for desktop Grove Table and phone Clay Cards; phone Nightfall Feed was also reviewed.
- Root Overview read actual installation counts. Operations displayed an explicit missing-worker-tables state in this preview database; no worker was started and healthy operations were not fabricated. Activity rendered stored audits without raw detail JSON.
- Root configuration search lived inside the contextual sidebar, with no search/category column in the main work area. Searching `activityPageSize` returned one matching setting. At 390px, the single Root drawer included the same search, sections and categories; it focused Close, made the background inert and fit without overflow. Shift+Tab/Tab wrapped between Close and Sign out; Escape returned focus to Menu & filters. Desktop-transition focus behavior additionally has a component regression.
- A real Chrome Offline save attempt kept the changed activity-limit draft (`51`), showed an actionable error and re-enabled Save. Networking was restored and the page reloaded to discard that unsaved edit; no configuration write reached the server.
- Eighteen additional authenticated route fetches returned 200 with their expected headings: Home, calendar, queue, approvals, composer, image library, Analytics, both Ads pages, six Settings pages and Root users/workspaces/platforms. This is a rendering smoke check, not a completed interaction audit of those routes. Phone Inbox also rendered without page-level overflow under the new shell.

The full suite passed **476 tests across 95 files**, including both rollback-only PostgreSQL probes. TypeScript checking, an isolated production build and whitespace checks passed. The isolated build kept the user's development preview running and emitted no CSS alignment compatibility warnings. Vitest still prints its existing Vite CJS and Tailwind content configuration notices; deliberate cutover refusal tests print their expected refusal messages.

Regressions cover permission-filtered shell links/quick creation, workspace and sign-out failure recovery, contextual dock placement, mobile Root App exit, drawer/desktop-transition focus, media/link safety, first comments, Root authorization before data loads, audit redaction/limits and config draft/retry/duplicate-write handling. A reviewer initially reported overwritten post scope, then retracted it after verifying Prisma's separate top-level OR and channel filter are combined with AND; no authorization change was made for that false positive.

Remaining: complete every core route/control/state in all themes and permission variants; reuse/refine previews in publishing workflows; improve missing profile/media example coverage; finish the legacy Root inventory and complete searchable/paginated audits. No real provider operations, production deployment or cutover were performed by this design batch. Shared Inbox deletion reconciliation and full MCP capability parity remain open.


## Publishing workflow design and recovery, 2026-10-16

The dedicated composer now has live neutral content/first-comment previews, one active attachment type, and destination/timing/actions in the existing contextual sidebar. Shared healthy-destination loading removed the expired fixture channel from publish-ready choices while retaining its readable history. Queue and approval work surfaces use the same full saved post preview, within a 720px reading measure. Calendar opens that preview in the shared dialog and docks Previous/Today/Next navigation beside the existing filters.

Observed local evidence:

- Optional, repeatable synthetic campaign images were added with `seed-preview.ts --media-only` to empty fixture attachments. Existing messages, statuses and attachments were preserved. Both bundled images decoded through authenticated `/api/media/<id>` at 1200px source width. The six fixture posts remain stored for review.
- Chrome filled a clearly identified local-only draft with a first comment and selected channel. A File created from the already-authorized example image was assigned to the browser's file input because the automation file chooser could not access local filesystem paths. The actual composer uploaded it and returned `notice=created`. Authenticated MCP `list_posts` verified draft state, the first comment, one `media:<uuid>` reference and the pending selected destination. This is an actual HTTP upload/server-action/MCP check, not a mocked service result.
- MCP deletion of the image while attached was refused with `code: conflict`. Confirmed local post deletion then succeeded with `remoteDeletionRequested: false`; confirmed unused-image deletion succeeded; a subsequent image read returned 404. No worker or remote publishing was involved.
- An initial Offline save test exposed loss of the editor through the global error boundary. Client transport recovery now leaves post text and first comment in place, shows an unconfirmed-save message and opens Posts separately for inspection before retrying. Repeating the actual Offline test retained both fields and enabled retry. Restoring networking and retrying created exactly one matching local draft, whose first comment was verified through MCP. It was then deleted, and MCP re-read confirmed six fixture posts and no matching verification draft. This does not establish idempotency after a server commit whose response is lost.
- At 390 × 844, saving an empty composer from its contextual drawer initially hid validation behind an inert editor. The shared shell now closes that drawer, focuses `main-content` and reveals the top-of-form error. The repeated browser check showed the error at y=178.5, no modal/inert work area and no horizontal overflow; no post was created.
- Chrome and Node returned different Casablanca clock times for the same October timestamp. This caused an actual hydration error. Previews now consume server-formatted times; calendar hour grouping, move choices and ended slots use server-resolved wall-time data, and move success includes a server-formatted receipt. Fresh composer and desktop Week calendar navigations emitted no console errors/warnings. The Week view showed 1:00 AM for fixture publications and had no page overflow. Date validity, DST, future time and permissions remain server checks.
- The calendar preview dialog showed the saved image and both published destination states; Escape closed it and restored the View post opener. In phone Nightfall it measured 352px within the 390px viewport, decoded its image and had no page overflow. Calendar preview/navigation, server-time DTO consumption, move receipt and elapsed-slot refusal have component regressions.
- Composer, Queue and Approvals had no page-level horizontal overflow at 390 × 844 in Grove, Coast, Clay and Nightfall (temporary DOM theme checks). Desktop Grove composer and queue and phone Nightfall calendar preview were visually inspected. This is not exhaustive per-control/theme/accessibility coverage.

Media HTTP routes and all four MCP image tools now preserve intentional typed validation/availability failures and mask unexpected filesystem/internal exceptions. Regression tests cover safe format/size/cursor feedback, storage unavailability, raw path redaction, workspace guards and confirmation behavior. Other MCP tool domains still need equivalent safe error boundaries; full parity is not claimed.

Integrated verification passed **503 tests across 101 files**, including both rollback-only PostgreSQL probes, TypeScript checking and an isolated production build. Whitespace checks passed. The preview stayed running; production and provider settings were not changed. Missing legacy Root controls, other core module design/state parity, inline post-edit/import failure recovery, generic MCP hardening, lost-response idempotency and live-provider/cutover gates remain open.

## Root workspace access and shared field review, 2026-10-16

Local Chrome verified directory search is in the contextual sidebar, not main content. The actual Suspend confirmation paused `preview_workspace`; authenticated MCP returned a suspension timestamp and rejected a post write with typed `forbidden` before creation. A `finally` restoration via the shared Root MCP tool returned `suspended: false`; the directory showed Active, six posts and unchanged record counts. No provider request was needed. The retained Root audit records show the two access changes.

The rollback-only PostgreSQL probe created an identifiable temporary owner/workspace, suspended it, verified side effects were rejected, restored it, verified operations resumed, and checked both audit actions. It rolled back and verified user, workspace and audits were absent. This checks real storage and shared service behavior; it is not a concurrent-lock timing test. Background sync regressions separately verify rejection prevents status, analytics, Ads and Inbox provider requests and writes.

At 390 × 844, the Suspend dialog measured 358px with no page/dialog overflow in Grove, Coast, Clay and Nightfall; its themed input measured 44px. Nightfall was visually inspected. Escape returned focus to Suspend. The access-limited page and its phone drawer rendered workspace identity, private Root access for the fixture owner and Sign out, without old preview/setup copy. Multi-membership switching in this exact denial state remains a separate browser case.

Final verification passed **524 tests across 106 files**, including all three rollback-only PostgreSQL probes; the isolated production build also passed its TypeScript and route checks. Root empty search at `page=999999` rendered “0 matching workspaces” and “Page 1 of 1”, kept empty-state copy outside the horizontal table region, and emitted no browser console errors or warnings. Whitespace checks passed. No production cutover, destructive migration or live provider test was performed. Remaining Root legacy controls, generic MCP error hardening, full capability parity and release gates stay open.

## Root historical audit search, 2026-10-16

Root Activity now reads historical records through one currently authorized service. Sidebar filters search actions or actor names/emails literally, filter an exact top-level workspace ID and inclusive UTC dates, and choose a bounded page size. Latest/Newer/Older links use filter-bound tuple cursors. Raw audit JSON is omitted consistently from UI, HTTP and MCP. Workspace API keys do not receive the tool/resource and cannot force their invocation.

Chrome entered the filters through the actual desktop form and requested one workspace event for 2026-10-16. UI, HTTP and MCP returned the same `root.workspace_restored` ID and safe suspension metadata; Older showed the preceding suspension event with the filters retained. Anonymous HTTP returned 401. Authenticated MCP advertised `list_root_activity` and `msp://root/activity`; the resource returned bounded safe records without a raw detail field.

At 390 × 844, all five sidebar fields measured 44px and the drawer measured 330px, without page/drawer horizontal overflow in Grove, Coast, Clay or Nightfall (temporary DOM theme checks). Nightfall drawer was visually inspected. Shift+Tab from Close wrapped to Sign out, then Tab returned to Close. Submitting a no-match search closed the drawer and revealed the deliberate empty state. A malformed cursor showed Check activity filters and reset recovery; Reset returned to history. Fresh reset navigation emitted no console errors/warnings. Desktop history also had no overflow. These are local synthetic checks, not exhaustive accessibility or large-data evidence.

The actual Root configuration API temporarily set audit page size to 1, search characters to 3 and cursor characters to 512. A longer search returned 400; a valid short search returned one record and a 239-character continuation token. A `finally` block restored all three prior effective values, and a subsequent safe read verified restoration. Only the synthetic local installation was affected; configuration audits remain as intended.

The new rollback-only PostgreSQL probe creates a temporary owner and tied-time audit rows, checks both paging directions with a later inserted event, literal percent/underscore/backslash matching, date/workspace and actor scope, omission of private JSON text, and current-owner demotion denial. It rolls back and confirms the user/audits are absent. No production schema, provider request or deployment was changed.

Remaining: production-volume search/cursor query plans and potential reviewed indexes, audit exports/retention, generic error/log administration, membership-independent private Root MCP transport, broader core parity and all release gates. Final verification passed **546 tests across 110 files**, including all four rollback-only PostgreSQL probes, TypeScript checking, an isolated production build and whitespace checks. Independent agent review was unavailable because the agent service reported exhausted workspace credits; the batch received inline authorization, SQL, cursor, transport and UX review instead.

Final timezone review reproduced a real cursor error after `SET LOCAL TIME ZONE 'Pacific/Honolulu'`: binding JavaScript Date objects coerced comparisons against legacy UTC `TIMESTAMP(3)` storage. Cursor anchors now bind canonical ISO text with explicit timestamp casts; date boundaries bind validated date text and compute the following midnight in PostgreSQL. The repeated rollback-only probe passes in that non-UTC session, including a 00:05 UTC event. It also covers the valid 9999-12-31 upper date, whose following midnight previously generated an unsupported extended JavaScript ISO year. Existing legacy timestamps are interpreted as UTC; this batch does not repair historically mis-zoned records.

## Membership-independent installation MCP and recovery, 2026-10-16

MCP now has discriminated installation/workspace identities and a shared private Root dispatcher. Explicit `scope=installation` bypasses workspace loading but requires a current fully verified active installation owner. Explicit `scope=workspace` requires actual grants and hides Root tools. Automatic context can fall back to Root for owners without usable workspace membership/roles/grants. Workspace API keys never gain Root context and a supplied bearer takes priority over cookies. Current-owner checks, typed registry validation, exact confirmations, safe Root errors, no-store responses, global availability and per-owner installation request budgets are covered by regressions. Configuration writes rely on the shared atomic domain audit; the separate after-commit MCP audit for that operation was removed.

`scripts/verify-installation-mcp.ts` is guarded to the seeded loopback `_preview` database and an explicit localhost HTTP origin. It created an identifiable temporary owner with zero memberships and an enrolled authenticator. Actual password sign-in returned a pending verify session; installation MCP denied that pending session. Actual TOTP verification completed sign-in. Automatic and explicit installation contexts exposed five Root tools and three private resources, denied customer post reads, returned masked secret values and completed a same-value configuration write with exactly one transactional `config.changed` audit for that key.

The probe created a disposable workspace/membership and a scoped key under the seeded fixture owner; the installation probe owner itself retained zero memberships. With the membership-free owner's session cookie also present, that key still exposed only its permitted workspace read; installation scope returned 401. The same probe verified immediate denial after owner demotion and account disable. It verified the no-workspace route's Root redirect and direct private Root page access. The first run's redirect assertion incorrectly assumed a 3xx header; actual Next.js output was a 200 streaming meta redirect. That test assumption was corrected, and Chrome independently followed `/no-workspace` to `/root`. Failed and successful probe attempts cleaned their temporary records. Final cleanup explicitly checked users, sessions, keys, the disposable workspace/membership and probe audits were absent and the original setting value/encryption flag/timestamp were restored.

Root overview's Copy endpoint action succeeded in actual Chrome. At 390 × 844 its panel measured 358px without panel/page horizontal overflow in all four temporary DOM themes; Nightfall was visually inspected. Fresh desktop Root navigation emitted no console errors or warnings. Customer API-key copy now describes workspace policy; the private guide remains on Root only. These are synthetic local UI/auth/HTTP/MCP checks, with no provider request, production change or cutover.

Remaining: installation bearer/OAuth issuance, remaining Root UI/API/MCP parity, generic workspace MCP error boundaries, full core design coverage, Facebook coverage, production-volume and migration/rollback/release gates. A fresh lower-cost independent reviewer completed a read-only security review of the final auth/context, Root dispatcher, entitlement exception and related tests with no actionable findings. The reviewer ran whitespace checks, not the test suite. Final integrated verification passed **568 tests across 113 files**, including all four rollback-only PostgreSQL probes, typecheck, an isolated production build and whitespace checks.

Final scope review reproduced a suspended-workspace read exception inherited from an owner creator through the shared entitlement loader. `loadEntitlements` now accepts an explicit installation-inspection policy; workspace bearer keys always disable it, and explicit workspace sessions do too. The regression invokes the actual MCP route and entitlement resolver for both contexts and expects a typed `forbidden` before post querying. Existing owner session inspection in the default combined context remains available; private installation context itself cannot call customer tools.

The final live probe additionally suspended its disposable workspace through the membership-free owner's Root MCP context. A bearer key created by the seeded installation owner was denied `list_posts` while suspended, then read access resumed after Root restoration. The original fixture workspace was not suspended or changed. This verifies the loader policy through actual HTTP/MCP and PostgreSQL, beyond the route regression.


## Shared MCP failure/recovery batch — 2026-10-16

Added regression-first tests for raw database/provider failures across workspace reads and writes, deliberate typed recovery errors, malformed argument containers, invalid calendar dates, invalid JSON-RPC fields, resource codes and secondary audit failures after returned outcomes. Publishing and Inbox service tests confirm explicit validation/access/connection/state errors are safe while unexpected DB/provider exceptions remain untyped. Connection and data-control errors retain deliberate safe messages; internal storage/path/purge-state failures remain untrusted.

Final integrated suite passed **613 tests across 115 files**, including all four rollback-only PostgreSQL probes after explicitly setting `REBUILD_PREVIEW_DATABASE_URL` from the private local preview environment. An initial run without that opt-in passed 609 and correctly skipped the four probes; it was not counted as integration coverage. Typecheck, isolated production build and whitespace checks passed. The build used a disposable source copy so it did not overwrite the running preview's `.next` output.

Actual Chrome at the guarded `http://localhost:3200` preview called workspace MCP: null arguments and a rolled-over February date returned `invalid_request`, a missing conversation returned `not_found`, and all responses were `no-store`. It created one identifiable local draft, updated it, read back the exact change, and deleted it in a `finally` cleanup. Each returned write receipt recorded `mcpAuditRecorded: true`. A direct preview-only PostgreSQL check confirmed the post was absent and exactly the create/update/delete `mcp.write` audit tools existed; those three probe audit rows were then removed.

The guarded installation MCP probe passed again: real password/TOTP, pending denial, zero-membership owner, five Root tools/three resources, safe configuration audit, bearer/workspace isolation, suspended owner-created key denial/restoration, owner recovery, demotion/disable denial and verified record/settings cleanup. No live provider call, production setting, migration or cutover occurred. Simulated exception and secondary-audit failure coverage is automated fault injection, not an induced live database/provider outage.

Independent lower-cost read-only review found no actionable regressions in the MCP response boundary, request checks, typed-error conversions, permission/confirmation checks or secondary-audit receipts. The reviewer did not run the suite; integrated checks above were run by the main agent.

Remaining: complete core/Root design and legacy parity, durable operation-specific provider reconciliation and audit guarantees, wider MCP clients, complete Facebook engine and live verification, migration/rollback/release gates.


## Root user workflow — 2026-10-16

Integrated verification passed **663 tests across 122 files**, including six guarded rollback-only PostgreSQL probes (the four existing probes plus Root user mutation/directory checks), typecheck, isolated production build and whitespace checks. Directory probes verify literal wildcard search, active-only verified session counts, credential exclusion, current-owner checks and rollback cleanup. Account controls have service/HTTP/MCP and UI tests for exact confirmations, current actor checks, self/last-owner/Root-factor protections, conflicts, safe failures, duplicate submit, malformed receipts and focus restoration. Source review was completed by the main agent; lower-cost workers stopped with workspace-credit errors before an independent final review, which remains unavailable for this batch.

The actual guarded password/TOTP/MCP probe passed with seven private tools/four resources. It created a disposable non-Root target with active/pending sessions and synthetic factors; verified safe user reads, non-Root/key denials, wrong/self confirmations, disable/enable/sign-out/factor reset, persisted outcomes and exactly four domain audits. All probe users, factors, sessions, workspaces, keys, audit rows and the prior config value were cleaned/restored. No provider call or production change occurred.

Actual Chrome displayed the filtered Users table with filters/pagination in the contextual sidebar. Its confirmation dialog focused Cancel; entering the exact phrase enabled submission, produced a successful receipt and refreshed to Disabled/Enable. A later read verified persisted disabled state; direct preview SQL verified exactly its `root.user_disabled` audit and then removed that disposable user/audit. An initial read raced the in-flight write and was not treated as failure evidence; the completed receipt and subsequent read established the outcome. Desktop had no page overflow. At 390×844, the mobile drawer contained the status/search controls with focused close action; temporary four-theme measurements found no page overflow. This does not claim full route/theme visual QA.

The module organization requirement is now explicit in architecture and UX documents; a unified Root module menu/control layout remains to be implemented. Production remains legacy.


## Root module menu/settings organization — 2026-10-16

Integrated verification passed **675 tests across 124 files**, with all six isolated PostgreSQL rollback probes. Typecheck, isolated production build and whitespace checks passed. Final small copy/spacing refinements were covered by the module page/form/organization checks and typecheck. Tests verify generated navigation, one setting owner, provider ownership precedence over historical keys, explicit declared keys, module-scoped values/inventory, shared exclusions, safe store-error states, authorization ordering, refusal of uninstalled IDs and provider category labels.

Actual Chrome inspected the three native Root disclosure groups and active-group expansion on product and platform routes. Product availability/child controls appeared first. Facebook had Engine/API credentials/endpoints/scopes/Inbox categories within its own screen. Authenticated browser HTTP loaded the overview, six product module pages, Facebook module page and Shared configuration successfully with their Root menus. The Root MCP configuration read returned schema 34 with all definitions owned and all saved secret values masked; the historical Messenger reply-policy setting belonged to Facebook, not shared Inbox.

At 390×844, the module settings drawer contained search and category controls, with no page horizontal overflow measured under Grove, Coast, Clay or Nightfall. Desktop Product modules was visually inspected in Clay, and the Publishing settings page had no console errors/warnings during the check. These are representative views, not exhaustive every-state visual QA.

A real browser save inside Publishing wrote the existing image-description limit with its same effective value. The UI confirmed Saved; Root MCP returned the persisted value; direct guarded preview SQL verified exactly one new `config.changed` audit. The exact prior setting record (including absence) was restored, the single probe audit removed and the private temporary snapshot deleted. No customer content, live provider, production record or schema was changed.

Independent final review remained unavailable because lower-cost workers had exhausted workspace credits. Main source review and automated/live local checks were completed. Complete source encapsulation, per-module health/actions, other legacy Root controls, full Facebook/live-provider parity and migration/rollback/cutover gates remain unfinished.

## Root diagnostics, connectivity and module health — 2026-10-16

Final integrated verification passed **737 tests across 135 files**, including all **eight isolated PostgreSQL rollback probes**. Typecheck, whitespace checks and an isolated production build passed; preview `.next` was not overwritten. New tests cover current Root authority, exact run confirmations, provider connection isolation, same-origin HTTP, scoped/capped reads, raw-error masking, start-before-check auditing, failed completion-audit receipts, timeout cancellation and skipped checks, immutable recovery floors after changed settings, rebuild-versus-legacy heartbeat isolation, provider identity/grants/discovery and preserved configurable worker priority. Independent lower-cost static review found a potential slow-pagination overlap; the total deadline/cancellation and stored recovery floor fixed it, and follow-up review reported no remaining actionable source findings. Reviewers did not run tests/browser checks.

The actual local password/TOTP probe passed with **ten private tools/six resources**. It verified diagnostics through installation MCP and the same receipt through HTTP, current module ownership in worker reads, scope-wide repeat denial, private diagnostic resource access, workspace bearer isolation, existing Root account/workspace controls and domain audits. All disposable users, factors, sessions, keys, workspaces, memberships, probe audits and prior configuration changes were cleaned/restored. Unit MCP checks explicitly deny all three new capabilities to owner-created workspace keys before service calls.

Chrome desktop selected the synthetic source and ran Facebook diagnostics. On a 390×844 phone viewport, sidebar submission closed the existing drawer, removed work-area inertness, retained the chosen connection and focused rendered feedback. Final results contained one configuration-validation pass and five honest setup/API failures against fake credentials and `.invalid` endpoints. Identity, requested grants, Page discovery and ad-account discovery never produced a fabricated live success. A timezone-dependent hydration mismatch was observed, fixed with explicit Root operational timezone presentation, covered by regression tests, and absent from the final reload’s console. Four-theme phone measurements found no horizontal page overflow and correct semantic surface/text theme changes. These are representative checks, not exhaustive visual QA of every state.

Actual Shared diagnostics returned four passes (database read, shared configuration, in-memory encryption, media-directory permissions) and `worker_unavailable`: no replacement worker is running. Completion auditing succeeded. The initial preview lacked `rebuild_sync_runs`; a private custom-format local backup was restored into a temporary local database, matching user/workspace/post/audit counts (1/1/6/29), then the existing additive worker migration applied to the isolated preview only. A second real PostgreSQL probe caught and fixed an explicit integer-cast issue in the heartbeat-prefix query. The scratch restore database was removed; the verified backup remains private at `/private/tmp/socialpilot-preview-before-worker-20261016T155616Z.dump`. No worker was started. Browser health runs remain as legitimate synthetic-preview audit/history examples; disposable probe records were removed.

No provider content, ads, messages or production state were changed. Passing local fixture, HTTP, MCP and build checks does not prove successful real Facebook operations, complete legacy/operator parity or production readiness. Operation-level provider diagnostics, live credentials/remote verification, broader Root controls, migration/rollback and rebuild cutover remain open. Production remains legacy.

## Inbox stored browsing and scoped reads — 2026-10-16

Integrated verification passed **782 tests across 141 files**, including all **nine isolated PostgreSQL rollback probes**. Typecheck and whitespace checks passed. An isolated production build passed before the final `noValidate` attribute addition to the GET filter form; it did not overwrite the running preview's `.next`. The final attribute and new preview guard tests passed the integrated suite and typecheck. The new PostgreSQL fixture exercised 60 merged activities (including timestamp ties) and 305 stored messages, forward/backward cursors, literal wildcard search, filters, channel/key intersections, foreign/disabled/unselected resource exclusion, original-comment retention, and latest-inbound policy context beyond the displayed window. Unit/HTTP/MCP/page tests cover validation, revoked/disabled access, typed safe errors and retained UI positions.

The actual guarded HTTP/MCP probe (`scripts/verify-inbox-read.ts`) passed: a read-only member assigned only North reached the list, assigned thread and Inbox page; a forged Studio filter returned 403 and its unassigned history returned 404. Owner HTTP and a read-only workspace bearer returned matching merged ordering/cursor and newest history entries; Earlier returned a different history window with a return cursor. The key could not write or access Root. Removing the member's channel grant immediately removed list/thread access; disabling the account and revoking the key denied requests. Disposable member, membership/access, sessions and key were deleted and absence verified. These sessions were direct verified fixtures for authorization testing; actual password/TOTP authentication was tested separately in the prior installation probe. No global MCP policy was changed.

This probe initially caught a real UI mismatch: the page's first authorization accepted a scoped reader, but PageFrame repeated an owner/admin-only check. The page now declares `scopedAccess`, with page regression and the passing actual scoped-reader UI request proving the correction. Counts now explicitly say stored matches/messages/replies; sync may not contain all provider history. Independent lower-cost review inspected scope, SQL, cursor behavior, HTTP/MCP errors and UI context, finding no additional actionable issues after these fixes. The reviewer did not run tests.

The guarded preview seed now includes one clearly synthetic Studio conversation with **54 stored messages**. Chrome desktop opened it, changed the list to Older while keeping this off-page selection, then selected Earlier history: **4 of 54 stored messages shown**, with both list/history URL positions retained and no horizontal page overflow. At an emulated **390×844** phone viewport, Menu & filters opened the existing modal drawer and focused its close control; width was 390 with no page overflow. A real drawer Newer link navigated back toward recent history. The console query after that navigation returned no errors or warnings. The follow-up DOM-state read and screenshot were **not executed**: automatic approval review ran out of workspace credits. Therefore final drawer-close/focus behavior, screenshots, four-theme checks and remaining keyboard/error-state browser coverage are not claimed for this batch. Do not infer them from earlier Root or Publishing checks.

Frontend Design/Premium review used the established DESIGN.md/UX-CONTRACT.md, PageFrame/AppShell and sibling filter patterns. Its final static strict audit exited 1 with **38 app-wide candidate findings**, principally missing explicit form-validation ownership and textarea expansion policy; the shared Button spread-prop warning requires manual triage. The changed Inbox filter form now declares server-owned validation and has no remaining page finding. The machine-readable report is local at `/private/tmp/socialpilot-inbox-ui-audit.json`. It is an unfinished cross-screen UX audit, not a passing accessibility certificate. Canonical clear-search, field-error focus, other form migrations and full visual/interaction verification still require review.

No schema migration, provider content/message/ad write, production change or cutover occurred. Local examples use fake credentials/endpoints; these results do not prove real Facebook connectivity or operations. Inbox assignment, private notes, saved replies, nested visitor-reply discovery, durable remote-write reconciliation, MCP comment deletion and production-volume query plans remain open alongside the broader architecture/release gates.

## Shared form validation and multiline controls — 2026-10-16

The final integrated suite passed **802 tests across 145 files**, including all **nine isolated PostgreSQL rollback probes**. Typecheck, whitespace checks and an isolated production build passed. The build used a disposable source copy and preserved the running preview's `.next`. New component interaction tests cover native range/step/email/length constraints, password whitespace, domain-error ordering, associated help/error IDs, first-invalid focus, correction, valid shared Button action/submit forwarding, textarea growth/shrink/ref callbacks and uncontrolled form reset. Geometry is synthetic in jsdom; those assertions do not establish visual layout in a real browser.

Ads tests exercise missing campaign name, invalid ad set budget/country, invalid budget edits without a request, field focus/association and retained confirmation/value after request failure. Settings tests cover invalid profile/password/team email and key lifetime/feature selection before network writes, retained values, default-masked one-time tokens, explicit reveal, clipboard success/failure while still masked and UTF-8 password byte bounds. Root creation rejects missing fields and invalid timezone before its confirmation, and retains exact confirmation/workspace values after a server refusal. Calendar picking retains its dialog and focuses the associated missing date. Existing publishing, Inbox and Root dialog tests remain green. Provider/API responses in these component tests are mocked.

Independent lower-cost review found no actionable regressions in the requested validation/focus, multiline/ref, token handling or request paths, and ran the three shared/Ads/Settings test files (15 tests at that review snapshot). Later additions for Button forwarding, textarea reset, Root and Calendar were checked by the integrated run above. Three workers had explicit nonoverlapping file ownership.

The Premium static strict audit moved from **38 findings to two remaining candidates** and still exits 1. Manual source/runtime-test triage identifies both as scanner limitations: `Button.tsx` forwards real `onClick`/`type` props (covered by interaction test), and `AutoTextarea.tsx` enforces the quoted React `resize: 'none'` style (covered by style/ref/height tests). No dummy handler or weakened scanner configuration was added. All previously reported literal forms now declare validation ownership; every product multiline control uses AutoTextarea. The report is local at `/private/tmp/socialpilot-forms-audit-after.json`. The official DESIGN.md lint command was attempted with `npx --no-install --package @google/design.md designmd lint DESIGN.md`, but failed with npm registry DNS `ENOTFOUND`; lint success is not claimed. Only prose/canonical-owner documentation changed; runtime palette/frontmatter values were preserved.

Browser approval review was previously blocked by exhausted workspace credits. A question to the user about credit availability is pending; this batch did not bypass that review or rerun denied screenshot/DOM actions. Actual desktop/phone layout, long-content scrolling, four themes, keyboard/popup/error/focus states and clipboard permission behavior therefore remain **unverified for this batch**. Passing jsdom/static/build tests is not full browser/accessibility approval.

No data migration, provider writes, production changes or cutover occurred. Shared server authority, domain confirmations and existing API permissions remain in place. Remaining UX work includes unsaved-change protection, unified server field-error mapping/notifications, cross-screen busy and session-expiry recovery, configurable copy coverage, full browser review and broader module/legacy parity. Complete Facebook operations, live-provider verification, migration/rollback and production cutover remain open.

## Inbox local workflow and truthful write receipts — 2026-10-16

Final integrated verification passed **849 tests across 150 files**, including all **ten isolated PostgreSQL probes**. Typecheck and an isolated production build passed; the build preserved the preview’s `.next`. Registry version 37 exposes Inbox workflow transaction timeout and pool-wait limits as validated Root-managed settings consumed by the shared service. Targeted tests verify the configured Prisma transaction options. Whitespace validation also passed before publication.

The new database probe uses an outer rollback transaction and real PostgreSQL savepoints around the service transaction. It injects an audit failure after the actual scoped update and verifies both stored state and audit rows roll back, then verifies message/comment resolve/reopen with matching domain audits, narrow caller scope, foreign item and disabled-account refusal, and total fixture cleanup. Entitlement/permission policy and the workspace lock wrapper are mocked in this probe; it is evidence for SQL scope/atomicity, not a real lock-contention test. Separate route/MCP tests establish one service-owned guard; unit tests simulate channel/permission revocation while waiting and require fresh authorization before writing.

Actual guarded `scripts/verify-inbox-workflow.ts` passed all ten aggregate checks (including cleanup) against `http://localhost:3200` and the loopback preview database. It creates disposable expired fake source/channel, conversation, post/comment, verified-session fixtures, read/write key and read-only member. HTTP message resolve, MCP message reopen, MCP comment resolve and HTTP comment reopen update actual rows and produce matching domain audit records; MCP secondary audits identify the same items. A read-only key/member cannot write, and a missing item returns 404. Every disposable content/resource/identity/session/key and matching probe audit is removed and absence verified. No global settings, existing owner grants or provider data were changed. These session fixtures test request authorization; actual password/TOTP authentication remains the separate installation probe. The first probe's aggregate summary incorrectly re-read resolved state after later reopen; it was corrected to capture each immediate state, then all checks reran and cleanup passed.

Review caught a genuine duplicate-lock risk: nesting a transport `FOR SHARE` operation guard around the service guard on another connection could queue behind a pending exclusive purge lock. Both HTTP and MCP now skip their generic wrapper for local resolution, and the service owns exactly one guard. Guard-count regressions cover both entry points. A second review identified grant freshness across lock waits; the service now reauthorizes after acquiring the guard, with channel/permission revocation tests. The independent reviewer inspected the write boundaries and ran 35 targeted tests at its review snapshot; its standalone integration invocation lacked the preview opt-in and was not counted as database evidence. The main integrated run explicitly enables all preview probes.

Workspace credits were refilled, and browser verification resumed. Chrome initially reported connection refused; an authoritative listener check found no process on 3200, so the existing private preview environment was used to start a loopback-only Next preview. No running service was replaced. Actual Inbox at 390×844 showed the newest 50 of 54 stored messages. Real keyboard input committed an 819-character, 12-line synthetic reply; the shared textarea grew to 547px (545px inner scroll height), had `resize:none` and no page horizontal overflow under Grove, Coast, Clay and Nightfall. Initial automated DOM fill had not committed React input state; measurement was repeated after a real keyboard event. Offline submission retained all 819 characters, reenabled Send reply, displayed the unconfirmed-outcome instruction and never showed Reply sent. No request reached a provider.

After restoring networking, Earlier history navigation from the phone drawer displayed 4 of 54 stored messages, closed the drawer and removed main-content inertness without horizontal overflow. At 1280×800, actual Mark resolved then Reopen displayed matching receipts and restored the example conversation's original Open state with its history position retained. Those two legitimate preview workflow audits remain as example history. Fresh post-navigation Inbox console contained no warnings/errors. Root workspace creation in Chrome focused the associated Workspace name error without opening a confirmation or writing data. At 390×844 all four temporary DOM themes preserved focus and had no page overflow; error colors followed the semantic danger token. The Clay phone screenshot was visually inspected, and Root console contained no warnings/errors. Temporary DOM theme changes were restored to Clay; no saved appearance setting changed. This is representative evidence, not all-screen keyboard/popup/visual/accessibility coverage.

The official one-off `designmd lint DESIGN.md` now completed with **zero errors and ten warnings** after network access was available. Warnings concern a missing `primary` alias and unreferenced frontmatter color tokens: this project documents the existing CSS runtime as canonical, rather than generating component references from frontmatter. No duplicate palette or generated runtime source was introduced to silence them. The Premium static audit's two previously reviewed framework limitations remain separate; neither tool proves full accessibility.

No schema migration, live provider operation, remote content/message/ad write, production change or cutover occurred. Remote delete is still provider-first/local-second without durable recovery, so its MCP tool remains unadvertised. `INBOX_WRITE_RECOVERY.md` records the required journal, concurrency, sync tombstone, status/recovery, lifecycle and migration work. Broader Inbox/legacy parity and release gates remain unfinished.

## Durable Inbox deletion, scoped MCP and operator recovery — 2026-10-16

Final integrated verification passed **913 tests across 159 files**, including **13 real PostgreSQL tests across 11 integration files**. Typecheck, whitespace validation and an isolated production build passed; the build preserved the preview’s `.next`. The new committed-fixture journal tests use independent database clients and real workspace/channel locks. They prove committed intent is visible before dispatch, concurrent requests cannot make a second outbound attempt, uncertain claims survive repeat/alias requests, audit failure rolls local cleanup back while retaining remote confirmation, recovery is local-only/idempotent, recursively stored replies are removed and tombstoned, completed aliases retain status after their rows disappear, and newly seen stale descendants remain suppressed. Provider dispatch and entitlement/permission resolution are mocked in this database suite; real HTTP/MCP authorization is separate.

The guarded `scripts/verify-inbox-deletion.ts` passed **12 aggregate checks including cleanup** against localhost and the isolated preview. It seeds a clearly synthetic started intent representing a lost response, exercises safe HTTP/MCP status parity and no-store responses, missing-confirmation rejection, repeated intent without another dispatch, unassigned/read-only denial, private Root history/key isolation and explicitly synthetic operator attestation, then actual workspace-MCP local finalization and repeated idempotent finalization with one domain audit. Matching MCP audits identify the same fixture. All disposable sessions, keys, member/user, source/channel, post/comments/reply, journal and exact fixture audits were removed and absence verified. Direct verified-session fixtures test request authority; actual password/TOTP evidence remains the earlier separate installation probe. No global policy or existing grants changed. Root alone receives the provider/opaque remote identity for external verification; customer status remains redacted. The probe never contacted a provider or proved real remote deletion.

Chrome opened a separate identifiable synthetic uncertain-deletion example. At desktop width the dialog exposed only Close and Check deletion status; at an actual 390×844 mobile viewport it stayed within 352px with no page overflow. Temporary Grove/Coast/Clay/Nightfall DOM theme changes produced the expected semantic root tokens and no page overflow; Coast/Clay/Nightfall dialog surfaces were also measured. An initial immediate same-task style read returned the prior surface, so it was repeated across animation frames. This is token/layout evidence, not four complete visual screenshot audits. Temporary DOM themes were restored to Clay without saving appearance settings. A Fast Refresh closed an early dialog during source edits; later verification reopened the current implementation rather than treating stale UI state as proof.

Private Root → Product modules → Inbox rendered the recovery history and opened its shared confirmation dialog on the phone, initially focusing Cancel. The Clay screenshot was visually inspected; long workspace/channel/remote identifiers wrapped within the 358px dialog, with neither dialog nor page horizontal overflow. The exact confirmation and verification checkbox enabled the action. This exercise used a fake remote identity and synthetic state; its operator attestation was a workflow test, not real Facebook verification. The resulting stored remote-confirmed state became visible through the customer’s Check deletion status. An actual offline status check retained its dialog, displayed a useful retry error and offered no second remote deletion. Restoring networking recovered the same operation; Finish removal from Inbox completed the local cleanup and returned to the list. The intentional offline fetch produced a console network error; fresh post-cleanup Inbox and Root reloads contained no errors/warnings. The browser fixture and all exact operation audits were removed, with independent zero-count checks for journal/comments/posts/channels/sources/audits. Root’s final recovery list was empty. The normal no-operation confirmation was also opened on an existing synthetic comment without submitting deletion; Escape closed it and returned focus to Delete comment, with no page overflow.

Independent lower-cost review found a completed-alias recovery gap; the final journal now retains alias IDs through cleanup, and the actual database regression verifies status afterward. Review also caught lock deadlines shorter than provider work, rollback-inflated worker counts and erasure/disconnection losing recovery state. Cancellable provider work, retained transaction budget floors, post-commit counters and lifecycle locks/settled-state checks address those findings. A final read-only review of authorization, locking, aliases and descendant propagation reported no additional actionable issue; it did not replace the runtime checks above. Regression-first tests also cover safe Close semantics for an existing deletion and refusal of incompatible workspace/comment guard budgets.

The final additive journal SQL was applied from scratch to a restored private pre-journal baseline, all 15 columns verified, then a separate final-schema custom backup restored with matching counts across **96 public tables**. Both scratch databases were removed. Before amending the isolated preview with durable alias/tombstone arrays, a second private backup restored with matching users/workspaces/posts/audit/comments/conversations counts (1/1/7/37/5/2); those counts included the temporary browser example. Verified artifacts remain private: `/private/tmp/socialpilot-preview-before-inbox-deletion-20261016T182951Z.dump`, `/private/tmp/socialpilot-preview-before-inbox-aliases-20261016T191401Z.dump` and `/private/tmp/inbox_journal_rehearsal_8ebe047ad341448da7dc32c7518f5e0f.dump`. This verifies the new migration on a local clone, not the complete three-migration sanitized production-shaped cutover or media/proxy/service rollback.

Workspace credits briefly exhausted automatic approval review again: the corrected browser-seed invocation was rejected without execution, and two agents stopped. After the user’s refill response, the normal approval gate accepted the remaining database/browser checks; no bypass was used. The Frontend Premium static audit could not be rerun because its previously installed skill/script was removed from the filesystem during the tool/skill refresh. Earlier static results are historical, not a fresh audit of this batch. Shared primitives, component interactions, actual phone/desktop states and the screenshot above provide current scoped evidence; full visual/accessibility approval remains open.

No live platform content, messages, ads, production schema/services or cutover changed. Automatic provider absence verification, definitive-rejection/rearming policy, durable reply/moderation journals, complete visitor-reply discovery, production-volume concurrency/load checks and broader Inbox/legacy/module/configuration parity remain unfinished. See INBOX_WRITE_RECOVERY.md and CUTOVER.md. Production remains legacy.

## Analytics explorer, comparisons and read boundaries — 2026-10-16

Final batch verification passed **955 tests across 164 files**, including **13 real PostgreSQL tests across 11 integration files**. Typecheck and an isolated production build passed; the running preview's `.next` was preserved. The page suites emit the existing Tailwind content-configuration warning and Vitest emits Vite's CJS deprecation notice. These warnings are not browser runtime failures. Exact private run logs: `/private/tmp/socialpilot-analytics-tests.log`, `/private/tmp/socialpilot-analytics-build.log`, `/private/tmp/socialpilot-analytics-live-probe.log`. Logs are local evidence, not repository artifacts or provider proof.

## Publishing operation boundaries and row recovery — 2026-10-16

Final suite: **994 tests across 171 files**, including **16 real PostgreSQL tests across 12 integration files**. Typecheck and isolated production build passed. New database tests initially reproduced deletion during an open publish and publication of a cancelled stale candidate, then passed with the service guards. A third database test refuses post-history removal while an Inbox deletion journal is unresolved. These tests use real locks and separate clients but controlled provider/authorization dependencies.

`scripts/verify-publishing.ts` passed against the actual localhost app/MCP endpoint and isolated preview DB. It confirms scoped creation with first comment, current grant and feature revocation, read-only refusal, updated data/domain audit, processing-evidence preservation, successful confirmed local deletion, Root isolation and no-store responses. Temporary content, actor, membership, grants, keys, session and domain audits were removed; the effective MCP role policy was restored. Audited Root policy changes remain. No provider request was dispatched.

`scripts/preview-publishing.ts` created one clearly named disposable failure fixture. At **390×844**, actual edit refusal retained revised text/first comment and destination choice, focused its error and reenabled controls; actual delete refusal retained the open dialog and checked remote-delete choice. Theme-token/layout probes covered Grove, Coast, Clay and Nightfall with no page overflow; the first immediate Grove surface read still reflected a transition, so four exact rendered-theme screenshots are not claimed. At **1440×1000** the delete refusal had a 520px dialog, retained choice, focused error, no page overflow, and Escape returned focus to Delete locally. Unit interaction tests cover Cancel focus return and pending controls.

The normal disposable draft (`seed-success`) then exercised actual inline save and local deletion. The first successful save exposed a swallowed `NEXT_REDIRECT` in the client transport wrapper: the app showed success and a false unconfirmed error together. The fix rethrows framework redirects; regression tests and a second actual save confirmed Post saved with no edit error. Actual delete redirected to Post deleted locally, closed the dialog and removed the fixture. Guarded database cleanup verified no fixture/targets remained. A representative desktop Clay screenshot was visually inspected; the final console query returned no errors/warnings. Phone success, every keyboard path and every rendered theme/state remain open.

Independent lower-cost review found no additional introduced issues in the guard/access/lifecycle/MCP/local-draft boundaries. It identified two still-open release blockers: uncertain publishing lacks an auditable reconciliation action, and remote deletion lacks a durable intent/receipt journal. First-comment remote-ID recovery also remains open. These limitations are explicit in PUBLISHING_OPERATIONS.md and the parity gate; passing local tests does not waive them. Production, migrations, real provider content and worker ownership were unchanged.

Private local evidence logs: `/private/tmp/socialpilot-publishing-tests.log`, `/private/tmp/socialpilot-publishing-build.log`, `/private/tmp/socialpilot-publishing-live-probe.log`. Existing Vite CJS and Tailwind configuration warnings remain test/build tooling notices.

## Separate first-comment delivery — 2026-10-16

Final verification passed **1,021 tests across 174 files**, including **23 real PostgreSQL tests across 13 integration files**. Typecheck, whitespace validation and an isolated production build passed; the preview's `.next` was preserved. Seven new database cases use real transactions/independent observers with controlled provider/access dependencies: post receipt visible before comment dispatch, ambiguous no-repeat, recognized rejection and deliberate retry, post/comment receipt-persistence failure, malformed remote IDs and exact audited manual reconciliation. A test-reset defect initially made a new rejection-count case fail; resetting the controlled adapter before each case corrected the fixture and the complete suite passed. The actual guard/access services are separately exercised by current-authority and localhost MCP checks.

The extended actual localhost Publishing MCP probe passed **14 reported checks**, including comment read-only/current-channel refusal, exact confirmation, safe normalized reads, manual SENT/NOT SENT recording with matching domain audits, already-confirmed no-repeat and no remote dispatch during manual absence. Its temporary user, membership/grants, keys, owner session, content and domain audits were removed, and the original effective MCP role policy restored. Root configuration-change audits remain. No provider was called. The preview was restarted after client regeneration; only existing first-comment columns were mapped, and local catalog metadata confirmed nullable text/timestamp types. No DDL or migration was executed.

Chrome used the guarded disposable `seed-comment-review` fixture. At **390×844**, a real oversized comment-ID rejection exposed radio/checkbox resets after React form actions. The final dialog prevents the native submit/reset and dispatches its action state in a transition: the selected SENT outcome, acknowledgement, ID and focused typed error remained visible. Another regression test ensures refreshed delivery props cannot remount the open dialog and discard input. Closing/reopening starts fresh, and cancelling an uncertain send keeps its latest review state.

A successful actual synthetic recording closed the dialog, changed delivery to First comment recorded as sent, and SQL confirmed the expected first ID with exactly one matching human-attestation audit. A second disposable example verified the final success-focus fix: focus moved to the named remaining delivery group after its action button disappeared. Both fixture instances and their destination rows were cleaned up; deliberate synthetic attestation audits remain as history. No real remote comment was claimed or created.

Phone theme/layout probes covered Grove, Coast, Clay and Nightfall with a **358px dialog and no page overflow**; the first immediate Grove surface read still reflected Clay, so four exact rendered-theme screenshots are not claimed. Final Clay and Nightfall dialog screenshots were inspected after the comment-ID control adopted the shared themed field; the final Nightfall input measured 44px high with its dark semantic surface. The saved Clay preference was restored. Browser console checks found no errors/warnings. Exhaustive desktop, keyboard, accessibility, all-state/theme and real Facebook tests remain open; earlier desktop recovery-dialog evidence is not a substitute for every new state.

Independent lower-cost review found misleading certainty copy for a recognized rejection. Separate not-sent/review counts, neutral per-destination attention copy and a real-database regression corrected it. The final independent pass found no additional issue; the parent then verified error retention, themed field layout and success focus in Chrome. See FIRST_COMMENT_DELIVERY.md for state/permission/configuration ownership and remaining limits. Durable publication/deletion journals, delayed comments, automatic provider verification, selected-resource reads and full parity/cutover remain release blockers.

Private logs: `/private/tmp/socialpilot-first-comment-tests.log`, `/private/tmp/socialpilot-first-comment-build.log`, `/private/tmp/socialpilot-first-comment-live-probe.log`. Existing Vite CJS and Tailwind configuration warnings remain tooling notices. Production and workers were unchanged.

The guarded `scripts/verify-analytics.ts` ran against localhost:3200 and the dedicated loopback `_preview` database with a fake encrypted credential, unique temporary channel/source, a truly ads-only separate source, stored observations and scoped reader. **Twelve aggregate checks passed**, plus zero-count cleanup across all nine fixture model groups: scoped member UI/HTTP; historical audience (210 at the report end, excluding later 999); equal-duration prior comparison (latest 60 versus 20, delta 40); continuation through all 60 dated observations and 58 category rows; HTTP/MCP aggregation parity; scoped MCP overview resource; removed raw tool rejection; CSV comparison provenance; invalid/duplicate dates and unassigned IDs denied; ads-only stored spend; immediate grant revocation; disabled account/revoked bearer denial. Direct verified sessions exercise request authorization; password/TOTP evidence remains the separate earlier installation probe. No provider operation or background worker ran.

Default Root policy excludes viewer-role MCP authentication. The probe temporarily permits that role through the actual signed-in Root configuration API, preserving value-free configuration audit events, then restores the original effective policy before removing sessions/keys, member/user, insights, accounts, channels and sources. The test does not grant permanent access or alter existing member assignments. Cleanup is in a `finally` block and verifies record absence; safe failure output never prints credentials or provider content.

Independent lower-cost review found an existing cross-scope raw `get_page_analytics` MCP path: scoped lookup could overwrite the requested target ID while the insight read used the original ID. That tool was removed from discovery/mapping/dispatch in favor of the shared product reader, with tests proving unknown-tool rejection and no raw database read. Review also caught inert metric paging in detail mode, missing reach overlap caveats, missing caveats on MCP details, and inaccurate latest-day CPP/frequency coverage. All were fixed and independently rechecked. Conservative unknown/unique metric semantics, mixed scalar/category retention, exact covered-resource comparison and duplicate metric identity rejection have focused regression coverage.

Actual Chrome checks at **1440×1000 desktop** and **390×844 phone** verified the two-sidebar/drawer structure, independent ads-only detail, current/comparison dates, missing-period copy, stored audience coverage/freshness, semantic SVG previews, full detail tables and no report actions in main content. All report filters, metric selection, export, paging and return links are in the sidebar. A real phone drawer form submission preserved dates, channel/ad selections and search while selecting Followers detail and prior-year comparison. The native-select tool initially required visible option text rather than its stored value; the successful submission was repeated against a fresh snapshot. An earlier concurrent fixture cleanup made a stale selected ID unavailable; the app safely refused it instead of widening selection. The deliberate reversed-date page showed a safe error and sidebar retry preserving its URL; Reset recovered the default report.

Temporary Grove/Coast/Clay/Nightfall DOM themes were measured across animation frames at both widths: expected semantic surface/ink tokens and no horizontal page overflow. Representative Clay desktop and Nightfall phone screenshots were visually inspected; themes were restored to the saved Clay value without changing appearance settings. This is representative visual plus four-theme token/layout evidence, not exhaustive screenshots/accessibility audits for every state. Fresh console checks contained no errors/warnings. Browser does not prove complete provider API coverage.

Remaining Analytics boundaries are explicit in ANALYTICS_READS.md: account-level stored Ads inputs only; no live provider verification, production-volume load proof, complete historical breakdown archive, post/object exploration, pins, report scheduling/templates, independent ad-resource grants or production cutover. Invalid-filter errors currently recover through sidebar retry/reset rather than full inline field correction. Full rebuild/legacy parity remains active; production is still legacy.

## Durable post deletion batch — 2026-10-16

The synthetic preview now has the additive `rebuild_post_deletions` journal.
Final migration SHA-256:
`80e406ae33000a349d07f9e428563d20083bc36c65956a969a5e7ccc77c32f07`.
The pre-journal private custom-format backup restored with matching exact
counts for 96 tables; the final SQL applied from that backup and independently
restored with matching counts across 97 tables. Before the preview constraint
amendment, another private backup restored with matching counts across 97
tables (`socialpilot-preview-before-post-deletion-constraint-20261016T231821Z.dump`,
249411 bytes). SQL state predicates now require a true result: NULL reason
values cannot bypass required uncertain/confirmed/rejected reasons. No
production schema, worker or provider data was changed.

Actual localhost MCP/HTTP probe `scripts/verify-post-deletion.ts` passed:
read-only empty/status reads, expired-source preflight before intent/dispatch,
uncertain request reuse, exact confirmations, read-key write refusal,
workspace-key refusal at private Root, Root HTTP shared history, human
attestation without local removal, provider-free finalization, retained alias
content with cancelled remote references, readable post-removal receipts,
idempotent finalization and domain audits. This uses disposable synthetic
records and performs no real provider deletion. Fixtures, keys, sessions and
sources were removed; synthetic audit evidence remains.

Actual Chrome checks used a fresh sign-in to the synthetic preview. On a
390×844 phone with reduced motion, customer recovery preserved the selected
remote option and known operation after an offline status failure, focused its
error and kept the dialog open. Manual DELETED advanced to local-pending;
explicit Finish local removal alone produced the deletion redirect. PostgreSQL
then showed completed remote/local receipts and no requested local post.
The customer dialog showed the affected post excerpt, one status control,
human-readable operation states and a single final cleanup action. Clay and
Nightfall were visually inspected; the dialog stayed 358px wide with no
horizontal overflow. Other theme/state combinations remain unverified here.

Private Publishing Root recovery was exercised at 1440×1000 and 390×844.
Cancel received initial focus; Escape returned focus to Review. Offline
submission retained the chosen result, exact phrase and verification checkbox
and focused the error. Successful recording closed the dialog and the actual
journal became remote-confirmed, with no completed local receipt. The success
notice now receives focus (component regression tested). Synthetic browser
journals were removed. This is manual workflow evidence, not a claim that a
human checked a real platform.

Automated evidence: the final integrated suite passed 1064 tests in 180 files,
including 39 actual PostgreSQL checks in 15 files. The 12 deletion-service cases
include committed intent visibility, concurrent request exclusion, a separate
attempt after NOT DELETED, complete preflight before any dispatch and atomic
local audit rollback. Typecheck and isolated production build passed. PostgreSQL
coverage includes real journal constraints and writes; provider calls in those
tests are controlled mocks.

The premium static audit reports two existing scanner false positives:
`Button.tsx` forwards action/type props to its native button, and
`AutoTextarea.tsx` explicitly applies `resize: 'none'`. Its scan does not
understand those shared implementations. The audit artifact is private at
`/private/tmp/socialpilot-post-deletion-premium-audit.json`; it is not reported
as a clean strict audit. Shared primitive/component/browser checks supply the
separate behavior evidence.

Remaining release gaps include remote publication receipt loss before local
commit, automatic provider verification, complete Facebook formats/grants,
actual live-provider tests, selected-resource reads (retained posts on
unselected channels still appear), deletion redirect list/filter restoration
and focus after the removed customer action, complete Root/MCP/legacy parity,
production-shaped migration/authorization and cutover/media/rollback checks.
Production remains legacy.

## Selected-resource Publishing reads — 2026-10-17

Normal Publishing reads now exclude retained posts with unselected destinations,
including mixed posts where only part of the destination set is visible. Posts,
Queue, Approvals, Calendar, Home counts, HTTP and MCP use one current-authorized
service. Sidebar and composer choices use its selected-resource resolver.
Expired credentials and missing write readiness do not hide eligible stored
history. See PUBLISHING_READS.md for exact scope and remaining archive limits.

Final automated evidence: **1101 tests in 184 files passed**, including **43
actual PostgreSQL checks in 16 files**. Typecheck and an isolated production
build passed; the running preview build directory was preserved. Database
tests exercise selected/unselected, disabled/revoked, expired, cross-workspace,
limited-grant, unconnected-author and whole-post pagination/count boundaries.
A final four-case PostgreSQL rerun passed after ensuring fixture cleanup also
refuses writes when its database safety preflight has failed.
No schema migration, background worker or provider call occurred in this batch.

The guarded `scripts/verify-publishing-reads.ts` passed against localhost:3200
and the dedicated loopback `_preview` database. Actual HTTP, MCP list and MCP
resource results obeyed the same limited channel grant. Unassigned selection
returned zero matches rather than broadening scope. Invalid/repeated HTTP and
invalid MCP filters failed safely; HTTP returned no-store. Read-only keys could
not delete, grant revocation took effect immediately, and disabling the actor
invalidated both its existing session and key. The preview-only viewer-role
MCP policy change was restored to its exact original row or absence, and all
disposable probe fixtures were verified absent in `finally` cleanup. This is
local request/authorization evidence, not live-provider evidence.

Actual Chrome checks covered 1440×1000 desktop and 390×844 phone. Published
Posts and HTTP/MCP lists contained only the expected selected-channel fixture.
Unavailable Posts and Calendar URL selections produced explicit no-match
feedback; the sidebar retained an opaque Unavailable channel choice without
revealing a hidden channel name. Drawer form submission preserved Feed and
Published filters, and returned to the report. Home showed the expected
synthetic counts: four selected channels, three linked ad accounts, one
published post and one scheduled post. A final desktop Cards snapshot after
probe cleanup showed one published post and the two-sidebar layout.

Browser testing found that the shared drawer captured Escape while a native
select popup was open. The handler now respects handled/composing events and
the native select's `:open` state. Chrome verified that popup dismissal retains
the drawer; Escape after the popup closes dismisses the drawer and restores
opener focus. Native popup state can settle asynchronously. Older engines
without `:open` support need separate compatibility verification.

Representative Clay desktop/phone and Nightfall phone views were inspected
with no horizontal page overflow. The saved Clay preference was restored.
This is not exhaustive four-theme, keyboard or accessibility coverage of every
read state. Browser access was checked again before publication and returned
the expected one-post desktop Cards view.

Independent lower-cost review reported no remaining actionable P1/P2 issue
for this batch. The premium strict static audit still exits nonzero for the
same two documented scanner false positives: forwarded Button action/type
props and AutoTextarea's explicit `resize: 'none'`. It is not a clean strict
audit; shared primitive tests and browser checks provide separate evidence.

Private artifacts: `/private/tmp/socialpilot-selected-reads-tests.log`,
`/private/tmp/socialpilot-selected-reads-build.log`,
`/private/tmp/socialpilot-selected-reads-live-probe.log` and
`/private/tmp/socialpilot-selected-reads-premium-audit.json`.
Remaining work includes durable publication receipt recovery (planned in
PUBLICATION_RECOVERY_PLAN.md), retained-data browsing, full Facebook/legacy /
MCP/Root parity, live-provider testing and all migration/rollback/cutover gates.
Production remains legacy.


## Durable publication receipt recovery — 2026-10-17

The fifth additive journal migration was applied only to the isolated synthetic
preview after restore verification. Private backup
`/private/tmp/socialpilot-preview-before-publication-20261016T234535Z.dump`
was 249671 bytes; exact source/restore counts matched for 97 existing tables.
After applying the checksum-pinned SQL to scratch, an independent backup
restored with matching exact counts across 98 tables. Scratch databases were
removed. See CUTOVER.md for the SHA-256 and remaining full-five-file rehearsal.
No production schema, worker or provider state changed.

Final integrated tests passed **1132 tests in 192 files**, including **55 actual
PostgreSQL checks in 19 files**. New real-database cases verify visible committed
intent before dispatch, concurrent exclusion with a single controlled create,
receipt survival after a projection-audit fault, local-only continuation,
unknown/rejected outcomes, explicit retry after human absence, late outcome
conflicts, exact operation confirmation, contributor/current-grant/feature
refusal, NULL-safe constraints, retained claims and workspace lifecycle. Mocked
adapters in these tests do not prove live Facebook behavior. Typecheck and an isolated production build passed; the running preview build directory was preserved.

The actual localhost HTTP/MCP probe `scripts/verify-publication-recovery.ts`
passed scoped no-store status, unknown filter refusal, read-key write denial,
workspace-key/private Root isolation, exact confirmations, cross-post operation
binding, legacy claim adoption, external absence, saved external receipts and
separate local finish, private Root history/attestation/finish, immediate grant
revocation and disabled-session denial. It uses disposable synthetic records;
no provider create/read/delete is part of this probe. Fixtures, sessions, keys,
memberships and journals were removed and verified absent in `finally` cleanup.
The probe does not change the installed MCP role policy.

Actual Chrome checks covered 390×844 phone and 1440×1000 desktop with reduced
motion. Customer recovery showed the affected post/channel, no preselected
outcome, external-check acknowledgement and exact typed confirmation. Cancel
received initial focus. Offline submission preserved the remote ID, link,
phrase and checkbox, kept the dialog open and focused its error. Browser-level
fetch text found during that check was replaced with plain recovery guidance,
then verified again offline. Successful human-recorded publication saved only
the receipt; explicit local finish changed the PostgreSQL projection without
sending content or a first comment. The browser then exposed a filtered-row
focus loss. The fix preserves status/view/page filters and uses an operation-
bound route notice with focus after row removal; Chrome verified Cards and
Publishing filters remained and focus landed on the persistent success notice.

Private Root's dialog showed resolved workspace/channel/post context and an
explicit external outcome. Offline submission retained its phrase/checkbox
and focused safe feedback. Successful human-recorded absence closed the dialog,
retained/focused its success notice after the action disappeared, and the actual
journal was `attested_absent`. This is a synthetic human-attestation workflow,
not proof of an external platform check. The separate HTTP/MCP probe covers
Root saved-receipt projection; Root legacy adoption is not browser-verified.

Representative Clay and Nightfall phone dialogs were visually inspected:
358px wide at 390px, 16px inset, reachable actions and no horizontal page
overflow. Root was also opened on desktop. Phone/desktop switching under offline
emulation reloaded Chrome once; that test setup was restored online and the
actual offline form test was repeated without a viewport change. Saved Clay
appearance was restored by normal navigation. Exhaustive four-theme, all-state,
cross-browser, keyboard and accessibility coverage remains open. The two
browser test posts, journals and their domain audits were removed and verified.

A lower-cost independent read-only service review found no actionable P1/P2
issue in dispatch ownership, authority, cleanup or receipt ordering. Parent UI
review subsequently found and fixed default-outcome/confirmation weakness,
unsafe success-receipt acceptance, browser error text and disappearing success
focus. Component regressions cover preserved input, wrong receipts, explicit
outcomes, focus and route notice behavior. The previously installed premium
static audit executable disappeared from the plugin cache during this batch;
an exact cache search found no copy. Its fresh strict scan could not run. The
earlier two scanner false positives remain historical evidence only, not a
fresh clean audit of this batch.

Private evidence: `/private/tmp/socialpilot-publication-tests-final.log`,
`/private/tmp/socialpilot-publication-final-typecheck.log`,
`/private/tmp/socialpilot-publication-build-final.log`,
`/private/tmp/socialpilot-publication-live-probe.log`,
`/private/tmp/socialpilot-publication-backup.log` and
`/private/tmp/socialpilot-publication-ui-final.log`.

Automatic provider reconciliation/idempotency, full Facebook formats/grants,
complete legacy/Root/MCP parity, production-shaped data/authorization migration,
live provider testing/cleanup and exact cutover/media/service rollback remain
unfinished. Production remains legacy.

## Publishing readiness and photo identity — 2026-10-17

Final source verification passed **1,148 tests across 193 files**, including
actual isolated PostgreSQL suites; rebuild typecheck and an isolated production
build passed. The isolated build left the running preview's `.next` untouched.
Earlier regression runs reproduced missing-grant/expired publication, stale
picker readiness, unguarded adapter status/comment calls and stale MCP
`canPublish` output. Updated older provider fixtures supply explicit operation
policies/grants so cancellation and provider error classification still reach
their intended transport boundary. No schema or production migration occurred.

The real localhost HTTP/MCP probe `scripts/verify-publishing-readiness.ts`
passed: current destination tool/resource readiness, missing-grant rejection
before publication intent, retained selected post history and remote-deletion
rejection before intent with the local post preserved. It used a disposable
synthetic credential/channel/post/key, never a usable platform token or a
remote post. Fixture cleanup was verified. An optional interactive run retained
the no-grant fixture briefly for browser inspection, then cleaned it too.

Chrome confirmed the composer omitted that no-grant channel while retaining
three ready synthetic choices. This was checked on Clay desktop at 1440×1000
and Nightfall phone at 390×844. Phone destination/timing controls remained in
the existing 330px navigation drawer, with no horizontal page overflow; Escape
closed it and restored focus to Menu & filters. Root's Facebook API scopes
category displayed the separate publish/delete controls on desktop and phone;
the phone fields were 324px wide with no horizontal page overflow. Categories
and connection diagnostics stayed in the existing contextual sidebar/drawer.
No Root values were saved. Appearance was restored to Clay and the preview
returned to desktop Posts. These are representative checks, not exhaustive
four-theme/accessibility/keyboard coverage.

Independent lower-cost read-only review found no concrete issue in the
credential/adapter/photo-identity change, then identified unsafe probe cleanup
if an unexpected intent appeared. The script now revokes the temporary key
first and retains post/destination/source when either journal has evidence.
A controlled local test fabricated one uncertain intent: cleanup exited with
failure, preserved the parent fixtures/evidence and revoked the key. After
verifying that state, only the known fabricated journal and its fixtures were
removed. The normal MCP probe then passed and cleaned its fixtures again.
PUBLISHING_READINESS.md records the
actual boundaries: local grant metadata is not current Meta approval or task
eligibility; no real Facebook create/status/delete was tested. Durable
intermediate media-upload receipts/cleanup and complete provider formats,
legacy/Root/MCP coverage, data migration and cutover proof remain open.

Private logs: `/private/tmp/socialpilot-credential-tests-final.log`,
`/private/tmp/socialpilot-credential-typecheck-final.log`,
`/private/tmp/socialpilot-credential-build-final.log`, and
`/private/tmp/socialpilot-readiness-live.log`, and
`/private/tmp/socialpilot-readiness-cleanup-proof.log`.

## Installed platform access policies — 2026-10-17

Final verification passed **1,175 tests across 196 files**, including actual
isolated PostgreSQL tests. Rebuild typecheck and an isolated production build
passed. Registry 46 adds Facebook-owned default inclusion and plan-grant policy
controls; Facebook's default availability is retained. No schema migration,
production deployment or provider request was made.

Regression failures reproduced uninstalled provider grants from arbitrary plan
strings, stale default Facebook access under Root disable/suspension, OAuth
start without entitlement, resource selection without entitlement, and an HTTP
error path that treated raw exception text matching a phrase as safe. Those
regressions now pass. Shared policy tests use an example provider independent
of Facebook and exercise Root changes, missing definitions, malformed and
encrypted settings. Inbox/Ads service work used a lower-cost independent agent;
old audit/permission/concurrency/expired-local-history test semantics remain.

`scripts/verify-platform-access.ts` changed the actual isolated app's policies
through private Root MCP. The same temporary workspace key then saw no
unentitled destinations, Inbox activity, Analytics provider metrics or Ads
accounts/reports. HTTP Inbox/Analytics/Posts agreed; authorized unconnected
drafts remain local. HTTP and MCP selection attempts were denied without
changing selected flags. OAuth start and callback denied before provider code
exchange. Private Root still opened and exposed module controls.

Review found ordinary workspace loads inherited a private owner inspection
exception; it now requires explicit internal opt-in and normal web/MCP loads
explicitly disable it. A regression reproduced default loader access first.
The actual probe then suspended the synthetic workspace through Root MCP:
the instance owner's customer OAuth start was denied (401), private Root stayed
available, and Root restored workspace access. No provider call occurred.

Review also found failed audited restoration could skip the probe snapshot
restore. The probe now attempts exact database restoration even after API
failure, verifies original row values/presence/times and active workspace state,
then removes temporary credentials. Injecting 503 only into audited restore
requests produced the expected failed diagnostic after exact restoration.
An independent database check confirmed zero probe keys/sessions and an active
workspace. Normal restoration/readiness was separately verified. Audited
synthetic configuration/workspace test activity is retained; business records
and original selected flags are unchanged.

Chrome checked denied Connections on Clay desktop 1440×1000 and phone 390×844,
with no Root setup instructions or unavailable connect action. Its empty copy
was corrected to No available connections, avoiding a false claim that retained
records never existed. Root's Workspace access category stayed in the existing
sidebar/drawer. Nightfall phone controls were visually inspected: the plan-key
textarea was 324px wide, labels/copy/actions fit, and no horizontal page overflow
occurred. Clay desktop controls were also inspected. Policy restoration returned
the seeded connections; appearance and desktop geometry were restored. These
are representative checks, not full four-theme/all-state/accessibility proof.

Independent review found the two issues above, confirmed their fixes, and
reported no further concrete introduced issue. Full plan/billing controls,
provider-owned background collector subscription gating, complete legacy/Root/
MCP coverage, live provider checks and release/cutover gates remain unfinished.

Private logs: `/private/tmp/socialpilot-platform-access-tests-final.log`,
`/private/tmp/socialpilot-platform-access-typecheck.log`,
`/private/tmp/socialpilot-platform-access-build-final.log`,
`/private/tmp/socialpilot-platform-access-live.log`, and
`/private/tmp/socialpilot-platform-restore-failure.log`.

## Idempotent post duplication — 2026-10-17

Final suite passed **1,206 tests across 200 files**, including the three actual
isolated PostgreSQL duplication tests. Rebuild typecheck and an isolated
production build passed; the build preserved the running preview's `.next`.
Registry stays at 46. No DDL, production change or provider request occurred.
POST_DUPLICATION.md records ownership, protocol and remaining limitations.

Source and interface regressions cover strict confirmation/UUID input,
source/current channel scope, contributor ownership, bound receipt replay,
missing copied drafts, safe HTTP/MCP errors, cache/secondary-audit failures,
UI receipt checks, pending state and error focus. PostgreSQL proves atomic
audit rollback, fresh pending destination state, content/first-comment copying,
replay and preserving an unrelated draft on UUID collision. Review found a
scoped-editor unconnected-draft visibility mismatch; source reads now use the
same author predicate as normal Publishing reads. Parent review also caught a
confirmed UI request ID surviving into another deliberate duplication; only
confirmed success now resets the ID, with a same-mounted-control regression.

`scripts/verify-post-duplication.ts` ran against actual localhost HTTP/MCP and
the isolated preview database. HTTP returned 201 for one clean two-image draft
with first comment; MCP reused its UUID and returned the same post. HTTP replay
preserved later edits, a different source with the same UUID conflicted, strict
input and foreign/hidden sources were denied, a read key could not write or
discover the Duplicate tool, and current channel-grant revocation denied even
an existing receipt replay. Original source content/history remained unchanged.
The original MCP role policy first denied editor authentication; the probe
temporarily permitted it only in the local preview, then verified exact
restoration of row presence/value/encryption/timestamp independently of fixture
cleanup. Disposable posts, grants, identities, sessions, keys and domain/MCP
audit rows were removed and verified. No provider transport was invoked.

Actual Chrome checked Clay desktop Feed at 1440×1000, Grove desktop Table at
1440×900, and Nightfall phone Cards at 390×844. All used the same Manage post
action, with no page overflow. Desktop success disabled sibling actions while
pending, navigated to Drafts and focused the shared success notice. On the
phone, Offline produced focused, safe recovery feedback and a real Check
Drafts link opening another tab; reconnecting and retrying succeeded. Database
inspection confirmed the two browser-created copies contained the source's
workspace-owned image reference, four fresh pending destinations total and no
remote post/comment IDs, schedule or publication timestamps. Those two copies
and their test receipts were removed; the original seeded publication stayed
published. Browser returned to Clay desktop Posts with no overflow.

These are synthetic local checks, not real Facebook evidence or all-state
accessibility proof. Reloading/leaving the component loses its in-memory request
ID; inspect Drafts before starting another unknown-outcome attempt. Bulk actions,
full media editing, broad Publishing/legacy/MCP parity, Facebook formats and
operations, live provider tests, migration/rollback and production cutover remain
open. Private logs: `/private/tmp/socialpilot-duplicate-full-tests-final.log`,
`/private/tmp/socialpilot-duplicate-typecheck-final.log`,
`/private/tmp/socialpilot-duplicate-build-final.log` and
`/private/tmp/socialpilot-duplicate-live-final.log`.

## Posts literal search and complete CSV export — 2026-10-17

Final automated verification passed **1,234 tests across 204 files**, including
actual isolated PostgreSQL suites. Typecheck and an isolated production build
passed; preview `.next` was preserved. Registry 47 adds consumed Publishing
search length and CSV post/UTF-8 byte/batch ceilings. No DDL, provider request
or production change occurred. POST_SEARCH_EXPORT.md records interface and
consistency/resource limitations; the plan records review refinements.

Test-first regressions cover SQL LIKE metacharacters, status/channel/query
composition, identical count/row predicates, read-only MCP permission/discovery,
caller result ceilings, strict no-store HTTP filters, CSV quoting/Unicode/formula
protection, normalized first-comment/media/outcomes, exact row/byte ceilings,
multiple keyset batches and no further queries after refusal. UI tests cover
applied-filter URLs, pending/repeat clicks, metadata/blob byte checks, object
URL cleanup, safe focused failure and preparation feedback.

Independent review found that the page data helper's new custom predicate could
replace its mandatory scope. Current routes passed correct scoped predicates;
no exposed route bypass was observed. A failing regression demonstrated the
helper contract weakness, then it was corrected to conjoin workspace, selected
resource and author scope independently. The query helper returns resolved
scope to the paged reader. Parent review also replaced repeated full-CSV byte
scans with incremental accounting and single giant reads with bounded snapshot
batches, and aligned search limits with native HTML UTF-16 maxLength.

`scripts/verify-post-search-export.ts` ran against the actual local app and
preview database. Disposable scoped-editor/read-key fixtures included a message
match, first-comment-only match, own unconnected draft, wildcard lookalike, mixed
hidden destinations, foreign workspace, unselected destination and another
author's unconnected draft. Literal percent/underscore/backslash search returned
exactly the three authorized matches across three HTTP pages under temporary
page size one. HTTP export returned both North matches independent of displayed
page size. Read-only MCP returned byte-identical CSV and list search agreed.

CSV inspection confirmed quote/formula protection after whitespace, embedded
line breaks, Unicode, both stored media references and first comments, without
raw provider error text. Temporary batch size one exercised actual PostgreSQL
keyset reads. Temporary post/byte ceilings refused oversized matches as JSON,
with no partial CSV. Current channel-grant revocation immediately removed North
from that same key's export. Unsupported/repeated parameters were denied. The
original editor-denying MCP policy was checked before the temporary local test
grant. Exact setting presence/value/encryption/timestamp restoration and removal
of all disposable posts, identities, keys, sessions and workspaces were verified.
No provider transport was invoked.

Chrome exercised Clay desktop Table at 1440×1000: typing/applying waiting
returned the two seeded waiting/awaiting posts, then the sidebar initiated CSV
preparation with focused Prepared CSV for 2 posts feedback. Nightfall phone
390×844 retained Feed and search inside the existing 330px navigation drawer.
Offline export focused safe recovery feedback and retained filters; reconnecting
and retrying prepared the same two-post CSV. No page overflow occurred. Root's
Publishing category exposed the four new consumed defaults in its existing phone
shell. A forged 201-character search retained the route and focused the precise
200-character validation message; mutation/import controls were absent during
that failure. Cards with no matches showed the no-match state. Grove desktop
1440×900 retained Cards/search and the configured input bound/export control
without overflow. These are representative local checks, not complete all-state
accessibility or browser-save proof; prepared/download-initiated does not assert
that the operating system saved the file.

Synchronous export limits deliberately refuse large sets. Asynchronous archives,
performance/index work at production volume, saved views, bulk operations, REST
v1, complete legacy/provider/MCP coverage and migration/rollback/cutover remain
open. Private evidence logs:
`/private/tmp/socialpilot-search-full-tests-final.log`,
`/private/tmp/socialpilot-search-typecheck-final.log`,
`/private/tmp/socialpilot-search-build-final.log`, and
`/private/tmp/socialpilot-search-export-live-final.log`.

## Batch 49: Facebook signing and bounded live reads — 2026-10-17

Final integrated verification passed **1253 tests across 206 files**, including
actual isolated PostgreSQL tests. Typecheck and isolated production build passed;
the running preview's `.next` was preserved. Focused regressions cover HMAC token
identity across GET/DELETE/form/multipart, pagination token/proof replacement,
disabled/missing-secret behavior, OAuth separation, request cancellation, ad-set
ownership/create signing, registry ownership/default and server secret injection.
Unreadable or blank secrets preserve engine/adapter metadata; Ads live read/manage gates
and direct mutations fail closed without exposing technical configuration copy.

In Chrome at localhost:3200 (Clay, 1440×1000), Root → Facebook sidebar search
found exactly one active default-enabled Sign Graph requests control in API
credentials. No setting was changed. Posts retained stored rows, and Ads retained
stored results; both had no horizontal overflow or signing-setup error copy.
These are representative desktop checks, not new full phone/theme/keyboard or
real-provider UI verification. Earlier wider design evidence remains separate.

The exact signed engine bundle passed six read checks on the authorized host
against real Graph v26.0: matching user/Page identity, required read grants,
10 returned Pages, 5 ad accounts, and 24 observations covering all four requested
Page metrics. Empty/missing metrics or missing required grants are not passes.
No remote content, ads or customer database rows were changed. No secret/token/
proof/customer ID/value left the host. This is a legacy-credential engine probe,
not rebuilt OAuth/config import, UI/API/MCP, complete metrics or write proof.
The current connection lacks `ads_management`.

Exact private remote probe artifacts were removed after testing. Legacy web,
worker and proxy remained active; loopback/public health returned 200. No DDL,
production configuration change, service restart or cutover occurred. The local
public-defaults/bundle copies were removed; sanitized final logs remain private:
`/private/tmp/socialpilot-signing49-tests-final.log`,
`/private/tmp/socialpilot-signing49-typecheck-final.log`,
`/private/tmp/socialpilot-signing49-build-final.log`,
`/private/tmp/socialpilot-signing49-live-final.log`, and
`/private/tmp/socialpilot-signing49-cleanup-final.log`.
FACEBOOK_REQUEST_SIGNING.md records ownership, reproduction and remaining gates.

## Batch 50: ordered media, authoring and adapter boundaries — 2026-10-17

Verification passed **1304 tests across 208 files**, including actual isolated
PostgreSQL authorization/recovery and duplication tests. Typecheck and isolated
production build passed; the running preview's `.next` was preserved. Independent
read-only review found no remaining P1/P2 issue in this batch. Earlier full-suite
failures exposed a missing adapter declaration in the duplication fixture, a
missing copied-link preflight argument and one brittle error-copy assertion;
these were corrected before the final suite. No DDL or production change occurred.

Focused cases cover ordered removal/reordering/description association,
multi-image atomic selection, partial upload retry without reuploading confirmed
files, malformed receipts, field/error IDs across editors, visible failure focus,
pending field locking with enabled hidden serialization, count exhaustion and
unsupported controls. Provider-neutral fixtures permit combinations that Facebook
rejects; selected adapters decide compatibility before saves/schedules/duplication
and publication intent. Strict action/MCP parsing rejects extra fields/bytes and
ambiguous scalar/list shapes. Ready-only MCP destination metadata matches the UI.

`scripts/verify-ordered-media.ts` refused missing preview inputs, then passed real
localhost HTTP/MCP checks against the synthetic loopback preview: scoped uploads,
ordered create/edit, per-image descriptions and first comment, foreign images,
malformed payloads, Facebook-incompatible combinations, current Root count,
read-only keys and revoked destination access. It verified removal of all its
disposable images/records and exact restoration of temporary configuration,
including original timestamps/encryption flags. No provider request was sent.

Chrome **Clay, 1440×1000**: two synthetic images selected together, described,
reordered and previewed; forced offline upload preserved both Files, order,
descriptions, text and first comment. Online retry uploaded/saved both. Actual
HTTP reads confirmed two ordered workspace references with matching descriptions.
Multi-image editing reopened both items. Offline edit retained reordered media,
edited text/description and focused recovery; retry persisted all changes and
returned to Posts. Expanding edit initially exposed a file-input CSS specificity
overflow; after fixing the scoped picker geometry, document width stayed 1440.
The saved browser draft and both uploaded images were removed through existing
local services, and absence was checked. Original seeded image fixtures remain.

Chrome **Nightfall, 390×844**: composer/editor styling inspected; two synthetic
Files selected, sidebar drawer opened and Save draft tested offline. The drawer
closed, the visible failed row received focus and described errors, both Files
and text remained, and document width stayed 390. The later phone description
fill and menu-click actions were **not executed**: automatic approval review
reported exhausted workspace credits. Phone successful save/retry, final keyboard
matrix and Grove/Coast/other narrow theme checks remain unverified. The browser
retains an unsaved synthetic phone draft and Nightfall theme pending resumption;
that phone flow created no persistent post or uploads before the block.

The browser's native upload tool separately refused the local fixture paths.
File selection was instead simulated with File/DataTransfer objects built from
the app's authorized synthetic media API. This exercises the actual change,
preview and HTTP-upload paths, not the native OS file dialog.

The newly available frontend-design + frontend-design-premium skills were applied
to final review. Their strict static audit returned **two findings**, both in
existing shared primitives: it did not recognize forwarded Button action props
(`components/Button.tsx`) or inline JSX `resize: 'none'` (`AutoTextarea.tsx`).
Source inspection and actual action/textarea behavior contradict those reports;
no fake click handler or redundant style was added merely to silence the audit.
The strict audit is **not reported as passed**. Its private JSON artifact is
`/private/tmp/socialpilot-media50-premium-audit-artifact.json`.

Private logs: `/private/tmp/socialpilot-media50-tests-final.log`,
`/private/tmp/socialpilot-media50-typecheck-final.log`,
`/private/tmp/socialpilot-media50-build-final.log`,
`/private/tmp/socialpilot-media50-live-final.log`, and
`/private/tmp/socialpilot-media50-browser-cleanup.log`.
ORDERED_MEDIA_AUTHORING.md records ownership and remaining formats, upload
recovery, live provider, full parity and release gaps. Production remains legacy.


## Batch 51: captionless post content — 2026-10-17

Shared authoring/edit/duplicate services now accept a normalized empty caption
when validated media or a link provides post content. Empty/first-comment-only
posts are refused. Scheduling/rescheduling validates stored content and publication
checks it before creating provider intent. UI accepts pending local image Files,
keeps invalid/empty URL recovery, labels captions optional with attachments and
renders content without filler. Posts/Calendar share safe neutral summaries.
MCP accepts an explicit empty string while refusing absent/non-string messages;
confirmed writes still call the same current-authorized domain services.

Verification passed **1336 tests across 208 files**, including the isolated
PostgreSQL integration checks. Typecheck and an isolated production build passed;
the running preview's `.next` was preserved. The first full suite caught old
rescheduling mocks that omitted all newly selected content fields (five failures)
and a malformed UUID in a new summary fixture (one failure). Fixtures were
corrected, with explicit empty/first-comment-only reschedule denial and link-only
reschedule coverage added; the full rerun passed. Two independent lower-cost
implementation agents and a separate reviewer handled service/UI/review scopes.

The extended guarded `scripts/verify-ordered-media.ts` passed actual local HTTP
image uploads and authenticated MCP image-only creation, caption removal retaining
ordered image descriptions/first comment, link-only replacement, and link/video-only
creation with exact persisted content. Empty/first-comment-only create and update
were refused, and an existing link survived a refused update. Temporary drafts were
removed through authorized local MCP deletion; existing foreign-image, malformed
payload, unsupported combination, Root cap, read-only key and revoked-scope checks
still passed. Cleanup verified fixtures/images absent and exact restoration of
all temporary settings. No provider request or production change occurred.

Facebook engine fixture tests verify no-caption photo, remote-video and link
requests omit the respective caption/description/message field; genuinely empty
content makes no transport request. This is transport-fixture evidence, not real
Graph publication proof. Automated component tests cover the composer, local edit,
first-comment-only denial, preview and list/calendar summaries. They are not a
substitute for live keyboard, phone/theme, upload and save/edit browser checks.

The Premium strict static audit reran and exited 1 with the same two existing
shared-primitive detection limitations: Button forwards action/type through
`...props`, and AutoTextarea applies `resize: 'none'` through inline React style.
Both were inspected in the previous batch and remain unchanged; no new findings.
The strict audit is **not green**. No fake handler or duplicate CSS was added to
silence it. Browser automatic approval review had rejected earlier phone fill/click
actions because workspace credits were exhausted. The user has said they will
refill; new browser calls remain pending confirmation of the refill. No alternate
browser/automation path was used to bypass that rejection.

Private evidence: `/private/tmp/socialpilot-content51-tests-final.log`,
`/private/tmp/socialpilot-content51-typecheck-final.log`,
`/private/tmp/socialpilot-content51-build-final.log`,
`/private/tmp/socialpilot-content51-live-final.log`, and
`/private/tmp/socialpilot-content51-design-audit.json`. CAPTIONLESS_POSTS.md owns
this behavior and remaining scope. Native formats, durable temporary-photo
recovery, full legacy/UI/API/MCP parity, live-provider and cutover gates stay open.


## Batch 52: durable Facebook media steps and private module evidence — 2026-10-17

Facebook now commits a photo intent before each multi-image upload, its validated
receipt before the next photo, then a feed intent and receipt. Configured adapter
and direct engine construction both inject the module-owned journal. Failures
with possible partial effects remain held. Installed neutral hooks protect new
claims, data/connection cleanup and manual outcomes even when customer module
access is off. Root's owning platform section has one shared evidence table,
contextual sidebar operation filter/reset, GET API and installation MCP tool and
resource. Registry 49 consumes Root and Facebook evidence limits.

**1392 tests across 216 files passed**, including six new guarded PostgreSQL
media tests. Actual database cases cover independent committed ordering, real
engine/fake transport sequencing, receipt-write fault rollback, held replay,
feed receipt-write failure, duplicate identities, outcome checks and bounded
content-free evidence. Protocol tests cover missing operation identity, begin/
record faults, first-photo versus later rejection, feed uncertainty, malformed
IDs and cancellation. Root tests cover current authority, disabled-module
visibility, cap changes, schema bounds, private HTTP/MCP, sidebar validation and
empty/truncated/unavailable states. Typecheck and isolated production build
passed; the running preview's `.next` was preserved.

The first full unit run caught old SQL mocks treating the new journal query as
an advisory-lock/table-list result, an overbroad host import pulling unrelated
engine mocks into safety checks, and an in-progress journal mock. The registry
was narrowed to explicit installed module safety wiring, mock queries were made
accurate, and real PG validation caught/fixed a missing raw-read proxy method.
The first complete database run then identified two cutover tests still pinned
to five migrations. The reviewed allowlist checks were updated to require the
new sixth file/hash and mapped columns; subsequent complete runs passed.

Before preview migration, a private custom-format backup restored exact counts
across all 98 source tables. The additive SQL applied to that scratch restore,
and an independent migrated backup restored exact counts across 99 tables. Only
then did the same checksum apply to the synthetic preview, preserving every
original count with an empty new table. Both scratch databases were removed.
CUTOVER.md records the artifact sizes/paths, checksum and outstanding full
production-shaped/six-file/media/proxy/worker rollback gates. No production
migration or service change occurred.

Guarded `scripts/verify-facebook-media-evidence.ts` passed actual localhost
HTTP/MCP checks with disposable synthetic data and injected fake Graph responses:
three committed photo/feed receipts; exact Root API/tool/resource evidence;
Root access independent of workspace membership; anonymous and ordinary
workspace-owner denial; a successfully authenticated workspace key denied Root
reads; known feed receipt denying ABSENT and a mismatched ID; and matching
explicit local publication recovery without another provider request. All
fixture workspace/content/keys/sessions/users/journal/audit records were removed
and absence checked. No global setting changed and no secret was printed. The
probe refuses absent preview guards before opening a database. Early attempts
cleaned their fixtures after missing timestamp fields and a double-slash local
URL produced invalid responses; corrected timestamps/normalized origins passed.

Independent review found one P2 misleading promise that an operation filter
would bypass the history limit. Copy now says configured limits still apply;
new filter/reset and clear-to-unfiltered behavior are covered. The final review
reported no P1/P2 findings. Three lower-cost implementation agents and a separate
reviewer worked in explicit service/engine/Root/review ownership boundaries.

Premium strict audit exited 1 with only the same two existing shared-primitive
detection limitations (Button forwards props, AutoTextarea sets inline resize).
It is not green; no fake handler or duplicate style was added. Browser automatic
approval review previously rejected phone actions because credits were exhausted.
The user said they will refill; no new browser run or alternate automation bypass
was attempted. Root sidebar/table phone/theme/keyboard behavior remains unverified
in a live browser. Component and HTTP/MCP checks are not browser evidence.

Known staged-photo cleanup, unknown-step reconciliation/attestation, delayed
result conflict recovery and real Facebook multi-photo canary/cleanup remain
unfinished. Failed staged effects can therefore stay held. This batch does not
claim full Publishing/Facebook/MCP/Root/legacy parity or production readiness.
Production still runs legacy. FACEBOOK_MEDIA_RECOVERY.md owns this slice.

Private evidence: `/private/tmp/socialpilot-photos52-tests-final.log`,
`/private/tmp/socialpilot-photos52-typecheck-final.log`,
`/private/tmp/socialpilot-photos52-build-final.log`,
`/private/tmp/socialpilot-photos52-live-final.log`,
`/private/tmp/socialpilot-photos52-migration.log`,
`/private/tmp/socialpilot-photos52-probe-guard.log`, and
`/private/tmp/socialpilot-photos52-design-audit.json`.


## Batch 53 — manual known staged-photo deletion, 2026-10-17

This batch implements one provider-owned private recovery action, not full
Facebook recovery. Manual cleanup defaults off, requires exact step confirmation
and external-unused/race acknowledgment, and refuses known or uncertain feed
effects. The module derives all remote identity from durable evidence. Independent
intent/receipt/audit transactions preserve unknown DELETE effects and forbid
automatic resend. Shared Root publication/workspace/target/active-owner guards
are reused across UI, HTTP and installation MCP. Provider rules remain enclosed
in Facebook. Registry 50 owns the consumed manual-policy/read/delete scope keys.

Verification:

- The guarded isolated-preview full suite passed 1,445 tests in 222 files,
  TypeScript passed, and the isolated production build passed. This was before
  the final locked-query hardening that prevents a corrupt feed target from
  being filtered out. After that change, the focused guarded PostgreSQL cleanup
  suite passed 13/13 and TypeScript passed. A final full guarded suite/build/
  HTTP-MCP rerun was requested but automatic approval review rejected execution
  because workspace credits were exhausted; those final reruns remain pending.
- Real PostgreSQL tests cover confirmed replay, intent/audit and receipt faults,
  uncertain hold, explicit rejection retry, staged-photo settlement, ABSENT
  protection, feed refusal, parent freeze and corrupted binding refusal.
- Engine/transport fixtures cover configured grants/policy/current binding,
  exact fresh photo identity and deletability, positive/malformed story refusal,
  omitted story under manual policy, Graph signing and exact success receipts.
  Regression tests reproduced policy/connection revocation during the GET; a
  final current-credentials check now refuses DELETE in that case. False or
  malformed DELETE responses through the real engine remain uncertain.
- Component/HTTP/MCP tests cover active Root-only scope, module dispatch, typed
  confirmation/acknowledgment, no secret leakage, pending/error/unknown feedback,
  malformed non-JSON 404 hold, validation correction, Close and review refresh,
  and persistent focused success after refreshed metadata removes the action.
- Actual localhost HTTP/MCP probe `scripts/verify-facebook-media-cleanup.ts`
  authenticated an installation owner with no fixture-workspace membership and
  an ordinary owner/API key. It denied anonymous/ordinary-owner/key writes and
  cross-origin requests, enforced disabled policy/exact confirmation/acknowledgment,
  replayed the same synthetic confirmed receipt through HTTP/MCP, held uncertain
  deletion in both interfaces and exposed retained evidence without another
  action/intent. No provider callback or real Graph request was performed.
  Temporary policy changes were audited and the exact prior setting restored;
  disposable users/workspace/targets/sessions/keys/journal/audit records were
  removed and absence checked. Config history retains the value-free test audit.
- Seventh additive migration was backup/restore verified on exactly 99 then 100
  public tables before preview application; CUTOVER.md records checksums and
  private backups. No production change occurred.

Independent review added parent-to-step checks before action scope construction
and under lock, and tests prevent corrupt feed bindings from disappearing from
eligibility queries. A transport-review concern about missing story fields was
evaluated against Meta's documented limitation: neither missing nor null proves
unused. The chosen policy remains explicit external verification/acknowledgment
with cleanup disabled by default; a positive story always blocks it. This does
not claim an atomic provider safety guarantee.

Premium strict static audit exits 1 with exactly the same two existing shared
primitive detection limitations: Button forwards action/type props and
AutoTextarea sets inline resize. No new finding; the strict audit is not green.
Browser automatic approval review previously rejected phone actions because
workspace credits were exhausted. The user said they will refill, with no
completed-refill confirmation yet. No browser run or alternate bypass occurred.
Desktop/phone/theme/keyboard visual checks remain pending.

No live Facebook DELETE/create canary, unknown upload/feed/delete reconciliation,
complete provider format/permission/MCP/legacy parity, seven-file production-shaped
cutover rehearsal or production rollout is established. Production remains legacy.
FACEBOOK_MEDIA_RECOVERY.md defines the exact implemented/manual boundaries.

Private evidence: `/private/tmp/socialpilot-cleanup53-tests-final.log`,
`/private/tmp/socialpilot-cleanup53-typecheck-final.log`,
`/private/tmp/socialpilot-cleanup53-build-final.log`,
`/private/tmp/socialpilot-cleanup53-http-mcp-final.log`,
`/private/tmp/socialpilot-cleanup53-migration.log`, and
`/private/tmp/socialpilot-cleanup53-design-audit.json`.

The later command approval block also affects integration reruns and potentially
network publishing, not only browser inspection. It states that approval review
could not complete because credits were exhausted, rather than deciding the
action unsafe. No alternate execution path was used to bypass that block.
The local filesystem-only checks remain distinct from blocked network/database
checks. The local probe's additional API-key authentication assertion was added
after its last successful run and still needs the blocked actual HTTP rerun.

Final filesystem-only checks after the last safeguard passed: 1,362 tests in
200 files, with the 83 guarded database tests in 22 files explicitly skipped;
TypeScript and `git diff --check` also passed. This does not replace the pending
final guarded full-suite/build/HTTP-MCP reruns. Private offline log:
`/private/tmp/socialpilot-cleanup53-tests-offline-final.log`.

### Batch 53 final approval recovery and browser evidence

After the transient credit-review rejection, the same normal approval mechanism
accepted GitHub push and remote verification. The previously blocked guarded
full suite then passed **1,445 tests in 222 files** against the exact committed
backend safeguard; isolated production build and the actual HTTP/MCP probe also
passed, including the added valid-key initialization check. No alternate path
was used to bypass review. The earlier pending-rerun statements above record the
intermediate state and are superseded by these results.

Chrome read/write controls subsequently worked through normal approval. A
disposable synthetic example added one actionable known photo plus confirmed
and uncertain deletion examples. It had no usable credentials, and temporarily
enabled manual cleanup through the audited Root MCP setting service. Nightfall
390×844 checks verified Cancel initial focus, exact confirmation and checkbox
gating, bounded 358px dialog, no document horizontal overflow (390px), safe
preflight failure retaining both inputs, focused alert, disabled repeat, Close
and review refresh, and the same row remaining held afterward. Sidebar drawer
filter submission retained invalid text with aria-invalid and associated error.

A Grove visual check at 1440×1000 used a temporary DOM-only theme preview, not
a saved theme-setting workflow. The 520px dialog stayed within the viewport,
Cancel kept initial focus, and the two sidebars retained navigation/filters.
Native inline screenshots were visually inspected for both phone error and
desktop dialog. File-path screenshot export was refused by the browser tool's
configured roots; no alternate file-write path was used. The old “known
unpublished” module copy was corrected to “recorded staged” because the provider
cannot guarantee continued unused state; a PostgreSQL metadata assertion guards
that distinction.

The browser fixture process completed cleanup and exact prior policy restoration.
A fresh page showed empty evidence, manual cleanup disabled, original Nightfall
theme restored and no document overflow (1440px). No live provider operation was
dispatched. These are representative Root browser checks, not all themes/states,
remote success, complete keyboard coverage or the older composer phone matrix.
All remaining live-provider, unknown-step reconciliation and release gaps remain.

Published implementation: `8e2842fa27e1e60c69639e613b42aad59c9bf9f4` on
`origin/main`, with exact remote verification and clean tree before this final
copy/evidence follow-up. This section records that follow-up.

## External Facebook media reports and late receipts — batch 54

Facebook now owns explicit human photo/feed/deletion reports, separate immutable
resolution events, retained late provider evidence and conflict holds. Registry
51 adds the consumed, default-off `meta.manualMediaAttestationEnabled`. Shared
Root carries bounded module-defined fields and read-only binding context without
interpreting provider semantics. HTTP and installation MCP call the same guarded
service; workspace owners and workspace API keys cannot execute these actions.
`attested` identifies human evidence, never an independently confirmed provider
result. No automatic resend, absence inference or arbitrary conflict resolver
was added. Human-attested feed absence does not authorize destructive staged-photo
cleanup: only no feed intent or a definitive provider rejection passes that gate.

### Automated, migration and actual HTTP/MCP evidence

- Final full guarded suite: **1,473 tests passed in 222 files**. An earlier run
  hit five Vitest worker module-loading timeouts; no assertion failed. The full
  rerun with two workers and file parallelism disabled passed in 41.53 seconds.
- TypeScript, isolated production build and `git diff --check` passed. The build
  did not replace the running preview's `.next` directory.
- Real PostgreSQL cleanup tests include human-absent feed refusal in both action
  metadata and direct service dispatch, safe no-feed parent absence, canonical
  projected-identity contradictions, immutable-event update refusal, late receipt
  races, deletion claim collisions, and workspace export/erase ownership.
- The actual local HTTP/MCP probe passed default-policy, anonymous/member/key,
  origin, exact confirmation, acknowledgment and strict module-field denials.
  It recorded a synthetic human feed receipt, separately finished its matching
  local publication, recorded photo absence/deletion through MCP and preserved
  contradictory late provider evidence after parent absence. The workspace
  archive included the FK-owned ledger; unresolved conflict refused erasure.
  These probes issued no real provider request.
- Eighth-migration restore verification matched all 100 original and 101 migrated
  public-table counts before preview application. CUTOVER.md records the unchanged
  checksum, private backups and remaining production-shaped rehearsal requirements.

### Representative Chrome evidence

Disposable examples had no usable provider credential and required the synthetic
`provider-preview.invalid` endpoint. Before read-only binding context was added,
Nightfall 390×844 checks covered required-ID focus/error association, exact
confirmation/acknowledgment gating and an offline submit retaining all values,
focused safe feedback, disabled repeat and Close and review. After restoring the
network, a Grove 1440×1000 local report succeeded: the action disappeared, the
table kept a focused human-provenance notice, and separate operator evidence was
visible. Native inline screenshots were visually inspected at those stages.

After binding context and Root-only scroll layout were added, a second Nightfall
390×844 check visually confirmed the Page/workspace/target/operation context and
358px dialog. Its body had 554px visible height and 647px scroll height; header
and footer remained fixed. Shift+Tab brought the acknowledgment into view;
Escape closed the dialog and restored its opener. Document width stayed 390px.
Grove 1440×1000 DOM checks confirmed four binding entries, a 520px-wide dialog
within the viewport and no document overflow. The final desktop screenshot's
automatic approval review timed out; it supplies no additional visual evidence.
This does not prove all themes, states or keyboard combinations.

The prolonged browser/approval wait outlived the disposable fixture's original
five-minute session. Fixture records were deleted, but its audited policy
restoration initially failed authentication. A new correctly formatted temporary
Root session restored the original absent/default-off setting through audited
MCP and was removed. The probe now renews only its own fixture session before
restoration; the server still checks current Root authority. The final full probe
then completed cleanup and exact original-policy restoration successfully. A
fresh browser page showed empty evidence, manual attestation disabled, original
Nightfall restored and 1440px document width. No production setting changed.

The previously used premium static-audit plugin file is no longer installed at
its recorded path, so that audit was not rerun for this batch. The earlier two
primitive detection limitations remain historical findings, not a green audit.

### Live-provider and release boundaries

A fresh read-only host query found ten selected enabled Page targets and current
connection-level `pages_manage_posts`/`pages_manage_engagement` grants. This does
not independently prove Page-specific access. Credentials stayed on the host;
temporary scripts were removed and health remained HTTP 200. The user selected
Cuisine Pleine d’Envie for identifiable temporary canary posts and cleanup.
No live create/delete operation was executed by batch 54. Candidate search,
arbitrary conflict resolution, complete Facebook formats/permissions/legacy/MCP
coverage, the eight-file production-shaped migration and production rollback
gates remain open. Production still runs legacy.

Private evidence: `/private/tmp/socialpilot-resolution54-full-final.log`,
`/private/tmp/socialpilot-resolution54-typecheck-final.log`,
`/private/tmp/socialpilot-resolution54-build.log`,
`/private/tmp/socialpilot-resolution54-http-mcp-final.log`, and
`/private/tmp/socialpilot-resolution54-migration.log`.

Post-publication review tightened one further receipt guard: every step in a
late-deletion operation must match its copied Facebook Page identity. A real
PostgreSQL regression corrupts a separate feed binding and verifies refusal
without changing the deletion state or appending a misleading provider event.
The media-journal/cleanup suites pass 32 tests and TypeScript passes. No live
target lookup was added, preserving receipt capture after local object removal;
the applied migration and its checksum are unchanged.

## Live multi-photo canary — batch 55

Added an import-safe host-only operator verifier and twelve synthetic filesystem
tests. The verifier uses two generated 640×480 PNGs, a unique visible run label,
exact selected-Page binding, public artifact hashes and credentials decrypted
only on the authorized legacy host. Durable file intent/receipts precede each
phase; an exclusive Page lock prevents concurrent/repeated unknown runs.
Uncertain photo/feed/delete outcomes remain held. Strict finalization cannot
remove an unresolved ledger or claim a failed read proves absence.

The final full guarded suite passed **1,486 tests in 223 files**. TypeScript,
isolated production build and whitespace checks passed. The rebuild preview's
`.next` directory was preserved. The full suite includes the follow-up late
deletion binding regression and canary tests for ordering, generated-image bounds,
unknown states, exact IDs, no-repeat writes, Page concurrency, lock retention and
verified finalization. These synthetic checks do not establish remote outcomes.

The real engine canary on the user-selected Page recorded two photo receipts,
then one feed receipt. Signed reads confirmed published status and both exact
photo/feed associations. Feed deletion returned explicit success. Subsequent
photo reads failed, so the initial verifier exited 2 with `held_photo_cleanup`;
it did not declare a complete passing run or automatically send photo deletes.

Read-only investigation revalidated the Page identity and publishing grant.
ID-only photo reads returned HTTP 400/code 100/subcode 33; the feed returned
HTTP 400/code 10. A bounded uploaded-photos read returned four identities and
neither test photo, without establishing absence. A separate user-authorized
cleanup made the first exact-ID DELETE for each known generated photo after
durable intent and original-ledger backup. Both returned HTTP 400/code 100/
subcode 33. Zero explicit photo-deletion receipts exist; those writes will not
be retried. Evidence and the Page lock remain on the host. No application cleanup
guard was relaxed, no production database/settings were written and no service,
worker or proxy changed. Public and loopback port 3100 health returned HTTP 200.

The separate test browser was logged out of Facebook. Local Chrome access was
disabled; after the user said they will enable it, the available browser inventory
still contained only the in-app and MCP Apps browsers. Authenticated visual photo
cleanup verification remains pending. Primary Meta documentation fetches returned
429; no deletion-cascade guarantee was inferred from secondary pages.

FACEBOOK_LIVE_MEDIA_CANARY.md records hashes, explicit reproduction inputs,
private evidence paths and scope. This is an engine-only legacy credential bridge,
not a migrated rebuild runtime/UI/API/MCP or database-journal test. First comments,
other formats, broader provider/legacy/MCP parity and production cutover remain
open. The Facebook module and full application are not complete.

Private local checks: `/private/tmp/socialpilot-canary55-tests.log`,
`/private/tmp/socialpilot-canary55-typecheck.log` and
`/private/tmp/socialpilot-canary55-build.log`. The private host ledger is retained
as documented; do not delete or release it merely to permit another test run.

## Ads report selection and correction — batch 56

Reproduced eleven failing regression cases before implementation: unavailable
account input became All accounts, malformed/reversed custom dates became the
default period, summary counts ignored account selection, and preset date inputs
were editable although their values were ignored. An additional empty-account
correction case was also observed failing before its normalization fix.

Ads now owns the pure parser/preset catalog; invalid input produces field errors
before insights or management-readiness work. The picker retains unavailable
accounts and invalid date text. Shared themed fields/buttons replace separate
36px controls; error descriptions remain outside labels. Existing dataset scope
still independently intersects authorized accounts with the requested identity.

Final verification:

- **1,499 tests passed in 224 files**, including nineteen focused Ads tests.
- TypeScript, isolated production build and whitespace checks passed. The
  preview's `.next` directory was preserved.
- Actual local desktop GETs for unavailable accounts on Ad accounts and Campaigns
  showed a focused alert, retained picker value/associated error and no report.
  Correcting the account through Apply loaded only the EUR example card, with
  Linked/Enabled/Synced/Campaign totals all one. A reversed custom range retained
  both dates and marked its end field invalid without loading a report.
- Changing the preset to Custom dates enabled its fields immediately. Nightfall
  390×844 checks retained `2026-02-30` as editable text with its associated error.
  The Menu & filters drawer exposed all controls at 44px height and document width
  stayed 390px. Correcting to March 1–3 and submitting loaded the selected example
  account, closed the drawer and removed the alert, with no horizontal overflow.
- A native Nightfall phone screenshot and Grove desktop error screenshot were
  visually inspected. Desktop DOM geometry checks across all four theme previews
  kept 44px fields and 1440px document width. These are representative checks,
  not a complete contrast/keyboard/state matrix. Temporary DOM theme previews
  were not saved; a fresh navigation restored the user's current Clay theme.
- Actual authenticated workspace MCP rejected the unavailable account with safe
  `unavailable` failure and accepted a valid selected EUR request. No provider
  write occurred. MCP already had this unavailable-account guard; the batch does
  not add new tools or claim complete UI/API/MCP reporting parity.

No DDL, registry change, provider request or production deployment occurred.
Existing presets/defaults and new correction copy still need the requested Root
configuration/copy catalog. Query bounds/pagination, account-status presentation,
comparisons, export/freshness and broader Ads/core/legacy parity remain open.
The earlier Facebook photo-cleanup ledger and lock remain unresolved and were
not modified by this batch. ADS_REPORT_FILTERS.md records behavior and boundaries.

Private logs: `/private/tmp/socialpilot-ads56-red.log`,
`/private/tmp/socialpilot-ads56-empty-red.log`,
`/private/tmp/socialpilot-ads56-focused-final.log`,
`/private/tmp/socialpilot-ads56-full-final.log`,
`/private/tmp/socialpilot-ads56-typecheck-final.log` and
`/private/tmp/socialpilot-ads56-build-final.log`.

## Ads Root policy and shared report validation — batch 57, 2026-10-17

Scope: synthetic isolated localhost preview, registry 52; production remains
legacy. No DDL or real provider request was part of this batch.

- Test-first UI cases failed on missing policy consumption, absent custom preset
  choices and unbounded custom days. MCP regressions reproduced its former
  29-day/local-time date interpretation and independent Analytics maximum.
  Added preset discovery/mixed-input and empty-account regressions failed before
  their fixes. Root route tests reproduced missing pre-persistence schema
  validation. Independent review found the empty account scope issue; it was
  fixed and reviewed again.
- Final guarded PostgreSQL suite: **1,550 tests in 227 files passed**, 45.37s.
  Focused policy/route checks, final TypeScript and whitespace checks passed.
  The isolated production build passed without changing preview `.next`.
  The Vite CJS deprecation notice remains tooling output, not a failing test.
- Actual authenticated local HTTP/installation-MCP probe
  `scripts/verify-ads-report-policy.ts` saved a 14-day policy through both Root
  interfaces, checked registry 52/value-free audits and invalid-policy 400/no
  write. Ordinary workspace owners could not read/write Root; their read-only
  Ads key could not read Root HTTP or save Root MCP configuration.
- The same probe verified default and explicit custom preset selection,
  exact 14-day inclusive UTC endpoints/exclusive end metadata, over-limit and
  stale-preset refusal, end-only default-duration behavior, safe report options,
  and both actual server-rendered Ads pages using the configured choice/limit.
  This is HTTP-rendered evidence, not interactive browser editing of Root JSON.
- Exact prior setting row restoration and disposable user/session/key/membership
  cleanup were independently checked before the probe returned exit 0. Invalid
  origin, remote/non-preview database and production-mode guard executions
  returned exit 1 before database access, using dummy credentials/loopback port 1.
- Actual Chrome desktop Clay check rejected a 367-day custom request with the
  configured 366-day maximum, preserved both endpoints, associated its end-field
  error, focused the route alert and loaded no report. Root's Ads section exposed
  the new JSON setting with default-source/Active labels.
- At 390×844 with reduced motion and a temporary Nightfall DOM theme, the one
  Menu & filters drawer retained the same correction and limit guidance. Its
  native screenshot was visually inspected; no horizontal overflow appeared.
  Correcting the end date and choosing Preview EUR Ads through the actual form
  loaded the selected account, closed the drawer and removed the correction
  state. Linked/Enabled/Synced counts each became one. An empty account query
  on Campaigns then produced correction without a report or overflow.
- Temporary DOM theme preview was not persisted. Only the audit-owned browser
  tab was closed; the user's pre-existing preview tab was left untouched.
  This is representative desktop/phone evidence, not a complete four-theme
  contrast, keyboard and every-screen accessibility matrix.

General copy configuration, report database row bounds/full pagination,
comparisons/export/freshness, readable provider-owned status, broader Ads/core/
legacy/MCP parity and release gates remain open. Personal Chrome was still
absent from available browser inventory after the user's access-settings reply.
The existing Facebook photo-cleanup ledger and Page lock remain held and were
not modified; unreadable provider objects are not treated as absent.

Final full-suite log: `/private/tmp/socialpilot-ads57-full-final.log`.

## Ads bounded reports and server pages — batch 58, 2026-10-17

Scope: isolated synthetic localhost preview only. Registry 53 adds consumed Ads
page-size and report-row limits; no DDL, provider request or production cutover.

- Test-first checks reproduced an unbounded stored-row fetch, stale object names,
  colliding delimiter-based summary keys, absent server report pages and missing
  MCP policy-sized/strict-integer paging. Independent review covered current
  scope predicates, level filters before the row cap, complete aggregation before
  paging, creation/readiness placement and correction paths; no findings remained.
- Final guarded PostgreSQL suite: **1,589 tests in 229 files passed**, 45.84s.
  Focused checks, final TypeScript and whitespace checks passed. The isolated
  production build passed and left preview `.next` unchanged. Earlier agent
  checks encountered in-flight module/test edits and an unconfigured run skipped
  database suites; neither was used as final acceptance evidence.
- The actual authenticated HTTP/installation-MCP probe saved all three report
  settings. Root page size one produced distinct MCP pages with the same complete
  result count and a continuation. Both server-rendered report routes exposed
  first/second pages, retained dates/account in links and rendered explicit scope
  counts. A one-row ceiling refused oversize UI/MCP reports with actionable
  correction and no partial metrics or result count.
- The probe also retained its batch-57 date-policy, stale-input, UTC, workspace-
  owner/key Root denial and value-free audit checks. It restored all three exact
  prior setting rows (including absence/timestamps) and verified disposable
  identities/sessions/key/membership cleanup before exit 0. Four separate dummy-
  credential guard checks rejected remote origin, remote/non-preview database and
  production mode before database access.
- Actual desktop Chrome Clay: saved page size one through Root's numeric control
  and observed Saved/database-source feedback. Ads overview showed one of three
  cards, while Linked/Enabled/Synced totals remained three and Campaigns remained
  two. Following Next page changed the visible account and retained the custom
  October 1–14 URL/date state and full scoped totals. Both pager directions
  measured 40px high without document overflow.
- Actual Nightfall DOM preview at 390×844/reduced motion: the EUR account's
  Campaigns route showed one of three objects. Its single 330px navigation drawer
  exposed correctly scoped Previous/Next links, range and page text. The native
  drawer screenshot was visually inspected; both directions measured 40px high,
  with no horizontal overflow. Following Next page preserved EUR/custom dates,
  showed the next object, and closed the drawer. A malformed page later produced
  the focused correction and a first-page link preserving all selected filters,
  with no result panel or overflow.
- The browser setting's original absent row was backed up privately and restored
  exactly after verifying its current value was still this test's one. Its
  legitimate value-free Root change audit was retained. Temporary Nightfall DOM
  styling was not saved. Only the owned test tab was closed; the user's existing
  preview tab was left untouched. Representative checks are not a complete
  four-theme/keyboard/every-screen accessibility matrix.

The current query bounds rows and aggregates the whole admitted dataset before
server display paging. It does not provide byte/time ceilings, database object
paging, asynchronous reports or a stable snapshot across requests. Directory
paging, comparisons/export/freshness/status, general copy/native Root numeric
hints, daily MCP details, full Ads/legacy parity and cutover remain open. Personal
Chrome was still not exposed by browser inventory; the existing Facebook cleanup
ledger and lock were not modified and visual cleanup remains pending.

Final logs: `/private/tmp/socialpilot-ads58-full-final.log`,
`/private/tmp/socialpilot-ads58-build-final.log`. Test-first MCP reproduction:
`/private/tmp/socialpilot-ads58-mcp-red.log`. One-setting browser backup:
`/private/tmp/socialpilot-ads58-page-size-original.json` (contains only the original
public setting row, not credentials).

## Stored Ads daily metrics and complete CSV — batch 59, 2026-10-17

Final integrated verification passed **1,654 tests across 237 files**, with the
explicit isolated-preview database opt-in and all existing rollback-only
PostgreSQL checks enabled. Typecheck, whitespace checks and an isolated
production build passed. The disposable build retained the running preview's
`.next` output. An earlier build caught two TypeScript errors in the new probe;
both were fixed before the final build. Focused service, serializer, HTTP, MCP,
UI and stale-request tests were also run during review. Review corrections added
consistent quoted formula-safe CSV strings, signed credential URL scrubbing,
preserved nonsecret JSON `key` metrics and complete daily UI scalar measures.

The guarded `scripts/verify-ads-report-export.ts` passed against the dedicated
loopback `_preview` database and localhost:3200. Disposable UUID-bound insight
rows exercised real scoped viewer HTTP/MCP reads, exact account/level/object
filtering, scalar/action/additional-field preservation, exact fetch provenance,
credential redaction, complete CSV receipts and `msp://ads/daily`. Removing the
current channel grant denied the same account through both interfaces without
rows. Missing-feature keys could neither discover nor call reporting tools.
Anonymous HTTP and duplicate parameters were refused. Root row/detail-byte/CSV-
byte ceilings refused whole oversized results without partial data/files.
Temporary Root writes had value-free audits.

The preview initially excluded viewers from MCP's configured role policy. A
first draft of the probe therefore could not establish viewer MCP scope proof;
the final probe captures that policy, temporarily permits viewers, uses keys
created by the scoped viewer, verifies success followed by revocation denial,
and restores the exact original policy row. It also restores all four captured
Ads settings including absence/encryption/timestamps, and verifies removal of
its rows, users, grants, memberships, sessions, keys and config audits. Seeded
examples remain. No provider request, migration, production data or service
change occurred.

Actual Chrome: Clay desktop 1440×1000 exported all **12** seeded matching daily
rows from Campaigns with focused `Prepared CSV for 12 daily rows.` feedback and
unchanged filters. At 390×844 under Nightfall, offline export retained filters,
reenabled the button and focused safe error feedback inside the drawer. Online
retry prepared the same 12 rows; Escape closed the drawer and returned focus to
Menu & filters. Shared download component regressions additionally cover
duplicate clicks, filename/format/count/byte receipts, unmount, filter/filename
changes and stale completion while a newer request remains pending. Completed
feedback clears when scope changes. A desktop keyboard Enter also exported the
12-row result successfully.

Real phone daily expansion displayed report day separately from fetch time,
currency, spend, impressions, clicks, daily non-additive reach, all ratios,
actions and retained breakdown values without document horizontal overflow.
All four theme token sets were inspected on the owned desktop tab, with distinct
computed palettes and no document overflow. This is representative browser
proof, not the full all-screen/theme/accessibility matrix. Only owned test tabs
were changed; theme overrides were DOM-only and no user preference was saved.

Frontend Design Premium strict static audit reported two existing primitive
false positives: `Button.tsx` forwards action/type props, and `AutoTextarea.tsx`
already applies `resize: 'none'` in its inline style. Both sources were manually
checked; no app-wide clean static-audit claim is made. Runtime tests/build/browser
checks above remain the actual evidence.

Logs: `/private/tmp/socialpilot-ads59-full-final.log`,
`socialpilot-ads59-build-final.log`, `socialpilot-ads59-type-final.log`,
`socialpilot-ads59-probe.log`, and `socialpilot-ads59-premium-audit.json` in the
same private temporary directory. ADS_REPORT_EXPORT.md records protocol and
limits. Asynchronous exports, stable multi-request snapshots, comprehensive
provider metric collection/management, comparison/status analysis, wider
legacy/MCP parity and migration/cutover remain open. Facebook canary cleanup
evidence/lock remain held and unchanged; this batch makes no remote cleanup claim.

## Workspace-qualified Facebook sync — batch 60, 2026-10-17

The user's selected any-active-owner rule is recorded in ARCHITECTURE_CONTRACT.
WORKER_WORKSPACE_ACCESS.md describes the neutral gate, current owner/provider/
feature checks, Root settings and resource-lock protocol. Candidate reads no
longer capture tokens. Four Facebook collectors re-read current credentials,
grants, expiry and selected bindings per attempt, after reads and before commit.
Scheduled status and Inbox also constrain parent post workspace identities.
Selection, disconnect and reconnection share sorted neutral resource locks;
collector writes use the locked transaction. Counters describe committed work.

Focused tests exercised policy loss while waiting, new tokens on retry, missing
grants, lost selections, rebound resources, token expiry during reads and access
loss after a staged upsert. They also preserve partial metric failure reporting,
cursor fairness, disabled-module behavior and Inbox deletion ordering. Provider
engines in these tests are stubs; no real provider outcome is asserted.

Nine actual isolated PostgreSQL checks use unique synthetic users, workspaces,
memberships and plans. The real entitlement loader and bound SQL validate
same-owner grants, rejection of pooled grants, any/all policy, disabled-owner
exclusion, cross-workspace isolation, suspension despite installation ownership
and owner-ceiling refusal. Two real clients prove resource conflict before the
second callback, release/reacquisition and rejection/rollback of a late write
through an expired transaction client. Root policy overrides exist only inside
an intentionally rolled-back transaction. Cleanup verifies zero fixture records.
An initial fixture insert lacked the legacy plan timestamp; it was corrected
and all tests reran with explicit preview database opt-in. Failed-attempt fixtures
were also removed and aggregate namespace counts verified zero.

Actual Chrome read private Shared configuration Jobs/Sync controls and the
Facebook Analytics collection category at localhost:3200. Policy defaults,
owner ceiling, three resource budgets and provider 7/30-day windows displayed in
their declared sections. A 390×844 Nightfall check retained settings through the
single drawer; Escape restored Menu & filters focus, with no document overflow.
No settings or user theme preferences were saved. Authenticated real HTTP and
private MCP returned schema 55 and matching active Shared/Facebook ownership
metadata for all eight new keys. Browser review found missing private Root HTTP
cache headers; regression tests first failed, then passed after explicit
`no-store` and safe read-error handling were added. Real browser read 200 and
invalid-policy write 400 both returned `no-store`; the invalid value was refused.

Final integrated verification passed **1,710 tests across 241 files**, with all
guarded PostgreSQL checks explicitly enabled. Typecheck, whitespace checks and
the isolated production build passed; the preview build output was retained.
One Facebook-owned lookback schema is consumed by both Root and collectors,
avoiding independent copies of the range rule. Final logs are
`/private/tmp/socialpilot-facebook60-release-tests.log`,
`/private/tmp/socialpilot-facebook60-release-build.log` and
`/private/tmp/socialpilot-facebook60-type-verified.log`. Targeted database and
cache regressions are recorded in `socialpilot-facebook60-database.log` and
`socialpilot-facebook60-root-cache-red.log`/`root-cache-green.log` in the same
private temporary directory.

There was no migration, real provider request, worker startup or
production change. In-flight HTTP reads are not recalled by a policy switch;
current checks fence subsequent attempts and transaction commits. Complete
collection metrics/formats, live grant/expiry proof, callback lifecycle, Inbox/
Ads management, broader legacy/MCP parity and release gates remain unfinished.
The private Facebook cleanup ledger/lock were not modified. Root numeric input
min/max hints and the complete visual/accessibility matrix remain open.

## Workspace team access — batch 61, 2026-10-17

The Settings-owned team service is shared by the customer page, HTTP and MCP.
The guarded `scripts/verify-team-access.ts` probe passed against actual local
HTTP/MCP keys and PostgreSQL grants/audits. It exercised suspension and account
disablement, channel-scope enforcement, admin/owner authority, self-protection,
disabled-member removal, and retention of the removed person's other workspace.
Cleanup was verified. No provider request, schema migration or production change
occurred.

In the owned browser tab, adding an account succeeded with focused feedback;
a missing-account failure retained the form context. On a 390px Nightfall phone
emulation, offline edit failure preserved Viewer role, two channel choices and
confirmation, and focused the uncertain-outcome message. Online edit then succeeded with the Viewer role and both selected channels. Removal succeeded with focused feedback; HTTP readback confirmed absence. The three browser domain audits and disposable account cleanup were verified. The phone inspection also showed 601px document
scroll width from the fixed module rail at a 390px viewport; touch interaction
hit timeouts while keyboard interaction worked. Mobile visual/interaction pass
is not claimed. Investigation remains open.

The current edit form carries unavailable existing target IDs into submission,
while the UI omits them from the selectable list. Server scope validation refuses
those IDs before replacing grants, so this is a blocked edit/recovery path, not a
silent grant removal. The explicit removal action and warning are implemented and covered by component tests; no automatic grant removal occurs.

Typecheck and an isolated production build passed. Initial full-suite runs found test-harness compatibility issues (registry version/metadata assertions and the new router dependency); these were corrected before the final passing run recorded below. The strict static audit
reported two existing shared-primitive findings (`Button` prop forwarding and
`AutoTextarea` inline resize suppression); no clean audit claim is made. Logs:
`/private/tmp/socialpilot-team61-live-api.log`, `/private/tmp/socialpilot-team61-build.log`,
`/private/tmp/socialpilot-team61-rebuild-type.log`, `/private/tmp/socialpilot-team61-full-tests.log`,
`/private/tmp/socialpilot-team61-release-tests.log`, and `/private/tmp/socialpilot-team61-ui-audit.json`.
Final test totals follow below. Root defaults are least-privilege by default: contributor with no channels selected.

Final batch 61 verification: **1,743 tests across 244 files passed**, with guarded
PostgreSQL checks explicitly enabled (`/private/tmp/socialpilot-team61-final-tests.log`).
Final rebuild typecheck and whitespace check passed; isolated production build
passed without changing the preview `.next`. The original positional Team service
and its obsolete test were removed; all entry points use the Settings-owned service.
The browser test tab was closed, leaving the user's Analytics tab untouched.

## Workspace invitations and onboarding — batch 62

Focused invitation, mail, cookie/session, public-route and component regressions
passed **171 tests across seven files**. A guarded integration probe then passed
against isolated loopback PostgreSQL, actual HTTP/Root configuration updates,
an in-memory local SMTP capture, and scoped workspace MCP keys. It verified
invite creation and explicit reissue (old token refused), fragment-token
preview/cookie continuation, correct-email existing-account acceptance,
wrong-email and pending-MFA denial, existing-account registration refusal,
new-account registration without a session, non-Root status, email verification
and zero channel grants, list/revoke scope, read/write MCP-key parity, expiry,
revocation and replay rejection. Disposable records and exact prior Root
settings were restored and verified. No external email/provider, production
database, production setting or schema migration was used.

An integrated preliminary test run had five failures caused by concurrent mock
export and label fixtures; those fixtures were corrected. A subsequent 136-test
MCP-targeted run passed. The final exact index snapshot passed 1,778 tests across 250 files with guarded
PostgreSQL checks enabled; typecheck and production build passed. Two additional
owner-invitation rank regressions were then added and the complete 10-test
invitation service file passed. A clean phone/browser join-flow pass remains
pending. The browser tool returned no usable fresh-flow evidence, so no
browser-flow pass is claimed. SMTP ambiguous outcomes are `uncertain`, not
automatically retried; email logs may carry `delivery_unconfirmed` when SMTP
accepted but its receipt could not be recorded. See ONBOARDING.md for exact
security boundaries and remaining account-lifecycle parity.
