# MS Social Pilot

## Active rebuild

The replacement application lives in [`rebuild/`](rebuild/). Codex and Claude must read [AGENTS.md](AGENTS.md), the [architecture contract](rebuild/docs/ARCHITECTURE_CONTRACT.md), and [implementation architecture](rebuild/docs/ARCHITECTURE.md) before working on it. The instructions below describe the legacy production application. Rebuild cutover follows [rebuild/docs/CUTOVER.md](rebuild/docs/CUTOVER.md).

A self-hosted social media scheduler and analytics tool for agencies that run
many Facebook Pages, plus Instagram, Bluesky, Mastodon, LinkedIn, Threads, X,
Pinterest, YouTube, TikTok and Telegram. Write once and publish to many
channels; plan on a calendar and queue; answer comments and messages in one
inbox; analyse every channel together; send branded reports; run several client
workspaces with roles, approvals and client links. The first account to sign up
is root and configures the installation from its own section.

Documentation is in [docs/](docs/README.md): features, architecture,
permissions, design rules, operations (tests and deploy), Graph API notes and
the open plan.

## Quick start

Requires Docker, or Node 22 with PostgreSQL 14 or later.

```bash
npm install
npm run setup          # writes .env and generates the secrets; safe to re-run
docker compose up -d   # Postgres, web app and worker on http://localhost
```

Without Docker, with your own Postgres in `DATABASE_URL`:

```bash
npm run db:migrate
npm run dev            # http://localhost:3000
npm run dev:worker     # second terminal: nothing publishes without the worker
```

Then open the app, create the first account (it becomes root), and enter the
Meta app ID and secret in Root › Platforms › Meta. Other networks, AI providers
and email are set up in the same section; everything optional stays hidden
until it is configured. A fresh Debian server installs with
`sudo bash scripts/install-debian.sh` (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).

## Tests

```bash
npx tsc --noEmit
env TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npx vitest run
```

The Playwright browser walk and its setup are described in
[docs/OPERATIONS.md](docs/OPERATIONS.md).

## Security in brief

Tokens encrypted at rest; every Graph call signed with `appsecret_proof`;
passwords hashed with scrypt; sessions and invitation tokens stored hashed;
two-step sign-in and passkeys; workspaces isolated and tested as a security
boundary; every API route tested to refuse anonymous callers; server-side
fetches protected against SSRF; cross-site API writes refused; AI output never
publishes on its own.
