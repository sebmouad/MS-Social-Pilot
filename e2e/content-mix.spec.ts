import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, PAGE_NAME, prisma } from './fixtures';

/**
 * Content mix (NEXT_PHASES H1): an admin sets how many posts of a label a
 * Page should get per week, and the coming week shows how far it falls short.
 */

const LABEL = 'Product launch E2E';

test.afterAll(async () => {
  await prisma.label.deleteMany({ where: { name: LABEL } });
});

test('sets a Page’s weekly mix and shows the week against it', async ({ page }) => {
  const failures = collectFailures(page);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: await connectPretendPage(OWNER.workspace) } });
  await prisma.label.upsert({
    where: { workspaceId_name: { workspaceId: target.workspaceId, name: LABEL } },
    create: { workspaceId: target.workspaceId, name: LABEL },
    update: {},
  });

  await open(page, '/queue/mix');
  await expect(page.getByRole('heading', { level: 1, name: 'Content mix' })).toBeVisible();
  await expect(page.locator('nav a[aria-current="page"]', { hasText: 'Content mix' })).toBeVisible();

  await page.getByLabel('Page or group').selectOption({ label: PAGE_NAME });
  // Clicked again until the page has hydrated and the row appears.
  const perWeek = page.getByRole('spinbutton', { name: `Posts per week for ${LABEL}` });
  await expect(async () => {
    if (!(await perWeek.isVisible())) await page.getByRole('button', { name: 'Add a label' }).click();
    await expect(perWeek).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await page.getByRole('combobox', { name: 'Label' }).selectOption({ label: LABEL });
  await perWeek.fill('3');
  await page.getByRole('button', { name: 'Save mix' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mix saved.' })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: LABEL });
  await expect(row.getByText('0 of 3')).toBeVisible();
  await expect(row.getByText('Short by 3, no draft left')).toBeVisible();
  expect(await prisma.contentMixRule.count({ where: { targetId: target.id, perWeek: 3 } })).toBe(1);
  expect(failures).toEqual([]);
});
