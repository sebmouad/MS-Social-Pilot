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
| `phone.spec.ts` | Every screen at phone width, signed in and signed out: nothing slides sideways, and the navigation is reachable behind the menu. Its own Playwright project. |
| `accessible.spec.ts` | That every control has something for a screen reader to announce, that the composer can be reached by tab, and that focus is visible when it lands. |

`compose.spec.ts` also covers correcting a scheduled post in place, and that a
published one offers no way to rewrite it — the Edit button is absent and the
URL answers 404.

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
- **A destination row with a long name pushed the composer 100px off a phone
  screen.** A grid track sizes itself to its content's minimum width, so one
  wide row grew the column and every other column stretched to match. `truncate`
  does not help — it clips what is painted without reducing the width the box
  asks for — and the fix is `min-w-0` on the grid children.
- **A post containing a long URL made the dashboard slide sideways on a phone**,
  taking the heading off the edge with it. `break-words` had been the obvious
  fix and is the wrong one: it stops a word painting outside its box but does
  not change the box's min-content width, so inside a flex row the box still
  demands the width of the longest word. `overflow-wrap: anywhere` is the
  property that shrinks the intrinsic width too.
- **The settings screen showed contributors four sections they could not save.**
  Every button answered 403, which reads as a broken product rather than as a
  permission. They are hidden now, with the reason in their place.
- **Two file inputs had no label**, so a screen reader announced "file upload
  button" and nothing about what the file was for. One was a `<span>` styled to
  look like a label; the other sat between a label and the textarea that label
  actually named.

## Seeds have to reach the screen

The phone walk seeds a long filename, an unbreakable URL, a feed with both, a
long email address and a destination whose row carries a name, an account and
the note saying why it is switched off. None of that is decoration: an empty
screen fits on anything, and the first version of this walk passed on every
screen because there was nothing on them.

There is a test whose only job is to assert the seeded strings are actually
rendered on the screens the overflow checks then visit. Without it a fixture
that quietly stops reaching a page turns the checks around it into a thorough
looking suite that exercises an empty layout.

## The route that throws on purpose

`src/app/(app)/e2e-slow` sleeps, so the loading skeleton can be seen: it is by
nature the thing nobody looks at, appearing for as long as the server takes and
then gone, which makes it the easiest piece of a UI to break without noticing.

`src/app/(app)/e2e-throw` exists only to prove the error boundary works. It is
a 404 unless `E2E_ALLOW_THROW=true`, which this config sets and nothing else
does. It is not named with a leading underscore, tempting as that was: Next
treats such a folder as private and drops it from routing altogether, so the
route would not exist even with the flag on.

## What it is not for

It asserts that pages render, that the journeys work, and that a stranger is
turned away. It does not test the rules underneath — which Graph edge a post
takes, whether a retry is worth attempting, whether one client can reach
another's data. Those live in `tests/`, run in seconds, and are where a new
rule should be tested first. Reach for the browser when the question is one only
a browser can answer.
