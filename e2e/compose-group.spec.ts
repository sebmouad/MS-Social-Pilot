import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** The composer's "Save these channels as a group": two ticked channels become a group in one step. */

let secondId = '';

test.afterAll(async () => {
  await prisma.pageGroup.deleteMany({ where: { name: 'e2e saved group' } });
  if (secondId) await prisma.target.delete({ where: { id: secondId } }).catch(() => undefined);
});

test('saves the ticked channels as a group', async ({ page }) => {
  const failures = collectFailures(page);
  const firstId = await connectPretendPage(OWNER.workspace);
  const first = await prisma.target.findUniqueOrThrow({ where: { id: firstId } });
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = first as typeof first & { createdAt?: Date; updatedAt?: Date };
  const second = await prisma.target.create({ data: { ...(rest as never), providerId: '20000000000000099', name: 'e2e second channel' } });
  secondId = second.id;

  await open(page, `/compose?to=${firstId},${secondId}`);
  await page.getByRole('button', { name: 'Save these channels as a group' }).click();
  await page.getByLabel('Group name').fill('e2e saved group');
  await page.getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByText('Group “e2e saved group” saved.', { exact: false })).toBeVisible();

  const group = await prisma.pageGroup.findFirstOrThrow({ where: { name: 'e2e saved group' }, include: { pages: true } });
  expect(group.pages).toHaveLength(2);
  expect(failures).toEqual([]);
});
