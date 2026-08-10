# Deployment

## Before going live

- [ ] `SESSION_SECRET` and `ENCRYPTION_KEY` generated fresh (`openssl rand -base64 48` / `-base64 32`)
- [ ] `APP_URL` uses https and matches the Meta app's OAuth redirect URI exactly
- [ ] Postgres instead of SQLite (see below)
- [ ] The scheduler runs — either `npm run worker` or a cron hitting `/api/cron/tick`
- [ ] Deauthorize and data-deletion callback URLs set in the Meta app and publicly reachable
- [ ] "Require app secret proof" enabled in the Meta app
- [ ] Backups cover the database **and** `MEDIA_DIR`
- [ ] `ENCRYPTION_KEY` stored somewhere you can recover it (see key rotation)

---

## Postgres

SQLite is fine for a single instance, but it does not tolerate several app
servers sharing a database. Switch in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

```env
DATABASE_URL="postgresql://user:password@host:5432/social_pilot?schema=public"
```

```bash
npm run db:migrate -- --name init
```

No model changes are needed — the schema deliberately avoids enums and native
JSON columns so one file is valid on both engines.

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

The worker handles SIGTERM by finishing the tick in flight, so a restart does
not abandon a post mid-publish.

Running several workers is safe — destinations are claimed atomically — but one
is enough until you are publishing thousands of posts an hour.

### Cron over HTTP (serverless)

Set `CRON_SECRET`, then call the endpoint on a schedule:

```bash
curl -X POST https://your-domain.com/api/cron/tick \
     -H "Authorization: Bearer $CRON_SECRET"
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
- **Token expiry.** Long-lived user tokens last ~60 days. The Accounts page
  reports real expiry via `/debug_token`. A production deployment should nag
  users before expiry rather than after; a weekly job over
  `SocialAccount.tokenExpiresAt` is the straightforward version.
- **Analytics.** `/api/analytics/refresh` deliberately refreshes 25 destinations
  per call, stalest first. These counters move slowly; refreshing everything on
  page load would burn the rate limit for nothing.
- **Backlogs.** Each tick takes `SCHEDULER_CONCURRENCY × 10` destinations, oldest
  scheduled first, so a backlog drains in the order users expect.

---

## Docker

```dockerfile
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json prisma ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
```

Run the worker as a second container from the same image with
`command: npm run worker`, sharing the database and the media volume.
