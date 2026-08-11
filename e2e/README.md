# The browser walk

An end-to-end pass over every screen, with Playwright.

The Vitest suites in `tests/` cover the libraries under `src/lib` thoroughly and
quickly. What they cannot do is render a page: a server component that throws, a
translation key that only exists in English, a form that submits before React
attaches to it — none of that shows up until a browser opens the app. That is
what this is for.

## Playwright is not a declared dependency

`@playwright/test` is deliberately absent from `package.json`. It pulls in a
browser download and several hundred megabytes, and the walk is a periodic check
rather than something to run on every commit. Install it when you want to run
the walk, and leave it out the rest of the time:

```sh
npm install --no-save @playwright/test
npx playwright install chromium
```

`--no-save` keeps `package.json` and the lockfile clean. The `e2e/` directory
and `playwright.config.ts` are excluded from `tsconfig.json` for the same
reason: `npm run typecheck` must pass without the package installed.

## Running it

Postgres has to be reachable — the same one the Vitest integration suites use:

```sh
docker compose up -d db          # or a local Postgres on 5432
npx playwright test
```

The config starts `next dev` on port 3100 itself and points it at a schema
called `e2e` inside `social_pilot_test`, which `e2e/prepare.ts` drops and
recreates on every run. Nothing touches the development database.

If the browser in your environment is a different build from the one
`@playwright/test` expects, point at it rather than downloading another:

```sh
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npx playwright test
```

## What it covers

| Spec | What it walks |
| --- | --- |
| `auth.setup.ts` | A server nobody has used yet: the setup screen, then registering the first account. Saves the session the rest of the run uses. |
| `screens.spec.ts` | Every screen behind the sign-in wall, signed in as the owner, plus every link in the nav bar. |
| `compose.spec.ts` | Writing a post, scheduling it, finding it on the list, the calendar and the dashboard, correcting it in place, and cancelling it. |
| `invite.spec.ts` | Inviting a colleague, accepting the invitation, and walking every screen again **in French**. |
| `signed-out.spec.ts` | That none of it is served to a stranger, and that the public pages still are. |

`compose.spec.ts` puts a pretend Facebook Page straight into the database
(`e2e/fixtures.ts`) rather than logging in to Facebook. It exists so the screens
have rows to render; nothing in the walk ever calls the Graph API.

## What it has caught

- **The sign-in and registration forms submitted before React hydrated**, which
  sent the visitor's password to the server in the URL query string — and so
  into browser history and the access log. Fixed in `src/components/AuthForm.tsx`;
  the regression test that outlives this directory is `tests/auth-form.test.ts`,
  which renders the form the way the server does and checks that it cannot be
  submitted yet.
- **The composer discarded anything typed before hydration.** The message and
  link boxes were controlled, so hydration reset them to empty. They are
  uncontrolled now and their contents are adopted on mount.
- **`/settings/config` rendered with no heading at all** for anyone who is not
  an owner — a card of refusal text and nothing naming the screen.
