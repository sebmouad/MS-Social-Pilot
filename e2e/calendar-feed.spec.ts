import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Calendar feed: a private ICS address, shown once, revocable. */

const MESSAGE = 'Calendar feed E2E post';

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { message: MESSAGE } });
  await prisma.calendarFeed.deleteMany({ where: { user: { email: OWNER.email } } });
});

test('creates a calendar address that serves the posts, then revokes it', async ({ page, request }) => {
  const failures = collectFailures(page);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: await connectPretendPage(OWNER.workspace) } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  await prisma.post.create({
    data: {
      workspaceId: target.workspaceId,
      authorId: owner.id,
      message: MESSAGE,
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 3 * 86_400_000),
      targets: { create: { targetId: target.id } },
    },
  });

  await open(page, '/calendar');
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await dialog.getByRole('button', { name: 'Create address' }).click();
  const address = await dialog.getByLabel('Your private address').inputValue();
  expect(address).toMatch(/\/api\/calendar-feed\/[\w-]{20,}$/);

  const path = new URL(address).pathname;
  const feed = await request.get(path);
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('text/calendar');
  expect(await feed.text()).toContain(MESSAGE);

  const list = dialog.getByRole('list', { name: 'Your subscriptions' });
  await list.getByRole('button', { name: 'Revoke' }).first().click();
  await page.locator('[data-confirm]').click();
  await expect(async () => expect((await request.get(path)).status()).toBe(404)).toPass();
  expect(failures).toEqual([]);
});
