# Architecture

Two processes share one database:

```
   Browser ──► Next.js app ──► Postgres ◄── Worker ──► Graph API
                    │                                  RSS feeds
                    │                                  Resend
                    └──► Graph API (immediate / native)
                         Claude API (captions)
                         Resend (invitations)
```

The web app never waits on a scheduled publish; it writes rows. The worker owns
everything time-based. Both call Graph through the same client, so retry and
error-classification rules cannot drift apart.

**The worker runs up to ten jobs** on independent intervals — publish (30s),
rss (15m), evergreen (1h), analytics (6h), pageInsights (12h), edges (4h),
housekeeping (24h), tokens (24h), plus instagram (12h) and ads (12h) when those
permissions are enabled. Each is a plain async
function with one shape, so the loop is a table rather than a pile of branches,
and any job can be run alone from a test or `POST /api/cron/tick?jobs=…`. A job
that throws is caught per job: a failing RSS poll must never stop posts going
out.

The instance-wide jobs walk their tenants through `forEachWorkspace` /
`forEachEnabledPage` rather than loading every id up front. Cursor paging, not
offset — `skip` re-scans everything it skips, so the last page of a long list
costs the most and rows inserted mid-pass shift the window, while a cursor on
the primary key is stable and costs the same on every page. Failures are caught
per row as well as per job: one client with a dead token must not end the pass
for everyone behind them in the list. Rows are handled one at a time on purpose
— these jobs call Graph, and Facebook throttles per app, so running tenants in
parallel would spend the rate limit faster without finishing sooner.

---

## The central design decision: PostTarget

A `Post` is what the user wrote. A `PostTarget` is *one post going to one
destination*, and it is the unit the scheduler claims, publishes and retries.

This matters because the common real-world case is partial failure. Publishing
to five Pages where one token has been revoked should publish four and report the
fifth. If the post were the unit of work, the choices would be to fail all five
or to retry the post and double-publish to the four that already succeeded.

`Post.status` is therefore derived, not authoritative — `refreshPostStatus()`
recomputes it from its destinations after every change:

| Destinations | Post status |
|---|---|
| Some still pending | `scheduled` or `publishing` |
| All published | `published` |
| All failed | `failed` |
| Mixed | `partially_failed` |
| All handed to Facebook, none live | `scheduled` |

---

## Scheduling

Three modes, chosen per post:

**`immediate`** — publish during the HTTP request. The user sees per-destination
results straight away.

**`worker`** (default) — store `scheduledAt` and let the worker publish at that
time. Editable until it goes out, and the only mode that works for Groups. The
cost: if the worker is not running, nothing is published.

**`native`** — create the post on Facebook immediately with
`scheduled_publish_time`, and let Facebook hold it. Survives our downtime
entirely. The costs: Pages only, minimum 10 minutes and maximum 6 months ahead,
and editing means deleting it on Facebook and recreating it. Destinations in
this state get the `scheduled_remote` status so our scheduler leaves them alone,
and cancelling deletes the remote post rather than silently letting it publish.

### Claiming work without row locks

Claiming is a conditional update rather than a row lock — simpler, and already
proven by the integration tests. Postgres could use
`SELECT … FOR UPDATE SKIP LOCKED` instead if throughput ever demands it.

```ts
const { count } = await prisma.postTarget.updateMany({
  where: { id, status: 'pending' },        // only if still unclaimed
  data:  { status: 'processing', lockedAt: now, lockedBy: workerId },
});
return count === 1;                         // exactly one worker wins
```

Atomic, so multiple workers are safe.

**The one accepted risk:** a worker that dies *after* Facebook accepts a post but
*before* the row is updated leaves a lock that is reclaimed and retried — which
can double-post. Facebook's own duplicate detection (error 506) catches
identical content. The alternative, never reclaiming, silently drops posts,
which is worse for a scheduling product.

### Reclaiming abandoned locks

