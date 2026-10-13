import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Negative-comment alert: switched on in Settings › AI. */

let workspaceId = '';

test.afterAll(async () => {
  if (workspaceId) await prisma.workspace.update({ where: { id: workspaceId }, data: { watchNegativeComments: false } });
});

test('switches on the negative-comment alert', async ({ page }) => {
  const failures = collectFailures(page);
  const targetId = await connectPretendPage(OWNER.workspace);
  workspaceId = (await prisma.target.findUniqueOrThrow({ where: { id: targetId } })).workspaceId;

  await open(page, '/settings');
  const box = page.getByRole('checkbox', { name: /negative comments spike/i });
  // Clicks before hydration do nothing; retry until it sticks.
  await expect(async () => {
    if (!(await box.isChecked())) await box.click();
    await expect(box).toBeChecked({ timeout: 1_500 });
  }).toPass();
  await box.locator('xpath=ancestor::section[1]').getByRole('button', { name: /save/i }).click();
  await expect.poll(async () => (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).watchNegativeComments).toBe(true);

  await page.reload();
  await expect(page.getByRole('checkbox', { name: /negative comments spike/i })).toBeChecked();
  expect(failures).toEqual([]);
});
