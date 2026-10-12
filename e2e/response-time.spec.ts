import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Inbox response time (NEXT_PHASES H11): business hours in Settings, the figures under Analytics. */

let postId = '';
let workspaceId = '';

test.afterAll(async () => {
  if (postId) await prisma.post.deleteMany({ where: { id: postId } });
  if (workspaceId) await prisma.workspace.update({ where: { id: workspaceId }, data: { businessDays: [] } });
});

test('sets business hours and shows how fast comments were answered', async ({ page }) => {
  const failures = collectFailures(page);
  const targetId = await connectPretendPage(OWNER.workspace);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
  workspaceId = target.workspaceId;
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });

  const asked = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const post = await prisma.post.create({ data: { workspaceId, authorId: owner.id, message: 'Product launch' } });
  postId = post.id;
  const postTarget = await prisma.postTarget.create({ data: { postId, targetId } });
  await prisma.postComment.createMany({
    data: [
      { postTargetId: postTarget.id, remoteId: 'rt-c1', fromId: 'someone', message: 'When does it open?', createdTime: asked },
      {
        postTargetId: postTarget.id,
        remoteId: 'rt-r1',
        parentRemoteId: 'rt-c1',
        fromId: target.providerId,
        message: 'At nine.',
        createdTime: new Date(asked.getTime() + 25 * 60 * 1000),
        sentById: owner.id,
      },
    ],
  });

  await open(page, '/settings');
  const hours = page.getByRole('group', { name: 'Business hours' });
  // Clicks before hydration do nothing; retry until the hours appear.
  await expect(async () => {
    if (!(await page.getByLabel('From').isVisible())) await hours.getByText('Mon', { exact: true }).click();
    await expect(page.getByLabel('From')).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await page.getByRole('button', { name: 'Save workspace' }).click();
  await expect.poll(async () => (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).businessDays).toEqual([1]);

  await open(page, `/analytics?view=responseTime&pages=${targetId}&range=7d`);
  await expect(page.getByText('Times count business hours only, as set in Settings.')).toBeVisible();

  await prisma.workspace.update({ where: { id: workspaceId }, data: { businessDays: [] } });
  await page.reload();
  const byPage = page.getByRole('region', { name: 'By Page' });
  await expect(byPage.getByRole('row', { name: new RegExp(`${target.name} · comments`) })).toContainText('25 min');
  const members = page.getByRole('region', { name: 'Who answered' });
  await expect(members.getByRole('row', { name: new RegExp(OWNER.name) })).toContainText('25 min');

  await open(page, `/reports?target=${targetId}&range=7d&sections=responseTime`);
  await expect(page.getByRole('heading', { name: 'Response time', level: 2 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Who answered' })).toContainText('25 min');
  expect(failures).toEqual([]);
});
