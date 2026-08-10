# MS Social Pilot

A SocialPilot-style scheduler for Facebook. Compose once, pick any number of
Facebook Pages and Groups, and have the post published at the time you choose —
with per-destination status, automatic retries, and link previews built from the
page's Open Graph tags.

Built with Next.js 15 (App Router), TypeScript, Prisma and Tailwind. Runs on
SQLite out of the box; Postgres is a one-line change.

---

## What it does

**Publishing**
- Post to many Facebook Pages and Groups from one composer.
- Text, links, photos (single or as a gallery) and video.
- Per-destination outcomes: publishing to five Pages where one token is dead
  succeeds on four and reports the fifth, instead of failing the batch.

**Scheduling** — three modes, because they fail differently:

| Mode | Who holds the post | Editable after saving | Works for Groups | Survives your server being down |
|---|---|---|---|---|
| Publish now | — | n/a | Yes | n/a |
| Scheduled (default) | This app | Yes | Yes | No — the worker must be running |
| Scheduled (native) | Facebook | No, must cancel and recreate | No | Yes |

- A recurring **queue** ("post this at my next free slot"), defined in workspace-local
  time and stable across daylight saving changes.
- A calendar view, and bulk scheduling from CSV.

**Reliability**
- Failed publishes retry with exponential backoff and jitter; rate limits back
  off far harder than transient errors.
- Failures that cannot succeed on a retry — a revoked token, a missing
  permission, content Facebook rejected — fail immediately with an explanation
  rather than burning attempts.
- A dead token flags the whole connection, so the UI tells you to reconnect
  instead of letting every scheduled post discover it separately.
- Crashed workers release their locks; multiple workers can run safely.

**Open Graph link previews**
- Uses Facebook's own scraper (`POST /?id=<url>&scrape=true`) so you see exactly
  the card Facebook will render, and so Facebook's cache is refreshed — the fix
  for "my preview shows the old headline".
- Falls back to fetching and parsing the page's `og:` tags directly.

**Analytics** — impressions, reach, engaged users, reactions, comments and shares
per published post.

---

## Quick start

Requires Node 20.11+ (Node 22 recommended).

```bash
npm install
cp .env.example .env
```

Fill in `.env`. The two secrets can be generated right now:

```bash
openssl rand -base64 48   # → SESSION_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY (must decode to exactly 32 bytes)
```

`FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` come from your Meta app — see
[docs/META_APP_SETUP.md](docs/META_APP_SETUP.md), which is the fiddly part.

Then:

```bash
npm run db:push     # create the database
npm run db:seed     # optional: a demo login
npm run dev         # web app on http://localhost:3000
npm run dev:worker  # scheduler, in a second terminal
```

Both processes are needed: the web app schedules posts, the worker publishes
them. (Serverless alternative: `POST /api/cron/tick` — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).)

Register at `/register`, then connect Facebook on the Accounts page.

---

## Terminology

The user-facing request for this project asked for the "Facebook Open Graph API".
Two different things are involved, and both are used here:

- **Graph API** — the REST API that creates posts (`POST /{page-id}/feed`). This
  is what publishes.
- **Open Graph** — the `og:` metadata protocol that describes a web page. The
  Graph API's scrape endpoint reads it to build link preview cards.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run dev:worker` | Scheduler worker, restarting on changes |
| `npm run worker` | Scheduler worker (production) |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Vitest suite (unit + integration) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Apply the schema (development) |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:studio` | Prisma Studio |
| `npm run db:seed` | Demo workspace and login |

---

## Tests

```bash
npm test
```

92 tests. The unit tests cover token encryption, the retry policy, timezone and
queue-slot maths, Open Graph parsing, CSV parsing and the Graph publishing
decision table.

`tests/scheduler.integration.test.ts` runs the real scheduler against a real
SQLite database and a stub Graph API, and covers the cases that actually matter
in a scheduling product: a post going out exactly once, a transient error
retrying with a backoff, a revoked token failing permanently and flagging the
account, partial success across destinations, and an abandoned lock being
reclaimed.

---

## Project layout

```
src/lib/facebook/     Graph client, OAuth, publishing, Open Graph, insights
src/lib/scheduler/    Claiming, publishing, retry policy
src/lib/              Auth, posts, accounts, media, time, validation
src/app/api/          REST endpoints
src/app/(app)/        Dashboard, composer, calendar, posts, accounts, settings
scripts/worker.ts     The scheduler process
prisma/schema.prisma  Data model
```

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Important limitations

**Groups.** Meta restricted the Groups API in April 2024. `publish_to_groups`
requires separate approval, and a Group only appears at all if a Group admin has
added your app to it. Group support is therefore **off by default**
(`FACEBOOK_ENABLE_GROUPS=false`). The code paths are complete and will work once
your app has the access — but do not plan a product around Group publishing
without confirming your app can get it.

**App Review.** Publishing to Pages you do not own requires `pages_manage_posts`
to be approved by Meta. Before that, your app works only for users with a role on
it (admin/developer/tester). This is a process measured in days, not minutes.

**Editing published posts.** Not supported, deliberately: Facebook cannot change
a published post's attachments, so "edit" would silently do less than it claims.
Cancel and repost instead.

---

## Security notes

- Access tokens are encrypted at rest with AES-256-GCM; nothing stores a
  plaintext token.
- Every Graph call is signed with `appsecret_proof`, so a stolen token is useless
  without the app secret. Turn on "Require app secret proof" in your Meta app.
- Passwords use scrypt; sessions are database-backed and stored as hashes, so
  logout revokes immediately and a database dump cannot be replayed.
- Uploaded media is served through an authenticated route, not from `/public`.
- The link-preview endpoint refuses loopback and private address ranges (SSRF).
- The `signed_request` on Facebook's deauthorize and data-deletion callbacks is
  verified before it is acted on.

Before going live, read the deployment checklist in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