How long a destination may stay in `processing` before another worker takes it
back is `scheduler.staleLockMinutes` (default 15). It is a setting rather than a
constant because both directions hurt and the right value is
installation-specific: too long and a crash strands a client's post until it
elapses, too short and a slow-but-healthy publish — a large video upload holds a
destination open for minutes — is reclaimed while its first worker is still
talking to Facebook, and the post goes out twice.

A reclaim spends an attempt. A payload that kills the worker kills it again next
time, so without counting the crash the row is handed back every timeout for
ever, taking the worker down with it each round. Counting it means
`SCHEDULER_MAX_ATTEMPTS` still terminates: the last reclaim marks the
destination `failed` with `worker_lost`, recomputes the parent post's status,
and the post becomes visible in the UI instead of looping unseen.

### Retry policy

`src/lib/scheduler/backoff.ts`. The base delay depends on why the attempt failed:

| Failure kind | Graph codes | Retry? | Base delay |
|---|---|---|---|
| `transient` | 1, 2, HTTP 5xx, network | Yes | 60s, doubling |
| `rate_limit` | 4, 17, 32, 613, 80001–2 | Yes | 900s, doubling |
| `auth` | 190 | No — reconnect required | — |
| `permission` | 3, 10, 200, 283, 294 | No | — |
| `rejected` | 368, 506, 1609005 | No — content refused | — |
| `invalid_request` | 100 | No — our bug | — |

Capped at 6 hours, with ±20% jitter so a batch that failed together does not
retry in lockstep. `SCHEDULER_MAX_ATTEMPTS` (default 5) ends it.

Retrying an expired token forever is the failure mode this table exists to
prevent: an `auth` error fails the destination immediately *and* flags the whole
connection, so the UI can ask for a reconnect once instead of per post.

---

## Publishing: choosing the Graph edge

Facebook has no single "create post" endpoint. `planPublish()` is a pure
function holding the decision table, which is why it is directly testable:

| Content | Calls |
|---|---|
| Text and/or link | `POST /{target}/feed` |
| One photo | `POST /{target}/photos` |
| Several photos | N × `POST /{target}/photos` (`published=false`, `temporary=true`), then `POST /{target}/feed` with `attached_media[i]` |
| Video | `POST /{target}/videos` |

Rejected before any network call: more than one video, and mixing a video with
photos.

`link` is passed through untouched so Facebook renders its own Open Graph card.
Attaching the scraped image ourselves would produce a photo post with a URL in
the text — visually similar, functionally worse.

Locally uploaded media is streamed to Graph as multipart binary; externally
hosted media is passed as a URL for Facebook to fetch. That split exists because
our own media route requires a session cookie, so Facebook cannot fetch it.

---

## Tokens

The lifecycle, and why each step exists:

1. OAuth dialog with a signed, nonce-backed `state` (CSRF).
2. `code` → **short-lived** user token (~1 hour).
3. → **long-lived** user token (~60 days).
4. `/me/accounts` with the long-lived token → **Page tokens that do not expire**
   while the user token is valid.

Skipping step 3 is the classic bug in this kind of product: everything works
during testing, then every scheduled post fails an hour after the customer
connects.

Storage: AES-256-GCM, in a versioned `v1:<iv>:<tag>:<ciphertext>` envelope so a
future key or algorithm rotation can still read old rows. Every Graph call sends
`appsecret_proof`.

Disconnecting an account wipes Page tokens from the `Target` rows *first*, then
deletes the account row — `Target.socialAccountId` is nullable with
`ON DELETE SET NULL` specifically so published-post history survives while the
credentials do not.

---

## Data model

