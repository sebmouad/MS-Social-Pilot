import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Post templates (NEXT_PHASES H4): an editor saves a structure with a blank,
 * hashtags, a first comment and a label; the composer fills it in.
 */

const NAME = 'Weekly offer E2E';
const LABEL = 'Promo E2E';

test.afterAll(async () => {
  await prisma.postTemplate.deleteMany({ where: { name: NAME } });
  await prisma.label.deleteMany({ where: { name: LABEL } });
});

test('saves a template and starts a post from it', async ({ page }) => {
  const failures = collectFailures(page);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: await connectPretendPage(OWNER.workspace) } });
  await prisma.label.upsert({
    where: { workspaceId_name: { workspaceId: target.workspaceId, name: LABEL } },
    create: { workspaceId: target.workspaceId, name: LABEL },
    update: {},
  });

  await open(page, '/templates');
  await expect(page.getByRole('heading', { level: 1, name: 'Post templates' })).toBeVisible();
  // Clicked again until the page has hydrated and the form opens.
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'New template' }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await dialog.getByLabel('Name').fill(NAME);
  await dialog.getByLabel('Category').fill('Promo');
  await dialog.getByLabel('Text').fill('This week only: {product} at a special price.');
  await expect(dialog.getByText('Blank to fill in: product')).toBeVisible();
  await dialog.getByLabel('Hashtags').fill('offer, new');
  await dialog.getByLabel('First comment').fill('Order in the link above.');
  await dialog.getByLabel('Label').selectOption({ label: LABEL });
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Promo' }).getByText(NAME)).toBeVisible();
  await expect(page.getByText('#offer #new')).toBeVisible();

  await open(page, '/compose');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await dialog.getByRole('button', { name: new RegExp(NAME) }).click();
  await dialog.getByLabel('product').fill('Lemon tart');
  await expect(dialog.getByText('This week only: Lemon tart at a special price.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use template' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('#message')).toHaveValue('This week only: Lemon tart at a special price.\n\n#offer #new');
  await expect(page.locator('#first-comment')).toHaveValue('Order in the link above.');
  await expect(page.getByRole('button', { name: `Remove ${LABEL}` })).toBeVisible();
  expect(failures).toEqual([]);
});
