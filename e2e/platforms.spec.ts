import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { prisma } from './fixtures';

/** The sidebar groups channels by platform; a platform header narrows the screen to it. */

const PROVIDER_ID = 'did:plc:e2e-platforms';

test.afterAll(async () => {
  await prisma.target.deleteMany({ where: { providerId: { startsWith: PROVIDER_ID } } });
  await prisma.socialAccount.deleteMany({ where: { providerUserId: PROVIDER_ID } });
});

test('picking a platform header narrows the screen to its channels', async ({ page }) => {
  const failures = collectFailures(page);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const account = await prisma.socialAccount.create({
    data: { workspaceId: workspace.id, provider: 'bluesky', providerUserId: PROVIDER_ID, name: '@client-b.example', accessToken: 'unused' },
  });
  await prisma.target.createMany({
    data: [
      { workspaceId: workspace.id, socialAccountId: account.id, type: 'bluesky', providerId: PROVIDER_ID, name: '@client-b.example' },
      { workspaceId: workspace.id, socialAccountId: account.id, type: 'mastodon', providerId: `${PROVIDER_ID}-m`, name: '@client-c@example.social' },
    ],
  });

  await open(page, '/posts');
  const sidebar = page.locator('.shell-sidebar');
  // A click before hydration does nothing: click until the URL follows.
  await expect(async () => {
    await sidebar.getByRole('button', { name: /^Mastodon/ }).click();
    await page.waitForURL(/net=mastodon/, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(sidebar.getByText('@client-c@example.social').first()).toBeVisible();
  await expect(sidebar.getByText('@client-b.example')).toHaveCount(0);

  await sidebar.getByRole('button', { name: /^Mastodon/ }).click();
  await expect(page).not.toHaveURL(/net=/, { timeout: 30_000 });
  await expect(sidebar.getByText('@client-b.example').first()).toBeVisible();
  expect(failures).toEqual([]);
});
