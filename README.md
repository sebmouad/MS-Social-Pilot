# MS Social Pilot

A SocialPilot-style scheduler for Facebook Pages and Groups. Compose once,
publish to many destinations, with approval workflow, RSS auto-posting, AI
writing help, link tracking and client reporting.

Next.js 15 (App Router), TypeScript, Prisma, PostgreSQL, Tailwind. English and
French.

Built to the specification in [docs/PROJECT_SCHEMA.md](docs/PROJECT_SCHEMA.md).

---

## What it does

**Publishing**
- Many Facebook Pages and Groups from one composer: text, links, photo
  galleries, video.
- **Instagram Business accounts** as destinations alongside them — single
  photo, reel, or carousel. Instagram's API takes a URL rather than an upload,
  so each attachment gets a signed link that names one file and expires in
  minutes; nothing in the media library becomes publicly readable.
- Per-destination outcomes. Publishing to five Pages where one token is dead
  succeeds on four and reports the fifth, rather than failing the batch.

**Scheduling** — three modes, because they fail differently:

| Mode | Who holds the post | Editable after saving | Works for Groups | Survives your server being down |
|---|---|---|---|---|
| Publish now | — | n/a | Yes | n/a |
| Scheduled (default) | This app | Yes | Yes | No — the worker must be running |
| Scheduled (native) | Facebook | No, cancel and recreate | No | Yes |

- A recurring **queue** ("post at my next free slot"), defined in workspace-local
  time and stable across daylight saving changes.
- Calendar view, bulk CSV scheduling, and **evergreen recycling** that rotates
  text variants so Facebook does not reject repeats as duplicates.
- Anything not yet sent can be **edited in place** — wording, attachments,
  destinations, time — in the composer it was written in. A post held for review
  goes back to the reviewer only if the edit changes what they looked at.

**Teams and clients**
- Several clients per account, each its own workspace with its own
  destinations, queue, branding and language.
- Roles: owner, admin, editor, contributor. Email invitations with hashed,
  expiring tokens.
- **Approval workflow**: contributors submit, admins approve or send back with a
  note. Enforced in the scheduler, not just the UI.

**Automation**
- **RSS auto-posting** with conditional polling, guid de-duplication, and a
  first-poll cutoff so subscribing to a blog does not queue its archive.
- **AI captions** via the Claude API, seeded by the workspace's brand voice.
- **Link shortener + UTM tagging** applied at publish time, per destination.

**Reliability**
- Retries with exponential backoff and jitter; rate limits back off much harder
  than transient errors.
- Failures that cannot succeed on retry — revoked token, missing permission,
  content Facebook rejected — fail immediately with an explanation.
- Email alerts on publish failure, dead connections, and tokens **approaching**
  expiry.
- Crashed workers release their locks; several workers can run safely.

**Engagement** — comments moderated from here (reply, hide, delete, each
writing to Facebook first), Page ratings, and the Page inbox with replies.
Facebook accepts a reply only within 24 hours of the person's last message, so
threads outside that window say so instead of offering a box that would refuse.

**Open Graph link previews** — Facebook's own scraper
(`POST /?id=<url>&scrape=true`), so you see exactly the card Facebook will
render and its cache is refreshed. Falls back to parsing `og:` tags directly.

**Reporting** — impressions, reach, engagement and link clicks per destination
and per post, with CSV export and a print-styled page for PDF.

---

## Quick start

Node 20.11+ (22 recommended) and PostgreSQL 14+.

```bash
npm install
cp .env.example .env
```

Generate the two secrets:

```bash
openssl rand -base64 48   # → SESSION_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY (must decode to exactly 32 bytes)
```

`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` come from your Meta app — see
[docs/META_APP_SETUP.md](docs/META_APP_SETUP.md), the fiddly part.

```bash
docker compose up -d postgres   # or point DATABASE_URL at your own
npm run db:migrate
npm run db:seed                 # optional: demo login, two workspaces
npm run dev                     # http://localhost:3000
npm run dev:worker              # second terminal
```

Both processes are needed: the web app schedules, the worker publishes.
Serverless alternative: `POST /api/cron/tick` — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Everything optional degrades cleanly. No `RESEND_API_KEY` means email is logged
as skipped rather than failing; no `ANTHROPIC_API_KEY` means the composer hides
the AI tools.

### Docker

```bash
docker compose up --build
```

Three services from one image: `web`, `worker`, `postgres`.

---

## Terminology

The original request asked for the "Facebook Open Graph API". Two different
things, both used here:

- **Graph API** — the REST API that creates posts (`POST /{page-id}/feed`).
- **Open Graph** — the `og:` metadata protocol describing a web page. Graph's
  scrape endpoint reads it to build link preview cards.

---

## The worker

Five jobs on independent intervals:

