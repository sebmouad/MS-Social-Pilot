import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Target audience per Page: a country and a language set in
 * the Page's dialog are saved and shown again. Database only.
 */

let targetId: string;

const reset = () =>
  prisma.target.update({
    where: { id: targetId },
    data: { audienceCountries: [], audienceLanguages: [], audienceTimezone: null, audienceCalendars: [] },
  });

test.beforeAll(async () => {
  targetId = await connectPretendPage(OWNER.workspace);
  await reset();
});

test.afterAll(async () => {
  await reset();
});

test('sets a Page’s audience and keeps it', async ({ page }) => {
  const failures = collectFailures(page);
  const { name } = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
  await open(page, '/settings/pages');

  const row = page.locator('li').filter({ hasText: name });
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await row.getByRole('button', { name: 'Voice, audience & links' }).click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass();

  await dialog.getByLabel('Countries', { exact: true }).selectOption('MX');
  await dialog.getByLabel('Languages', { exact: true }).fill('es_mx');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('(es-MX)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => prisma.target.findUniqueOrThrow({ where: { id: targetId } }).then((t) => [t.audienceCountries, t.audienceLanguages]))
    .toEqual([['MX'], ['es-MX']]);

  await page.reload();
  await expect(page.locator('li').filter({ hasText: name })).toContainText('MX, es-MX');
  expect(failures).toEqual([]);
});
