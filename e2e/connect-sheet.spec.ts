import { expect, test } from '@playwright/test';

import { collectFailures, open } from './helpers';

/** Each network in the summary opens a sheet that says what connecting needs and starts it. */
test('the network summary opens a connect sheet', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/connections');
  const summary = page.getByRole('region', { name: 'Networks at a glance' });

  await summary.getByRole('button', { name: /Facebook Page/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Facebook Page' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Connect/ })).toHaveAttribute('href', '/api/facebook/connect');
  await page.keyboard.press('Escape');

  // A network connected through a form opens that form further down.
  await summary.getByRole('button', { name: /Bluesky/ }).click();
  await page.getByRole('dialog').getByRole('link', { name: /Connect/ }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Bluesky' })).toBeVisible();
  expect(failures).toEqual([]);
});
