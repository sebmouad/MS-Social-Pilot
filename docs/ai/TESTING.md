# Testing

When to run what (owner, 2026-10-11): small edits → `npx tsc --noEmit` + the
test files they touch (`npx vitest run tests/x.test.ts`, `npx playwright test
e2e/x.spec.ts -g …`). Full unit suite after a big change. The Playwright browser
suite (~20 min) only after every ~25% of NEXT_PHASES is built, and before a
deploy (owner, 2026-10-11).

Three layers, all required before a deploy: **typecheck → unit/integration →
browser walk**, then a **live check on production with real data**.

## 0. Once per machine

```bash
npm ci
npm install --no-save @playwright/test && npx playwright install chromium   # browser walk only
open -a Docker                       # macOS: Docker Desktop must run
scripts/dev/test-db.sh               # Postgres for tests on 127.0.0.1:55432
```

### Without Docker (cloud sessions)

Use a local PostgreSQL (16 is fine; production is 15) on the same port:

```bash
D=/var/tmp/msp-pg; mkdir -p $D && chown postgres $D
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 55432 -k /tmp -c listen_addresses=127.0.0.1' -l $D/log start"
psql -h 127.0.0.1 -p 55432 -U postgres -c "alter user postgres password 'postgres'" -c "create database social_pilot_test"
```
- Playwright: real `psql` is installed, so leave `scripts/dev/bin` off `PATH`;
  set `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` (never
  `playwright install`).
- A fresh cluster reports its time zone as `Etc/UTC`, which fails
  `setup.integration.test.ts > requires the database to run in UTC`. Start it
  with `-c timezone=UTC` in the `-o` options to avoid that environment-only
  failure.

## 1. Typecheck

```bash
npx tsc --noEmit
```
(There is no ESLint config; `npm run lint` is not used.)

## 2. Unit + integration (Vitest, ~3 min, ~1,420 tests in 91 files)

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test npx vitest run
```
- Integration tests (`*.integration.test.ts`) create their own database from
  `tests/helpers/database.ts` (`setupTestDatabase('name')`), so they need the
  container above.
- **Known failure (pre-existing, ignore):** `scheduling into an hour that does not
  exist > accepts the same wall clock in a zone whose clocks move on another date`.
  Anything else failing is yours.
- Tests that guard conventions — keep them green, don't weaken them:
  - `tests/locale.test.ts`: same keys and placeholders in en/fr; ICU plural for
    anything that counts. Gotcha: `{Add}` inside a plural branch looks like a
    placeholder; write `=0 {Add hashtags}` in both languages.
  - `tests/metadata.test.ts`: every page calls `screenMetadata('ns.key')` or is
    listed in `INHERITS` with a reason.
  - `tests/api-routes.integration.test.ts`: every API route answers 401 to an
    anonymous caller (or is in `PUBLIC`); routes contributors must not reach go
    in `CONTRIBUTOR_MUST_NOT`, with a valid body in `VALID_BODY`.
  - `tests/configuration-docs.test.ts`: every setting's env var is in
    `.env.example` and `docs/PROJECT_SCHEMA.md`.
  - The reports message namespace must stay flat (a test casts it to
    `Record<string,string>`).
- Mocking Graph / other networks: either a local HTTP server and
  `FACEBOOK_GRAPH_BASE_URL` (see `tests/budget.test.ts`, `tests/scheduler.integration.test.ts`)
  or `vi.stubGlobal('fetch', …)` (see `tests/networks.test.ts`, `tests/live-findings.test.ts`).

## 3. Browser walk (Playwright, ~4.5 min, 251 tests)

```bash
# Playwright is not in package.json: install it after every npm ci
npm i --no-save @playwright/test
PATH="$PWD/scripts/dev/bin:$PATH" \
E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_test \
npx playwright test --reporter=line
```
- Starts `next dev` on port 3100 against schema `e2e`; `e2e/prepare.ts` resets it
  with `psql` (the shim in `scripts/dev/bin` runs it inside the container).
- Projects: `chromium` (desktop) and `phone`. Every screen in
  `e2e/helpers.ts → SIGNED_IN_SCREENS` is rendered, checked for console errors, for
  horizontal overflow on a phone, and for accessibility basics. **Add every new
  screen to `SIGNED_IN_SCREENS`.**
- Confirmations use the in-app dialog: click `[data-confirm]` to accept, `[data-close]`
  to dismiss (`e2e/posts.spec.ts → pressAndAnswer`).
- Don't edit code while it runs (the dev server reads the working tree).
- Run one spec: `npx playwright test e2e/phone.spec.ts -g "calendar"`.

## 4. Live check on production (real browser, real data) — required

The user wants every feature verified in **their Chrome** (Claude in Chrome
tools) on https://social.newsgeet.com with their real Pages, after deploy.

- Read-only checks are always fine: open screens, compare numbers with Facebook.
- **Anything that publishes, deletes, messages or emails needs the user's OK for
  that action.** Agreed sandbox: Page **DIY Page 3** (1 follower). It is normally
  *paused*: switch it on in Connections for the test, delete test posts after
  ("Delete from Facebook" on the post), switch it off again.
- Automation quirks seen: the first click right after a navigation is sometimes
  lost — re-check state and click again; `find` refs can point at the wrong
  element in long lists — prefer coordinates from a fresh screenshot; the
  JavaScript tool runs in an isolated world (overriding `window.confirm` there does
  nothing).
- Live test log of 2026-10-11 (all passed): publish now + first comment; photo
  with alt text scheduled by the app worker; link post held by Facebook then
  cancelled (removed from Facebook); comment reply / delete as the Page (Hide is
  refused by Facebook for the Page's own comments — the button is hidden now);
  follower count, reactions, comments, shares and engagement rate matched
  Facebook; delete-from-Facebook of published posts.

## Visual checks without production

`scripts/dev` has no demo seed by design (the user prefers real data). For quick
screenshots, `npm run screenshots` runs `e2e/screenshots.spec.ts`.
