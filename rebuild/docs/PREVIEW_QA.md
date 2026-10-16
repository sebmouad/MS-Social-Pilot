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
