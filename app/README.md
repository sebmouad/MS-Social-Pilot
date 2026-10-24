# MS Social Pilot (`app/`)

MS Social Pilot v1.0.0 — modular social media publishing, inbox engagement, analytics, AI studio, and paid ads platform.

## Documentation

- [Architecture Contract](docs/ARCHITECTURE_CONTRACT.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [UI & UX Improvement Roadmap](docs/UI_UX_ROADMAP.md)
- [Public API v1](docs/API_V1.md)
- [MCP Parity](docs/MCP_PARITY.md)
- [Operations & Deployment](docs/OPERATIONS.md)
- [Release & Rollback](docs/CUTOVER.md)
- [Testing Guide](docs/TESTING.md)
- [Local Synthetic Preview](docs/PREVIEW.md)

## Commands

Run from `app/`:

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
```

Production deploy (from anywhere in the checkout):

```bash
bash app/scripts/prod-deploy.sh
```
