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

**The worker runs up to eleven jobs** on independent intervals — publish (30s),
nativeReconcile (15m), rss (15m), evergreen (1h), analytics (6h), pageInsights
(12h), edges (4h), housekeeping (24h), tokens (24h), plus instagram (12h) and
ads (12h) when those permissions are enabled. Each is a plain async
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

**The same rules apply when the mode is changed on an edit.** The composer
offers "let Facebook hold it" while editing as well as while creating, so both
paths share `assertNativeSupported` — a rule enforced on only one of them is
not a rule, it is a detour. And switching to native actually hands the post
over, rather than recording the choice and leaving it for our own worker: the
whole reason to pick native is that the post survives our worker being down,
and the screen would otherwise say Facebook had it while nobody had asked
Facebook anything. Two cases are deliberately excluded — an edit that sends the
post back for review, because handing it over would publish something no
reviewer has seen, and an edit that turns it into a draft, which has no time for
Facebook to hold it until.

**Facebook never tells us when it publishes one.** A natively scheduled post
exists on Facebook from the moment it is created and flips to published on its
own, so without asking, a `scheduled_remote` destination stays that way for
ever: the post reads "Scheduled" months after it went live, never gets a
`publishedAt`, and is invisible to the analytics refresh, which only looks at
published rows. Choosing native mode to survive our downtime therefore cost the
post its place in every report.

`runNativeReconcile` asks, once the scheduled moment has passed, and only then
— one Graph call per post rather than a poll. `is_published` decides it, and
only a literal `true` counts: absent is not "no", and guessing would mark a post
published that never went out. The timestamp comes from Facebook's own
`created_time` rather than the moment the worker happened to ask, so reports put
the post where it actually happened. A post that has been deleted on Facebook
(code 100) is recorded as failed rather than left claiming for ever that it is
about to go out.

**When that deletion fails, the destination is not marked cancelled.** The copy
that matters lives on Facebook, so a post reading "Cancelled" here while
Facebook publishes it on schedule is the worst outcome available: the client
sees a post they were told would never go out, and nobody is looking for it
because our own records agree it is gone. A destination we could not delete
stays `scheduled_remote`, the reason is returned to the caller, and the post's
own status is derived rather than asserted — so it reads as scheduled, which is
what it is. A destination with no stored token counts as a failure for the same
reason: there is no way to reach the post at all, and passing over it silently
reported a clean cancellation for something still going out.

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

That safety has to be earned by each job separately, though — it is a property
of the claim, not of the worker. The loop deciding which jobs are due keeps its
state in process memory, so every worker runs every job. Recycling had no claim
at all: each worker found the same due post and created its own copy, which is
a second post on a client's Page. It now claims a cycle with a compare-and-set
on `recycleNextAt` before creating anything, so only the worker that still sees
the date it read gets to act. Advancing before the copy exists means a failure
costs one missed repeat, which nobody notices, rather than a duplicate, which
everybody does. The token expiry check had the same shape and the same fix: it read an
unwarned account, emailed, and only then marked it, so each worker sent the
client its own copy of the same warning. It now claims the warning before
sending — which costs nothing, because `notifyTokenExpiring` swallows its own
failures and the send result was never consulted anyway.

The rest of the jobs are safe as they stand, for two different reasons. RSS
polling is protected by the `@@unique([feedSourceId, guid])` on `feed_items`,
which rejects the second worker's insert before it can create a post.
Housekeeping deletes, which is idempotent. The sync jobs — analytics, page
insights, edges, Instagram, Ads — read a batch and overwrite it with what Meta
returned, so a second worker writes the same numbers over the top; the only
cost is a duplicated Graph call against the app's rate limit, which is not
worth a claim to avoid.

The general rule: a job needs a claim when running it twice *creates* something
— a post, an email — and not when it merely rewrites or removes.

**The one accepted risk:** a worker that dies *after* Facebook accepts a post but
*before* the row is updated leaves a lock that is reclaimed and retried — which
can double-post. Facebook's own duplicate detection (error 506) catches
identical content. The alternative, never reclaiming, silently drops posts,
which is worse for a scheduling product.

**Results are written only while the lock is still held.** Both the success and
the failure write are `updateMany … where { id, lockedBy: workerId }`, and a
count of zero means the destination was reclaimed mid-publish. This bounds the
risk above at *one* extra post. Without it the failure write is the dangerous
one: it sets `pending` and clears the lock, which frees a destination another
worker is actively publishing, so a third worker claims it and posts again —
one reclaimed lock turning into an unbounded number of posts.

A worker that loses its lock does nothing else either: no failure email, and no
condemning the connected account on an auth error. The worker that holds the row
is about to hit the same error and will report it, and acting on a result we
were not allowed to write risks disabling a working account on a misclassified
one. A *successful* publish that loses its lock is logged with the permalink and
`orphaned: true` — the post is live on Facebook and nothing in the database
points at it, so the log line is the only way anyone finds it.

### Editing a post the worker has already started

The claim above moves a *destination* to `processing`, but the *post* stays
`scheduled` until `refreshPostStatus` runs. There is a real window, then, where
a post reads "scheduled" in the UI while a worker is already talking to
Facebook about one of its destinations — and an edit landing in that window
used to delete the row the worker was holding, erasing the only record that the
post was on its way out. The recreated `pending` row published it a second time.

Two things close it, and they are deliberately belt *and* braces:

1. **The refusal reads the destinations, not just the post.** An edit is turned
   away when any destination is `processing`, even while the post itself still
   says `scheduled`.
2. **The write can't delete a claimed row anyway.** Replacing a post's
   destinations only deletes rows nothing is holding (`pending`, `failed`,
   `cancelled`) and recreates with `skipDuplicates`.

The second exists because the check and the write are two statements and a
worker can claim between them. With the narrowed delete, the worst a lost race
can do is leave a stale destination behind — recoverable, and visible. Deleting
the claimed row is neither.

### One headline status per post

A post shows one word in the UI, derived from its destinations:
`refreshPostStatus` reads them all, works out the word, and writes it back.
That read and that write are separate, and in the ordinary multi-worker case
two ticks reach it at once — each having claimed a different destination of the
same post. Interleaved, the refresh that read first can write last, leaving its
stale snapshot behind.

Nothing corrects that afterwards: a refresh only happens when there is
publishing activity, and by then there is none left. The post is stuck reading
`scheduled` or `publishing` with every destination long finished — it never
shows as published, and if the stale word is `publishing` it cannot be edited
either, because that is exactly what an edit refuses.

