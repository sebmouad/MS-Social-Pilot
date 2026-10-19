# Content feeds (legacy parity wave 3)

Status: SOURCE and MOCKED TESTS. No real PostgreSQL run, no browser check, no live network call, no live provider call. Production remains legacy.

## Ownership

Content feeds are a feature of the Publishing product module (feature id `publishing/feeds`, route `/publishing/feeds`), like the media library. `src/modules/feeds/` follows the self-containment layout and Publishing's manifest spreads `FEEDS_PAGES`, `FEEDS_ROOT_KEYS` and `FEEDS_JOBS`, so there is no new module id.

| File | Role |
| --- | --- |
| `manifest.ts` | feature id, navigation entry, Root key list, worker job declaration |
| `config.ts` | 26 `feeds.*` Root keys (all `active`) |
| `feeds.ts` | pure: schemas, confirmations, RSS/Atom/WordPress parsing, message rendering, `selectNewEntries`, `fallbackTime`, `spreadGroups` |
| `server/access.ts` | per-call authorization (account, membership, plan, grants, purge guard) and `qualifyingOwner` |
| `server/core.ts` | Root bounds, guarded workspace transaction, locking, audit, row mapping |
| `server/feeds.ts` | `readFeeds`, `createFeed`, `updateFeed`, `deleteFeed`, `checkFeed` |
| `server/ingest.ts` | the shared read-and-create core (manual and automatic) |
| `server/polling.ts` | `runFeedPolling`, the worker entry |
| `server/http.ts` | thin-route helpers |
| `mcp.ts`, `copy.ts`, `ui/` | `FEEDS_MCP` group, en+fr copy, `FeedsScreen` + `FeedManager` |

`src/app/publishing/feeds/page.tsx` re-exports `ui/FeedsScreen`. API: `GET/POST /api/feeds`, `PUT/DELETE /api/feeds/[id]`, `POST /api/feeds/[id]/check`. Reused rather than duplicated: the SSRF-guarded pinned fetch (`modules/publishing/server/media/network/net-guard`), Publishing's `validateTargets` (scope, enabled, provider capability, link support) and `resolveAuthorizedDestinationFormats`, `allocateQueueTime` (weekly queue), `recordPostVersion`, `withWorkspaceOperation`. The earlier WIP's duplicate network guard and its reliance on `modules/media` internals were dropped.

## Capability against legacy (`src/lib/rss/poll.ts`)

| Legacy | Rebuild |
| --- | --- |
| RSS, Atom, WordPress REST sources | Same (`kind`), https only unless Root allows http; host allowlist |
| Add / edit / delete, name, URL, template, hashtags, destinations, enabled | Same, with exact confirmations (`CREATE FEED <name>`, `UPDATE FEED <id>`, `DELETE FEED <id>`) |
| `{title} {excerpt} {link} {hashtags}` and `{{...}}` placeholders | Same; values are inserted literally |
| Auto-schedule vs approval queue (`autoApprove`) | `handling`: `schedule` (queue) or `review` (Approvals). Stored in the legacy `autoApprove` column; new feeds default to `review` |
| Queue slot, else now+1h stepped past booked posts | `allocateQueueTime` then `fallbackTime`; delay and spacing are Root keys |
| Spread over channels (`spreadMinutes`) | Same, bounded by `feeds.maxSpreadMinutes` |
| First poll ignores items older than the subscription (`ingestFrom`) | Same |
| Match on guid, one post per item | Unique `(feed, guid)` row written in the same transaction as the post(s) |
| Per-poll cap (10) and no etag while a backlog remains | `feeds.autoCheck.maxItemsPerFeed`; validators are cleared while a backlog remains |
| Conditional requests | ETag / Last-Modified, used by automatic reads only |
| Disable after 10 consecutive failures | `feeds.autoCheck.disableAfterFailures` (0 never), audited |
| Poll now | `Check now` (preview) plus confirmed `drafts` or `posts` modes |
| Worker polling by interval | `feedsPoll` job, per-feed claim, interval and failure backoff |
| Approval email once per poll | Not ported (see limitations) |
| Featured image as link preview | Not ported |

