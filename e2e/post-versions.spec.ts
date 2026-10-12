import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Post version history (NEXT_PHASES H9): Compose lists a post's saves, shows
 * what changed, and loads an earlier one back into the form.
 */

const OLD = 'Product launch E2E on Friday at noon';
const NEW = 'Product launch E2E on Monday at noon';

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { message: { in: [OLD, NEW] } } });
});

test('compares and loads back an earlier version', async ({ page }) => {
  const failures = collectFailures(page);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: await connectPretendPage(OWNER.workspace) } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  const post = await prisma.post.create({
    data: {
      workspaceId: target.workspaceId,
      authorId: owner.id,
      message: NEW,
      targets: { create: { targetId: target.id } },
    },
  });
  const version = { postId: post.id, authorId: owner.id, format: 'post', timezone: 'UTC', targetIds: [target.id] };
  await prisma.postVersion.create({ data: { ...version, message: OLD, createdAt: new Date(Date.now() - 3_600_000) } });
  await prisma.postVersion.create({ data: { ...version, message: NEW } });

  await open(page, `/compose?post=${post.id}`);
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await expect(dialog.getByText(/changed text/)).toBeVisible();
  await expect(dialog.getByText(/first saved/)).toBeVisible();

  await dialog.getByRole('button', { name: /first saved/ }).click();
  await expect(dialog.locator('del', { hasText: 'Friday' })).toBeVisible();
  await expect(dialog.locator('ins', { hasText: 'Monday' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Load this version' }).click();
  await page.locator('[data-confirm]').click();

  await expect(page.locator('#message')).toHaveValue(OLD);
  expect(failures).toEqual([]);
});