So the whole read-compute-write runs in one transaction behind
`pg_advisory_xact_lock(hashtext(postId))`. Per post, not global: refreshes for
different posts still run in parallel, and the lock is released with the
transaction whatever happens.

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

### Destinations that were turned off

`findDue` excludes a destination whose Page is disabled, which stops it
publishing — and, on its own, leaves the row `pending` for ever and the post
reading "Scheduled" for ever. It never goes out, never fails and never explains
itself.

`skipped` is the state for that. It was already in the enum, already terminal,
already excluded from the active set when a post's headline status is
recomputed, and nothing had ever set it. Each tick settles *due* destinations
whose Page is off — not ones scheduled for next week, which may well be back on
by then — so a post publishes to the Pages that were on and records why it went
nowhere on the ones that were off.

A post every one of whose destinations was skipped reads `failed`, not
`cancelled`. Nobody cancelled it; calling it cancelled sends the reader looking
for a colleague who did it.

Evergreen respects the same signal, and has to: a recycled copy pointed at a
disabled Page would be created, skipped on the next tick, and replaced by
another copy an interval later, indefinitely. Recycling therefore copies only
live destinations, and stops altogether when none are left — the same thing it
already did when the destinations had been deleted outright.

### Time

### The hour that does not happen

Once a year an hour is skipped. In London the clocks read 00:59 and then 02:00,
so every wall-clock time from 01:00 up to 02:00 — 01:00 itself included — is not
a time that morning. `fromZonedTime` does not object to being handed one: it
returns the instant an hour *before* the gap, so 01:30 becomes 00:30 and 01:59
becomes 00:59.

Nothing about that is visible afterwards. The post goes out an hour early, and
the calendar agrees with itself, showing the time it moved to rather than the
time somebody set. So scheduling into the gap is refused, with a message that
says which hour is missing and why.

The queue is the one mode where the author does not choose the time, so the
composer names the slot it got back rather than saying "Scheduled" and leaving
them to go and find it on the calendar. The confirmation carries the hour, not
just the day: "goes out Tuesday" omits the part they need.

A post that went out immediately gets its permalinks in the same banner. Graph
returns one with every successful publish and the API passes it through; right
after posting is when somebody wants to look at what went out, so confirming it
worked and making them go and find it is the wrong half of the answer. Only
destinations that actually published are linked, and they render through
`ExternalLink` like every other href that came from data rather than from the
code.

**The calendar grid needs it for a different reason.** Four real zones —
Santiago, Havana, Beirut and Cairo — change their clocks at midnight, so on one
day a year those zones have no 00:00 at all. `monthGrid` built every square by
asking `fromZonedTime` for that day's midnight, and got back 23:00 the evening
before. The grid then held the previous day twice and had no square for the day
that lost its midnight, so every post scheduled on it had a bucket key matching
no cell and simply vanished from the calendar. Each square is now
`firstRealInstant`, which lands on 01:00 that morning and formats as the right
day.

`wallClockExists` is a round trip: convert to an instant and back, and if the
wall clock that returns is not the one that went in, the one that went in never
existed. `firstRealInstant` finds the moment the clocks land, for callers that
should move rather than refuse — a weekly queue slot at 01:30 on a Sunday must
not break one Sunday a year. It searches rather than adding an hour, for two
reasons: adding an hour lands an hour after the *requested* time rather than at
the start of the hour that replaced it, and not every shift is an hour — Lord
Howe Island moves by thirty minutes.

The autumn transition needs no rule. That hour happens twice, so both readings
are real; the conversion picks the second and the round trip is stable, which
is all that is required of it.

The test finds the next transition rather than naming a date, for the same
reason the scheduling tests compute a future timestamp: a literal date is a
test that passes until one morning it does not, and this one would need
rewriting every year besides.

A one-off scheduled time is refused when it falls in the gap; a recurring queue
slot is moved. The difference is what the two things are: a typed-in time is a
statement about one post, and silently changing it is a lie, while a weekly slot
is a standing instruction that must not break one Sunday a year.

### Counting characters

`String.length` counts UTF-16 code units, which is neither what a person means
by a character nor what Meta's limits are measured in. An emoji is two units, a
flag four. It does not matter against Facebook's 63,206 and it matters a great
deal against Instagram's 2,200, which long captions full of hashtags and emoji
reach as a matter of course: a caption of exactly 2,200 characters with fifty
emoji counted as 2,250 and was refused by our own check before Facebook was
ever asked.

The direction is why it was worth fixing rather than documenting. Over-counting
turns valid content away with a message the person cannot act on — the caption
really is 2,200 characters, and the app says it is not. `countCharacters` uses
code points: neither code points nor grapheme clusters is exactly what Meta
counts and Meta does not say, but code points is the closer of the two to what
an API means, and clustering would fold a flag into one where Meta near
certainly sees two.

The composer also warns while somebody is still writing, rather than letting a
long caption fail on the Instagram destinations hours later when the post is
due. The limit is written twice for that — once where it is enforced, once
where a client component can see it — and a test keeps the two in step.

### One zone per screen

A post carries the zone it was created in, and every screen renders in the
*workspace's* zone and says so. Both are right, and the two must not be mixed
in one place. The edit screen mixed them: it rendered the time in the post's own
zone while the composer sent back the workspace's, so opening a post written
before a timezone change and pressing Save without touching anything moved it by
the difference between the two — and, with review switched on, sent it back to a
reviewer for a change nobody made. The field is rendered in the workspace's zone
now, which is also the number the person just saw on the list they clicked from.

Changing a workspace's timezone deliberately does not touch any scheduled post.
A post is an instant; the zone is how it is displayed. Nine o'clock in London
becomes ten in Paris on every screen, and goes out at the same moment it always
would have.
outs

Sending a file is not a request that answers in a moment, and one timeout used
to cover both: a minute, which is generous for a JSON call and short for a
video. A 25 MB upload needs better than 3.5 Mbit/s upstream to finish inside
that, and when it does not the abort arrives as a network error, is classed
`transient`, and retries until the attempt limit — so the post fails with a
message that says nothing about what actually went wrong, which is the failure
this codebase keeps having to be talked out of.

`facebook.requestTimeoutSeconds` (60) and `facebook.uploadTimeoutSeconds` (300)
are separate and both configurable, because the right numbers depend on the
link the server sits on.

A timeout that does fire says so, naming the file, its size and the limit it
exceeded. It is still classed `transient` and still retried — a slow link is
usually a passing thing — but the difference between that message and "the
operation was aborted" is whether the person reading the failed post can tell
that their video is too big for this server's connection.

