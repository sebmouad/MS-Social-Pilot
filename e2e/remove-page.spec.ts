import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Removing a Page from a workspace. Reported as a bug: two Pages added by
 * mistake could only be switched off, and a Page left behind by a
 * disconnected account was shown nowhere. Nothing here talks to Facebook.
 */

test.describe.configure({ mode: 'serial' });

const EXTRA = 'Client A (remove walk)';
const ORPHAN = 'Client B (remove walk)';

test.beforeAll(async () => {
  const pageId = await connectPretendPage(OWNER.workspace);
  const page = await prisma.target.findUniqueOrThrow({ where: { id: pageId } });
  await prisma.target.deleteMany({ where: { name: { endsWith: '(remove walk)' } } });
  await prisma.target.createMany({
    data: [
      { workspaceId: page.workspaceId, socialAccountId: page.socialAccountId, type: 'page', providerId: 'remove-walk-1', name: EXTRA },
      // What a disconnected account leaves behind.
      {
        workspaceId: page.workspaceId,
        socialAccountId: null,
        type: 'page',
        providerId: 'remove-walk-2',
        name: ORPHAN,
        enabled: false,
        canPublish: false,
        publishBlockerCode: 'disconnected',
      },
    ],
  });
});

test.afterAll(async () => {
  await prisma.target.deleteMany({ where: { name: { endsWith: '(remove walk)' } } });
});

for (const name of [EXTRA, ORPHAN]) {
  test(`${name} can be removed from Connections`, async ({ page }) => {
    const failures = collectFailures(page);
    await open(page, '/connections');

    if (name === ORPHAN) await expect(page.getByRole('heading', { name: 'Pages no longer connected' })).toBeVisible();
    await page.getByRole('button', { name: `Remove ${name}` }).click();
    await expect(page.getByRole('dialog')).toContainText(`Remove ${name} from this workspace?`);
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByRole('status')).toContainText(`${name} was removed.`);
    await expect(page.getByRole('button', { name: `Remove ${name}` })).toHaveCount(0);
    expect(await prisma.target.count({ where: { name } })).toBe(0);
    expect(failures).toEqual([]);
  });
}