| Model | Purpose |
|---|---|
| `User`, `Session`, `Workspace`, `Membership` | Auth and tenancy |
| `Invitation` | Pending team invitations; token stored hashed |
| `SocialAccount` | A connected Facebook user; holds the long-lived user token |
| `Target` | A Page or Group; Pages carry their own token |
| `Post` | What was written, and when it should go out (`mediaKeys` mirrors its media references for indexed lookup) |
| `PostTarget` | One post × one destination: status, attempts, remote id, insights |
| `Media` | Uploaded files |
| `QueueSlot` | Recurring publishing times |
| `FeedSource`, `FeedItem` | RSS sources and the guid de-duplication ledger |
| `ShortLink`, `LinkClick` | Link shortening and click tracking |
| `AiGeneration` | Caption calls with token counts, so spend is visible |
| `NotificationSetting`, `EmailLog` | Who gets emailed, and whether it arrived |
| `PageInsight` | Captured Graph metric values over time |
| `MetricAvailability` | What Graph would actually serve, last time we asked |
| `PostComment` | Comments on posts we published, with hidden state |
| `PageReview` | Star ratings and recommendations left on a Page |
| `Conversation`, `ConversationMessage` | Page inbox threads |
| `ExternalPost` | Posts that reached a Page without going through this app |
| `PageVideo` | Videos, with the video-level insight catalogue attached |
| `InstagramAccount`, `InstagramMedia`, `InstagramInsight` | Instagram Business analytics |
| `AdAccount`, `AdInsight` | Spend and delivery, so paid reach can be told from earned |
| `ActivityLog` | Audit trail |

Status fields are **native Postgres enums**, so an invalid value is rejected by
the database rather than trusted from application code. Structured payloads are
native `Json`. Reads still narrow defensively through `src/lib/json.ts` —
Postgres validates that a column holds JSON, not *which* JSON, so a row written
by an older version must degrade to a fallback rather than crash a render.

### Multi-tenancy

A client is a `Workspace`; a user may belong to several with different roles.

Every capability answer lives in `src/lib/constants.ts` and nowhere else, so the
UI and the API cannot disagree about who may do what. The matrix is asserted in
the test suite rather than only written down — every permission hole found so
far was a route that simply forgot to ask, and a widened capability should be a
visible change rather than a one-line edit:

| Capability | Minimum role |
| --- | --- |
| `canManageInstance` (configuration) | owner |
| `canManageAccounts` (connections, tokens, destinations) | admin |
| `canManageTeam`, `canManageSettings`, `canApprove` | admin |
| `canDeleteComments` | admin |
| `canModerateComments` (hide, unhide, reply) | editor |

Deleting a comment sits a step above hiding one deliberately: hiding is undone
from the same screen, deletion removes a customer's words from the client's page
and nothing brings them back.
`getAuthContext` resolves the requested workspace and **re-checks membership** —
an id from a cookie or URL is a request, not a permission. Workspace scoping is
therefore a security boundary, with tests that a member of one workspace cannot
read, publish to, or approve anything in another.

### Approval workflow

`initialApprovalStatus` decides at creation time and stores the result on the
row, rather than recomputing later from settings that may have changed. The
load-bearing half is in the scheduler: the due-work query filters
`approvalStatus IN ('not_required','approved')`, so an unapproved post cannot go
out when its scheduled time arrives.

That query is not the only way out, though, and the second gate matters as much
as the first. "Post now" calls `publishNow` directly and never touches the
due-work query, so it checks the same statuses itself before it does anything —
a held post its author can push live on demand is not a review workflow, and the
UI hiding the button is not a control. Both gates read the same
`PUBLISHABLE_APPROVAL_STATUSES`, so there is one definition of publishable.

Because the workflow is a per-workspace switch, it can be turned off while posts
are still queued behind it — and those two gates are exactly what would then
strand them: the scheduler skips a `pending` post, `publishNow` refuses it, and
the Approvals screen that would clear it is hidden as soon as the setting is
off. `releaseHeldPosts` runs whenever the setting is written as off and moves
them to `not_required`, landing them where an approval would have (scheduled if
they have a time, draft if not). Rejected posts keep their decision; turning the
switch off is not a way to overturn a reviewer.

