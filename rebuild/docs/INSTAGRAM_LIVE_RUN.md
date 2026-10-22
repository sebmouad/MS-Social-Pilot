# Instagram live run — audit and owner checklist

Dated 2026-10-22. Binding target: [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md).
Module source: `src/platforms/instagram/`. The module is installed in
`PLATFORM_MODULES`/`PLATFORM_HOSTS` and **disabled by default**
(`platforms.instagram.enabled`, default `false`). All statements below are
source evidence unless marked live. No live Graph call was made from the
authoring lane (sandbox has no loopback/tokens); live steps are owner-executed
from section 2.

## 1. Capability audit (source)

Status key: **implemented** (source + mocked tests), **partial**
(source with a known boundary), **missing** (not present; customer choices must
not promise it).

| Capability | Status | Source of truth |
| --- | --- | --- |
| Connect via linked Pages (Facebook Login, no separate IG OAuth) | implemented | `src/platforms/instagram/connection.ts` (`discoverSelectedInstagramAccounts`); callback is a no-op redirect |
| Channel selection / disconnect with retain-or-delete | implemented | shared `src/modules/settings/server/connection-mutations.ts` + `src/platforms/instagram/selection.ts` (aligns `instagram_accounts.enabled`) |
| Token storage | implemented | encrypted Page-token clones on `social_accounts`/`targets` (`encryptSecret`); source binding in `social_accounts.meta`; never logged |
| Token refresh / expiry | partial | no `renewToken` by design (Page tokens renew through Facebook reconnection + rediscovery, which upserts clones); expired/invalidated credentials fail closed (`reconnect_required`, jobs skip without provider calls) |
| Publish photo | implemented | `publishing.ts` image container → `FINISHED` poll → `media_publish` → permalink; journaled (`container-journal.ts`) |
| Publish feed video | implemented | `publishing.ts` (`media_type: VIDEO` with caption); this lane |
| Publish carousel (mixed, up to `carouselMax`) | implemented | `publishing.ts` (every child `FINISHED` before the parent) |
| Publish reel | implemented | `publishing.ts` (`media_type: REELS`) |
| Publish story | implemented | `publishing.ts` (`media_type: STORIES`, no caption — captioned stories refused pre-dispatch); this lane |
| Scheduling | partial | application-held via the shared queue (`scheduling: { application: true, native: false }` on every format); provider-held refused (`scheduledAt` rejected at the adapter) |
| First comment | implemented | `publishFirstComment` (+ shared delivery); refused for stories (descriptor `firstComment: false`) |
| Remote status readback | partial | `getRemoteStatus` for feed media (owner/type/timestamp match, else `unknown`); stories declare `remoteStatus: false` (the `media_publish` receipt is the delivery proof) |
| Remote media deletion | missing | deliberately undeclared — no verified deletion contract for Facebook Login; `remoteDelete: 'unsupported'` everywhere |
| Account insights collect + stored reads | implemented | `insights.ts` (`views`, `reach`/day) + `jobs.ts` (`syncInstagramAnalytics` via the shared `analytics` job) + `analytics-host.ts` (coverage/provenance preserved, missing stays unknown) |
| Media history + per-media insights | implemented | `insights.ts` `media()` (bounded window, per-media metrics, single-media failure isolation, clipped-window refusal) persisted by `syncInstagramAnalytics` to `instagram_media`; read by `postPerformance`; this lane |
| Metric catalog coverage | partial | narrow Root-editable defaults (`accountMetrics`: views/reach; `postMetrics`: views, reach, likes, comments, shares, saved, total_interactions); bilingual labels for more; extend through `instagram.policy` after live probing |
| Comment read (owned media + replies) | implemented | `inbox.ts` (media-owner match, explicit truncation failure) |
| Comment reply / hide+unhide / delete | implemented | `inbox.ts` + `inbox-host.ts` (shared authorization, locks, audit; delete via the shared durable path) |
| Inbox background sync | missing | manual sync only (`instagramInboxHost.sync`); no `jobs.inbox` hook — contrast Facebook `syncInbox` |
| Direct messages, reviews | missing | absent; reply policy reports comments-only |
| Meta inbound webhooks | missing | no inbound receiver exists for any platform (Facebook likewise); IG sync is poll/manual |
| Publication recovery registry | implemented | `container-recovery.ts` registered in `src/server/platforms/publication-recovery.ts`; this lane (was the documented before-activation gap) |
| Token/grant health UI | implemented | `connection.grantHealth` (publishing/comments/analytics rows) via neutral `platformGrantHealth` in `ConnectionsScreen.tsx` |
| Error kinds + retries | partial | `transport.ts` maps definite 4xx (codes 10/100/190/200) → `rejected`, 429/5xx/transient → `uncertain` + `retryable`; jobs retry via `withRetries`; no usage-header budget accounting (contrast Facebook `graph-usage.ts`) |
| Stored local media delivery | missing | adapter refuses `localFile`; only public credentialless HTTPS URLs publish — needs the shared tenant-bound signed-URL pipeline (Publishing/media owner) |
| Ads | unsupported | correctly declared; IG ads stay in Facebook Ads |