What Facebook itself refuses is not retried: an oversized file comes back as
code 100 or an HTTP 4xx, both of which classify as `invalid_request`, so the
post fails once rather than five times.

### One job at a time

The worker stamped a job's next run *before* starting it, so a job taking
longer than its interval came due again while the previous run was still going,
and the loop started another — indefinitely.

For `publish` that is harmless: claiming a destination is atomic, and running
several workers is a supported way to go faster. For the jobs that walk every
workspace calling Graph — analytics, page insights, edges, Instagram, ads — it
is not. Two passes over the same Pages spend the app's rate limit twice to
collect the same numbers, and an installation big enough for a job to overrun
is the one that can least afford it.

`src/lib/scheduler/loop.ts` skips a job whose previous run is still in flight
and schedules the next from when that run *finished*. A job taking 45 seconds
on a 30-second interval settles into every 75 seconds — slower than configured,
which is the honest answer when the work does not fit in the interval. A slow
job still does not delay a fast one; they share a loop precisely so that
publishing keeps its cadence while analytics grinds.

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

**A manual retry keeps a scheduled time that is still ahead.** `retryPost`
makes the post due immediately when its moment has passed — the usual case, and
without it the retry would wait for a slot already behind us and never run. But
a destination can fail long *before* the post is due: native scheduling hands
the post to Facebook at creation time, so a Page that refuses it is `failed`
while the rest of the post sits queued for Friday. Moving that post to "now"
publishes the retried destination days early while the others stay queued — the
post goes out twice, at two times, neither of which anybody chose.

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

## Publishing to Instagram, which is nothing like publishing to Facebook

An Instagram Business account is reached with the token of the Page it is
linked to — there is no separate Instagram login — so it lives as a `Target`
row of type `instagram` alongside Pages and Groups. That is the point: the
composer, the calendar, the queue, the post list, retries and per-destination
failure reporting all work on it without knowing what it is. Only the Graph
call differs, in `src/lib/facebook/instagram-publish.ts`.

Three differences shape that file.

**It takes no bytes.** Every other edge here uploads a file. Instagram takes a
URL and Facebook's own servers fetch it, with no cookie to present — so the
authenticated media route is unreachable to it. `src/lib/media-links.ts` mints
a link for exactly that fetch: one file, signed with a key derived from the
session secret rather than being it, expiring in thirty minutes. The expiry is
inside the signature so it cannot be extended, and the signature names the file
so it cannot be pointed at another. Nothing is stored; the link exists for the
length of one publish.

**It is two steps.** You create a *container* describing the post, Facebook
downloads and processes the file, and only then may you publish it. Publishing
early gives an empty post, and for a carousel a parent published before its
children are ready is missing pictures — neither of which Instagram lets anyone
fix afterwards. So every container is waited on, children included, and the
three ways waiting ends (`FINISHED`, `ERROR`, `EXPIRED`) each get their own
explanation. Facebook's note on a rejected container says which rule the file
broke — aspect ratio, length, codec — and that is passed straight through,
because none of it is guessable from here.

**It has no text-only post.** A caption with nothing attached is refused by
`planInstagramPublish` before any network call, alongside the caption length
limit and the ten-item carousel maximum. Two consequences follow elsewhere:
native scheduling is refused for Instagram destinations, because Instagram has
no scheduling of its own and "let Instagram hold it" would silently mean
"publish now"; and RSS auto-posting is Facebook-only, since a feed entry is a
headline and a link and Instagram publishes neither on its own. The feeds
screen does not offer Instagram destinations and both feed routes refuse them
through `assertFeedDestinations`.

A discovered account starts with `canPublish: false`, because
`instagram_content_publish` is a separate App Review from the Instagram reading
scopes. Rediscovery never overwrites that decision — it is one somebody made on
the Connections screen.

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

### Slugs under concurrency

Asking whether a slug is free and then inserting it are two steps, so two people
creating "Acme" at the same moment — or one person double-clicking the button —
both find it free and both insert. One of them got a failed sign-up out of it.

`createWorkspace` retries, and retrying is enough to converge: by the second
pass the winner's row exists, so the search moves on to `acme-2`. Only a slug
collision is retried; anything else is a real failure and is rethrown, which is
the difference between a race and a broken database. The short-link path already
worked this way — it collides far more often, being random — so this brings the
two into line.

### Who may create an account

Registration is closed by default. This app has to be reachable from the
internet for Facebook to call back, which makes an open sign-up form open to
everyone who finds the address — and a workspace here holds live Page tokens.
`auth.openRegistration` turns it back on for installations that want it.

Two exceptions keep closed from meaning locked out: the **first** account is
always allowed, because a fresh installation has nobody to invite anyone, and
anyone holding a live invitation to their own address was already admitted by
someone who could admit them. The check lives in `registerUser`, which every
sign-up passes through; the register screen also asks first, so nobody fills in
a form only to be refused.

### Slowing down the sign-in form

Sign-in is the one unauthenticated endpoint that does deliberate slow work: a
password is checked with a hash that is expensive on purpose, and it is checked
even for addresses nobody has registered, so response timing does not reveal
which addresses exist. Both properties are right, and together they make an
unlimited form a cheap way to keep every core busy as well as a way to guess
passwords.

Two keys, because they stop different things. The **address** bounds guessing at
one account however many machines the guesses come from. The **client** bounds
one machine working through a list of addresses, and bounds the load. A success
clears both: for the address so a person who mistypes twice starts from zero,
and for the client because a whole office behind one address would otherwise
spend its allowance on people signing in successfully and turn away the tenth
colleague of the morning. Somebody who can sign in is not who the limit is for.

The counters are in memory, not in the database. What is being defended against
is a flood of requests, and a table write per attempt hands the attacker a
second, cheaper way to do damage — the defence would become the amplifier. The
cost is that counts are per process and reset on restart, which is the right
trade here: this is a brake, not an access control, and the hashed password is
still underneath it.

### Accepting an invitation

The token lives only in the email: the row stores a SHA-256 of it, so a database
dump cannot be turned into a set of working invitation links. Accepting checks
expiry, refuses a second use, and requires the signed-in address to match the
one invited — otherwise a forwarded link admits whoever received it.

The part that was broken was the detour. Most people accepting an invitation
have no account yet, so they arrive, click "create an account", and sign in
first. The invitation page linked to `/register?invite=…` and neither auth page
read the parameter: they registered, landed on the dashboard of a workspace they
had not been invited to, saw nothing about the invitation anywhere, and had to
go back to the email and click the link again. `afterAuthPath` is now the one
definition of where someone goes after signing in, used by both auth pages and
the form itself.

