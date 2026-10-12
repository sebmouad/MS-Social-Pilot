import { expect, test } from '@playwright/test';

import { collectFailures, open } from './helpers';
import { prisma } from './fixtures';

/**
 * Outgoing webhooks (NEXT_PHASES H18): add one, see its secret once, send a
 * test (the address does not exist, so it is reported as not delivered and
 * logged), then remove it through the confirmation dialog.
 */

const NAME = 'Client A automation E2E';

test.afterAll(async () => {
  await prisma.webhookEndpoint.deleteMany({ where: { name: NAME } });
});

test('adds, tests and removes a webhook', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/settings/webhooks');
  await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible();

  await page.getByRole('button', { name: 'Add webhook' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(NAME);
  await dialog.getByLabel('Address (https)').fill('https://hooks.invalid/e2e');
  await dialog.getByRole('button', { name: 'New comment' }).click();
  await dialog.getByRole('button', { name: 'Add webhook' }).click();

  await expect(page.getByText('Copy the signing secret now')).toBeVisible();
  await expect(page.locator('code').filter({ hasText: /^whsec_/ })).toBeVisible();
  await page.getByRole('button', { name: 'I have copied it' }).click();
  await expect(page.getByText('Copy the signing secret now')).toBeHidden();

  const row = page.getByRole('listitem').filter({ hasText: NAME });
  await expect(row.getByRole('button', { name: 'New comment' })).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Send test' }).click();
  await expect(row.getByText(/Test not delivered/)).toBeVisible({ timeout: 20_000 });

  await row.getByRole('button', { name: 'Delivery log' }).click();
  await expect(row.getByRole('cell', { name: 'ping' })).toBeVisible();

  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(NAME)).toBeHidden();
  expect(await prisma.webhookEndpoint.count({ where: { name: NAME } })).toBe(0);
  expect(failures).toEqual([]);
});
