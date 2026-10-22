# Rebuild app tests

Run the self-contained test suite from `rebuild/` with:

```sh
npm test
npm run typecheck
```

The suite uses this package's own Vitest installation and configuration; no parent app exists anymore. It does not install packages or require a production database. Tests that exercise database-backed services replace the Prisma data module with in-memory mocks, so they only inspect queries and mutation inputs.

The suite covers password and session compatibility, encrypted secret envelopes, configuration value schemas, MCP workspace scoping, draft authorization and mutation guards, migration-content and rehearsal-script pins, parity guards, and config validation. Database integration probes run only when `REBUILD_PREVIEW_DATABASE_URL` points at an isolated loopback preview database (see [PREVIEW.md](PREVIEW.md)); otherwise they are explicitly skipped.

Targeted runs:

```sh
npx vitest run tests/<file>.test.ts
npx vitest run tests/parity-guard.test.ts
npx vitest run tests/config-validation.test.ts
```

See [BROWSER_MATRIX.md](BROWSER_MATRIX.md) for the Playwright browser suites.
