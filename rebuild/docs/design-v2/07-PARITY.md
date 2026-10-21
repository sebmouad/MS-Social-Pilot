# 07. UI vs REST vs MCP parity (code inspection, 2026-10-21)

Method: every exported function in `src/modules/*/server/**` was classified by
which entry points import it. Entry points are UI (screens, server actions, and
browser `fetch('/api/…')` resolved to their route), API (`app/api/**/route.ts`,
module `rest.ts`/`http.ts`) and MCP (`*mcp*.ts`). Source-level only; no
running MCP client or provider.

## Summary

| Measure | Value |
|---|---|
| Service functions reached by UI, API **and** MCP | 181 |
| UI pages / API route files / MCP tool modules | 75 / 183 / 41 |
| Screens or routes reading the DB directly | 7: `FeedsScreen`, `McpScreen`, `AccountFallback`, `AuthorizeScreen`, `root/sessions/page`, `api/oauth/authorize`, `api/mcp` |
| Screens computing channel scope themselves | 12 (`viewer.permissions.pageScope` in ui files) |

The architecture is right: shared module services behind thin entry points. The differences below are what remains.

## Findings and required fixes

| # | Finding | Fix | Acceptance |
|---|---|---|---|
| P1 | **Ads screens bypass the Ads read service.** `AdsScreen`, `CampaignsScreen`, `CompareScreen` and `ObjectsScreen` build scope from `viewer.permissions` + entitlements and call raw `getAdsAccounts`/`getAdsDataset` with `parseAdsFilters`. REST/MCP call `readAdsPerformance`/`listAdsAccounts` → `authorizeAdsRead` with `parseAdsPerformanceFilters`. | Screens call the same read services (add a screen-shaped read such as `readAdsAccountsView(actor, args)` in `modules/ads/server/` if the output shape differs). Delete scope computation from UI files. | Same inputs give the same totals and periods in screen, REST and MCP. A test feeds one fixture through all three. |
| P2 | **Scope computed in 12 screens.** Inbox, Home, Analytics, Feeds, Ads, collaboration and OAuth screens derive `allowedChannelIds` themselves. | One helper `actorFromViewer(viewer)` in `src/server/context.ts` returns the actor with scope; services remain the authority. Channel scope (01 §5) is applied by services from a `channel` argument, intersected with authorization. | Grep shows no `pageScope` in `modules/*/ui/**`. |
| P3 | **Publishing write paths differ by entry.** UI server actions call `createPost`/`updatePost`/`reschedulePost` directly. REST/MCP call `createPublishingPost`, which adds exact confirmation and its own argument parsing. MCP also writes a transport `auditedReceipt`. | Introduce one input parser `parsePostInput` used by both. Keep confirmation transport-specific: UI dialogs are the confirmation, MCP/REST require the phrase. Domain audit only in the service; drop or clearly label transport receipts. | Same invalid input → same error code and message on all three. |
| P4 | **Queue semantics differ.** UI "Add to queue" creates and queues in one step (`createQueuedPost`). MCP `queue_post` only queues an existing draft. | Add an optional `content` form to `queue_post` (or a `create_and_queue_post` tool) calling `createQueuedPost`. | An MCP client can do the composer's queue action in one call. |
| P5 | **Key REST v1 much smaller than MCP.** `/api/v1` covers posts, pages, me, webhooks, analytics and ads operations. Inbox, Tasks, Media, Feeds, Sharing and Settings are reachable by MCP keys but not REST keys. | Generalize `keyToolEndpoint` (Integrations) to every module's MCP group: `/api/v1/<module>/<operation>`, with the same ceilings and confirmations. | Each MCP tool has a REST v1 twin, or a documented reason it does not. |
| P6 | **Calendar view UI-only.** MCP uses `list_posts`. | Add `get_calendar` (read) over `readPublishingCalendar`. | Optional; low priority. |
| P7 | **Known contract gaps.** Agency switching is confirmed in MCP but not in REST. Sharing copy-only edits differ. Ads locale is not passed from UI/REST/MCP. | Per MCP_PARITY.md. | MCP_PARITY "remaining deviations" closed. |
| P8 | **Direct DB reads in 7 screens/routes.** | Move them into the owning module's services (OAuth and MCP routes may keep bootstrap reads, documented). | Only documented bootstrap exceptions remain. |
| P9 | **Channel parameter names.** Customer routes use `channel`, `channelId`, `target`, `targets`, `targetIds` and `channels`. | One `channel` parameter (01 §5) parsed by a shared `parseChannelScope`. Keep old names readable for one release. | One name in URLs; tests for legacy mapping. |

## Re-run the inspection

```sh
cd rebuild/src && node ../scripts/parity-inventory.mjs .            # per-module summary
cd rebuild/src && node ../scripts/parity-inventory.mjs . publishing # one line per function
```

Treat the output as a lead list (helpers show as single-entry); confirm each item by reading the code.
