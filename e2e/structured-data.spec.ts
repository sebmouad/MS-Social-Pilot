import { expect, test } from '@playwright/test';

import { collectFailures, open } from './helpers';

/**
 * Posts from page details (NEXT_PHASES H3). The server fetches the page, so a
 * test cannot serve it JSON-LD; this checks the way in and the honest answer
 * for a page that describes nothing. The parser and captions are unit-tested.
 */

test('"Use page details" opens and says when a page has nothing to use', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/compose');
  const button = page.getByRole('button', { name: 'Use page details' });
  await expect(button).toBeDisabled();
  await page.getByLabel(/^link/i).fill('https://page.invalid/item');
  await expect(button).toBeEnabled();
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Post from page details' });
  await expect(dialog.getByText(/gives no product, event, recipe/)).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(failures).toEqual([]);
});
