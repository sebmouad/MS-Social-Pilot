# Rebuild app tests

Run the isolated rebuild test suite from this directory with:

```sh
npm test
npm run typecheck
```

The test command uses the Vitest installation and configuration already maintained by the parent app. It does not install packages or require a production database. Tests that exercise database-backed services replace the rebuild Prisma data module with in-memory mocks, so they only inspect queries and mutation inputs.

The suite covers legacy password and session compatibility, encrypted secret envelopes, configuration value schemas, MCP workspace scoping, and local draft authorization and mutation guards. It does not exercise the Next.js request adapters or database schema migrations.
