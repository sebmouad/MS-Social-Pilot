import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * A feed, edited after the fact.
 *
 * The API always accepted a new name, template, destinations and approval
 * setting; the screen only offered an on/off switch, so changing any of them
 * meant deleting the feed — and with it the record of what had already been
 * posted. This walks the form that replaced that.
 */

test.describe.configure({ mode: 'serial' });

let feedId: string;

test.beforeAll(async () => {
  const targetId = await connectPretendPage(OWNER.workspace);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const owner = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });

  await prisma.feedSource.deleteMany({ where: { workspaceId: workspace.id, name: { startsWith: 'Bakery journal' } } });
  const feed = await prisma.feedSource.create({
    data: {
      workspaceId: workspace.id,
      name: 'Bakery journal',
      url: 'https://journal.example.com/feed.xml',
      targetIds: [targetId],
      // Never polled by the walk: disabled, so the worker leaves it alone.
      enabled: false,
    },
  });
  feedId = feed.id;

  const item = await prisma.feedItem.create({
    data: {
      feedSourceId: feed.id,
      guid: 'rye-week',
      url: 'https://journal.example.com/rye-week',
      title: 'Rye week starts Monday',
    },
  });
  await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: owner.id,
      message: 'Rye week starts Monday\n\nhttps://journal.example.com/rye-week',
      link: 'https://journal.example.com/rye-week',
      status: 'scheduled',
      publishMode: 'worker',
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      timezone: 'UTC',
      sourceFeedItemId: item.id,
      targets: { create: [{ targetId }] },
    },
  });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('a feed shows what it imported, and can be edited in place', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/feeds');

  const card = page.locator('section', { hasText: 'Bakery journal' });
  await expect(card.getByText('Rye week starts Monday')).toBeVisible();
  await expect(card.getByRole('link', { name: /view post/i })).toHaveAttribute('href', /\/compose\?post=/);

  // A click only registers once React has attached its handler, which in a
  // development build can be a second or two after the button appears.
  await expect(async () => {
    await card.getByRole('button', { name: /^edit$/i }).click();
    await expect(card.getByLabel(/^name$/i)).toBeVisible({ timeout: 1_000 });
  }).toPass();

  await card.getByLabel(/^name$/i).fill('Bakery journal (weekly)');
  await card.getByLabel(/post template/i).fill('New on the journal: {{title}}');
  // The preview uses the feed's own latest headline.
  await expect(card.getByTestId('feed-template-preview')).toHaveText('New on the journal: Rye week starts Monday');
  await card.getByLabel(/schedule new items automatically/i).uncheck();

  await card.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('status')).toHaveText(/feed saved/i);
  await expect(page.getByText('Bakery journal (weekly)')).toBeVisible();
  await expect(page.getByText(/needs approval/i)).toBeVisible();

  const saved = await prisma.feedSource.findUniqueOrThrow({ where: { id: feedId } });
  expect(saved.name).toBe('Bakery journal (weekly)');
  expect(saved.messageTemplate).toBe('New on the journal: {{title}}');
  expect(saved.autoApprove).toBe(false);
  expect(saved.targetIds).toHaveLength(1);

  expect(failures).toEqual([]);
});
