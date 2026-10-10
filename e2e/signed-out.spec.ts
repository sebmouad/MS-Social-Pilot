import { expect, test } from '@playwright/test';

import { collectFailures, open, SIGNED_IN_SCREENS } from './helpers';

/** Nobody signed in, and the app has been used — so the first-run excuses are gone. */
test.use({ storageState: { cookies: [], origins: [] } });

for (const path of SIGNED_IN_SCREENS) {
  test(`${path} is not served to a stranger`, async ({ page }) => {
    await open(page, path);
    await expect(page, `${path} rendered without a session`).toHaveURL(/\/(login|setup)$/);
  });
}

test('the sign-in screen renders once there is an account to sign in to', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/login');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel(/e-?mail/i)).toBeVisible();

  expect(failures).toEqual([]);
});

test('registration is closed once the first account exists', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/register');
  // No form: the whole point is that a public server does not hand out
  // accounts to whoever finds the URL.
  await expect(page.getByRole('button', { name: /create/i })).toHaveCount(0);

  expect(failures).toEqual([]);
});

test('the data deletion page is readable without an account', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/data-deletion');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  expect(failures).toEqual([]);
});

test('the terms of service are readable without an account', async ({ page }) => {
  // Meta links here from the Facebook Login dialog, for people with no account.
  const failures = collectFailures(page);

  await open(page, '/terms');
  await expect(page.getByRole('heading', { level: 1, name: /terms of service/i })).toBeVisible();

  expect(failures).toEqual([]);
});

test('an invitation link nobody issued says so rather than breaking', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/invite/not-a-real-token');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  expect(failures).toEqual([]);
});

test('a stranger following a dead link is pointed at sign-in, not at nothing', async ({ page }) => {
  const failures = collectFailures(page, { expect404: true });

  const response = await page.goto('/nothing-here-at-all');
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // No dashboard link for somebody with no session: it would bounce them
  // straight back to sign-in with nothing explaining why.
  await expect(page.getByRole('link', { name: /sign in|connexion/i })).toBeVisible();

  expect(failures).toEqual([]);
});

test('the app has a mark of its own, and enough to pin to a home screen', async ({ page }) => {
  // Without these, three client windows are three identical generic icons —
  // the other half of the problem the per-screen titles solve — and a phone
  // that adds the app to its home screen names it after the domain.
  const icon = await page.request.get('/icon.svg');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('svg');

  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);

  const body = (await manifest.json()) as {
    name?: string;
    start_url?: string;
    display?: string;
    icons?: Array<{ src: string }>;
  };

  expect(body.name).toBeTruthy();
  // Straight to the dashboard: somebody who pinned the app did not pin the
  // marketing page they never see.
  expect(body.start_url).toBe('/dashboard');
  expect(body.display).toBe('standalone');
  expect(body.icons?.[0]?.src).toBe('/icon.svg');

  // And the document points at both, or none of it is used.
  await open(page, '/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"]')).not.toHaveCount(0);
});

test('the privacy policy is readable without an account', async ({ page }) => {
  // Meta links here from the Facebook Login dialog and the app's details.
  const failures = collectFailures(page);

  await open(page, '/privacy-policy');
  await expect(page.getByRole('heading', { level: 2, name: 'Politique de confidentialité' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Privacy policy' })).toBeVisible();

  expect(failures).toEqual([]);
});
