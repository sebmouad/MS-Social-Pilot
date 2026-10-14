import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { prisma } from './fixtures';

test.beforeAll(async () => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const account = await prisma.adAccount.create({
    data: { workspaceId: workspace.id, actId: 'act_e2e_metrics', name: 'Test ad account', currency: 'USD', lastSyncedAt: new Date() },
  });
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  await prisma.adInsight.createMany({ data: [
    { adAccountId: account.id, level: 'account', objectId: account.actId, date, spend: 20, impressions: 1000, clicks: 20 },
    { adAccountId: account.id, level: 'campaign', objectId: 'campaign-e2e', objectName: 'Test campaign', date,
      spend: 20, impressions: 1000, clicks: 20, frequency: 1.5,
      actions: { actions: [{ action_type: 'link_click', value: '7' }] },
      fields: { video_p25_watched_actions: '12' },
    },
  ] });
});

test.afterAll(async () => {
  await prisma.adAccount.deleteMany({ where: { actId: 'act_e2e_metrics' } });
  await prisma.$disconnect();
});

test('Ads exposes stored campaign metrics in the populated view', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/ads');
  await expect(page.getByText('Test campaign')).toBeVisible();
  await page.getByText('All stored metrics').click();
  await expect(page.getByText('video p25 watched actions')).toBeVisible();
  await expect(page.getByText('actions: link click')).toBeVisible();
  await expect(page.getByText('cost per action type: link click')).toHaveCount(0);
  expect(failures).toEqual([]);
});
