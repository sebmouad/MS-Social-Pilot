import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { prisma } from './fixtures';

/**
 * Key dates and seasons: a key date added on its screen shows
 * there and on the calendar; a seasonal mode is added and removed. Database only.
 */

const TITLE = 'Product launch E2E';
const SEASON = 'Summer break E2E';

async function clean() {
  await prisma.keyDate.deleteMany({ where: { title: TITLE } });
  await prisma.seasonalMode.deleteMany({ where: { name: SEASON } });
}

test.beforeAll(clean);
test.afterAll(clean);

test('adds a key date and a seasonal mode', async ({ page }) => {
  const failures = collectFailures(page);
  const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await open(page, '/calendar/dates');
  await expect(page.getByRole('heading', { level: 1, name: 'Key dates & seasons' })).toBeVisible();

  await page.getByRole('button', { name: 'Add a date' }).click();
  const dateForm = page.getByRole('form', { name: 'Key date' });
  await dateForm.getByLabel('Name').fill(TITLE);
  await dateForm.getByLabel('Date').fill(date);
  await dateForm.getByRole('button', { name: 'Save' }).click();
  await expect(dateForm).toBeHidden();
  await expect(page.getByRole('region', { name: 'Your key dates' })).toContainText(TITLE);
  await expect(page.getByRole('region', { name: 'Coming up in the next 90 days' })).toContainText(TITLE);

  await page.getByRole('button', { name: 'Add a seasonal mode' }).click();
  const seasonForm = page.getByRole('form', { name: 'Seasonal mode' });
  await seasonForm.getByLabel('Name').fill(SEASON);
  await seasonForm.getByRole('radio', { name: 'Move times' }).click();
  await seasonForm.getByLabel('Minutes (negative for earlier)').fill('30');
  await seasonForm.getByRole('button', { name: 'Save' }).click();
  await expect(seasonForm).toBeHidden();
  const seasons = page.getByRole('region', { name: 'Seasonal modes' });
  await expect(seasons).toContainText(SEASON);
  await expect(seasons).toContainText('Times move by 30 minutes');
  expect(await prisma.seasonalMode.findFirstOrThrow({ where: { name: SEASON, workspace: { name: OWNER.workspace } } })).toMatchObject({ rule: 'shift', shiftMinutes: 30 });

  await seasons.locator('li').filter({ hasText: SEASON }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(seasons).not.toContainText(SEASON);

  await open(page, `/calendar?month=${date.slice(0, 7)}`);
  await expect(page.getByRole('link', { name: TITLE }).first()).toBeVisible();
  expect(failures).toEqual([]);
});