The other way approval leaks is time. A contributor can edit an approved post
right up until it publishes, so without a check the decision travels with the
row rather than with the content — sign-off on one message, a different one goes
out. `updatePost` compares the incoming edit against the stored row and returns
the post to `pending` when it changes something the reviewer saw: message, link,
media, destinations or scheduled time. The comparison is against stored values
rather than "did the request mention this field", because the composer PATCHes
the whole form and opening a post must not cost it its approval. Editors and
above are exempt, since `initialApprovalStatus` grants them `approved` at
creation anyway — queueing edits they could bypass by reposting is theatre.

---

## Time

Every stored `Date` is UTC. Timezones are applied only when interpreting what a
human typed, or when rendering back to them.

Queue slots are stored as (day-of-week, hour, minute) in **workspace-local**
time and converted to UTC at scheduling time, so "Tuesday 09:00" stays 09:00
across a daylight saving change rather than drifting by an hour. There is a test
for exactly that.

---

## Request flow, end to end

Composer → `POST /api/posts`:

1. Zod validates the body (`createPostSchema`).
2. `loadTargets` rejects destination ids outside the caller's workspace.
3. `resolveSchedule` turns "explicit time" / "queue" / "now" into a UTC instant.
4. The link's Open Graph card is scraped and cached (best-effort; a failure never
   blocks publishing).
5. `Post` and its `PostTarget` rows are created in one write.
6. Then, by mode: publish now / hand to Facebook / leave for the worker.

Errors surface in one shape — `{ error, fields?, traceId? }` — via
`handleApiError`. Unrecognised exceptions return a generic message and are logged
server-side, because a raw exception can contain a token.


---

## Feature notes worth knowing

**Link handling** is applied at publish time, not compose time, so the composer
keeps showing the real destination and an edited post does not accumulate
redirects. UTM tags are per destination, so a campaign is attributable to the
Page it ran on. `/l/[slug]` is a bare 302 with no body — Facebook fetches
whatever URL appears in a post to build its preview card, so an interstitial
would publish the post with a blank card. Facebook's scraper is excluded from
click counts for the same reason: it hits every shortened link at publish time.

**Evergreen recycling** creates a copy each cycle rather than re-running the
original row, keeping per-attempt history intact. Text variants rotate because
Facebook rejects identical repeated content with error 506.

**RSS ingestion** has three guards against flooding a Page: nothing published
before the subscription (`ingestFrom`), guid-based de-duplication, and a
per-poll cap. ETag/Last-Modified make the common "nothing new" case cheap.

**AI captions** never publish on their own — output lands in the composer for a
human to accept. Every call is logged with token counts and capped per workspace
per hour, so a stuck loop hits a limit rather than an invoice.

**Reporting** keeps Facebook's insights and our own click counts separate and
never sums them; they measure different things. PDF is a print-styled page
rather than server-side rendering, which keeps headless Chromium out of the
production image.





---

## Media

A post's media lives in a Json array — the composer needs order, alt text and a
mix of stored and external URLs, none of which a foreign key gives you. The cost
is that the database cannot answer "which posts use this file?", so `Post` also
carries **`mediaKeys`**: the same ids and storage keys flattened into a
GIN-indexed `text[]`. `mediaColumns()` in `src/lib/json.ts` writes both, and
nothing writes one without the other — a post with stale keys would let its own
file be swept out from under it, which is the failure the array exists to
prevent.

That lookup guards deletion in both directions. A manual delete refuses while
any unpublished post still references the file, because the alternative surfaces
hours later at publish time as a Graph error nobody can trace back. The `media`
job sweeps the opposite case — uploads nobody ever attached — after 30 days, and
keeps anything referenced by *any* post whatever its status: deleting one a
published post still renders turns history into broken images.

Uploading is deliberately **not** a privileged action. Contributors draft posts,
so they upload; a role check there would stop people doing their job. What bounds
the disk is a per-workspace quota, checked before the bytes are written.

## Retention

Several tables are append-only records of things that already happened — an
audit entry per publish, an email log per notification, a row per short-link
click, a row per AI call. On a busy agency workspace they outgrow everything
else within a year while being the rows nobody reads past the first month, so
the `housekeeping` job prunes each on its own configurable window.

