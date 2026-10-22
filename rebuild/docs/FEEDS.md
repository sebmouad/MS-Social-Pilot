# Content feeds (legacy parity wave 3)

Status: **source/mock recovery evidence plus owner-recorded production planning, publication and first comments for one full day**.
Updated 2026-10-21 against source HEAD `99c41554`, schema 123; deployment was
not re-observed by this lane. The rebuild is in production;
[RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md#production-log--2026-10-21) records
the recipe run below. Original RSS/Atom mocked tests do not establish live checks
of every feed kind. No fresh database, browser or provider calls in this doc pass.

## Current source reconciliation — 2026-10-21

Reviewed at `99c41554`, schema 123. Existing reuse policy, reviewer notices,
caption decoding/control repair and recovery changes below are integrated source.
HomeScreen still does not mount RecipeSupplyCard: the Home low-supply warning
remains incomplete. Reuse defaults off; zero source cooldown alone does not
permit repeats. The earlier pool-health description is historical; the shared
supply policy below governs finite estimates and actual-publication reuse.

The 40/40 publication/comment day remains owner-recorded production evidence.
Retry/pause-cancel, uncertain-claim reconciliation, concurrent cross-slot allocation,
large retained-history reads and actual notice delivery still lack runtime proof.
Caption repair is service-only, with no UI/REST/MCP entry points; outcomes for the
six planned captions remain unrecorded here. Do not equate source repair with
stored-data repair. LEGACY_SWEEP_2026-10-21.md is absent at this HEAD, so any further
Feeds inventory findings from it await integrator input. No new keys in this lane.

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

`src/app/content/library/feeds/page.tsx` (Content › Library › Feeds; the old `/publishing/feeds` address redirects) re-exports `ui/FeedsScreen`. API: `GET/POST /api/feeds`, `PUT/DELETE /api/feeds/[id]`, `POST /api/feeds/[id]/check`. Reused rather than duplicated: the SSRF-guarded pinned fetch (`modules/publishing/server/media/network/net-guard`), Publishing's `validateTargets` (scope, enabled, provider capability, link support) and `resolveAuthorizedDestinationFormats`, `allocateQueueTime` (weekly queue), `recordPostVersion`, `withWorkspaceOperation`. The earlier WIP's duplicate network guard and its reliance on `modules/media` internals were dropped.

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

Existing WIP keys plus `feeds.autoCheck.schedule`, `feeds.autoCheck.maxItemsPerFeed`, `feeds.autoCheck.disableAfterFailures`, `feeds.maxSpreadMinutes`, `feeds.queueLookaheadDays`, `feeds.fallbackDelayMinutes`, `feeds.fallbackSpacingMinutes`. All bounded, all consumed. Owned by Publishing in Root. Fetch, size, redirect, host, per-workspace count, name/message/target limits and transaction bounds are Root keys; residual defaults/literals are tracked in CONFIG_LITERAL_AUDIT.md.

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

Status: **implemented with mocked recovery tests and owner-recorded production delivery for one full day**.
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

Migration `20261031140000_rebuild_wordpress_sources` (additive, SHA-256 `cce64edcfbcf19553f7eafe661f86fb067d8d0152e08712d05dc1745121c4642`, pinned in `scripts/cutover-rehearsal.sh` and its test, **pinned source; the production recipe run is recorded separately, without an exact migration receipt in this feature report**): `wordpress_recipe_sources` (one per workspace; name, site, enabled, all-or-selected channels, JSON config overrides, last run) and `wordpress_recipe_plans` (the ledger). Both carry `workspaceId` FKs with cascade and the purge write gate, the ownership catalog declares export/erasure coverage. Exact PostgreSQL export,
erasure and purge-race evidence remains separate from these declarations.

### Data mapping (verified production facts)

- Recipes: `wp_posts` rows with `post_type = 'post'`, `post_status = 'publish'`; table prefix, type, status and every meta key below are Root defaults that each source may override.
- Caption: meta `_msrwa_facebook_caption`. Image: meta `_msrwa_facebook_generated` is an attachment ID; the attachment's `_wp_attached_file` gives the path, public address `{siteUrl}{uploadsPath}/{path}`. Recipe: meta `_msrwa_recipe` (JSON). Already shared: meta `fb_shared_at` (skipped when "skip shared" is on). A recipe needs all three of caption, image file and a recipe with at least one ingredient or step, otherwise it is not a candidate.
- Link: `feeds.wordpress.permalinkTemplate` (`{siteUrl}/{slug}/`), e.g. ID 60938 becomes `https://recettes.newsgeet.com/potee-auvergnate-a-lancienne-fondante-et-doree/`.
- Ingredients and steps may be strings or objects (`name/text/item`, `quantity/qty/amount`, `unit`, `note`, nested groups with `items`); group titles become heading lines.
- First comment: template with `{title} {description} {ingredients} {steps} {servings} {prep} {cook} {total} {link}` (French default). Ingredients get bullets, steps are numbered. Over the limit (the smaller of `feeds.wordpress.firstCommentMaxCharacters` and `publishing.maxMessageCharacters`) steps are cut first, then ingredients, with a mark, and a link is preserved only when the configured template contains `{link}`. The
  owner removed the article link from production recipe comments; do not restore
  it from the historical default/template description.
- Image: downloaded with the address-pinned public fetch (feeds redirect/allow-http/host-allowlist settings apply, so the WordPress host must pass `feeds.hostAllowlist` when that list is not empty), checked by `inspectMediaSnapshot`, converted to JPEG (quality from Root, lowered stepwise until under `publishing.maxImageUploadBytes`), and stored as a workspace image referenced as `media:<id>`.

### Planning

1. The `feedsPoll` job (schedule `feeds.autoCheck.schedule`, no new job name, `scripts/worker.ts` unchanged) now also runs `runRecipePlanning` after RSS reading. It acts only when `feeds.wordpress.enabled` is on and a source is enabled; RSS reading's own switch is independent. The result is attached as `recipes` on the job summary and printed in the worker's one-line log.
2. Per source it acts as the oldest active workspace owner who qualifies (`qualifyingOwner`, the workspace-owner worker policy). Channels are the source's list or, with "all channels", every enabled publishable channel whose type is in `feeds.wordpress.targetTypes`; each is validated through Publishing's `validateTargets` and dropped when Publishing would refuse it.
3. Slots: configured local times in the source time zone for `horizonDays` ahead, DST-correct (a time inside the spring gap moves to the first minute that exists; an ambiguous autumn time uses its first occurrence), starting `minLeadMinutes` from now.
4. Allocation: slots in time order, pages in name order; each slot takes the first recipe that no other page received in the horizon (when distinct), that this page has not had within `cooldownDays`, and that this slot has not already failed with. Recipes are scanned newest first (or oldest) in keyset batches, up to `candidateMaxScan` rows.
5. Each slot is claimed in the ledger first (unique on source, page, time), then image prepared, then Publishing `createPost` with one target, the scheduled time, the caption, the stored image, the rendered first comment and the first-comment delay. Publishing's own authorization, approval, scheduling mode (application default), first-comment continuation and status reconciliation apply unchanged.
6. Per-run budget `feeds.wordpress.runBudget` bounds posts created across all sources (default 80, the first fill of 10 pages x 2 days x 4 slots).

Ledger states: `planned` (post id stored), `claimed` (unfinished; older than `claimLeaseSeconds` it becomes `uncertain`), `uncertain` (a result that could not be confirmed: never retried automatically, the slot stays consumed, the recipe stays blocked), `failed` (definitive refusal: image or content problem). A failed slot is retried with another recipe (the failed ones are kept in `skipped` and stay blocked for that page) until `maxSlotAttempts`. An authority error (forbidden/unauthorized/unavailable) stops the source's run without blaming the recipe.

### API and MCP

`GET/PUT /api/feeds/wordpress`, `POST /api/feeds/wordpress/preview`, `/run`, `/state`; same-origin writes. MCP tools in the `content-feeds` group: `get_recipe_source`, `save_recipe_source` (`SAVE RECIPE SOURCE <name>`), `preview_recipe_source`, `run_recipe_planner` (`RUN RECIPE PLANNER`), `set_recipe_source_state` (`PAUSE RECIPE SOURCE` / `RESUME RECIPE SOURCE`). All are channel-scoped: a channel-limited member or key sees and changes only a source whose channels are explicitly listed and all inside the grant; a workspace-wide source is refused to them. Manual run-now acts as the signed-in member and requires the Root switch and an active source. The database address is never returned; the read model only says whether planning is available.

### Limitations and open work

- The production log supersedes the original no-runtime claim for the recorded MariaDB/image/storage/planning path. Dependency lockfile integration is in `b940fad9`. Exact target migration history, export/erasure, crash recovery, real MCP/client scope, current browser and Facebook recovery/cleanup outcomes still need their own evidence.
  The 40/40 publication/comment day below closes the original no-delivery-evidence
  claim only for that recorded run; an 80-post plan alone does not prove delivery.
- Chronological order now follows `post_date_gmt` (see Follow-ups below).
- The pool of eligible recipes is finite (about 2,900 with caption and image). At 40 posts a day with a 365-day cooldown it is exhausted in about 70 days; the planner then reports unfilled slots instead of repeating.
- A crash between creating the post and saving its ID leaves an `uncertain` row (slot consumed, no duplicate); the post itself is found in Publishing.
- Planned posts are not removed when a source is paused unless the member asks to cancel them (Follow-ups below) or when a channel is deselected (they are ordinary scheduled posts).
- The preview shows the original WordPress image address in an `<img>`; a strict `img-src` policy must allow the site, or a proxy would be needed.
- Shortening marks, minutes suffix and the French default template are Root settings; `feeds.copy` and `feeds.recipeCopy` now supply EN/FR customer copy, including
  localized service errors through `server/messages.ts`. Residual parser defaults
  and literals remain in CONFIG_LITERAL_AUDIT; this is not full extraction proof.

### Follow-ups (2026-10-21: order, retry, pause-cancel, pool health, log line)

- **Order.** Candidates are read by `post_date_gmt` (newest or oldest first per the source `order`), ties by `ID`, with keyset paging over (date, ID). Undated (zero-date) rows sort last newest-first and first oldest-first. Source/unit evidence only; no query was run against the production MariaDB, where the `(post_date_gmt, ID)` sort has not been timed.
- **Retry failed times** (`POST /api/feeds/wordpress/retry`, MCP `retry_recipe_slots`, confirmation `RETRY RECIPE SLOTS`). Acts only on upcoming times of an active source. Definitively failed times can be planned with another recipe, ignoring `maxSlotAttempts`. Uncertain claims inside the lease stay held; older claims reconcile only by the ledger's stored post identity (round 6 below), never by matching channel/time. Missing/unreadable identity stays uncertain and is not blindly resent. Only released/failed times are replanned; the rest of the horizon is unchanged.
- **Pause and cancel** (`POST /api/feeds/wordpress/state` and MCP `set_recipe_source_state` with `cancelScheduled: true`, confirmation `PAUSE RECIPE SOURCE AND CANCEL SCHEDULED POSTS`). Allowed only while Root `feeds.wordpress.pauseCancelEnabled` is on. The pause is saved first; then the source's `planned` ledger posts scheduled in the future are cancelled one by one through Publishing's `cancelScheduledPost` as the signed-in member (so Publishing's rights, channel scope and platform-held-copy removal apply; the post returns to a draft). A slot is released (`failed`, reason `cancelled`) only after its post was cancelled; a refused cancel leaves slot and post untouched and is counted in `notCancelled`. At most `pauseCancelBatchSize` per request; `remaining: true` means repeat.
  Refused rows rotate behind untouched work by least-recent-attempt order (round 6);
  a fully refused batch still reports remaining work. A failure inside the cancel step never undoes the pause (`incomplete: true`). Resuming plans the freed times again.
- **Pool health** in `get_recipe_source`, `GET /api/feeds/wordpress` and the UI ("Recipe supply"): per channel, eligible recipes (not planned or recently posted there, and not planned elsewhere when channels must differ) and `daysLeft = floor(eligible / (posts per day x channels sharing the pool))`; the later shared supply policy supersedes the old zero-cooldown unlimited rule. Flagged low under `feeds.wordpress.poolWarnDays`. `complete: false` means the scan limit was reached and the counts are lower bounds. The estimate does not count recipes that return after the cooldown. It needs a full library scan, so the result is cached per source for `poolCacheSeconds` (per process) and is `null` when the library cannot be read.
- **Worker log.** The `feedsPoll` line now ends with `recipes: sources=.. planned=.. failed=.. uncertain=.. unfilled=..` plus `reason=` and `stops=` (budget, no_pages, error, ...) or `recipes=off`.
- New Root keys: `feeds.wordpress.poolWarnDays`, `poolCacheSeconds`, `pauseCancelEnabled`, `pauseCancelBatchSize`. Evidence: unit and service tests with fakes (`feeds-wordpress-planner`, `-recovery-service`, `-db-image`, `feeds-mcp`); no PostgreSQL, browser, MariaDB, Facebook or production run.
- Superseded by round 6 (below): reconciliation by channel and time, and the starvation of later posts behind a refused first batch.

### Production record (owner-recorded, 2026-10-21)

The first full recipe day ran at all four configured Europe/Paris slots (07:00, 11:00, 15:00, 17:00): **40/40 posts published with 40/40 first comments, no errors**; 70 plans remain pending on the rolling horizon. The first comments originally carried the article link (preview); the owner had it removed, and commit `2e23223a` records the audited update of 80 scheduled comments and keeps a link only when the template contains `{link}`. This is production evidence for that day and the planned/publish path only. Retry, pause-cancel and supply-exhaustion paths have not been exercised in production.

### Round 6 recovery changes (`6d3347fb`, source and unit evidence)

- **Identity, not time.** `postForSlot` now reads the ledger row for (workspace, channel, slot) and returns the post only when it stores exactly one `postId` that still exists in the workspace; otherwise it throws ("identity unconfirmed"). `retryRecipeSlots` therefore no longer adopts a manual post at the same channel and time, finds a recipe post even after cancellation cleared its scheduled time, and leaves the slot `uncertain` (counted `unconfirmed`) when identity is unknown or unreadable. Old interrupted claims without a stored id stay uncertain until reconciled by hand; they are never resent blindly. A claim inside its lease is never looked up or released. `settleIf` now also requires the expected post id, so a concurrent settlement is not overwritten. This replaces the earlier "any post for that channel and time" residual risk.
- **Refused cancellations rotate.** `deferCancellation` (optional on the `RecipeStore` port) bumps only `updatedAt` of a refused `planned` row, guarded by state and post id; `plannedUpcoming` orders by least recent attempt, then slot time. A fully refused batch reports `notCancelled` and `remaining: true`, and the next request reaches untouched posts. State, receipt and reason of the refused row are unchanged.
- Tests: `tests/feeds-recipe-recovery-verification.test.ts` (fake ports/store). No PostgreSQL, MariaDB, Facebook or production exercise; the raw `UPDATE`/ordering SQL has only text-level checks.
- Still open: a post that the ledger never recorded (crash between create and save of the id) needs manual reconciliation; a post permanently refused by cancel keeps being retried every request, behind other work; the default Publishing lookup reads the post table from the feeds module (a Publishing-owned lookup would be cleaner). No new Root keys in round 6 for Feeds.


### Recipe supply lane (2026-10-21, working tree)

Supply estimates, preview and planning now share `supplyLedgerView`. Retained
history is read beyond the old cooldown window; turning the source cooldown to
zero no longer silently permits repeats or labels the supply unlimited. With
`distinctAcrossPages`, every channel consumes the same historical recipe pool,
matching the estimate's posts-per-day × channels denominator. Otherwise history
and reuse order apply per channel.

New Root keys, declared in `wordpress/config.ts` and aggregated by `config.ts`:

- `feeds.wordpress.reuseEnabled`: boolean, **false** by default. Off permanently
  excludes recipes with retained planned/claimed/uncertain history in the relevant
  pool. Definitively failed claims do not consume supply, but their skipped
  recipes remain excluded.
- `feeds.wordpress.reuseCooldownDays`: integer 0–3650, default **365**. When reuse
  is enabled, the effective cooldown is the longer of this minimum and the
  source's `cooldownDays` (whose Root default remains `repostCooldownDays`).
  Only a `planned` ledger row with a matching destination currently recorded as
  published and a known destination `publishedAt` can qualify. Cooldown uses
  that actual publication time; old scheduled times alone are insufficient.

Fresh recipes precede reusable recipes. Reusable recipes sort by their latest
confirmed publication, oldest first. Any recent, future or uncertain use keeps a
recipe blocked, even alongside an older confirmed publication. Existing image,
Publishing authorization/approval and per-slot claim/settlement paths still apply.
This records confirmed application publication state; it does not make a fresh
provider read. Unknown or missing destination proof remains blocked. On a capped
library scan, fresh recipes may be allocated but reuse is held: unseen fresh or
older posted recipes may exist beyond the scan ceiling.

The existing `feeds.wordpress.poolWarnDays` remains the configurable low-supply
threshold (default 14 days; strict less-than comparison). Estimates are finite,
exclude recipes that might become reusable later, and use the same eligibility
policy as planning. Incomplete scans return lower bounds and `low: false` means
**unconfirmed**, not adequate supply; the card says supply is unavailable and
shows the lower bound. A complete scan below the threshold shows the shared
English/French actionable warning from Root `feeds.recipeCopy`. The catalog also
explains whether reuse is enabled and the effective cooldown. Cache identity
includes source policy, runtime settings and authorized actor scope so Root
threshold/reuse changes do not keep a previous policy's answer until TTL expiry;
source invalidation clears all scope/policy variants.

`GET /api/feeds/wordpress` and MCP `get_recipe_source` already shared
`readRecipeSource`; both now return `reuse: { enabled, cooldownDays }` alongside
`pool` (also carrying the reuse policy). No separate transport business rules or
new endpoint were added. The Feeds screen uses the shared `RecipeSupplyWarning`.
`ui/RecipeSupplyCard.tsx` is an authorized server component prepared for Home;
it uses the same service and Root copy and hides itself when the source is
invisible or access is refused.

**Integration needed outside this lane:** `src/modules/home/ui/HomeScreen.tsx`
must import `RecipeSupplyCard` from `@/modules/feeds/ui/RecipeSupplyCard` and mount
`<RecipeSupplyCard actor={{ userId: viewer.user.id, workspaceId: viewer.workspaceId }} locale={locale} />`
in its existing card layout, preferably in the publishing card. Home does not
mount it yet; the Home warning requirement remains incomplete until that edit.
The service derives current member scope; do not replace it with a direct SQL
query in Home. Update ARCHITECTURE.md, GOAL.md, DELIVERY_PLAN.md and AGENT_HANDOFF.md
with this batch and remaining Home work. Integrator owns CONFIG_SCHEMA_VERSION;
this lane did not edit it. No schema migration is required for these joins.

Evidence: targeted Vitest tests cover reuse off, actual-publication cooldown
boundaries, latest-use blocking, fresh/oldest ordering, shared-pool consumption,
capped scans, finite estimates, Root cache changes, bilingual warnings and the
Home component, plus REST/MCP forwarding to the same service. These are fake-port,
mocked transport and static-render checks. No server, full suite, browser,
PostgreSQL/MariaDB, provider, deployment or production test was run. Retained
history query volume/performance and concurrent cross-slot recipe allocation
still need database/runtime evidence; existing unique slot claims do not prove
cross-slot recipe exclusivity between concurrent planning runs.

Verification for this lane: **142/142 tests passed in 12 targeted files**, using
`npx vitest run` with `--no-cache` (the linked dependency directory's Vitest cache
is outside writable roots). Files: `feeds-recipe-supply`,
`feeds-recipe-supply-ui`, `feeds-recipe-supply-transports`,
`feeds-wordpress-planner`, `feeds-wordpress-service`,
`feeds-wordpress-recovery-service`, `feeds-mcp`, `recipe-origin-visibility`,
`feeds-recipe-recovery-verification`, `feeds-wordpress-recipe`,
`feeds-wordpress-db-image`, `feeds-wordpress-job` (all `tests/*.test.ts`).
Vite CJS deprecation and existing missing Tailwind content warnings were emitted;
there were no test failures. TypeScript uses `--incremental false` to avoid
writing an unowned build-info artifact. This working tree is left uncommitted
for the integrator; no push/deploy was authorized in this lane.

### Rounds 10–12: reviewer notices, reuse keys and caption handling (HEAD `a910d774`)

Evidence kinds: source and unit/mocked tests; the production statements are
owner/integrator records, not observed by this documentation lane.

- **Root keys and schema:** `feeds.approvalNotificationsEnabled` (round 10, schema
  119) and `feeds.wordpress.reuseEnabled` / `feeds.wordpress.reuseCooldownDays`
  (round 11, schema 120). The "Recipe supply lane" section above is now merged
  (`d6ff1f17`); its "working tree" label is historical. Home mounting of
  `RecipeSupplyCard` was a stated integration need; confirm it before claiming the
  Home low-supply warning.
- **Caption text (`a47a339c`, `a910d774`):** the WordPress path decodes the HTML5
  named catalog and numeric references once, keeps U+00A0/U+202F, then
  `stripCaptionControls` maps C0 controls (seen: U+0016) that precede `? ! : ; »`, or
  follow `«`, to U+202F and removes any other C0 control except tab/newline. Cause
  recorded by the integrator: the caption plugin stores U+0016 where French
  typography needs U+202F, and Facebook rendered it as `0`. This resolves the
  earlier note that no inspected source turned a nonbreaking space into `0`: the
  damaged character was a control byte, not U+00A0. Tests:
  `feeds-wordpress-caption`, `feeds-wordpress-caption-controls`,
  `feeds-wordpress-caption-repair`.
- **Affected data (owner/integrator record):** seven WordPress captions carried the
  control byte. One had already been published and is kept as published; the
  repair service refuses published, due, claimed or attempted records by design.
  This document does not record the outcome for the other six planned captions:
  verify stored text privately (code points, no logging) before treating them as
  repaired.
- **Still open:** the RSS decoder in `feeds.ts` (incomplete named catalog,
  `&nbsp;` to an ordinary space); repair is a service export with no UI, REST or MCP
  entry point; no live PostgreSQL/MariaDB locking evidence for the repair.