### Moderating comments

Three writes reach somebody else's Facebook page: hide, unhide and delete. The
protections around them were already in place — a role check first
(`canModerateComments` for hiding, `canDeleteComments` for deleting, since one
is undone from the same screen and the other is not), and a lookup scoped to the
caller's workspace, so the id Graph is aimed at comes from the row that lookup
found rather than from the request.

What was missing was the record. Every other consequential action here writes an
activity entry, and deleting a client's comment is the least reversible thing
this app can do: Facebook keeps nothing afterwards, and the local row goes too.
The entry now holds the comment's author and text, so afterwards there is still
an account of what was removed and by whom.

### Who may act on a post

Workspace membership was the only check on editing, cancelling, retrying and
publishing: any member could act on any post in the workspace. `canManageOthersPosts`
(editor and above) now holds contributors to their own work — a role that exists
for people whose output is reviewed should not be able to empty a colleague's
calendar with one call. Duplicating is deliberately exempt: it produces a new
post authored by the copier, which faces review like anything else they write.

### Queue slots

"Add to queue" drops a post into the next free publishing slot, which only works
if every post that still intends to use its slot counts as holding it.
`QUEUE_OCCUPYING_STATUSES` is that set, and `pending_approval` belongs in it: a
contributor's queued post sat in review, the next person to use the queue was
handed the same slot, and both went out together the moment the first was
approved — the queue quietly doing the opposite of its job. Drafts hold nothing
because they have no time; rejected and cancelled posts release theirs, because
they are not going out.

Reading the free slots and writing the row also have to happen together, or two
people pressing "add to queue" both read the same set and are both handed the
same slot. The window is not theoretical: the Open Graph scrape for a post's
link sits between the two halves and can be seconds wide. `createPost` takes a
transaction-scoped `pg_advisory_xact_lock` keyed on the workspace for the queue
path only, so concurrent requests serialise behind each other, the lock is
released with the transaction whatever happens, and one workspace never blocks
another. The RSS poller needs no lock: it schedules a feed's entries
sequentially, re-reading the taken slots for each.

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

Cancelling is the exception that proves the shape of this. It leaves
`approvalStatus` alone on purpose, so the record of what was asked for
survives — which means the approval state alone no longer says whether anything
is waiting. `IN_APPROVAL_QUEUE` pairs it with `status = pending_approval`, and
the queue, the nav badge, the release sweep and the approve/reject guards all
read that one definition. Without the status half, a cancelled post sat in a
reviewer's queue and approving it flipped it back to `scheduled` while every
destination stayed cancelled: a post that reads as scheduled and can never go
out.

Evergreen recycling is the third way in, and the widest. Recycled copies are
created `not_required` on the grounds that repeating an approved post is not a
new editorial decision — but a *variant* is not a repeat, it is different text
nobody has read, published on a timer. Supplying variants therefore requires the
same standing as publishing without review; recycling the approved message
itself stays open to everyone, because that text has been read.

---

## Time

### The hour that does not happen

Once a year an hour is skipped. In London the clocks read 00:59 and then 02:00,
so every wall-clock time from 01:00 up to 02:00 — 01:00 itself included — is not
a time that morning. `fromZonedTime` does not object to being handed one: it
returns the instant an hour *before* the gap, so 01:30 becomes 00:30 and 01:59
becomes 00:59.

Nothing about that is visible afterwards. The post goes out an hour early, and
the calendar agrees with itself, showing the time it moved to rather than the
time somebody set. So scheduling into the gap is refused, with a message that
says which hour is missing and why.

`wallClockExists` is a round trip: convert to an instant and back, and if the
wall clock that returns is not the one that went in, the one that went in never
existed. `firstRealInstant` finds the moment the clocks land, for callers that
should move rather than refuse — a weekly queue slot at 01:30 on a Sunday must
not break one Sunday a year. It searches rather than adding an hour, for two
reasons: adding an hour lands an hour after the *requested* time rather than at
the start of the hour that replaced it, and not every shift is an hour — Lord
Howe Island moves by thirty minutes.

The autumn transition needs no rule. That hour happens twice, so both readings
are real; the conversion picks the second and the round trip is stable, which
is all that is required of it.

The test finds the next transition rather than naming a date, for the same
reason the scheduling tests compute a future timestamp: a literal date is a
test that passes until one morning it does not, and this one would need
rewriting every year besides.

A one-off scheduled time is refused when it falls in the gap; a recurring queue
slot is moved. The difference is what the two things are: a typed-in time is a
statement about one post, and silently changing it is a lie, while a weekly slot
is a standing instruction that must not break one Sunday a year.

### Counting characters

`String.length` counts UTF-16 code units, which is neither what a person means
by a character nor what Meta's limits are measured in. An emoji is two units, a
flag four. It does not matter against Facebook's 63,206 and it matters a great
deal against Instagram's 2,200, which long captions full of hashtags and emoji
reach as a matter of course: a caption of exactly 2,200 characters with fifty
emoji counted as 2,250 and was refused by our own check before Facebook was
ever asked.

The direction is why it was worth fixing rather than documenting. Over-counting
turns valid content away with a message the person cannot act on — the caption
really is 2,200 characters, and the app says it is not. `countCharacters` uses
code points: neither code points nor grapheme clusters is exactly what Meta
counts and Meta does not say, but code points is the closer of the two to what
an API means, and clustering would fold a flag into one where Meta near
certainly sees two.

The composer also warns while somebody is still writing, rather than letting a
long caption fail on the Instagram destinations hours later when the post is
due. The limit is written twice for that — once where it is enforced, once
where a client component can see it — and a test keeps the two in step.

### One zone per screen

A post carries the zone it was created in, and every screen renders in the
*workspace's* zone and says so. Both are right, and the two must not be mixed
in one place. The edit screen mixed them: it rendered the time in the post's own
zone while the composer sent back the workspace's, so opening a post written
before a timezone change and pressing Save without touching anything moved it by
the difference between the two — and, with review switched on, sent it back to a
reviewer for a change nobody made. The field is rendered in the workspace's zone
now, which is also the number the person just saw on the list they clicked from.

Changing a workspace's timezone deliberately does not touch any scheduled post.
A post is an instant; the zone is how it is displayed. Nine o'clock in London
becomes ten in Paris on every screen, and goes out at the same moment it always
would have.


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

