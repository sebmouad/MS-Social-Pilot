import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end walk of the screens.
 *
 * The Vitest suites cover the libraries underneath; nothing until now actually
 * rendered a page. A server component that throws — a missing translation key,
 * a query against a column that moved — is invisible to those suites and very
 * visible to whoever opens the app. This config exists to open the app.
 *
 * Playwright is not a declared dependency: see e2e/README.md.
 */
// Its own port, so two walks — from two checkouts, say — can run side by side.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

const databaseUrl = new URL(
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/social_pilot_test',
);
databaseUrl.searchParams.set('schema', 'e2e');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // One worker: the walk registers the first account, and "first" is a property
  // of the whole database rather than of a worker.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // The image ships a browser; a version-matched download is not always
    // possible offline. Point at it when it is there, otherwise let Playwright
    // resolve its own.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    // Registering the first account is both the first-run test and the sign-in
    // every other spec needs, so it runs once and saves the session.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      // Everything except the phone walk, which has its own project below and
      // asserts things that are only true at a narrow width.
      testIgnore: /phone\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/owner.json' },
      dependencies: ['setup'],
    },
    // The app has real responsive machinery — a menu below `lg`, columns that
    // swap at `sm`, navs that scroll sideways — and every test above runs at
    // one width. This runs the screens at the width most people check them at.
    {
      name: 'phone',
      testMatch: /phone\.spec\.ts/,
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/owner.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // E2E_PROD=1 walks a production build: no first-visit compile of each page,
    // so a full run is faster and does not stall on the development server.
    command: process.env.E2E_PROD
      ? `npx tsx e2e/prepare.ts && npx next build && npx next start --port ${port} --hostname 127.0.0.1`
      : `npx tsx e2e/prepare.ts && npx next dev --port ${port} --hostname 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: process.env.E2E_PROD ? 900_000 : 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL: databaseUrl.toString(),
      // Two-step sign-in has its own spec; everywhere else the walk signs in with a password.
      SECURITY_TWO_STEP: 'off',
      APP_URL: baseURL,
      SESSION_SECRET: 'e2e-session-secret-not-a-real-one',
      ENCRYPTION_KEY: 'c3aCfAcoo9L+9hMqSB+2x2mSjeyLwAyhNamW5DsCikc=',
      FACEBOOK_APP_ID: '000000000000000',
      FACEBOOK_APP_SECRET: 'e2e-placeholder',
      // Unlocks the one route that throws on purpose, so the error boundary is
      // exercised rather than assumed. Set nowhere else.
      E2E_ALLOW_THROW: 'true',
    },
  },
});
