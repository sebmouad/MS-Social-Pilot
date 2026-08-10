# Deployment

## Before going live

- [ ] `SESSION_SECRET` and `ENCRYPTION_KEY` generated fresh (`openssl rand -base64 48` / `-base64 32`)
- [ ] `APP_URL` uses https and matches the Meta app's OAuth redirect URI exactly
- [ ] Postgres reachable and migrated (`npm run db:migrate`)
- [ ] `RESEND_API_KEY` set and its sending domain verified, or failures go unreported
- [ ] `ANTHROPIC_API_KEY` set if AI captions are wanted (optional)
- [ ] `SHORTENER_DOMAIN` pointed at this app if link shortening is on (optional)
- [ ] The scheduler runs — either `npm run worker` or a cron hitting `/api/cron/tick`
- [ ] Deauthorize and data-deletion callback URLs set in the Meta app and publicly reachable
- [ ] "Require app secret proof" enabled in the Meta app
- [ ] Backups cover the database **and** `MEDIA_DIR`
- [ ] `ENCRYPTION_KEY` stored somewhere you can recover it (see key rotation)

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
curl -X POST "https://your-domain.com/api/cron/tick?jobs=analytics,tokens" -H "Authorization: Bearer $CRON_SECRET"
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
authenticated route.

On platforms with an ephemeral filesystem (Vercel, Heroku, most container
platforms), local files vanish on redeploy — and a scheduled post whose image
disappeared before its publish time will fail. Either mount a persistent volume,
or use externally hosted image URLs, which are passed to Facebook to fetch and
never touch local disk.

Moving to S3 means replacing the four functions in `src/lib/media.ts`
(`storeFile`, `readStoredFile`, `deleteStoredFile`, `resolveMediaForPublish`);
nothing else touches the filesystem.

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

For production, drop the `5432` port mapping on `postgres` (it is exposed only
for local `psql` and Prisma Studio) and put a TLS terminator in front of `web`.
