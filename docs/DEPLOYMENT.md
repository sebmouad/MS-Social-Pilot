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
- [ ] The Application URL (`app.url`, set by root on `/root/config`; the
      `APP_URL` variable still works as a fallback) uses https and matches the
      Meta app's OAuth redirect URI **exactly**, trailing slash and all
- [ ] Behind Cloudflare, a tunnel or a reverse proxy: `TRUST_PROXY="true"` in
      `.env` — Docker included, it is read from there — and the proxy is the
      only way in. Unset, every visitor looks like the proxy
      ([why](#behind-a-reverse-proxy))
- [ ] Docker: `POSTGRES_PASSWORD` set (`npm run setup` does it), and the
      Postgres port mapping removed ([Docker](#docker))

**The things that publish**

- [ ] Postgres reachable and migrated (`npx prisma migrate deploy`)
- [ ] The scheduler runs — either `npm run worker` or a cron hitting
      `/api/cron/tick`. Without it, nothing scheduled is ever published
- [ ] "Require app secret proof" enabled in the Meta app
- [ ] Every value in the **Meta app settings** panel (on Setup, and on
      Connections for an admin) entered in the Meta app: app domain, site URL,
      OAuth redirect URI, deauthorize and data-deletion callbacks. The panel
      builds them from `APP_URL` and warns if it is not https or is localhost
- [ ] Deauthorize and data-deletion callback URLs reachable from outside your
      network — Meta calls them from its own servers
- [ ] The Meta app's API version at least the one the app pins
      (`FACEBOOK_GRAPH_VERSION`, **v25.0** by default, supported until
      29 July 2028). An old `.env` pinning `v21.0` stops working on
      21 January 2027 — see
      [what Meta has retired](META_APP_SETUP.md#what-meta-has-retired)
- [ ] A Privacy Policy URL in the Meta app (Settings → Basic) — required
      before the app can go Live, and not something this app publishes for you
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
- [ ] A monitor on `GET /api/health`, which round-trips to Postgres and
      reports whether the worker is alive ([details](#health-checks))

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

The app listens on **`PORT`, 80 by default**, on the interface named by
**`HOST`**, and it speaks **plain HTTP**. There is no certificate handling in
it, so **443 is never this process's port** — HTTPS is terminated in front of
it, by Cloudflare or another proxy.

Port 80 is privileged. The systemd unit written by `scripts/install-debian.sh`
carries `AmbientCapabilities=CAP_NET_BIND_SERVICE`, which lets that one unit
bind it while still running as an ordinary user. Outside systemd, grant the
capability once:

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(command -v node)"
```

Running the whole app as root to reach port 80 is the option to avoid.

Set `PORT=3000` when something else on the machine already owns 80 — a local
nginx, or another site. `HOST=127.0.0.1` binds loopback only, which is right
when a proxy or a Cloudflare Tunnel on the same machine is the only thing that
should reach the app.

Under Docker the container port is fixed at 3000 and **`APP_PORT`** chooses the
host port the mapping publishes, so the healthcheck and the worker never depend
on what was chosen outside.

`APP_URL` is a separate question and is the **public** address. Behind a
terminator the two differ on purpose: the app listens on 80 and the world sees
`https://your.domain`. Nothing is derived from the incoming request, so
`APP_URL` has to be right on its own.

## Cloudflare

The arrangement Cloudflare is used for here: DNS record proxied (orange cloud),
Cloudflare answers 443 with its own certificate, and forwards to this server.

```
PORT="80"
TRUST_PROXY="true"
```

and the Application URL `https://your.domain` on `/root/config`.

**Set the SSL/TLS mode to Full, not Flexible.** Flexible makes the hop from
Cloudflare to your server plain HTTP across the open internet, which is where
session cookies and Facebook tokens travel. Two ways to avoid it:

- **Cloudflare Tunnel** (`cloudflared`) — the server opens an outbound
  connection and needs no inbound port at all. Set `HOST=127.0.0.1` so nothing
  else can reach the app, and point the tunnel at `http://127.0.0.1:80`. This is
  the option to prefer: the origin is not exposed, so there is no origin address
  to find and connect to directly.
- **An origin certificate** — issue one in Cloudflare, install it on the server
  behind a small terminator, and set the mode to Full (strict).

**Do not enable Cloudflare's caching or minification for this app.** Every page
is dynamic and behind a session; a cached response served to a second visitor is
another workspace's calendar. Leave the default "bypass cache on cookie"
behaviour alone, and if you add a Cache Rule, exclude `/api/*` explicitly.

**Facebook's OAuth redirect goes through Cloudflare like everything else.** The
redirect URI registered in the Meta app must be the `https://` address on your
domain, matching `APP_URL` exactly.

**`cf-connecting-ip` is read in preference to `x-forwarded-for`.** Cloudflare
overwrites its own header on every request, while `x-forwarded-for` arrives as
a list beginning with whatever the visitor sent — so behind Cloudflare the
first is the one a visitor cannot choose for themselves. The next section says
what the app does with an address.

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

**`TRUST_PROXY` must be set for any forwarding header to be read.** Unset (the
default), `cf-connecting-ip`, `x-forwarded-for` and `x-real-ip` are all
ignored: anyone who can reach the app directly can write them, and believing
them let one machine claim a fresh address for every sign-in attempt. Set
`TRUST_PROXY="true"` behind Cloudflare, a tunnel or a reverse proxy — and then
make sure the proxy is the *only* way in (`HOST=127.0.0.1`, or a firewall that
admits only the proxy), or the headers are no more trustworthy than before.
Without it the sign-in limit keys on the email address alone, and short-link
clicks are counted without an address.

**`X-Forwarded-For` is read in two places**, and it is worth knowing what each
one does with it:

Both read it through `clientIp` in `src/lib/client-ip.ts`, which takes
`cf-connecting-ip` first, then the left-most entry of `x-forwarded-for`, then
`x-real-ip`. One function rather than a copy each, because a header added for
one of them would otherwise not reach the other.

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

`GET /api/health` is unauthenticated and returns a 200, or a 503 with
`{"status":"unavailable"}` when the database cannot be reached. Point a load
balancer, an uptime monitor or a container probe at it.

```json
{ "status": "ok", "worker": { "status": "ok", "lastBeatSeconds": 12 } }
```

It round-trips to Postgres deliberately. A container that has booted but cannot
reach the database serves errors on every page, and a check that only proves the
process is alive would call that healthy.

`worker` reports the newest heartbeat from any scheduler worker: `ok` when one
wrote within the last two minutes, `stale` when the newest is older, `missing`
when none ever has, and `unknown` when the table cannot be read yet (a first
boot before migrations finish). **It never changes the status code.** The code
answers "is this web process healthy", which a stopped worker does not change —
and Docker restarting `web` would not fix it. To be alerted when publishing
stops, have your monitor check `worker.status == "ok"` in the body.

It deliberately returns nothing else — no version, no hostname, no worker id, no
error text — because everything that can reach the port can read it.

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
npm run setup          # writes .env, including POSTGRES_PASSWORD
docker compose up --build
```

`POSTGRES_PASSWORD` is **required**: Compose refuses to start without it rather
than falling back to a well-known password. `npm run setup` generates one (hex,
so it is safe inside a connection string); by hand, `openssl rand -hex 24`. The
`web` and `worker` containers build their own `DATABASE_URL` from it, so the
`DATABASE_URL` in `.env` only matters to things run on the host.

Postgres applies the password only when its volume is **first created**. On a
stack that was started before this was required, the database still has the
old `postgres` password: either set `POSTGRES_PASSWORD=postgres` to keep it, or
change it in place and then set the new value —

```bash
docker compose exec postgres psql -U postgres -c "ALTER USER postgres PASSWORD 'new-value'"
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

Postgres is published on **`127.0.0.1` only** (`POSTGRES_HOST_PORT`, 5432 by
default), for `psql`, Prisma Studio and `npm run dev` on the same machine. It is
never bound to every interface: a database on `0.0.0.0` is reachable by
anything that can reach the host. For production, delete the mapping entirely —
`web` and `worker` reach Postgres over the compose network — and put a TLS
terminator in front of `web`.

**Behind a proxy, set `TRUST_PROXY="true"` in `.env`.** The compose file does
not set it, because it publishes `web` on every interface and anyone reaching
that port directly could forge the forwarding headers. When the proxy is on the
same host, also change the `web` mapping to `'127.0.0.1:${APP_PORT:-80}:3000'`
so the proxy really is the only way in. See
[Behind a reverse proxy](#behind-a-reverse-proxy).

The image carries its own `HEALTHCHECK` against `/api/health`, so a plain
`docker run` or another orchestrator gets the same probe Compose runs. The
`worker` service disables it, because no web server listens in that container.

**The build context is filtered by `.dockerignore`.** `.env`, uploaded media,
`node_modules`, `.next`, the test output and the git history never reach the
build, and so never land in an image layer. If you add a file the build needs
at a new top-level path, check it is not excluded there.

**A production container refuses to start with a bad `SESSION_SECRET`.** At
server start (`src/instrumentation.ts`) the app checks that `DATABASE_URL`,
`ENCRYPTION_KEY` and `SESSION_SECRET` are set and that the session secret is
at least 32 characters, and exits with a message naming the variable. Before,
the same mistake surfaced as a 500 on the first page somebody opened. In
development the same check only warns.
