import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Goals per Page (NEXT_PHASES H12): set on the dashboard, shown with their pace there and in the report. */

let targetId = '';

test.afterAll(async () => {
  if (targetId) await prisma.pageGoal.deleteMany({ where: { targetId } });
});

test('sets a monthly goal and shows its progress on the dashboard and in the report', async ({ page }) => {
  const failures = collectFailures(page);
  targetId = await connectPretendPage(OWNER.workspace);
  await prisma.pageGoal.deleteMany({ where: { targetId } });

  await open(page, `/dashboard?pages=${targetId}`);
  const goals = page.getByRole('region', { name: 'Goals this month' });
  await expect(goals.getByText(/No goals yet/)).toBeVisible();

  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await goals.getByRole('button', { name: 'Set goals' }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await dialog.getByLabel('Channel').selectOption(targetId);
  await dialog.getByLabel('Posts published').fill('12');
  await dialog.getByRole('button', { name: 'Save goals' }).click();
  await expect(dialog).toBeHidden();

  await expect(goals.getByRole('progressbar', { name: 'Posts published' })).toBeVisible();
  await expect(goals.getByText(/ of 12$/)).toBeVisible();
  expect(await prisma.pageGoal.findMany({ where: { targetId }, select: { metric: true, target: true } })).toEqual([
    { metric: 'posts', target: 12 },
  ]);

  await open(page, `/reports?target=${targetId}&sections=goals`);
  await expect(page.getByRole('heading', { name: /^Goals for / })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Posts published' })).toBeVisible();
  expect(failures).toEqual([]);
});
