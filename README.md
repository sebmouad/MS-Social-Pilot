# MS Social Pilot (`v1.0.0`)

Modular, multi-workspace social media publishing, engagement inbox, analytics, AI studio, and paid-ads platform.

## Documentation

- [`AGENT.md`](AGENT.md) — Compact architecture, conventions, and operational reference for AI agents and developers.
- [`PLAN.md`](PLAN.md) — `v1.1+` product feature, visual design system, and UX roadmap.

## Quick Start

```bash
cd app
npm ci
npx prisma generate
npm run typecheck
npm test
npm run dev
```

## Unified Install & Update Deployment

```bash
# Deploy or bootstrap remote production server from origin/main:
bash app/scripts/deploy.sh

# Or install/update directly on a Debian/Ubuntu server:
sudo bash app/scripts/deploy.sh --local
```
