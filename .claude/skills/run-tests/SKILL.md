---
name: run-tests
description: Run MS Social Pilot's typecheck, unit/integration and Playwright browser suites correctly (test database).
---

# Run the tests

See `rebuild/docs/OPERATIONS.md` and `rebuild/docs/TESTING.md`. All commands
run from `rebuild/`.

```bash
scripts/dev/test-db.sh
npx tsc --noEmit -p .
npm test
REBUILD_PREVIEW_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_rebuild_preview npm test
```
- Start Docker Desktop first (`open -a Docker` on macOS);
  `scripts/dev/test-db.sh` provisions the throwaway Postgres on 127.0.0.1:55432.
- Without `REBUILD_PREVIEW_DATABASE_URL`, database integration probes are
  explicitly skipped.
- Browser suites: see `rebuild/docs/BROWSER_MATRIX.md`.
- Expected: typecheck zero errors. Known sandbox-only failures: the
  `facebook-native-http` loopback `listen EPERM ::1` tests (rerun where
  sockets are permitted).
- Long runs: start in the background and wait for completion; don't edit code
  while a browser suite runs (the dev server serves the working tree).