**Editing a post** reuses the composer rather than offering a smaller edit
form: everything you can say when writing a post you can also say when
correcting one, and a cut-down form would quietly be missing something.
`/compose?post=<id>` loads it. Whether a post can still be changed is
`postEditBlocker` in `src/lib/constants.ts`, asked by two callers — `updatePost`
refuses the save and turns each reason into its own error, and the post list
decides whether to show an Edit button at all. One function, because a button
that leads to a 409 is worse than no button. A whole-form save that changes
nothing the reviewer looked at does not cost the post its approval; one that
changes the text, the destinations or the time does.

**Answering the inbox** goes through the Send API with `messaging_type:
RESPONSE`, addressed to the person's page-scoped id — the thread id is not an
address Facebook will deliver to. Two of Facebook's rules are checked before
the call rather than discovered as a Graph error, because both have a plain
explanation and Graph's does not: a Page may answer only within 24 hours of the
person's last message, and a thread whose last word is the Page's has nobody to
answer. `readConversations` works both out per thread so the screen can show
the box only where it will work and say when the window shuts; the send checks
again against the whole thread. The reply is stored locally the moment Graph
confirms, as the comment reply already was — waiting for the next sync would
read as the message having been lost.


---

### Bulk upload

One request, as many posts as the file has rows, and every row that carries a
link scrapes it. Nothing bounded that: a few thousand rows made a few thousand
outbound fetches inside a single request, which runs for minutes and, on any
platform with a request timeout, is killed part-way — leaving posts scheduled
that the uploader never saw confirmed and cannot tell apart from the ones that
failed. The row limit is a setting (`scheduler.bulkRowLimit`, default 500) since
the right number depends on the deployment's timeout, and the raw file size is a
static ceiling because past it the parse itself is the problem. The whole file
is refused rather than partly scheduled: nothing happened, so there is nothing
to reconcile.

A quote that is never closed refuses the whole file. Unlike a ragged row there
is no per-row recovery to offer: everything after the quote is swallowed into
one field, so the rows behind it do not fail loudly, they stop existing — and
the uploader is told their two-hundred-row campaign scheduled one post. The
error carries the line the quote opened on, counting newlines inside quoted
fields so the number matches the editor.

A row with more values than the header is reported rather than trimmed. There is
no reading of that which is deliberate — it means a comma inside an unquoted
field, so everything after it has shifted and the extras were about to be
dropped in silence, which is how a client's page ends up with a post whose text
is a fragment. A row with *fewer* values is still filled in with blanks and says
nothing: hand-written files leave trailing commas off, and a blank cell already
means something useful here, since no scheduled time means "use the next queue
slot".

Per-row URL rules match the composer's, which they did not before: a spreadsheet
could put anything in the link column, and it was stored on the post and
rendered as an `href` on the post list and the approvals screen before anyone
discovered Facebook would not take it. Bad rows are now reported as bad rows,
which is what the row-by-row result format exists for — one malformed cell
should not cost a 200-row campaign, and it should not become a post either.

### Links rendered from data

Every `href` the app builds from data — a URL somebody typed, a spreadsheet
column they uploaded, a permalink Graph handed back — goes through
`ExternalLink`, which builds an anchor only for `http(s)` and otherwise renders
the same text as a plain span. Validation on the way in is the real defence and
it is in place, but it only covers rows written since it was added: a post
stored before the CSV columns were checked still renders, and so would anything
a future write path forgets. The unsafe value is shown rather than hidden — the
point is that the address stops being clickable, not that the user stops being
told what the post says.

## Exports opened in a spreadsheet

Both CSV writers — the analytics exports and the per-destination report — share
`csvCell`, which does RFC 4180 quoting and then the thing RFC 4180 says nothing
about. A cell beginning `=`, `+`, `-` or `@` is a formula to Excel and Sheets,
and these files exist to be opened in one. The text is not ours: post messages
come from colleagues, but Page names, comment bodies and reviewer names come
from Facebook, which is to say from anyone. A leading apostrophe defuses it, and
spreadsheets do not display the apostrophe.

Numbers pass through untouched, which is the point worth guarding: these are
analytics exports, negative values are ordinary, and turning `-5` into text
would break every sum in the sheet the file exists to feed.

## Link previews and outbound fetches

Composing a post scrapes the link for its Open Graph card, which means the
server fetches a URL somebody typed. Facebook's own scraper is preferred — it
returns the card Facebook will actually render, and re-scraping is the
documented fix for a stale one — but the fallback fetches the page ourselves,
and that is the path that needs guarding.

`assertSafePreviewUrl` lives in `scrapeWithFetch`, the one place the fetch
happens, rather than on a route. It used to sit on the preview endpoint alone,
which left the two paths that matter more — creating and editing a post, either
of which can arrive a few hundred rows at a time from a CSV — fetching whatever
they were given. The parsed `<title>` is stored on the post and rendered back,
so an unguarded fetch is not only a request to an internal address but a way to
read the answer.

Redirects are followed manually, three hops at most, checking each one. A guard
that inspects only the URL it was handed is walked straight past by a public
address that 302s to `169.254.169.254`. Hostname checks still cannot catch a
domain that *resolves* to a private address, so an egress proxy remains the
right answer for genuinely hostile input; this closes what can be closed in
process.

## Media

### Serving a file without holding it

Uploads run to `media.maxUploadMb`, so serving one by reading it into memory
cost tens of megabytes per request — twice over, once for the read and once for
the copy handed to the response — and a few people opening the media library at
the same time was enough to matter on a small host. `openStoredFile` returns a
stream and a size instead, so the cost per request is a buffer rather than a
file.

Publishing needs the bytes — Graph takes a file as one multipart upload — but it
needs them one at a time, which is not the same thing. `resolveMediaForPublish`
hands back a `read()` per attachment rather than a buffer, so a post with ten
images costs the largest of them to send rather than the sum of all ten, and the
worker publishing to four destinations at once multiplies the smaller number.

Existence is still checked up front, at resolve time. A file that has gone
missing should stop the post before anything is published, not half way through
its attachments with some of them already live on the page.

Range requests are not implemented, so scrubbing a long video re-fetches from
the start. Worth adding if video ever becomes a common upload; it is not one
today.

### The one public door

The media route is authenticated, which is why uploads are not written into
`/public`: unpublished campaign artwork should not be fetchable by anyone who
guesses a filename. Instagram makes that impossible for exactly one case — its
publishing API takes a URL rather than bytes, and Facebook's fetcher has no
cookie to present.

So `src/lib/media-links.ts` mints a link for that fetch and nothing else. It
names one file, carries an expiry, and is signed over both — so it cannot be
extended, and it cannot be pointed at a different file. The key is derived from
the session secret with a label rather than being the session secret, because
two things signed with one key can be swapped for one another when a format
changes. Thirty minutes, because it has to cover a single request. Nothing is
stored, so there is no long-lived public URL anywhere in the system.

