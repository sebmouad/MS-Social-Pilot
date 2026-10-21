# Content feeds (legacy parity wave 3)

Status: **source/mock evidence plus recorded production recipe planning**.
Updated 2026-10-21 against local HEAD `6fb0e57f`. The rebuild is in production;
[RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md#production-log--2026-10-21) records
the recipe run below. Original RSS/Atom mocked tests do not establish live checks
of every feed kind. No fresh database, browser or provider calls in this doc pass.

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

## WordPress recipe planner (2026-10-21)

Status: **implemented with mocked tests and owner-recorded production planning**.
Unit seams use mocked `mysql2`, an in-memory ledger and fake Publishing/image
ports, with real `sharp` conversion. Separately, the 2026-10-21 production log
records read-only MariaDB permission checks, image download/JPEG conversion and
80 scheduled posts across 10 Pages (0 failed, 0 unfilled) over a two-day horizon.
The configured production source is live; shipped Root default
`feeds.wordpress.enabled=false` and new-source paused defaults still apply to
new installations/sources. Planning is not proof of Facebook publication,
first-comment delivery, every transport or browser interaction.

Purpose: keep every selected Page continuously scheduled with recipes from the owner's WordPress site. Each configured time on each Page gets a **different** recipe: Facebook image and caption in the post, the canonical recipe in the first comment. Read-only access to WordPress; the application never writes to it.

| File | Role |
| --- | --- |
| `wordpress/config.ts` | 48 `feeds.wordpress.*` Root keys (spread into `FEEDS_CONFIG`; one secret, the others `active`) |
| `wordpress/recipe.ts` | pure: per-source config merge over Root defaults, recipe parsing, first-comment rendering and truncation, permalink and image addresses, slot instants (DST), recipe allocation, confirmations |
| `wordpress/db.ts` | read-only MariaDB access (lazy `mysql2/promise`, injectable pool): candidate query, attachment-path query |
| `wordpress/image.ts` | guarded fetch, media inspection, WebP to JPEG (`sharp`), stored through `uploadWorkspaceImage` |
| `server/wordpress-settings.ts` | one validated Root snapshot for the feature |
| `server/wordpress-store.ts` | `RecipeStore` port and Prisma implementation (sources, ledger claims) |
| `server/wordpress-planner.ts` | `planSource` (fill the horizon) and `runRecipePlanning` (worker entry) |
| `server/wordpress.ts` | customer service: read, save, pause/resume, preview, run now |
| `copy-recipes.ts`, `ui/RecipeSource.tsx` | en+fr copy and the screen section on `/publishing/feeds` |

Migration `20261031140000_rebuild_wordpress_sources` (additive, SHA-256 `cce64edcfbcf19553f7eafe661f86fb067d8d0152e08712d05dc1745121c4642`, pinned in `scripts/cutover-rehearsal.sh` and its test, **pinned source; the production recipe run is recorded separately, without an exact migration receipt in this feature report**): `wordpress_recipe_sources` (one per workspace; name, site, enabled, all-or-selected channels, JSON config overrides, last run) and `wordpress_recipe_plans` (the ledger). Both carry `workspaceId` FKs with cascade and the purge write gate, so catalog-driven export and erasure cover them.

### Data mapping (verified production facts)

- Recipes: `wp_posts` rows with `post_type = 'post'`, `post_status = 'publish'`; table prefix, type, status and every meta key below are Root defaults that each source may override.
- Caption: meta `_msrwa_facebook_caption`. Image: meta `_msrwa_facebook_generated` is an attachment ID; the attachment's `_wp_attached_file` gives the path, public address `{siteUrl}{uploadsPath}/{path}`. Recipe: meta `_msrwa_recipe` (JSON). Already shared: meta `fb_shared_at` (skipped when "skip shared" is on). A recipe needs all three of caption, image file and a recipe with at least one ingredient or step, otherwise it is not a candidate.
- Link: `feeds.wordpress.permalinkTemplate` (`{siteUrl}/{slug}/`), e.g. ID 60938 becomes `https://recettes.newsgeet.com/potee-auvergnate-a-lancienne-fondante-et-doree/`.
- Ingredients and steps may be strings or objects (`name/text/item`, `quantity/qty/amount`, `unit`, `note`, nested groups with `items`); group titles become heading lines.
- First comment: template with `{title} {description} {ingredients} {steps} {servings} {prep} {cook} {total} {link}` (French default). Ingredients get bullets, steps are numbered. Over the limit (the smaller of `feeds.wordpress.firstCommentMaxCharacters` and `publishing.maxMessageCharacters`) steps are cut first, then ingredients, with a mark, and the link is always kept.
- Image: downloaded with the address-pinned public fetch (feeds redirect/allow-http/host-allowlist settings apply, so the WordPress host must pass `feeds.hostAllowlist` when that list is not empty), checked by `inspectMediaSnapshot`, converted to JPEG (quality from Root, lowered stepwise until under `publishing.maxImageUploadBytes`), and stored as a workspace image referenced as `media:<id>`.

### Planning

1. The `feedsPoll` job (schedule `feeds.autoCheck.schedule`, no new job name, `scripts/worker.ts` unchanged) now also runs `runRecipePlanning` after RSS reading. It acts only when `feeds.wordpress.enabled` is on and a source is enabled; RSS reading's own switch is independent. The result is attached as `recipes` on the job summary (the worker's one-line log does not print it).
2. Per source it acts as the oldest active workspace owner who qualifies (`qualifyingOwner`, the workspace-owner worker policy). Channels are the source's list or, with "all channels", every enabled publishable channel whose type is in `feeds.wordpress.targetTypes`; each is validated through Publishing's `validateTargets` and dropped when Publishing would refuse it.
3. Slots: configured local times in the source time zone for `horizonDays` ahead, DST-correct (a time inside the spring gap moves to the first minute that exists; an ambiguous autumn time uses its first occurrence), starting `minLeadMinutes` from now.
4. Allocation: slots in time order, pages in name order; each slot takes the first recipe that no other page received in the horizon (when distinct), that this page has not had within `cooldownDays`, and that this slot has not already failed with. Recipes are scanned newest first (or oldest) in keyset batches, up to `candidateMaxScan` rows.
5. Each slot is claimed in the ledger first (unique on source, page, time), then image prepared, then Publishing `createPost` with one target, the scheduled time, the caption, the stored image, the rendered first comment and the first-comment delay. Publishing's own authorization, approval, scheduling mode (application default), first-comment continuation and status reconciliation apply unchanged.
6. Per-run budget `feeds.wordpress.runBudget` bounds posts created across all sources (default 80, the first fill of 10 pages x 2 days x 4 slots).

