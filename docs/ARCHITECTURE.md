# Architecture

Two processes share one database:

```
   Browser ──► Next.js app ──► database ◄── Scheduler worker ──► Graph API
                    │                                                │
                    └──────────── Graph API (immediate/native) ──────┘
```

The web app never waits on a scheduled publish; it writes rows. The worker owns
everything time-based. Both call Graph through the same client, so retry and
error-classification rules cannot drift apart.

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

SQLite has no `SELECT … FOR UPDATE`, and the same code must run on Postgres. So
claiming is a conditional update:

```ts
const { count } = await prisma.postTarget.updateMany({
  where: { id, status: 'pending' },        // only if still unclaimed
  data:  { status: 'processing', lockedAt: now, lockedBy: workerId },
});
return count === 1;                         // exactly one worker wins
```

Atomic on both engines, so multiple workers are safe.

**The one accepted risk:** a worker that dies *after* Facebook accepts a post but
*before* the row is updated leaves a lock that is reclaimed after 15 minutes and
retried — which can double-post. Facebook's own duplicate detection (error 506)
catches identical content. The alternative, never reclaiming, silently drops
posts, which is worse for a scheduling product.

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
| `SocialAccount` | A connected Facebook user; holds the long-lived user token |
| `Target` | A Page or Group; Pages carry their own token |
| `Post` | What was written, and when it should go out |
| `PostTarget` | One post × one destination: status, attempts, remote id, insights |
| `Media` | Uploaded files |
| `QueueSlot` | Recurring publishing times |
| `ActivityLog` | Audit trail |

Portability constraints: no enums and no native JSON columns, because SQLite
lacks both. Status fields are strings validated against the unions in
`src/lib/constants.ts`; structured payloads are JSON text parsed through
`src/lib/json.ts`, tolerantly — a row written by an older version degrades to a
fallback instead of crashing a page render.

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
