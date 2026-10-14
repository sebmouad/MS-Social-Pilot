import { expect, test } from '@playwright/test';

import { prisma } from './fixtures';
import { open, OWNER } from './helpers';

const NAME = 'Review selection Page';
let targetId = '';
let accountId = '';
let adAccountId = '';

test.beforeAll(async () => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const account = await prisma.socialAccount.create({ data: {
    workspaceId: workspace.id, provider: 'facebook', providerUserId: 'e2e-selection-user',
    name: 'Selection test account', accessToken: 'test-token',
  } });
  accountId = account.id;
  const target = await prisma.target.create({ data: {
    workspaceId: workspace.id, socialAccountId: account.id, type: 'page',
    providerId: 'e2e-selection-page', name: NAME, enabled: false,
  } });
  targetId = target.id;
  const adAccount = await prisma.adAccount.create({ data: { workspaceId: workspace.id, socialAccountId: account.id, actId: 'act_e2e_selection', name: 'Review selection ads', currency: 'USD' } });
  adAccountId = adAccount.id;
  await prisma.adInsight.create({ data: { adAccountId, level: 'account', objectId: 'retained-spend', date: new Date(), spend: 3 } });
});

test.afterAll(async () => {
  if (targetId) await prisma.target.deleteMany({ where: { id: targetId } });
  if (adAccountId) await prisma.adAccount.deleteMany({ where: { id: adAccountId } });
  if (accountId) await prisma.socialAccount.deleteMany({ where: { id: accountId } });
  await prisma.$disconnect();
});

test('retains ad insights when disconnecting an ad account', async ({ page }) => {
  await open(page, '/connections');
  await page.waitForLoadState('networkidle');
  const row = page.locator('#ads').getByRole('row').filter({ hasText: 'Review selection ads' });
  await expect(row.getByRole('checkbox')).toBeChecked();
  await row.getByRole('button', { name: 'Disconnect' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('What should happen to related data?');
  await dialog.getByRole('button', { name: 'Disconnect' }).click();
  await expect(dialog).not.toBeVisible();
  expect(await prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } })).toMatchObject({ enabled: false, socialAccountId: null });
  expect(await prisma.adInsight.count({ where: { adAccountId } })).toBe(1);
});

test('selects a discovered channel, then disconnects it while keeping history', async ({ page }) => {
  await open(page, '/connections?select=1');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/choose the channels/i)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: NAME });
  const selected = row.getByRole('checkbox', { name: `Include ${NAME} in the app` });
  await expect(selected).not.toBeChecked();
  const changed = page.waitForResponse((response) => response.url().includes(`/api/targets/${targetId}`) && response.request().method() === 'PATCH');
  await selected.click();
  expect((await changed).status()).toBe(200);
  await expect(selected).toBeChecked();

  await row.getByRole('button', { name: `Disconnect ${NAME}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('What should happen to related data?');
  await dialog.getByText('Keep posts, analytics and channel history').click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const retained = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
  expect(retained.enabled).toBe(false);
  expect(retained.socialAccountId).toBeNull();
});