Ledger states: `planned` (post id stored), `claimed` (unfinished; older than `claimLeaseSeconds` it becomes `uncertain`), `uncertain` (a result that could not be confirmed: never retried automatically, the slot stays consumed, the recipe stays blocked), `failed` (definitive refusal: image or content problem). A failed slot is retried with another recipe (the failed ones are kept in `skipped` and stay blocked for that page) until `maxSlotAttempts`. An authority error (forbidden/unauthorized/unavailable) stops the source's run without blaming the recipe.

### API and MCP

`GET/PUT /api/feeds/wordpress`, `POST /api/feeds/wordpress/preview`, `/run`, `/state`; same-origin writes. MCP tools in the `content-feeds` group: `get_recipe_source`, `save_recipe_source` (`SAVE RECIPE SOURCE <name>`), `preview_recipe_source`, `run_recipe_planner` (`RUN RECIPE PLANNER`), `set_recipe_source_state` (`PAUSE RECIPE SOURCE` / `RESUME RECIPE SOURCE`). All are channel-scoped: a channel-limited member or key sees and changes only a source whose channels are explicitly listed and all inside the grant; a workspace-wide source is refused to them. Manual run-now acts as the signed-in member and requires the Root switch and an active source. The database address is never returned; the read model only says whether planning is available.

### Limitations and open work

- The production log supersedes the original no-runtime claim for the recorded MariaDB/image/storage/planning path. Dependency lockfile integration is in `b940fad9`. Exact target migration history, export/erasure, crash recovery, real MCP/client scope, browser and Facebook publication/comment/cleanup outcomes still need their own evidence; the 80-post plan does not prove these.
- Chronological order uses `ID` (newest first by `ID`), not `post_date_gmt`.
- The pool of eligible recipes is finite (about 2,900 with caption and image). At 40 posts a day with a 365-day cooldown it is exhausted in about 70 days; the planner then reports unfilled slots instead of repeating.
- A crash between creating the post and saving its ID leaves an `uncertain` row (slot consumed, no duplicate); the post itself is found in Publishing.
- Planned posts are not removed when a source is paused or a channel is deselected (they are ordinary scheduled posts). Failed slots are not shown with a manual retry action.
- The preview shows the original WordPress image address in an `<img>`; a strict `img-src` policy must allow the site, or a proxy would be needed.
- Shortening marks, minutes suffix and the French default template are Root settings; the customer-facing error text of the service is English like the rest of the feeds service.