Two things are deliberately excluded, and the reasons matter more than the code:

- **`FeedItem` is a de-duplication ledger, not history.** Its guids are what
  stop an RSS feed republishing its archive. Pruning it would re-post years-old
  articles the moment a feed was touched — the worst failure this product could
  have. It grows, and it stays.
- **Insight snapshots are the product.** `PageInsight` and its siblings exist
  precisely because Graph serves only about two years; deleting them to save
  space throws away the thing the analytics module was built to keep.

Both exclusions are pinned by tests, because they are exactly what a later
"and anything else old" change would sweep up by accident.
---

## Configuration

Almost nothing is hardcoded. `src/lib/settings/definitions.ts` is a registry of
every tunable — type, default, bounds, the environment variable it falls back
to, and enough description that the config screen explains itself. The API, the
form and the validation are all generated from it, so a setting cannot exist in
the code and be missing from the screen.

Precedence is **database → environment → registry default**. An existing `.env`
keeps working exactly as before; anything set on Settings → Configuration wins
over it, and clearing an override hands the setting back. `env` reads through
the store, so no call site changed shape.

Three things stay purely environmental because they cannot be anything else:
`DATABASE_URL` reads the settings table, `ENCRYPTION_KEY` protects the secrets
stored in it, and `SESSION_SECRET` cannot be rotated from inside a session.
Everything else — including the Facebook app id and secret — is editable at
runtime, so a new installation is never configured by hand-editing a file on a
server.

Secrets are encrypted with the same key that protects access tokens and are
**never sent back to the browser**, not even to the person who set them: the
screen is told only whether a value exists. Leaving a secret field blank keeps
the current value rather than clearing it, so saving an unrelated change cannot
silently wipe an API key.

Reads are synchronous (`setting('scheduler.pollSeconds')`) with a cached
snapshot loaded at two choke points: the API route wrapper for requests, and
`getAuthContext` for server rendering. The worker re-reads on every pass of its
one-second loop.

The cache is validated against a **version stamp** rather than simply expiring.
More than one process runs this app — the web server, the worker, and possibly
several of each behind a load balancer — and a blind TTL let them disagree about
configuration for its whole length, including the feature switches that decide
which OAuth scopes a login asks for. The stamp is `max(updatedAt)` together with
the row count: an update moves the maximum, an insert moves both, and a delete
moves the count even when it left the maximum alone. It is checked at most once
a second and the full reload happens only when it has changed, so staleness is
bounded at a second and the steady-state cost is one aggregate per second per
process regardless of traffic.

## Connections

One screen for everything this workspace is connected to, because the failure
they share is the same: a token dies and everything downstream stops quietly.
Pages, Groups, Instagram accounts and ad accounts all hang off a connected
Facebook user, so they are grouped under the credential that reaches them.

Token expiry is shown as **days remaining, not a date** — "expires 14 Sep" makes
the reader do arithmetic before they know whether to act. Granted scopes are
listed beside it, because a token can be perfectly alive and still be missing
the permission a job needs, and those two failures look identical from the
outside. The dashboard carries the same warning *before* the token dies, which
is the difference between a five-minute reconnection and a week of silently
failing posts.

`src/lib/connections.ts` holds the permission and tenant boundary for all of it
rather than the route handlers, for one reason: a boundary that only exists
inside a Next handler cannot be tested without standing up a request. Handlers
parse, call, and map the outcome to a status. Two rules hold throughout — every
lookup is scoped by workspace, and **not found, not allowed and done stay three
distinct answers**. Reporting success for an id that was never touched is how a
bug hides for months; disconnect did exactly that for an account belonging to
another workspace until this was written.


---

## Scheduler fairness

Due work is selected **round-robin across clients**, not in global scheduled-time
order. The obvious implementation — order everything by `scheduledAt` and take
the first N — starves people on a shared installation: one workspace that queues
five hundred posts for 09:00 fills every slot of every tick until its backlog
drains, so a different client's single 09:01 post waits minutes behind work that
has nothing to do with them.

