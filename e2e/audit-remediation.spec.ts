import { expect, test } from '@playwright/test';
import { open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

test.beforeAll(async () => { await connectPretendPage(OWNER.workspace); });
test.afterAll(async () => { await prisma.$disconnect(); });

test('composer guards internal navigation and restores session content after reload', async ({ page }) => {
  await open(page, '/compose');
  await page.locator('#message').fill('Unsaved recovery regression');
  await page.locator('#message').press('End'); await page.locator('#message').press('Space'); await page.locator('#message').press('Backspace');
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('msp-composer:') && sessionStorage.getItem(key)?.includes('Unsaved recovery regression')))).toBe(true);
  await page.getByRole('link', { name: 'Calendar', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Leave this post?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep writing' }).click();
  await expect(page.locator('#message')).toHaveValue('Unsaved recovery regression');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Restore post', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Restore post', exact: true }).click();
  await expect(page.locator('#message')).toHaveValue('Unsaved recovery regression');
});

test('media modal traps focus and restores opener', async ({ page }) => {
  await open(page, '/compose');
  const opener = page.getByRole('button', { name: 'Choose from media library', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Choose from media library' });
  await expect(async () => { await opener.click(); await expect(dialog).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('segmented composer format has one tab stop and arrow navigation', async ({ page }) => {
  await open(page, '/compose');
  const radios = page.getByRole('radiogroup').first().getByRole('radio');
  await expect(radios.nth(0)).toHaveAttribute('tabindex', '0');
  await radios.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(radios.nth(1)).toBeFocused();
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(0)).toHaveAttribute('tabindex', '-1');
});

test('resizing open phone drawer releases desktop focus and scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/dashboard');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(async () => { await menu.click(); await expect(menu).toHaveAttribute('aria-expanded', 'true'); }).toPass();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  expect(await page.locator('main').evaluate(node => Boolean(node.closest('[inert]')))).toBe(false);
});

test('CSV publishing has a scoped Publish screen and a settings entry link', async ({ page }) => {
  await open(page, '/compose/import');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bulk schedule from CSV');
  await expect(page.getByRole('heading', { name: 'Bulk schedule from CSV', exact: true })).toHaveCount(1);
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  await open(page, '/settings');
  await expect(page.getByRole('link', { name: 'Open CSV import in Publish', exact: true })).toHaveAttribute('href', '/compose/import');
});
