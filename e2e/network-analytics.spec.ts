import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { prisma } from './fixtures';

/** Posts on the other networks, with the counters the worker read, under Analytics. */

const PROVIDER_ID = 'did:plc:e2e-analytics';

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { message: 'e2e network analytics post' } });
  await prisma.target.deleteMany({ where: { providerId: PROVIDER_ID } });
  await prisma.socialAccount.deleteMany({ where: { providerUserId: PROVIDER_ID } });
});

test('shows likes, reposts and replies per network and per post', async ({ page }) => {
  const failures = collectFailures(page);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const author = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });
  const account = await prisma.socialAccount.create({
    data: { workspaceId: workspace.id, provider: 'bluesky', providerUserId: PROVIDER_ID, name: '@client-a.example', accessToken: 'unused' },
  });
  const target = await prisma.target.create({
    data: { workspaceId: workspace.id, socialAccountId: account.id, type: 'bluesky', providerId: PROVIDER_ID, name: '@client-a.example' },
  });
  await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: author.id,
      message: 'e2e network analytics post',
      targets: {
        create: {
          targetId: target.id,
          status: 'published',
          publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          remotePostId: 'at://did:plc:e2e-analytics/app.bsky.feed.post/1',
          insights: { impressions: null, reach: null, engagedUsers: null, reactions: 7, comments: 2, shares: 3, clicks: null },
        },
      },
    },
  });

  await open(page, '/analytics?view=networks');
  const bluesky = page.getByRole('region', { name: 'Bluesky' });
  await expect(bluesky.getByText('Likes')).toBeVisible();
  const row = page.getByRole('row', { name: /e2e network analytics post/ });
  await expect(row).toContainText('7');
  await expect(row).toContainText('3');
  await expect(row).toContainText('2');
  expect(failures).toEqual([]);
});
