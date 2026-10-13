import { expect, test } from '@playwright/test';
import { open } from './helpers';

test('single task holds input and suppresses duplicate submission during a delayed write', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests++;
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Task rejected' }) });
  });
  await open(page, '/tasks');
  const add = page.getByRole('button', { name: 'Add', exact: true });
  await expect(async () => { await page.locator('#task-title').fill(''); await page.locator('#task-title').fill('Retained task'); await page.locator('#task-title').press('End'); await page.locator('#task-title').press('Space'); await page.locator('#task-title').press('Backspace'); await expect(add).toBeEnabled({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  await add.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('p[role=alert]')).toHaveText('Task rejected');
  await expect(page.locator('#task-title')).toHaveValue('Retained task');
  expect(requests).toBe(1);
  await expect(add).toBeEnabled();
});

test('workflow retains failed and unattempted rows and retry omits created tasks', async ({ page }) => {
  const titles: string[] = [];
  let failed = false;
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const { title } = route.request().postDataJSON(); titles.push(title);
    if (title === 'Three' && !failed) {
      failed = true; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test refusal' }) });
    } else await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: `stub-${titles.length}` }) });
  });
  await open(page, '/tasks');
  await page.getByText('Start a workflow', { exact: true }).click();
  await expect(async () => { const steps = page.getByRole('textbox', { name: 'Steps', exact: true }); await steps.fill(''); await steps.fill('One\nTwo\nThree\nFour\nFive'); await steps.press('End'); await steps.press('Space'); await steps.press('Backspace'); await expect(page.getByRole('button', { name: 'Create the tasks' })).toBeEnabled({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  await page.getByRole('button', { name: 'Create the tasks' }).click();
  await expect(page.locator('p[role=alert]')).toHaveText('Test refusal');
  await expect(page.getByRole('textbox', { name: 'Steps', exact: true })).toHaveValue('Three\nFour\nFive');
  await page.getByRole('button', { name: 'Retry remaining tasks' }).click();
  await expect(page.getByRole('textbox', { name: 'Steps', exact: true })).toHaveValue('');
  expect(titles).toEqual(['One', 'Two', 'Three', 'Three', 'Four', 'Five']);
});