`findDue` is therefore raw SQL, because the fairness *is* a window function:
`ROW_NUMBER() PARTITION BY workspace` numbers each client's due work
independently, and taking the lowest numbers first interleaves them. Within a
client the order is still oldest-first, so a backlog drains the way its owner
expects. Prisma cannot express that, and doing it in application code would mean
fetching the whole backlog in order to sort it — the exact cost this avoids.
---

## Charts and layout

Charts live in `src/components/charts/` and are hand-drawn SVG. A charting
library would be several times the weight of what is actually drawn here — one
polyline per series, a hairline grid, a bar list.

The palette is in `src/lib/viz.ts` as CSS custom properties, so light and dark
values swap in `globals.css` alone and nothing references a hex. Eight
categorical hues, **assigned in fixed order and never cycled**: the ordering is
what keeps adjacent pairs apart under colour-vision deficiency, so it is a
guarantee rather than a preference. Validated against the white card surface —
worst adjacent CVD ΔE 9.1, worst adjacent normal-vision ΔE 19.6. Past eight
series the tail folds into "Other"; a generated ninth hue is indistinguishable
from an existing one and breaks the check.

Three of the eight sit below 3:1 contrast against white, which is allowed only
with relief. That relief is `ChartFrame`'s **table view**: every chart can be
read as numbers, so colour never carries a value alone and a tooltip enhances
rather than gates. Keyboard focus on a line chart shows the same readout as
hover.

Marks follow one spec throughout: 2px lines, ≥8px end markers with a 2px surface
ring, 4px rounded data-ends on bars, solid hairline gridlines, area fills at 10%.
Values are direct-labelled *selectively* — the endpoint and the extreme, never a
number on every point. Trend colour states whether a direction is welcome, not
which direction it is: the arrow does that, and `DOWN_IS_GOOD` keeps the app from
congratulating a page on more unlikes.

The line chart measures its container with a `ResizeObserver` and redraws at the
real width. Scaling a fixed viewBox instead would either letterbox the plot
inside its own card or, with `preserveAspectRatio="none"`, stretch the 2px
strokes and the labels along with it.

### Responsive layout

The app is used on phones between client meetings, so every screen is checked at
360px: no page scrolls horizontally at any width. Three patterns do the work.
Wide tables scroll inside `.scroll-x` rather than moving the page. The ten-column
post table becomes **cards** below `sm` — a horizontally scrolling table on a
narrow screen is technically readable and practically not, because the post text
scrolls out of view exactly when the numbers come into it. Eleven analytics views
and ten nav links become a **select** and a **menu** rather than wrapping into
ragged rows that push content below the fold.

Inputs are 16px on small screens: below that, iOS Safari zooms the page on focus
and never zooms back out.
---

## Analytics

`src/lib/facebook/metrics.ts` is a catalogue of **every metric Meta documents**
— 354 insight names across five levels (Page, post, video, Instagram account,
Instagram media) plus 110 Ads Insights fields. Nothing in it is assumed to work.

Deprecated names are listed rather than deleted. A metric Meta removed in v4.0
still appears, tagged `deprecatedFrom`, so a blank chart carries an explanation
instead of looking like a bug — and because Pages older than the deprecation
sometimes keep serving them.

The reason is a specific Graph behaviour: **one unknown metric name fails the
entire request** with error 100, and Meta removes metrics between versions
without telling individual apps. Asking for thirty and getting a 400 back says
nothing about the other twenty-nine.

So `fetchInsights` chunks the request and **bisects a failing chunk** until the
offending names are isolated, returning both what came back and what was
refused. Auth failures and rate limits are deliberately *not* bisected — they
apply to every name equally, so splitting only spends more of the budget.

The refusals are stored in `MetricAvailability`, which is what lets the UI say
"Meta no longer serves this" instead of drawing an empty chart. `probeMetrics`
answers the question no amount of documentation will: what this app, on this
pinned Graph version, with the permissions it was actually granted, can retrieve
today.

