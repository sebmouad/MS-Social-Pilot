import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Notes on charts: added under the analysis chart, shown in the report, removable. */

const MESSAGE = 'Chart notes E2E post';
const LABEL = 'Product launch';
let targetId = '';

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { message: MESSAGE } });
  if (targetId) await prisma.chartNote.deleteMany({ where: { targetId } });
});

test('adds a note to the analysis chart, shows it in the report, then removes it', async ({ page }) => {
  const failures = collectFailures(page);
  targetId = await connectPretendPage(OWNER.workspace);
  await prisma.chartNote.deleteMany({ where: { targetId } });
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const author = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  const yesterday = new Date(Date.now() - 86_400_000);
  await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: author.id,
      message: MESSAGE,
      status: 'published',
      publishedAt: yesterday,
      targets: { create: { targetId, status: 'published', remotePostId: `${targetId}_notes`, publishedAt: yesterday, insights: { reach: 300, reactions: 10, comments: 2 } } },
    },
  });

  await open(page, `/analytics?target=${targetId}&days=30`);
  const add = page.getByRole('button', { name: 'Add a note' });
  const label = page.getByLabel('Note', { exact: true });
  await expect(async () => {
    if (!(await label.isVisible())) await add.click();
    await expect(label).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await label.fill(LABEL);
  await page.getByLabel('Colour').selectOption('green');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();

  const list = page.getByRole('list', { name: 'Notes on this chart' });
  await expect(list.getByText(LABEL)).toBeVisible();
  expect(await prisma.chartNote.findFirst({ where: { targetId }, select: { label: true, color: true } })).toEqual({ label: LABEL, color: 'green' });

  await open(page, `/reports?target=${targetId}&range=30d&sections=analysis`);
  await expect(page.getByRole('list', { name: 'Notes on this chart' }).getByText(LABEL)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a note' })).toHaveCount(0);

  await open(page, `/analytics?target=${targetId}&days=30`);
  await page.getByRole('button', { name: `Remove note “${LABEL}”` }).click();
  await page.locator('[data-confirm]').click();
  await expect(page.getByRole('list', { name: 'Notes on this chart' })).toHaveCount(0);
  expect(await prisma.chartNote.count({ where: { targetId } })).toBe(0);
  expect(failures).toEqual([]);
});