The signature stands in for the workspace check rather than skipping it: it
already names the file, and cannot be presented for another.

### The library screen

Uploads were reachable and deletable through the API from the start with
nothing on screen for either, which mattered more than a missing screen usually
does: when the storage quota fills, the upload is refused with "delete some
files" — an instruction the app gave nobody a way to follow.

`readMediaLibrary` exists because `postsUsingMedia` answers one file at a time.
That is right for the delete route and wrong for a page of two hundred files,
so the library asks once for every post referencing anything in the list and
groups the result. Two details the per-file version got right for free: a post
storing both the media id and the storage key is one post rather than two, and
a post that has already gone out holds nothing — it is on Facebook, and our
copy of the file is history.

### What a file claims to be, and what it is

The content type on an upload is whatever the browser was told to send: a claim,
not a fact. `storeFile` checks it against the first bytes and refuses a file
whose contents do not match, which is worth doing in both directions. A file
that is not really an image is rejected at upload, where the person can act on
it, rather than at publish time, where the same problem arrives as a Graph error
about an unsupported file. And nothing downstream inherits a lie: the download
route serves the stored type, so it has to be true.

The extension on disk follows the verified type, never the uploader's filename.
The name is theirs to choose; the file it produces is not. Nothing today
executes by extension — files are served through an authenticated route that
sets the type explicitly, with `nosniff` so a browser cannot second-guess it —
but the deployment notes contemplate a move to object storage, where the served
type is usually inferred from the key, and `<uuid>.html` would be live at that
point.


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

## When something goes wrong

Three pages exist for the moments the app cannot do what was asked, because
Next's defaults for all three are addressed to a developer rather than to
whoever is holding the screen.

**`not-found.tsx`** answers a link that leads nowhere. Two screens call
`notFound()` on purpose — an edit link for a post published since it was
bookmarked, an analytics row that has been deleted — so this is a page real
people reach by following a link that worked yesterday, not only by mistyping.
It says explicitly that nothing has happened to their account, because a bare
404 inside an app you are signed into reads as though something might have. It
offers the dashboard to somebody signed in and the sign-in screen to everybody
else: a dashboard link for a stranger would bounce them back to sign-in with
nothing explaining why.

**`error.tsx`** catches a page that throws. It shows the digest deliberately.
Next replaces the real message in production on purpose, because an exception
can carry a token or a connection string — the digest is the one string tying
what somebody saw to the line in the log that explains it, and without it "it
broke" is the whole bug report. `reset()` re-renders only the segment that
failed, which clears a dropped connection or a Graph timeout without a reload.

**`global-error.tsx`** is the last resort: the root layout itself failed, so it
replaces the entire document and none of the app's scaffolding is available.
Deliberately plain, and deliberately English — a page that tried to translate
itself there would throw inside the handler for a throw.

All three are walked by the browser, including a route that throws on demand
behind an environment flag the walk sets and nothing else does. Error handling
nobody has exercised is the kind that fails when it is finally needed.

### What the tab says

Twenty-five pages inherited one title from the root layout, so every tab read
"MS Social Pilot". That is a small thing on a product used one window at a time
and a real one here: this app exists to run several clients, has a switcher for
exactly that, and an agency with three open sees three identical tabs.

`screenMetadata` builds "screen · client". The screen goes first because a tab
strip crops from the right, and the client after it because that is what
separates three windows once they are down to a favicon and six characters. It
falls back to the app's name for anybody not signed in.

Six pages deliberately keep the generic title, each with its reason written
down in `tests/metadata.test.ts`: a redirect nobody sees a tab for, a legal
notice, the invitation page shown before the invitee belongs to anything, the
single-post analytics screen whose subject is not known until it is fetched,
and the two routes that exist only for the browser walk.

The mark itself is `src/app/icon.svg` — SVG rather than a set of PNGs, because
one file stays crisp at every size a browser asks for and can be read in a diff.
`manifest.ts` is what a phone needs to pin the app: without it, a home-screen
shortcut is named after the domain and illustrated with a screenshot. It starts
at the dashboard, since nobody pins a redirect.

### And while a page is still coming

Every screen behind the sign-in wall is `force-dynamic`, so a navigation waits
on the server — fourteen queries on the analytics screen. Without a loading
boundary Next leaves the *previous* page up meanwhile, and a click that takes
two seconds to do anything looks like a click that missed. `ScreenSkeleton` is
what fills the gap: shapes rather than a spinner, because a spinner says "wait"
and shapes say "a heading and some rows are coming".

Each screen re-exports it as its own `loading.tsx` rather than one file
covering the whole group, and that is not tidiness. **A loading boundary makes
Next flush the response before the page has finished deciding**, so a page that
then calls `notFound()` answers 200 with the not-found page in the body. Both
pages that call it — the composer opening a post that has since been published,
the single-post analytics screen — are reached by links that were valid
yesterday, so neither has a boundary and both keep answering 404. The browser
walk caught this the moment the group-wide boundary went in: a test that had
asserted 404 for years started seeing 200.

---

## A total that is actually a total

Two figures on two screens were computed from a slice and labelled as though
they covered everything. They are worth describing together, because the shape
recurs: fetch a capped page of rows, add them up in JavaScript, present the
result under a heading that promises the whole.

### The dashboard totals

The dashboard's reach and engagement figures sit under a heading reading
"totals across published posts". They were computed by fetching five hundred
rows of insights JSON and adding them up in JavaScript, which was wrong in two
ways, the second worse than the first.

Past five hundred published destinations the number was a partial sum presented
as a total, with nothing on screen suggesting it. And the query had no
ordering, so *which* five hundred was the database's choice: the figure could
change between two refreshes with no data having changed, which is how somebody
stops trusting every other number on the page.

`publishedTotals` sums in Postgres over every row instead. `->>` yields text so
each value is cast, and `COALESCE` makes a destination whose insights have not
been fetched yet contribute zero rather than removing the row or turning the
whole sum null — a post that went out a minute ago is in exactly that state.
Four integers come back instead of five hundred JSON documents.

### The review summary

`readReviews` had the same shape with a sharper edge. It summarised the five
hundred most recent reviews into four tiles — how many, the average, how many
recommend, how many do not — and an agency reports that average to the business
it belongs to. A partial sum can only understate, and somebody may notice; a
partial average is wrong in either direction with nothing to signal which. It
groups in the database now, over everything, and a recommendation left without
a star still counts as a review while contributing nothing to the average.

