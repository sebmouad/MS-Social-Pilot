import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { prisma } from './fixtures';

/** The sidebar's "By platform" list narrows a screen to one platform's channels. */

const PROVIDER_ID = 'did:plc:e2e-platforms';

test.afterAll(async () => {
  await prisma.target.deleteMany({ where: { providerId: { startsWith: PROVIDER_ID } } });
  await prisma.socialAccount.deleteMany({ where: { providerUserId: PROVIDER_ID } });
});

test('the sidebar lists platforms, and picking one narrows the screen to it', async ({ page }) => {
  const failures = collectFailures(page);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const account = await prisma.socialAccount.create({
    data: { workspaceId: workspace.id, provider: 'bluesky', providerUserId: PROVIDER_ID, name: '@client-b.example', accessToken: 'unused' },
  });
  // Two platforms, so the list has something to choose between.
  await prisma.target.createMany({
    data: [
      { workspaceId: workspace.id, socialAccountId: account.id, type: 'bluesky', providerId: PROVIDER_ID, name: '@client-b.example' },
      { workspaceId: workspace.id, socialAccountId: account.id, type: 'mastodon', providerId: `${PROVIDER_ID}-m`, name: '@client-c@example.social' },
    ],
  });

  await open(page, '/posts');
  const sidebar = page.locator('.shell-sidebar');
  await expect(sidebar.getByText('By platform')).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'All platforms' })).toHaveAttribute('aria-current', 'true');

  await sidebar.getByRole('link', { name: 'Bluesky' }).click();
  await page.waitForURL(/net=bluesky/);
  await expect(sidebar.getByRole('link', { name: 'Bluesky' })).toHaveAttribute('aria-current', 'true');

  await sidebar.getByRole('link', { name: 'Mastodon' }).click();
  await page.waitForURL(/net=mastodon/);
  await expect(page.getByText('@client-c@example.social').first()).toBeVisible();
  await expect(page.getByText('@client-b.example')).toHaveCount(0);

  // Settings screens are not narrowed by platform.
  await open(page, '/settings');
  await expect(page.locator('.shell-sidebar').getByText('By platform')).toHaveCount(0);
  expect(failures).toEqual([]);
});