## Automation and approvals

- A feed in `review` sends every new item to Approvals (`pending_approval`, approval `pending`, with a reserved queue time so an approved post is ready to go).
- A feed in `schedule` queues posts (`scheduled`) at the next free workspace queue time, but the post is **held for approval whenever the workspace requires approval**, whatever role the acting owner has. Unreviewed article text is never treated as reviewed. Automation never publishes immediately and never calls a provider; the shared delivery worker stays the only publisher.
- `drafts` (manual, confirmed) creates local drafts, never scheduled or submitted.
- Authority: manual runs act as the signed-in member (author role, current grants, channel scope). Automatic runs act as the oldest active workspace owner whose current plan and grants allow the feature **and** cover every destination (the workspace-owner worker policy; grants of different owners are never combined). Authority and the feed's channels are rechecked inside the post transaction.
- Posts carry the owner as author; the audit row of an automatic run has a null actor (`feeds.posts_created` with `automatic: true`), manual rows name the member.

## Worker, leases, idempotency

`feedsPoll` is declared in Publishing's manifest (schedule key `feeds.autoCheck.schedule`, default every 15 minutes) and registered in `scripts/worker.ts`; the shared worker owns the job lease and run history. `feeds.autoCheck.enabled` (default off) is Root's master switch. Per feed the claim is one compare-and-set `UPDATE ... SET lastPolledAt = NOW() ... WHERE enabled AND due RETURNING`, so two workers cannot read one feed in the same interval and a crashed worker leaves the feed not due until the next interval. Healthy feeds are due every `feeds.autoCheck.intervalSeconds`; each consecutive failure doubles the wait up to `maxBackoffMultiplier`. Item creation is all-or-nothing per read: a failed transaction rolls back every `feed_items` row and post, so the next read retries; a repeat read finds the guids and creates nothing.

## Root keys (registry version 84)

Existing WIP keys plus `feeds.autoCheck.schedule`, `feeds.autoCheck.maxItemsPerFeed`, `feeds.autoCheck.disableAfterFailures`, `feeds.maxSpreadMinutes`, `feeds.queueLookaheadDays`, `feeds.fallbackDelayMinutes`, `feeds.fallbackSpacingMinutes`. All bounded, all consumed. Owned by Publishing in Root. Fetch, size, redirect, host, per-workspace count, name/message/target limits and transaction bounds are Root keys; no operational literal lives in code.

## API and MCP

HTTP routes are same-origin for writes and call the same services. MCP group `content-feeds`: `list_content_feeds`, `create_content_feed`, `update_content_feed`, `delete_content_feed`, `check_content_feed` (`mode` preview/drafts/posts), resource `msp://feeds/sources`. Writes need the exact confirmation; creating modes of a check write an MCP audit receipt. All tools are classified **resource-scoped**: a restricted key or channel-limited member sees and changes only feeds whose channels are all inside the current grant, and a feed naming no channel (workspace-wide) is refused to them; destination checks reuse Publishing's scope rules. Feature `publishing/feeds` maps to the `publishing/posts` switch in the permission and entitlement tables.

## Limitations

- Evidence is unit tests with mocked Prisma/SQL text routing and injected network: not run against PostgreSQL, a browser, MCP with real keys, or a live provider. The raw SQL (`feed_sources`, `feed_items`, `posts`, `post_targets`) assumes the legacy columns (`autoApprove`, `spreadMinutes`, `pollErrorCount`, `publishMode`, `approvalStatus`, `submittedById`, `formatId`) exist as in `prisma/schema.prisma`; verify on a migrated database.
- No reviewer notification when feed posts land in Approvals (the notification kinds belong to Settings); reviewers see them in the Approvals queue.
- Feed images and link previews are not downloaded or attached.
- No "recently imported" list on the screen.
- `drafts` mode has no stored per-feed setting (no migration); it is a manual action.
- `qualifyingOwner` and the screen are not covered by their own unit tests beyond the injected seams.
- Automatic reading is off until Root enables `feeds.autoCheck.enabled`; the worker must run (`npm run worker`).
