import { expect, test } from '@playwright/test';

import { collectFailures, open } from './helpers';
import { prisma } from './fixtures';

/** Root switches the public product site on; a stranger reads it; root switches it off again. */

const ENTRY = 'e2e changelog entry';

test.afterAll(async ({ request }) => {
  await request.post('/api/root/config', { data: { values: { 'site.public': null } } });
  await prisma.changelogEntry.deleteMany({ where: { title: ENTRY } });
});

test('root publishes a changelog entry and a stranger sees the product site', async ({ page, browser }) => {
  const failures = collectFailures(page);
  expect((await page.request.post('/api/root/config', { data: { values: { 'site.public': true } } })).ok()).toBe(true);

  await open(page, '/root/changelog');
  await page.getByLabel('Title').fill(ENTRY);
  await page.getByLabel('Details (optional)').fill('A neutral example of a change.');
  await page.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText(ENTRY)).toBeVisible();
  expect(failures).toEqual([]);

  const stranger = await browser.newPage({ storageState: { cookies: [], origins: [] } });
  const strangerFailures = collectFailures(stranger);
  await open(stranger, '/');
  await expect(stranger.getByRole('heading', { level: 1 })).toContainText('Plan, publish and measure');
  await stranger.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Pricing' }).click();
  await expect(stranger.getByRole('heading', { name: 'Pricing' })).toBeVisible();
  await open(stranger, '/help');
  await stranger.getByText('How does scheduling work?').click();
  await expect(stranger.getByText(/publishes it at that time/)).toBeVisible();
  await open(stranger, '/changelog');
  await expect(stranger.getByText(ENTRY)).toBeVisible();
  await open(stranger, '/status');
  await expect(stranger.getByRole('status')).toBeVisible();
  expect(strangerFailures).toEqual([]);

  // Switched off, the pages are gone and the home page is the sign-in form again.
  await page.request.post('/api/root/config', { data: { values: { 'site.public': null } } });
  expect((await stranger.goto('/pricing'))?.status()).toBe(404);
  await stranger.close();
});
