# Deployment

## Fresh Debian server, in one command

```bash
sudo bash scripts/install-debian.sh
```

Node.js 22, PostgreSQL 16, the build packages, a database and role, `.env` with
generated secrets, dependencies, migrations, a production build, and optional
systemd units for the web app and the worker. Re-runnable: each step checks for
its own result first, so a run after a failure resumes, and an existing `.env`
or an encryption key already in use is never overwritten.

Two units rather than one, because a slow publish must never block a page load
and either can be restarted alone:

```bash
systemctl status social-pilot social-pilot-worker
journalctl -u social-pilot-worker -f
```

**The worker is not optional.** Nothing publishes without it. The Setup screen
reports whether one has reported in within the last two minutes, which is the
one first-install mistake that otherwise looks like nothing at all — posts sit
at "scheduled" and no screen says why.

![The setup screen reporting the installation checks](images/setup.png)


Everything here assumes the Meta app already exists. If it does not, start with
[META_APP_SETUP.md](META_APP_SETUP.md) — that is the part that blocks people.

## Before going live

**Secrets and identity**

- [ ] `SESSION_SECRET` and `ENCRYPTION_KEY` generated fresh — `npm run setup`
      does both, or `openssl rand -base64 48` and `-base64 32` by hand
- [ ] `ENCRYPTION_KEY` stored somewhere you can recover it. Lose it and every
      stored Facebook token is unreadable — see [Key rotation](#key-rotation)
- [ ] `APP_URL` uses https and matches the Meta app's OAuth redirect URI
      **exactly**, trailing slash and all

**The things that publish**

- [ ] Postgres reachable and migrated (`npx prisma migrate deploy`)
- [ ] The scheduler runs — either `npm run worker` or a cron hitting
      `/api/cron/tick`. Without it, nothing scheduled is ever published
- [ ] "Require app secret proof" enabled in the Meta app
- [ ] Deauthorize and data-deletion callback URLs set, and reachable from
      outside your network
- [ ] If you publish to Instagram: `APP_URL` reachable from the public
      internet, because Facebook fetches your media itself
      ([why](#instagram-needs-app_url-to-be-publicly-reachable))

**Optional, but decide deliberately**

- [ ] `RESEND_API_KEY` set and its sending domain verified — otherwise nobody
      is told when a post fails
- [ ] `ANTHROPIC_API_KEY` if you want AI caption help
- [ ] `SHORTENER_DOMAIN` pointed at this app if link shortening is on
- [ ] Registration policy: closed by default, so create the first account
      yourself and invite colleagues. `OPEN_REGISTRATION=true` opens it

**When it breaks**

- [ ] Backups cover the database **and** `MEDIA_DIR` — they are two halves of
      one thing
- [ ] A monitor on `GET /api/health`, which round-trips to Postgres

The app's **Setup** screen checks several of these for you on a fresh
installation, and **Connections** shows, per account, which permissions were
actually granted and whether publishing works.

---

## Database

```env
DATABASE_URL="postgresql://user:password@host:5432/social_pilot?schema=public"
```

```bash
npm run db:migrate     # development
npx prisma migrate deploy   # production; the web container runs this on boot
```

Migrations run in the `web` container rather than the worker, so two containers
starting together cannot race to apply the same migration.

---

## Running the scheduler

Pick **one** of these.

### A long-lived worker (recommended)

```bash
npm run build
npm start &        # web
npm run worker &   # scheduler
```

systemd:

```ini
[Unit]
Description=MS Social Pilot scheduler
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/ms-social-pilot
EnvironmentFile=/srv/ms-social-pilot/.env
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

The worker handles SIGTERM by stopping new work and draining the jobs in
flight, so a restart does not abandon a post mid-publish. A second signal exits
immediately.

Running several workers is safe — destinations are claimed atomically — but one
is enough until you are publishing thousands of posts an hour.

### Cron over HTTP (serverless)

Set `CRON_SECRET`, then call the endpoint on a schedule:

```bash
curl -X POST https://your-domain.com/api/cron/tick \
     -H "Authorization: Bearer $CRON_SECRET"
```

`?jobs=publish,rss` restricts the run, so publishing can be called every minute
while analytics runs hourly from a separate schedule:

```bash
curl -X POST "https://your-domain.com/api/cron/tick?jobs=publish" -H "Authorization: Bearer $CRON_SECRET"
curl -X POST "https://your-domain.com/api/cron/tick?jobs=analytics,edges,tokens" -H "Authorization: Bearer $CRON_SECRET"
```

Vercel (`vercel.json`):

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "* * * * *" }] }
```

Vercel Cron sends no custom headers, so on Vercel either use `CRON_SECRET` with
an external scheduler, or gate the route on Vercel's own cron header instead.

Note the resolution limit: cron granularity is your publishing accuracy. At one
minute, a post scheduled for 09:00 goes out by 09:01. The worker polls every
`SCHEDULER_POLL_SECONDS` (default 30).

Do not run both a worker and cron. It is safe — they cannot double-publish — but
it wastes work.

---

## Media storage

Uploads go to `MEDIA_DIR` (default `./media`) and are served through an
authenticated route, not from `/public`. Unpublished campaign artwork should
not be fetchable by whoever guesses a filename.

**Give it a persistent volume.** On platforms with an ephemeral filesystem
(Vercel, Heroku, most container platforms) local files vanish on redeploy, and
a scheduled post whose image disappeared before its publish time fails at the
moment it was due. The alternative is externally hosted image URLs, which are
handed to Facebook to fetch and never touch local disk.

**Back it up with the database.** They are two halves of one thing: a database
restored next to an empty media directory gives you a calendar full of posts
whose pictures are gone.

### Instagram needs `APP_URL` to be publicly reachable

This one catches people out. Facebook's Instagram API takes no file upload — it
takes a URL and fetches the file itself, from its own servers. So an
installation that Facebook cannot reach can publish to Pages perfectly well and
fail every Instagram post.

The link it fetches is minted per publish: it names one file, is signed, and
expires in thirty minutes (`src/lib/media-links.ts`). Nothing in the media
library becomes publicly readable, and no long-lived public URL is ever stored.
But the route has to be reachable for the length of that one fetch.

If you publish to Instagram, check that `https://your-domain/api/health`
answers from outside your network before wondering why.

### Moving to S3

Replace the storage functions in `src/lib/media.ts` — `storeFile`,
`readStoredFile`, `openStoredFile`, `deleteStoredFile` — and the two resolvers
that hand media to Facebook, `resolveMediaForPublish` and
`resolveMediaForInstagram`. Nothing else in the codebase touches the
filesystem.

With object storage you could serve Instagram's fetch from a pre-signed S3 URL
instead, and skip `signMediaUrl` entirely.

---

## Ports

The app listens on **`PORT`, 3000 by default**, on the interface named by
**`HOST`**, and it speaks **plain HTTP**. There is no certificate handling in
it, so **443 is a proxy's job** — see the next section. Under Docker, `PORT`
inside the container is fixed at 3000 and `APP_PORT` chooses the host port the
mapping publishes.

`APP_URL` is a separate question and is the *public* address. Behind a
terminator the two differ on purpose: the app listens on 3000 and the world
sees `https://your.domain`. Nothing is derived from the request, so `APP_URL`
has to be right on its own.

To serve directly with no proxy, set `PORT=80`. Ports below 1024 are
privileged, and the honest choices are:

```bash
# Grant the capability once, and keep running as an ordinary user.
sudo setcap 'cap_net_bind_service=+ep' "$(command -v node)"
```

The systemd unit written by `scripts/install-debian.sh` already carries
`AmbientCapabilities=CAP_NET_BIND_SERVICE`, which does the same thing for that
unit alone and is narrower than the `setcap` above. Running the whole app as
root to reach port 80 is the option to avoid.

`HOST=127.0.0.1` binds loopback only, which is what you want when a proxy on
the same machine is the only thing that should reach it.

## Behind a reverse proxy

The contract is short, and it is short on purpose.

**Nothing is derived from the request's `Host`.** Every absolute URL the app
produces — OAuth redirects, short links, every link in an email — is built from
`APP_URL`. So a proxy does not have to forward `X-Forwarded-Host` or
`X-Forwarded-Proto` for links to come out right, and a forged `Host` header
cannot rewrite the invitation link in an email to a colleague. The cost is that `APP_URL`
must be correct: it is the app's only idea of where it lives.

**Cookies are marked `secure` when `NODE_ENV=production`,** not when the request
happens to arrive over TLS. Behind a terminator the app itself sees plain http,
and deriving the flag from the request would quietly drop `secure` on every
session cookie in exactly that deployment. The Docker image sets `NODE_ENV`, and
`next start` sets it too.

**`X-Forwarded-For` is read in two places**, and it is worth knowing what each
one does with it:

- The **short-link redirect** hashes it for click counts. Forwarding it makes
  those counts more accurate; forging it skews an estimate and nothing else.
- The **sign-in route** uses it as one of two rate-limit keys. The other key is
  the email address being tried, and that one is the load-bearing half: it
  cannot be forged, and it is what stops somebody grinding through passwords
  for a known account. The client key exists to slow down a spray across many
  addresses, and a forged header does evade *that* half — so put the app behind
  a proxy that overwrites the header rather than appending to it, which is the
  default for most.

Neither value ever reaches an authorisation decision. Nothing about who you are
or what you may do is derived from a header.

---

## Health checks

`GET /api/health` is unauthenticated and returns `{"status":"ok"}` with a 200,
or 503 when the database cannot be reached. Point a load balancer, an uptime
monitor or a container probe at it.

It round-trips to Postgres deliberately. A container that has booted but cannot
reach the database serves errors on every page, and a check that only proves the
process is alive would call that healthy. It deliberately returns nothing else —
no version, no hostname, no error text — because everything that can reach the
port can read it.

---

## Key rotation

`ENCRYPTION_KEY` decrypts every stored access token. **Changing it makes every
stored token unreadable and every connected account must be reconnected.**

To rotate without that: decrypt with the old key and re-encrypt with the new one
in a single migration script, over `SocialAccount.accessToken` and
`Target.accessToken`. The ciphertext envelope carries a `v1:` version prefix so a
migration can tell old rows from new.

`SESSION_SECRET` is safer: rotating it only signs out every user and invalidates
any in-flight OAuth state.

---

## Scaling notes

- **Rate limits.** Meta's Pages limits are per app and per Page. `x-app-usage` is
  parsed on every response; if you approach the ceiling, lower
  `SCHEDULER_CONCURRENCY` before Meta starts throttling — a code 4 costs a
  15-minute backoff.
- **Token expiry.** Long-lived user tokens last ~60 days. The `tokens` job warns
  by email seven days out, once per token, and the Accounts page reports real
  expiry via `/debug_token`. This is what prevents the classic silent failure —
  a token dying and nobody noticing until a client asks why their page went
  quiet.
- **Analytics.** The `analytics` job refreshes 50 destinations per run, stalest
  first (`/api/analytics/refresh` does 25 on demand). These counters move
  slowly; refreshing everything on page load would burn the rate limit for
  nothing.
- **Edges.** The `edges` job (4h) reads comments, ratings, inbox threads, videos
  and posts published outside this app. It caps comments at the 25 newest posts
  per Page and video insights at 10 videos, so one pass over one Page stays
  bounded however much history the Page has.
- **Housekeeping.** The `housekeeping` job (24h) does two sweeps. It deletes
  uploads that were never attached to a post and are older than
  `media.retainUnusedDays` (30 by default) — a file referenced by any post is
  kept for good, whatever that post's status, because deleting one a published
  post still renders turns history into broken images. And it prunes the
  append-only tables on their own windows: activity log and email log at 180
  days, click detail and AI generations at 365. The RSS de-duplication ledger
  and the insight snapshots are never pruned; see the architecture notes for
  why.
- **Instagram and Ads.** Both are off unless `FACEBOOK_ENABLE_INSTAGRAM` /
  `FACEBOOK_ENABLE_ADS` is set, and the worker does not schedule the job at all
  while the flag is off — running it unapproved would spend the rate limit on a
  permission error every pass. Turn the flag on only once Meta has approved
  `instagram_manage_insights` / `ads_read` for the app.
- **Backlogs.** Each tick takes `SCHEDULER_CONCURRENCY × 10` destinations, oldest
  scheduled first, so a backlog drains in the order users expect.
- **AI spend.** `AI_RATE_LIMIT_PER_HOUR` is per workspace. Every call is recorded
  in `AiGeneration` with token counts — query it before assuming a bill is wrong.
- **Email deliverability.** Resend will not send to arbitrary addresses until
  the sending domain is verified. Until then invitations and failure alerts are
  logged as failed in `EmailLog`, not silently dropped.

---

## Docker

`Dockerfile` and `docker-compose.yml` are in the repository root:

```bash
docker compose up --build
```

Three services from one image — `web`, `worker`, `postgres` — with named
volumes for the database and for `MEDIA_DIR`. The worker is the same image with
`command: npm run worker`, so it can never drift out of sync with the code that
scheduled the work.

The worker waits for `web` to be **healthy**, not merely started. `web` applies
the migrations, and starting is not the same as having finished them: waiting
only for the container left the worker polling tables that did not exist yet,
crashing and restarting until the migration landed. It recovered on its own, but
every first boot spent a minute producing alarming logs.

For production, drop the `5432` port mapping on `postgres` (it is exposed only
for local `psql` and Prisma Studio) and put a TLS terminator in front of `web`.
