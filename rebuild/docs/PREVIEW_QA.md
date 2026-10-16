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
- After the failed campaign request, focus was observed on the document body while the native modal remained open. Review pending/error focus recovery and restoration across dialogs.
- Customer copy still includes storage/provider type jargon and raw status codes in some places. Design/copy polish remains incomplete.
- No real remote publishing, remote deletion, inbox reply, ad delivery/change, backup restore, production-shaped migration or cutover was exercised by this synthetic batch. The full architecture and release requirements remain open.

## Automated verification

The integrated batch passed **369 tests in 80 files**, with `REBUILD_PREVIEW_DATABASE_URL` set so both PostgreSQL probes ran, **TypeScript checking**, and **production compilation**. A skipped database probe must never be described as passing. The fixture seeder was executed repeatedly, and its production, remote-host, non-preview-name and host-override refusal paths were checked. It never reads the legacy application `.env`.

## Connection health and inventory follow-up

Home now uses the selected channel loader and the same ad-account predicate as Ads/MCP. In the synthetic browser it displays four channels and three accounts, excluding unselected and revoked sources. MCP `list_pages` returns the same four channel names. Tenant and enabled-platform filters are shared through `selectedResourceConnectionWhere`; expired credentials do not erase retained history.

Connections shows expired and revoked social/ad accounts as **Reconnect needed**. Its status labels come from the Root-managed `connections.statusLabels` registry entry (version 29), with bounded non-empty values. The shared selection service rejects attempts to enable expired/revoked sources or resources from a disabled module; disabling a stale resource remains allowed. The dialog permits undoing an unsaved deselection and omits unchanged items from the request.

Browser checks verified unchecking and restoring an expired channel before saving, with both actions still available. An actual local API request to enable the expired channel returned **409** and the reconnect message. The equivalent MCP ad-account request returned a tool error with the same message. These refusal checks did not change fixture selections. The phone Connections screen fit a 390px viewport without page overflow. The selection dialog was visually inspected in Nightfall at 390 × 844, and the connections table in Grove on phone and desktop. Regression tests cover expiry boundaries, disabled modules, stale-resource removal, selection undo/no-op writes, Home counts, post scope and MCP query bounds.

Follow-up verification: **383 tests in 84 files**, including both PostgreSQL probes, TypeScript checking and production compilation passed. No live provider or production deployment evidence is implied.