The rest of the capped reads were checked and left alone. `readVideos`,
`readExternalPosts`, `readInstagramMedia` and `readPostAnalytics` all feed
lists where each row carries its own numbers, so a cap shortens the list
without corrupting a figure — a different problem, and one the pager solves.

---

## Paging a list somebody is reading

The worker pages with a cursor, deliberately: it walks whole tables, and `skip`
re-scans everything it skips, so the last page of a long list costs the most.
The screens page with an offset, equally deliberately and for the opposite
reason. A person does not walk a list — they look at the first page or two and
then filter — so the cost never arrives, and page numbers let them see how much
there is and come back to where they were. A page is a URL, so it survives a
refresh and can be sent to a colleague.

The comment stream needed more than a pager. `readComments` had supported a
text search and a hidden/visible filter from the beginning and the screen
offered neither, so a Page with three hundred comments showed the newest two
hundred with no way to reach the rest and no way to find one. Moderation is an
action rather than a browse — hiding the comment somebody complained about
means being able to get to it — so the three arrived together, and the count
and the rows are taken through one shared `where` clause. A count over
different criteria than the rows gives a pager offering a page with nothing on
it.

`src/lib/paging.ts` holds the arithmetic because every mistake in it has the
same shape — a row shown twice, or never — and none of it is visible until
somebody has more rows than one page holds, which is when they stop reading
carefully. A page past the end clamps to the last one rather than rendering
empty: that happens when somebody bookmarks page nine and rows are deleted
since, and an empty screen reads as "your posts are gone".

Every paged query carries `id` as its final sort key. Postgres guarantees
nothing about the order of rows whose sort keys are equal, so without a unique
tiebreaker a row can appear on two pages while another appears on none. Worth
knowing what the test for this does and does not prove: on a small,
freshly-inserted table Postgres returns equal rows in physical order, which is
stable, so the property test passes with the tiebreaker removed. It breaks once
a plan changes — a parallel scan, dead tuples after updates, a different index —
which is the kind of thing that changes in production and not in a test suite.
The tiebreaker is there because the guarantee does not exist.

---

## The audit trail, and reading it

`ActivityLog` and `EmailLog` were written faithfully from the beginning and
read by nothing except the sweeper that deletes them. Two cases make that worth
fixing rather than tidying away:

- Deleting a comment on a client's Page is irreversible and invisible
  afterwards, so the author, the text and who removed it are recorded
  **because Facebook keeps none of it**. That entry is the only copy there is.
- Email failure is quiet by design. A workspace whose Resend domain was never
  verified sends nothing and is told nothing, so the log is the only place that
  says so — which is why the screen leads with a count of recent failures
  rather than waiting to be asked.

`actorId` is a plain column rather than a relation, and deliberately: an entry
has to outlive the person, because somebody leaving the agency does not un-delete
the comment they deleted. A foreign key would have to cascade or block, and both
are wrong. The name is looked up separately and may legitimately be absent —
which the screen distinguishes from the app having acted on its own.

The action names are a union type in `src/lib/activity.ts` rather than a free
string. That started as a test scraping `logActivity` calls with a regex, which
missed four actions — two written through a ternary, two with a capital letter
after the dot — and so reported their copy as stale. Typing the parameter moved
the question to the compiler, which cannot miss a call site. What is left for a
test is the part a compiler cannot check: whether somebody wrote the sentence,
in both languages.

Those sentences are stored nested — `actions.post.created`, not a flat key
`"post.created"` — because next-intl reads a dot as nesting and refuses a key
containing one. The flat version threw on every page load, and only the browser
walk noticed: no unit test renders a page, and the catalogue parity test
compares the two languages to each other rather than to what next-intl accepts.

---

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

## How this is tested

Roughly seven hundred and fifty tests, in three layers that answer different
questions.

**Unit tests** cover the pure decision-making: which Graph edge a post takes,
whether a retry is worth attempting, queue-slot and timezone arithmetic, CSV in
and out, link tagging, permission catalogues. Fast, and where most of the rules
actually live.

**Integration suites** run against a real Postgres and a stub Graph API. Each
creates and drops its own schema, so they need no coordination and can run in
any order. They exist for the failures that cost customers rather than the ones
that annoy developers: a post going out exactly once under concurrency, an
unapproved post never publishing even when due, one agency client unable to
read or post to another's workspace, a revoked token failing permanently
instead of retrying for ever.

Two of them are sweeps rather than lists, which matters because a sweep covers
code nobody remembered to think about:

- `tests/api-routes.integration.test.ts` walks every file under `src/app/api`,
  calls each exported handler with no session, and fails unless it refuses. A
  route that answers must be named in a `PUBLIC` map with a written reason — so
  that map is the API's public surface spelled out, and a new endpoint is
  private until somebody says otherwise. A second pass signs in as a
  contributor and checks the endpoints that act on the business rather than on
  their own drafts.
- `tests/post-editing.test.ts` checks that every `TargetType` has copy behind
  it, because a new destination kind with no label renders as "Page".

**A browser walk**, in `e2e/`, opens every screen in both languages, signed in
and signed out, empty and with a post on the calendar — and again at phone
width, where it checks that no page scrolls sideways. That last assertion is
worth more than it looks: one element wider than the screen moves the whole
page under the thumb, and it is invisible at any width where the element fits.
The check ignores anything inside a container that scrolls its own overflow,
because a tab strip that slides sideways is doing the right thing. None of the above
renders a page, so none of it can notice a server component that throws, a
missing translation, or a form that submits before React attaches to it — all
three of which it found the first time it ran. Playwright is deliberately not a
declared dependency; see [`e2e/README.md`](../e2e/README.md).

It also sweeps for accessibility, in the narrow sense a machine can check: an
interactive element with no accessible name, an image with no `alt` attribute,
a composer that cannot be reached by tab, a focus ring that has been styled
away. None of that says the app is usable — it says where it certainly is not,
which is the half worth automating. `alt=""` passes deliberately: it is a
statement that an image is decorative, and a missing attribute is a statement
about nothing.

### Confirming a test can fail

A test written after a fix usually passes. Whether it passes *because of* the
fix is a different question, and the only way to answer it is to put the defect
back and watch the test fail.

That step has earned its place twice in recent memory. A test for the
connection health screen passed against the bug it was written for, because the
stub returned the wrong shape of data and the check under test was skipped
rather than satisfied. And an early version of the contributor sweep sent `{}`
as a request body, which three routes rejected as malformed before they ever
consulted the caller's role — three checks passing while testing nothing.

---

## Keeping these notes honest

