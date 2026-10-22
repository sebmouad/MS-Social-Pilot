# Social Pilot (rebuild)

**Start here:** [agent instructions](AGENTS.md), [mandatory architecture contract](docs/ARCHITECTURE_CONTRACT.md), and [current implementation/gaps](docs/ARCHITECTURE.md). The contract defines the target; partial implementation is not a replacement specification.

**Continue work:** [active goal](docs/GOAL.md), [delivery plan](docs/DELIVERY_PLAN.md), and [shared Codex/Claude memory and handoff](docs/AGENT_HANDOFF.md). Keep these in Git with each material delivery update; revalidate recorded state before acting.

This is the live MS Social Pilot application (Next.js), serving production at `social.newsgeet.com`. The legacy application was removed from this repository and from the server on 2026-10-22 (lane 47); this tree is the only application.

## Local checks

```sh
npm ci
npx prisma generate --schema prisma/schema.prisma
npm run typecheck
npm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npm run build
```

Database history is one baseline migration in `prisma/migrations/` plus later additive migrations; the full database model is in `prisma/legacy-schema.prisma`. Host and deploy details are in [docs/OPERATIONS.md](docs/OPERATIONS.md). Never run migrations against production except through `scripts/prod-deploy.sh`, and never without a backup.

Use a dedicated local database populated with realistic synthetic example data for interactive testing. Follow [PREVIEW.md](docs/PREVIEW.md) for schema preparation, guarded fixture seeding and sign-in setup. Production-shaped migration rehearsals remain separate.

## Data and authorization

The app reads existing users, sessions, memberships, workspaces, posts, channels, social connections, and ad accounts by their original IDs. Password sign-in routes accounts requiring two-step verification to TOTP or recovery-code verification; accounts without an enrolled TOTP factor receive an enrollment flow. Every workspace read starts from a validated membership and an entitlement check. Provider credentials are not selected into frontend views.

## Current state

The rebuild serves production traffic with UI, REST API and MCP tools over shared services. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the current implementation, known gaps and evidence, and [docs/CUTOVER.md](docs/CUTOVER.md) for release and rollback procedures. Remaining work (provider coverage, analytics completeness, browser matrix rows) is tracked in [docs/GOAL.md](docs/GOAL.md) and [docs/DELIVERY_PLAN.md](docs/DELIVERY_PLAN.md).
