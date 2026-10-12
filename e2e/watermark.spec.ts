import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Watermark per Page (NEXT_PHASES G13): a text watermark set in the Page's
 * dialog is saved, previewed and shown again; "None" removes it. Database only.
 */

let targetId: string;

test.beforeAll(async () => {
  targetId = await connectPretendPage(OWNER.workspace);
});

test.afterAll(async () => {
  await prisma.$executeRaw`UPDATE targets SET watermark = NULL WHERE id = ${targetId}`;
});

test('sets a Page’s text watermark, then removes it', async ({ page }) => {
  await prisma.$executeRaw`UPDATE targets SET watermark = NULL WHERE id = ${targetId}`;
  const failures = collectFailures(page);
  const { name } = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
  await open(page, '/settings/pages');

  const row = page.locator('li').filter({ hasText: name });
  const dialog = page.getByRole('dialog');
  const openDialog = () =>
    expect(async () => {
      await row.getByRole('button', { name: 'Voice, audience & links' }).click();
      await expect(dialog).toBeVisible({ timeout: 2000 });
    }).toPass();

  await openDialog();
  await dialog.getByRole('radio', { name: 'Text' }).click();
  await dialog.getByLabel('Text', { exact: true }).fill('Client A');
  await dialog.getByLabel('Position').selectOption('top-start');
  await expect(dialog.getByRole('figure', { name: 'Preview' })).toContainText('Client A');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => (await prisma.target.findUniqueOrThrow({ where: { id: targetId } })).watermark)
    .toEqual({ text: 'Client A', position: 'top-start', opacity: 70, size: 15 });
  await page.reload();
  await expect(page.locator('li').filter({ hasText: name })).toContainText('watermark');

  await openDialog();
  await dialog.getByRole('radio', { name: 'None' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await prisma.target.findUniqueOrThrow({ where: { id: targetId } })).watermark).toBeNull();
  expect(failures).toEqual([]);
});
