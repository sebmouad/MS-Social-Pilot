# Application Testing Guide

Run the self-contained test suite from `app/`:

```sh
cd app
npm test
npm run typecheck
```

The test suite uses Vitest and runs without requiring a live production database. Tests that exercise database-backed services mock the Prisma client or inspect schema/migration contracts directly.

## Coverage Areas

- Authentication, password hashing, session security, and CSRF/Origin guards
- Encrypted secret envelopes and Root configuration schema validation (`tests/config-validation.test.ts`)
- UI/REST/MCP parity enforcement (`tests/parity-guard.test.ts`) and public API v1 contract pinning (`tests/api-v1-contract.test.ts`)
- Workspace data export and erasure table ordering (`tests/data-control-migration-inventory.test.ts`, `tests/inbox-data-control-coverage.test.ts`)
- Baseline migration checksum and schema rehearsal guards (`tests/baseline-migration.test.ts`, `tests/cutover-rehearsal.test.ts`)
- Design tokens, theme contrast, navigation hubs, command palette, and UI/UX audit regressions (`tests/ux-audit-batches-1-2.test.ts`)

## Targeted Test Runs

```sh
npx vitest run tests/<file>.test.ts
npx vitest run tests/parity-guard.test.ts
npx vitest run tests/config-validation.test.ts
```
