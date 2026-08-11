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

test('an invitation link nobody issued says so rather than breaking', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/invite/not-a-real-token');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  expect(failures).toEqual([]);
});
