# MS Social Pilot

Modular, multi-workspace social media publishing, engagement, analytics, and paid-media management platform.

## Project Structure

- [`app/`](app/README.md) — Self-contained Next.js + TypeScript + Prisma + PostgreSQL application and background worker.
- [`app/docs/ARCHITECTURE_CONTRACT.md`](app/docs/ARCHITECTURE_CONTRACT.md) — Architectural boundaries, security, and parity rules.
- [`app/docs/ARCHITECTURE.md`](app/docs/ARCHITECTURE.md) — System architecture and module map.
- [`app/docs/UI_UX_ROADMAP.md`](app/docs/UI_UX_ROADMAP.md) — UI & UX improvement plan (v1.1 roadmap).
- [`app/docs/OPERATIONS.md`](app/docs/OPERATIONS.md) — Production host, deployment, backup, and runbooks.

## Quick Start

```bash
cd app
npm ci
npx prisma generate
npm run typecheck
npm test
npm run dev
```

## Production Deployment

```bash
bash app/scripts/prod-deploy.sh
```
