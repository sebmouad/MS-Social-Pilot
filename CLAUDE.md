# Working in MS Social Pilot

Next.js 15 + Prisma/PostgreSQL app in `app/`. Architecture, module map and contracts: [`AGENT.md`](AGENT.md) — read
it first. This file holds what a new session needs on top: how to verify, how releases reach the server, and where
the current work (Meta App Review) stands.

Work on `main` and push there. Never commit or print secrets (app secrets, passwords, tokens); the Meta reviewer
account's password lives only in Meta's submission form.

## Verify before every commit (from `app/`)

```bash
npm ci                 # dependencies are not vendored
npx prisma generate
npm run typecheck
npm test               # node:test via tsx: tests/**/*.test.ts (Meta Graph calls, GitHub webhook)
npm run build
```

Commit messages say what was verified and what was not run.

## Releases and auto-update

- `app/scripts/deploy-from-server.sh` (installed on the server as `socialpilot-deploy`) and `app/scripts/deploy.sh`
  build apart, run `npm test`, apply SQL migrations in `app/prisma/migrations/`, switch releases, check health and roll
  back on failure. They also install the updater timer.
- Auto-update: GitHub calls `POST /api/updates/github` on each push (HMAC-checked with Root secret
  `updates.githubWebhookSecret`); a push to `updates.branch` (default `main`) of `updates.repository` is recorded in
  `app_updates` while `updates.automatic` is on. The root timer `social-pilot-updater` (every 30 s) runs
  `app/scripts/updater.sh`, which deploys that commit with its own deploy script and writes the result back.
  Root › Updates shows the running version, the history and « Update now ».
- **Activation status (2026-11-09): not active yet.** It needs, once: (1) one manual deploy of current `main`
  (installs the timer), (2) Root › Configuration › Updates: save a webhook secret and turn on « Install GitHub pushes
  automatically », (3) GitHub › sebmouad/MS-Social-Pilot › Settings › Webhooks › Add webhook: payload URL
  `https://social.newsgeet.com/api/updates/github`, content type `application/json`, the same secret, push events
  only. Root › Updates says whether the webhook secret is set. Claude cannot add the GitHub webhook (no tool for it).

## Local end-to-end runs (no real Meta)

`app/tests/e2e/` drives the real app against a fake Meta, over HTTPS like production. Everything is local-only
(scripts refuse a non-local `DATABASE_URL`).

1. PostgreSQL: `service postgresql start`; create a database, apply every `prisma/migrations/*/migration.sql` in order.
2. Env: `DATABASE_URL`, `ENCRYPTION_KEY` (**base64 of 32 bytes**: `openssl rand -base64 32`), `SESSION_SECRET`,
   `NODE_ENV=production`, and `NODE_EXTRA_CA_CERTS=<cert.pem>` so the app trusts the fake Meta.
3. Self-signed cert for `localhost`; `node tests/e2e/fake-meta.mjs 4600 cert.pem key.pem` (Graph + login dialog;
   `/__test/comment`, `/__test/message` simulate a visitor, `/__test/state` shows what was sent);
   `node tests/e2e/https-proxy.mjs 3443 3200 cert.pem key.pem`; `npm run build && npx next start -p 3200`.
4. `node --import tsx tests/e2e/seed-owner.ts <email> <password>` then
   `node --import tsx tests/e2e/configure-fake-meta.ts <email> https://localhost:3443 https://localhost:4600`.
5. `mkdir -p /var/lib/ms-social-pilot/media` (default `storage.mediaRoot`).
6. The owner must enroll two-step (authenticator code from the setup key) before Root and connections work.

Drive it with Playwright (pre-installed). Every flow below has been run this way.

## Current project: Meta App Review resubmission

Guide for the user (submission text, recording scripts, checklists):
https://claude.ai/artifact/NhkTtdKNASCrYEhpy3biKN — keep it in sync when screens change.

Meta app MS-Social-Pilot (ID 699780715171676), type Business, Facebook Login for Business, development mode.
Data controller: ANASSO TRAVAUX, Morocco. Reviewer app account: `meta-review@newsgeet.com` (password not stored here).

- 2026-10-24 verdict: approved `pages_show_list`, `business_management` (+ `public_profile`); refused
  `pages_read_engagement`, `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `read_insights`,
  `ads_read` — recordings did not show the full login, the grant and the use end to end, in English with captions.
  The first videos (release `meta-review-screencasts-2026-10-10`) were 1280 px, partly French, uncaptioned, idle for
  minutes, showed no visitor comments, no Instagram and an empty ad account.
- Resubmission scope: 14 permissions — the 6 refused plus `pages_messaging`, `pages_manage_metadata`,
  `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`,
  `ads_management` (and keep `business_management`). **One recording per permission** (Meta's guide).
  The October `ads_read` text says the app never creates ads: rewrite it, the app now creates paused campaigns.
- Decisions: two-step sign-in set to « off » in Root for the review window, back to « admins » after approval.
  Recordings: Claude records the app screens (1920×1080, English captions naming the permission, box on each click);
  the user records the Facebook / Instagram / Ads Manager parts (clips F1–F6 in the guide); Claude assembles 14 videos.

### Phase 1 — done (2026-11-09), on `main`, not yet deployed

Login asks for all 14 permissions plus Meta's dependencies (`withScopeDependencies`); optional `meta.loginConfigId`
(config_id). Pages subscribed to webhooks on connect. Messenger replies use the Send API (`POST /{page}/messages`).
One « Connect Facebook » brings Pages, their Instagram accounts and ad accounts, pre-ticked. « Publish now » sends at
once and stores the post link (« View on Facebook/Instagram »). « Sync now » on Insights and Ads. Photo uploads work
by default (media root default, media share secret generated). Deauthorize/data deletion erase Facebook and linked
Instagram tokens. Plain wording on Channels; network shown on composer chips. Auto-update (above).

### Phase 2 — next

1. User: deploy `main`; fill Root › Public site › Operator details (address, privacy email, law, host,
   `legalUpdated`); set two-step off; link an Instagram professional account to the test Page (the test Page, a second
   Facebook user and an ad account with a campaign exist); add `SP_URL`, `SP_USER`, `SP_PASSWORD` to the cloud
   environment for Claude.
2. Claude: check every screen on social.newsgeet.com in English (Playwright, login from `SP_*`, never printed), fix
   what a reviewer would not understand, then record the app parts per the guide's scripts R1–R8.
3. User records F1–F6 (Facebook in English, app removed from Facebook's Apps and websites first so the grant is
   first-time); Claude cuts, captions and joins them into 14 videos; the user submits with the guide's texts and the
   reviewer instructions (current screen names, not the October ones).