Scope safety (verified in source, unchanged by this lane): no new top-level
Root keys and no Facebook login/scope change, so existing grants cannot
regress; IG scopes are *checked* against stored Page grants, never added to the
login dialog. New IG permissions stay behind `platforms.instagram.enabled`
until Meta approves them. All provider reads run in the worker or under an
explicit user sync action — never fan-out on page load.

UI wiring (verified in code, all neutral — no IG screen or branch added):
channel list + connect/disconnect + grant health in
`src/modules/settings/ui/connections/ConnectionsScreen.tsx` (via
`connectablePlatforms`/`platformGrantHealth`); composer destinations and the
five format descriptors via `src/modules/publishing/server/destinations.ts`;
inbox threads/replies via `platformInbox` (`src/server/platforms/registry.ts`);
insights via `platformAnalytics` with covered/selected counts, as-of times and
non-additive overlap notes; EN+FR through the module `copy`/`labels` catalogs;
command palette is route-driven (`src/components/CommandPalette.tsx` +
`/api/home/commands`) and Instagram adds no routes; phone layouts come from the
shared responsive system.

Automated evidence for this lane: `npm run typecheck` 0 errors; 144 tests pass
across the 13 Instagram/config/registry suites (see the handoff entry). No
browser, provider or production run.

## 2. Owner-executed live checklist

Run from a normal terminal and Chrome against a non-production workspace first.
Prerequisites: an Instagram **Business or Creator** account linked to a
Facebook Page you manage; the Meta app granted `instagram_basic`,
`instagram_content_publish`, `instagram_manage_comments`,
`instagram_manage_insights` (plus the existing `pages_*` grants); Root:
`instagram.appSecret` set, `platforms.instagram.enabled` switched on. Keep the
switch off in production until every step passes and test content is cleaned.

1. **Connect.** Settings › Channels › Instagram › Connect, confirm
   `START CONNECTION instagram`. Expected: discovery finds the linked
   professional account as an *unselected* channel; nothing is enabled
   silently. Look: new row in Channels with `select=1` notice; Root audit
   `connection.instagram_discovered`.
2. **Select + grant health.** Tick the account checkbox (Save). Expected:
   channel enabled; grant rows show publishing/comments/analytics granted.
   Look: Channels row state; reconnect prompt absent.
3. **Publish a photo.** Create a post with one public HTTPS image, format
   Photo, first comment filled. Expected: published remotely; first comment
   lands under it. Look: post status `published` with URL; the photo + comment
   in the Instagram app; `instagram.publication_step` evidence in Root.
4. **Publish video + reel + story.** One feed Video (caption kept), one Reel,
   one Story (leave the caption empty — a captioned story must refuse with a
   validation message, and no story offers first comment). Expected: three
   remote media; story has no status readback. Look: Instagram app/profile for
   each; app shows published receipts.
5. **Schedule.** Schedule a photo 15+ minutes out. Expected: worker publishes
   it at the due time (application-held; no provider hold exists). Look: queue
   → published; remote post timestamp matches.
6. **Inbox reply + moderation.** Inbox › sync the IG channel; reply to one
   real comment; hide then unhide another. Expected: reply visible publicly;
   hide state flips remotely and locally. Look: Instagram app comment thread;
   app `inbox.comment_replied/hidden` audit rows.
7. **Insights compare.** After the next analytics sync (or trigger the
   `analytics` job), compare views/reach/followers and one post's
   likes/comments against Instagram Insights for the same window. Expected:
   same quantities within collection lag; unknown (not zero) where uncollected.
   Look: Insights overview + post tables with covered counts and as-of times.
8. **Token-expiry/reconnect drill.** In Facebook, remove the app grant (or
   disconnect the parent Page with retain). Expected: IG publish/sync/inbox
   fail closed with reconnect prompts; nothing half-sends; jobs skip. Then
   reconnect Facebook and re-run Instagram Connect. Expected: clones rotate,
   operations resume. Look: Channels health flips missing → granted.
9. **Cleanup.** Delete every test photo/video/reel/story **in the Instagram
   app** (the connector has no remote media delete), then delete the local
   drafts/posts. Expected: no test content left remotely or locally. Look:
   profile grid/stories empty of tests; app lists clean.
10. **Switch off until release.** Set `platforms.instagram.enabled` back to
    `false` if the release gate is not yet passed. Stored data stays for the
    release review.

## 3. Open gates (not verifiable from this lane)

- Every live Graph behavior above (permissions actually granted, container
  processing, `VIDEO`/`STORIES` acceptance, insight metric availability and
  periods, comment/hide/delete round-trips).
- `instagram.policy` metric defaults beyond the first live probe (extend only
  after the coverage probe confirms period/type per metric).
- Stored local-media publishing (needs the shared signed-URL pipeline).
- Inbox background sync, DMs, webhooks, usage-header accounting, remote media
  deletion — absent by design or gap (see §1); do not promise them.
- Browser EN/FR, theme, keyboard and phone verification of the touched flows;
  real REST/MCP client execution; production cutover gates per
  [CUTOVER.md](CUTOVER.md).
