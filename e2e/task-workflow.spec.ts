import { expect, test } from '@playwright/test';

import { collectFailures, open } from './helpers';
import { prisma } from './fixtures';

/** A workflow on the tasks board: one task per line, due one after another. */

test.afterAll(async () => {
  await prisma.task.deleteMany({ where: { title: { startsWith: 'e2e step' } } });
});

test('turns the steps into tasks due in order', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/tasks');
  await page.getByText('Start a workflow').click();
  await page.getByLabel('Steps', { exact: true }).fill('e2e step one\ne2e step two');
  await page.getByLabel('First step due').fill('2030-01-10');
  await page.getByLabel('Days between steps').fill('2');
  await page.getByRole('button', { name: 'Create the tasks' }).click();
  await expect.poll(() => prisma.task.count({ where: { title: { startsWith: 'e2e step' } } })).toBe(2);
  const rows = await prisma.task.findMany({ where: { title: { startsWith: 'e2e step' } }, orderBy: { title: 'asc' } });
  expect(rows.map((row) => row.dueOn)).toEqual(['2030-01-10', '2030-01-12']);
  expect(failures).toEqual([]);
});
