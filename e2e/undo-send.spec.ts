import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Undo send (NEXT_PHASES H10): "Publish now" waits with an Undo; pressing it
 * brings the post back as a draft, open in the composer. Nothing reaches
 * Facebook: the post is taken back before the worker's time.
 */

const MESSAGE = 'Undo send E2E check';

test.beforeAll(async () => {
  await connectPretendPage(OWNER.workspace);
  await prisma.workspace.updateMany({ where: { name: OWNER.workspace }, data: { undoSendSeconds: 60 } });
});

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { message: MESSAGE } });
  await prisma.workspace.updateMany({ where: { name: OWNER.workspace }, data: { undoSendSeconds: 30 } });
});

test('"Publish now" can be taken back while it waits', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/compose');
  await page.getByLabel(/what do you want to say/i).fill(MESSAGE);
  const send = page.getByRole('button', { name: /^schedule$/i });
  await expect(async () => {
    if (!(await send.isEnabled())) await page.getByRole('checkbox').first().click();
    await expect(send).toBeEnabled({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Other ways to send it' }).click();
  await page.getByRole('menuitemradio', { name: /Publish now/ }).click();
  await page.getByRole('button', { name: 'Publish now' }).click();

  const bar = page.getByRole('status').filter({ hasText: /Publishing in \d+ seconds/ });
  await expect(bar).toBeVisible();
  const post = await prisma.post.findFirstOrThrow({ where: { message: MESSAGE }, orderBy: { createdAt: 'desc' } });
  expect(post).toMatchObject({ status: 'scheduled', publishMode: 'worker' });

  await bar.getByRole('button', { name: 'Undo' }).click();
  await expect(page).toHaveURL(new RegExp(`/compose\\?post=${post.id}`));
  await expect(page.getByLabel(/what do you want to say/i)).toHaveValue(MESSAGE);
  expect(await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: 'draft', scheduledAt: null });
  expect(failures).toEqual([]);
});