`probeAllLevels` runs that probe across all five levels in one pass — against a
real Page, a real post, a real video and, where linked, a real Instagram account
and media item, because the post catalogue cannot be tested against the Page.
A level with no subject yet reports `skipped` rather than zero coverage, and
`readCoverage` turns the stored results into the honest version of "all
available metrics": catalogue size, confirmed, refused, and never asked.

Values are snapshotted into `PageInsight` because Graph serves only about two
years of history. Breakdown metrics (`page_fans_country` and the like) keep
their map and store `numeric = null` — summing "FR + GB + US" would be a number
that means nothing, so those series report no total.

Page profile counters (`fan_count`, `followers_count`, `talking_about_count`)
are read separately off the Page object. They need no `read_insights`
permission and no date range, so they still land when the insights edge is
restricted or empty.

The full per-post response is kept in `PostInsights.metrics`, not just the
seven numbers a table can show, and `/analytics/post/<id>` renders all of it
grouped by category with breakdown maps expanded. Posts found on the Page that
never went through this app get the same catalogue through the same reader
(`readPostCatalogue`), so the two cannot drift into different definitions of
"impressions".

Exports live in `src/lib/analytics-export.ts`: one CSV per part of the
catalogue, and for posts, videos and Instagram media, **one column per metric**.
Columns are derived from the data rather than the catalogue — 354 mostly-empty
columns would be worse than useless — so the header is the union of what
actually came back for the rows being exported. Breakdown maps are written as
JSON rather than collapsed to a number that would mean nothing.

Groups are skipped throughout: Facebook exposes no insights edge for a Group.

### Beyond /insights

Insights say a post reached 4,000 people. They do not say what those people
wrote, whether one of them left a one-star rating, or what the inbox was asked.
`src/lib/facebook/edges.ts` reads the rest: comments (flattened with
`filter=stream`, so replies arrive in the same call), ratings, conversations,
`published_posts` and videos.

Two rules hold across all of them. Every reader **pages with a hard ceiling** —
a Page with six years of comments must not be able to hold a worker job open
forever — and every sync **catches per edge**, so a Page whose token cannot read
the inbox still gets its comments. A refused edge is reported in the result, not
swallowed.

`published_posts` is the reconciliation edge. Posts made from the Facebook app,
by another tool, or by a colleague who never opened this product are invisible
otherwise, and every Page-level report that ignores them understates the Page.
Posts this app published are filtered out by remote id before storing, or the
totals would count them twice.

Comment moderation writes to Facebook **first** and mirrors the change locally
only after Graph confirms. An optimistic update would show a comment as hidden
while it was still public, which is the failure that gets a page reported.

### Instagram and advertising

An Instagram Business account linked to a connected Page is reachable with that
Page's own token — there is no separate Instagram login — so
`src/lib/facebook/instagram.ts` sits beside the Facebook client. The Graph shape
is the same, so the bisecting fetcher is reused; the vocabulary differs in three
ways that each need handling: some metrics exist only under
`metric_type=total_value`, demographics are refused without a `breakdown`
parameter, and bare names like `impressions` collide between account and media
level, so lookups pass a level.

Ads Insights is read-only and stored at all four levels — account, campaign,
ad set and ad — because "which ad" is the question people actually have when a
campaign underperforms. `ads_read` is requested; `ads_management` never is.
The point is the comparison: a Page whose reach tripled last month either earned
it or bought it, and only spend distinguishes the two. Rates are derived from
the totals rather than averaged across days — a mean of daily CPCs weights a £1
day the same as a £1,000 one. Campaign reach shows the best single day rather
than a sum, because reach counts people and adding days counts the same person
repeatedly.

Messaging, Instagram and Ads each sit behind a `FACEBOOK_ENABLE_*` flag. Meta
reviews those permissions separately, and requesting one the app has not been
approved for fails the whole consent dialog rather than just that permission —
so the scopes, and the worker jobs that need them, only turn on together.
