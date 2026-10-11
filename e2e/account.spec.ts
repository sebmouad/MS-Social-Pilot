import { expect, test, type Page } from '@playwright/test';

import { collectFailures, open } from './helpers';

/**
 * The account screens under pressure: a role changed by mistake, a request
 * that never comes back, a client switched from deep inside another one.
 *
 * Each of these used to fail quietly — a role changed on a stray pick, a
 * button stuck on "Please wait…", a 404 after switching — so each is walked
 * rather than assumed.
 */

const MEMBER = {
  name: 'Pat Quill',
  email: 'pat.quill@example.test',
  password: 'a-long-enough-password',
};
const MEMBER_STATE = 'e2e/.auth/member.json';

test.describe.configure({ mode: 'serial' });

test('a colleague with a workspace of their own joins the owner’s', async ({ page, browser }) => {
  const invite = await page.request.post('/api/team', {
    data: { email: MEMBER.email, role: 'contributor' },
  });
  expect(invite.status(), await invite.text()).toBe(201);
  const { acceptUrl } = (await invite.json()) as { acceptUrl: string };
  const token = acceptUrl.split('/').pop() ?? '';

  // Registering creates their own workspace; accepting adds the owner's. Two
  // memberships is what puts a switcher in their nav bar.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const registered = await context.request.post('/api/auth/register', { data: MEMBER });
  expect(registered.status(), await registered.text()).toBe(201);
  const accepted = await context.request.post('/api/team/accept', { data: { token } });
  expect(accepted.status(), await accepted.text()).toBe(200);

  await context.storageState({ path: MEMBER_STATE });
  await context.close();
});

test('changing a role asks first, and a refusal changes nothing', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/settings/team');
  // A pick made before hydration never reaches the handler; nothing to test.
  await page.waitForLoadState('networkidle');

  const select = page.getByRole('combobox', { name: `Role for ${MEMBER.name}` });
  await expect(select).toHaveValue('contributor');

  let patches = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/api/team/')) patches += 1;
  });

  // Cancelled: the menu goes back to what is stored and nothing is sent.
  await select.selectOption('editor');
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog).toContainText(`Change ${MEMBER.name} from Contributor to Editor?`);
  await confirmDialog.getByRole('button', { name: /^cancel$/i }).click();
  await expect(select).toHaveValue('contributor');
  expect(patches).toBe(0);

  // Confirmed: the change is sent once, and the menu is locked while it is.
  const patched = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/api/team/'),
  );
  await select.selectOption('editor');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  expect((await patched).status()).toBe(200);
  await expect(select).toHaveValue('editor');
  await expect(select).toBeEnabled();
  expect(patches).toBe(1);

  expect(failures).toEqual([]);
});

test('an invitation that never reaches the server gives the button back', async ({ page }) => {
  await open(page, '/settings/team');
  await page.waitForLoadState('networkidle');

  const send = page.getByRole('button', { name: 'Send invitation' });
  await page.getByLabel('Email address').fill('nobody@example.test');
  await expect(send).toBeEnabled();

  await page.route('**/api/team', (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
  );
  await send.click();

  await expect(page.getByRole('alert').filter({ hasText: /could not reach the server/i })).toBeVisible();
  await expect(send).toBeEnabled();
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a sign-in that never reaches the server gives the button back', async ({ page }) => {
    await open(page, '/login');
    await page.route('**/api/auth/login', (route) => route.abort('internetdisconnected'));

    await page.getByLabel(/e-?mail/i).fill(MEMBER.email);
    await page.getByLabel(/^password$/i).fill(MEMBER.password);
    const submit = page.getByRole('button', { name: /sign in/i });
    await submit.click();

    await expect(page.getByRole('alert').filter({ hasText: /could not reach the server/i })).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText(/sign in/i);
  });
});

test.describe('as the colleague', () => {
  test.use({ storageState: MEMBER_STATE });

  const switcher = (page: Page) => page.getByRole('combobox', { name: /switch client/i });
  /** Whichever client is not the current one: the colleague has exactly two. */
  const otherClient = async (page: Page) =>
    (await switcher(page).locator('option:not(:checked)').first().getAttribute('value')) ?? '';

  test('a failed switch says so and stays put', async ({ page }) => {
    await open(page, '/settings/notifications');
    await page.waitForLoadState('networkidle');
    const before = await switcher(page).inputValue();
    await page.route('**/api/workspace/switch', (route) => route.abort('internetdisconnected'));

    await switcher(page).selectOption(await otherClient(page));

    await expect(page.getByRole('alert').filter({ hasText: /could not switch client/i })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/notifications$/);
    await expect(switcher(page)).toHaveValue(before);
    await expect(switcher(page)).toBeEnabled();
  });

  test('switching client lands on the new client’s dashboard', async ({ page }) => {
    const failures = collectFailures(page);

    // Deep inside the owner's workspace, where the URL would mean nothing to
    // the other one.
    await open(page, '/settings/notifications');
    await page.waitForLoadState('networkidle');
    const before = await switcher(page).inputValue();

    await switcher(page).selectOption(await otherClient(page));

    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(switcher(page)).not.toHaveValue(before);
    await expect(switcher(page)).toBeEnabled();

    expect(failures).toEqual([]);
  });
});
