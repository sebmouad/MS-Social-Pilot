import { expect, test as setup } from '@playwright/test';

import { collectFailures, open, OWNER, OWNER_STATE } from './helpers';

/**
 * The first-run walk, which doubles as the sign-in every other spec depends on.
 *
 * It has to be both: "first run" is a property of the database — once anyone has
 * registered it never comes back — so the only honest place to assert it is on
 * the way in.
 */

setup('a server nobody has used yet offers to set itself up', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  expect(failures).toEqual([]);
});

setup('signing in is not offered before there is anything to sign in to', async ({ page }) => {
  await open(page, '/login');
  await expect(page).toHaveURL(/\/setup$/);
});

setup('the first visitor creates the first account', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/register');

  await page.getByLabel(/your name/i).fill(OWNER.name);
  await page.getByLabel(/e-?mail/i).fill(OWNER.email);
  await page.getByLabel(/^password$/i).fill(OWNER.password);
  await page.getByLabel(/workspace name/i).fill(OWNER.workspace);
  await page.getByRole('button', { name: /create/i }).click();

  // The nav bar only renders inside the signed-in layout, so its presence is
  // the proof that registration actually took.
  await page.waitForURL(/\/welcome/, { timeout: 30_000 });
  await expect(page.getByRole('banner')).toBeVisible();

  // The welcome steps (S3): the basics are saved, then the Pages step offers
  // the connections screen. UTC is chosen on purpose: the rest of the walk
  // reads times in it, whatever zone this browser reports.
  await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue(OWNER.workspace);
  await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your first channels' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect channels' })).toHaveAttribute('href', '/connections');
  await page.getByRole('link', { name: 'Go to the dashboard' }).click();
  await page.waitForURL(/\/dashboard/);

  // A form submitted before React attached its handler goes out as a GET with
  // every field in the query string. Nowhere in the journey should the
  // password appear in a URL.
  expect(page.url()).not.toContain(OWNER.password);

  // Developer features (API keys, webhooks) start off; root switches them on
  // for this workspace so the walk can reach those screens.
  await open(page, '/root/workspaces');
  await page.getByRole('link', { name: OWNER.workspace }).click();
  // A click before hydration ticks the box without saving; reloading shows
  // what was really saved, so click until the saved state is on.
  const developer = page.getByLabel(/^Developer features/);
  await expect(async () => {
    if (!(await developer.isChecked())) {
      const saved = page
        .waitForResponse((response) => response.url().includes('/api/root/workspaces/') && response.request().method() === 'PATCH', { timeout: 3_000 })
        .catch(() => null);
      await developer.click();
      await saved;
    }
    await page.reload();
    await expect(developer).toBeChecked({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  expect(failures).toEqual([]);

  await page.context().storageState({ path: OWNER_STATE });
});
