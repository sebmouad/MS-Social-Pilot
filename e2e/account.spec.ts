import { expect, test, type Page } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';

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

test('root sees AI spend and can only save prices written as model=input/output', async ({ page }) => {
  await open(page, '/root/config');
  await expect(page.getByRole('heading', { name: /AI spend|Dépenses IA/ })).toBeVisible();
  await expect(page.getByText(/No AI generations in the last 30 days|Aucune génération IA/)).toBeVisible();

  const prices = page.locator('#ai\\.priceOverrides');
  const save = page.getByRole('button', { name: /^(Save|Enregistrer)$/ });
  // Typed before hydration, the change never reaches React and Save stays off.
  await expect(async () => {
    await prices.fill('');
    await prices.fill('my-model=$2');
    await expect(save).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await save.click();
  await expect(page.getByText(/Write each price as model=input\/output/)).toBeVisible();

  await prices.fill('my-model=2/10');
  await page.getByRole('button', { name: /^(Save|Enregistrer)$/ }).click();
  await expect(prices).toHaveValue('my-model=2/10');

  const reset = await page.request.post('/api/root/config', { data: { values: { 'ai.priceOverrides': null } } });
  expect(reset.status()).toBe(200);
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

test('a person picks the Warm look, it follows them, and Facebook comes back', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/settings/account');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'facebook');

  // A tick before hydration is undone by React, so wait for React's own
  // highlight on the chosen option, not just the native check. A radio left
  // checked by a lost click would make the next check() a no-op, so each try
  // goes through Facebook first.
  const warm = page.getByRole('radio', { name: /warm/i });
  await expect(async () => {
    await page.getByRole('radio', { name: /facebook/i }).check();
    await warm.check();
    await expect(page.locator('label').filter({ has: warm })).toHaveClass(/ring-2/, { timeout: 1_500 });
  }).toPass();
  await page.getByRole('button', { name: /^save$/i }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');

  // Another screen, rendered by the server, keeps it; the page under the cards turns cream.
  await open(page, '/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(245, 241, 232)');

  // Dark turns the cards dark while white text stays white.
  const dark = await page.request.patch('/api/account', { data: { theme: 'dark' } });
  expect(dark.status(), await dark.text()).toBe(200);
  await open(page, '/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(24, 25, 26)');
  const button = page.getByRole('link', { name: /new post/i }).first();
  await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');

  // Back to the default, so the other walks see the usual look.
  const reset = await page.request.patch('/api/account', { data: { theme: 'facebook' } });
  expect(reset.status(), await reset.text()).toBe(200);
  await open(page, '/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'facebook');
});

test('a person sees their signed-in browsers and signs one out; root sees everybody’s', async ({ page, browser }) => {
  // A second browser, as from another computer.
  const other = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  });
  const signedIn = await other.request.post('/api/auth/login', { data: { email: OWNER.email, password: OWNER.password } });
  expect(signedIn.status(), await signedIn.text()).toBe(200);

  await open(page, '/root/sessions');
  const all = page.getByRole('list', { name: 'Signed-in browsers' });
  await expect(all.getByText('Firefox on Windows')).toBeVisible();
  await expect(all.getByText(OWNER.email).first()).toBeVisible();

  await open(page, '/settings/account');
  const list = page.getByRole('list', { name: 'Signed-in browsers' });
  await expect(list.getByText('This browser')).toBeVisible();
  const row = list.getByRole('listitem').filter({ hasText: 'Firefox on Windows' });
  await expect(row).toHaveCount(1);

  await expect(async () => {
    await row.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect(row).toHaveCount(0);

  const after = await other.request.get('/api/account/sessions');
  expect(after.status()).toBe(401);
  await other.close();
});
