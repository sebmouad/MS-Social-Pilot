---
name: run-tests
description: Run MS Social Pilot's typecheck, unit/integration and Playwright browser suites correctly (test database, psql shim, known failure).
---

# Run the tests

See `docs/ai/TESTING.md`.

```bash
open -a Docker && scripts/dev/test-db.sh
npx tsc --noEmit
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npx vitest run
PATH="$PWD/scripts/dev/bin:$PATH" E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npx playwright test --reporter=line
```
- Long runs: start in the background and wait for completion; don't edit code
  while Playwright runs (the dev server serves the working tree).
- Expected: 1 known unit failure (daylight-saving test), all Playwright tests pass.
- New screen → add to `SIGNED_IN_SCREENS` in `e2e/helpers.ts`. New API route →
  update `tests/api-routes.integration.test.ts` lists. New setting → document its
  env var in `.env.example` and `docs/PROJECT_SCHEMA.md`.