This document explains decisions by naming the code that implements them, which
is what makes it worth reading and also what makes it rot: a rename leaves prose
pointing at a function nobody can find, and nothing fails — the reader just
stops trusting the rest of it.

`tests/documentation.test.ts` checks that every symbol these notes name still
exists and that every file path they point at is still there. Deliberately
shallow: it cannot ask whether the prose is still true, only whether the things
it points at still exist, which is the part a machine can answer. The same
applies to configuration, where `tests/configuration-docs.test.ts` compares the
registry against both files that describe it.

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

The registry, `.env.example` and the schema notes describe the same
configuration three times, and three copies drift — they did, which is why
`tests/configuration-docs.test.ts` now fails when they stop agreeing, in both
directions. A name documented but absent from the registry is the more
interesting failure: it means a setting wired straight to `process.env`, which
is a setting nobody can change from the config screen. That is how
`DEFAULT_LOCALE` was found.

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

Those choke points cover everything a browser reaches, which is why the routes
that no browser reaches are the ones to watch: `/api/cron/tick` and Meta's
`deauthorize` and data-deletion callbacks have no session ahead of them and are
not wrapped, so each loads the snapshot itself. Missing that call does not fail
loudly — the route runs on environment values and silently ignores the config
screen, which for these three means a cron secret that reads as unset and Meta
callbacks rejected as unsigned. The short-link redirect is deliberately left
out: it reads no settings, and it is the hottest public path in the app.

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

## First run

A fresh deployment used to answer the browser with a sign-in form for an account
that does not exist. `/` and `/login` now send whoever just deployed it to
`/setup` while the database holds no accounts.

The checklist is **derived, never stored**. A wizard that remembers which step
you reached is wrong the moment anything changes underneath it — the last
connection is removed, credentials are rotated — and it cannot be resumed from a
different machine. `readSetupState` asks four counts and a setting on every
read, so a step that stops being satisfied simply reopens. The order is the
order things depend on each other: an account to sign in with, an app to
authenticate against, a connection made through it, a destination reached by it.

Two details are load-bearing. A destination counts only when it is both enabled
*and* publishable, because calling a Page ready when Facebook will not let this
account post there sends somebody off to write a post that cannot go out. And
credentials supplied through the environment count as done, since precedence is
database → environment → default and an installation configured by `.env` has
already finished that step.

`maySetUp` is the whole security of the screen, which is why it is a pure
function with its own tests rather than a condition inside two route handlers.
It is open while no account exists — requiring a sign-in to create the first
account is a deadlock — and owner-only from the first registration onwards. The
open door is keyed to a user count, the one fact about this that cannot be
faked from outside.

## Is the connection working?

The question people have after a post fails, answered in one place.
`src/lib/health.ts` asks Facebook three things and translates the answers:

- **The app itself** (`checkApp`). Worth asking separately, because when the app
  credentials are wrong *every* connection below reports failure and the screen
  shows eight problems instead of one. `checkWorkspace` stops there rather than
  listing consequences.
- **Each connection** — is the token valid, when does it die, and
  `/me/permissions` for what was granted. That endpoint says more than the token
  does: a permission that was *declined* appears there, where the token simply
  lacks it, and the two have different fixes.
- **Each destination** — a live read with the token actually stored for it.

The case that repays the whole feature is `granular_scopes`. Someone can grant
`pages_manage_posts` and then tick only three of their eight Pages in Facebook's
second dialog. The token carries the permission, so the account looks healthy,
and publishing fails on exactly the five that were left unticked. That is
undiagnosable from the outside, and it is the only thing Graph will tell you
about it.

That check is skipped for Instagram destinations, and the reason is a warning
about the whole feature. Facebook keys `granular_scopes` by **Page** id —
including for `instagram_content_publish`, because an Instagram account is
reached through its Page. An Instagram destination is addressed by its
Instagram user id, which is never in that list, so comparing the two told every
Instagram account it had been left unticked: confident, specific, actionable
and wrong, on the one screen whose whole job is to be trusted about exactly
this. A diagnosis that is wrong is worse than no diagnosis. Whether the
publishing permission is held at all is answered at the account level, where
the whole scope list is read.

Every line the screen shows names its own fix, and permissions are shown in
plain language with the scope name secondary — `pages_read_engagement` tells a
person nothing about whether they meant to refuse it. The checks are a button,
not a page render: a workspace with six Pages costs about ten Graph calls.

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

### Link clicks in a client report

A short link belongs to the post, not to any one destination, so there is no
way to know which Page earned a click. The per-destination column is therefore
a presentational split, not a measurement — but it still has to add up, because
a client reads this report and a table that sums to something other than the
headline beside it costs more credibility than the rounding ever bought.

Rounding each equal share on its own fails in both directions: five clicks
across two destinations rounds to three each and claims six that never
happened, ten across three rounds to three each and loses one. `spreadClicks`
hands the remainder out a click at a time instead — arbitrary in which
destination gets the extra, exact in the total.

The summary card and the per-destination table also count different things,
and used to say so with the same words. The card counts *posts*; the column
counts the times each destination was posted to, so one post to three Pages is
1 in the card and 1+1+1 in the column. Both figures are worth having — the
label was the bug, and a client reading "Posts published" twice with different
arithmetic under each has no way to know that.

Both CSV downloads name the file after the whole period rather than its last
day. Stamping only the end date gave the same name to every range ending
today, so a client sent last month and last quarter received two files called
the same thing and the browser renamed one without saying so. Nothing inside
the file records the range either.

An inverted range is refused rather than run, for the same reason the labels
matter: it returns nothing, and a report of nothing is indistinguishable from a
month in which the client's pages were silent, so a typo in the dates reads as
bad news about their account. The screen says so rather than falling back to a
default period — numbers that are real but for dates nobody asked for is the
one thing this page is best placed to hide.

**A day means a day where the client is.** The dates come from a date picker,
so "1 August" is a day on the workspace's calendar, not midnight UTC. Reading
them as UTC moved both boundaries by the offset: a Los Angeles workspace asking
for August got seven hours of 31 July at one end and lost the last seven hours
of 31 August at the other. The visible half was worse — the field redisplayed
their "1 August" as "31 July", because it renders the parsed instant back in
local time.

`parseReportRange` resolves a bare `YYYY-MM-DD` through `firstRealInstant`, so
a day that a clock change makes 23 hours long still starts at its first real
instant. The end of a range is the start of the next day minus a millisecond:
`23:59:59` would drop anything published in the final second and lands in the
wrong place in a zone that changes its clocks at midnight.

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
