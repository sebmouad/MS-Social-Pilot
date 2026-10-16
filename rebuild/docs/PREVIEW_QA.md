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
