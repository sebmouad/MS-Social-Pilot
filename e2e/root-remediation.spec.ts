import { expect, test } from '@playwright/test';
import { open } from './helpers';

test('root config guards unsaved navigation and reverting a field clears dirty state', async ({ page }) => {
  await open(page, '/root/config/url');
  const url = page.locator('[id="app.url"]');
  const original = await url.inputValue();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(async () => { await url.fill('https://draft.example.test'); await url.press('End'); await url.press('Space'); await url.press('Backspace'); await expect(save).toBeEnabled({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  await page.getByRole('link', { name: 'Status', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Leave unsaved settings?' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(url).toHaveValue('https://draft.example.test');
  await url.fill(original); await expect(save).toBeDisabled();
  await page.getByRole('link', { name: 'Status', exact: true }).click();
  await expect(page).toHaveURL(/\/root\/status$/);
});

test('root mobile menu closes after navigation and skip link targets main content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/root');
  const menu = page.locator('[aria-controls="root-menu"]');
  await expect(async () => { await menu.click(); await expect(menu).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 }); }).toPass({ timeout: 15000 });
  await page.getByRole('link', { name: 'Status', exact: true }).click();
  await expect(page).toHaveURL(/\/root\/status$/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#root-content');
});

test('root email screen has one section title', async ({ page }) => {
  await open(page, '/root/config/email');
  await expect(page.getByRole('heading', { name: 'Email', exact: true })).toHaveCount(1);
});