| Job | Default | What it does |
|---|---|---|
| `publish` | 30s | Publishes due posts |
| `rss` | 15m | Polls feeds, queues new items |
| `evergreen` | 1h | Creates the next copy of recycling posts |
| `analytics` | 6h | Refreshes engagement figures, stalest first |
| `tokens` | 24h | Warns before a token expires |

A failing job never stops the others. `POST /api/cron/tick?jobs=publish,rss`
runs a chosen subset over HTTP.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:worker` | Dev server / worker |
| `npm run build` / `npm start` | Production build and server |
| `npm run worker` | Worker (production) |
| `npm test` | Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` / `db:push` / `db:studio` / `db:seed` | Prisma |

---

## Tests

```bash
npm test
```

750 tests. Unit tests cover token encryption, retry policy, timezone and
queue-slot maths, Open Graph and RSS parsing, CSV in and out, link tagging, and
the Graph publishing decision table.

Four integration suites run against a real Postgres schema and a stub Graph API,
covering the failures that actually cost customers:

- **scheduler** — a post going out exactly once, backoff on transient errors, a
  revoked token failing permanently and flagging the account, partial success
  across destinations, abandoned locks reclaimed.
- **approvals** — an unapproved post never publishing even when due, "publish
  now" not bypassing review, and one client's workspace unable to read, post to
  or approve anything belonging to another.
- **jobs** — expiry warnings sent once per token and respecting opt-outs;
  evergreen creating a copy, rotating variants, and stopping at its limit.
- Invitations — wrong address refused, single use, expiry, last-owner
  protection.

One suite is a sweep rather than a list: `api-routes` walks every file under
`src/app/api`, calls each exported handler with no session, and fails unless it
refuses. A route that answers has to be added to a `PUBLIC` map with a written
reason, so a new endpoint is private until somebody says otherwise. A second
pass signs in as a contributor — the lowest role — and checks the endpoints that
act on the business rather than on their own drafts.

Tests need a reachable Postgres; each suite creates and drops its own schema.
Point `TEST_DATABASE_URL` at it if it is not the Compose default.

### The browser walk

None of the above renders a page. `e2e/` holds a Playwright pass over every
screen — in English and in French, signed in and signed out, with a post on the
calendar — that catches what only a browser can: a server component that throws,
a missing translation, a form that submits before React attaches to it.

Playwright is deliberately **not** a declared dependency; install it when you
want to run the walk. See [`e2e/README.md`](e2e/README.md).

---

## Project layout

```
src/lib/facebook/     Graph client, OAuth, publishing, Open Graph, insights
src/lib/scheduler/    Claiming, publishing, retry policy, job definitions
src/lib/rss/          Feed parsing and ingestion
src/lib/email/        Resend, templates, notification routing
src/lib/              Auth, posts, approvals, team, links, AI, reports, media
src/app/api/          REST endpoints
src/app/(app)/        Dashboard, composer, calendar, posts, approvals,
                      accounts, feeds, reports, settings
messages/             en.json, fr.json
scripts/worker.ts     The background worker
prisma/schema.prisma  Data model
```

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Important limitations

**Groups.** Meta restricted the Groups API in April 2024. `publish_to_groups`
needs separate approval, and a Group only appears if an admin has added your app
to it. Off by default (`FACEBOOK_ENABLE_GROUPS=false`). The code paths are
complete and work once you have the access — but do not plan a product around
Group publishing before confirming you can get it.

**App Review.** Publishing to Pages you do not own needs `pages_manage_posts`
approved by Meta. Until then the app works only for people with a role on it.
Days, not minutes.

**Instagram publishing** needs `instagram_content_publish`, a separate review
from the one that lets you read Instagram insights. Discovered accounts appear
as destinations but start turned off, saying so, until the permission is
granted — an Instagram destination offered before then would only be refused.
Instagram also has no scheduling of its own, so those posts always go out from
this app's worker rather than being handed over.

**Editing published posts.** Not supported, deliberately: Facebook cannot change
a published post's attachments, so "edit" would silently do less than it claims.

**Link clicks** are indicative, not audit-grade. Bot filtering is user-agent
based, and Facebook's own scraper is excluded so previews do not inflate counts.

---

## Security

- Access tokens encrypted at rest (AES-256-GCM, versioned envelope). No
  plaintext token is ever stored.
- Every Graph call signed with `appsecret_proof` — turn on "Require app secret
  proof" in your Meta app.
- Passwords use scrypt. Sessions and invitation tokens are stored hashed, so a
  database dump cannot be replayed.
- Workspace scoping is a security boundary between clients, with tests that a
  member of one cannot reach another.
- Uploaded media served through an authenticated route, not `/public`.
- Link preview fetches refuse loopback and private address ranges (SSRF).
- `signed_request` verified on Facebook's deauthorize and data-deletion
  callbacks.
- AI output never publishes on its own — it lands in the composer for a human.

Before going live, read the checklist in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
