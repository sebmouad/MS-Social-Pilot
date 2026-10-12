import { expect, test } from '@playwright/test';

import {
  collectFailures,
  DESKTOP_WIDTHS,
  expectEveryNavLinkShown,
  open,
  ROOT_SCREENS,
  SIGNED_IN_SCREENS,
} from './helpers';

/**
 * A colleague is invited, accepts, and finds the app in their own language.
 *
 * This is the only walk that renders the screens in French. Every label on them
 * is a lookup, and a lookup that misses is invisible in English — so an English
 * walk of a bilingual app is half a walk.
 */

const COLLEAGUE = {
  name: 'Colette Marchand',
  email: 'colette@example.test',
  password: 'un-mot-de-passe-assez-long',
};

test.describe.configure({ mode: 'serial' });

let acceptUrl = '';

test('the owner can invite a colleague', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/settings/team');
  await expect(page.getByRole('banner')).toBeVisible();

  // Through the API rather than the form: the link is what the next test needs,
  // and no screen shows it — it goes out by email.
  const response = await page.request.post('/api/team', {
    data: { email: COLLEAGUE.email, role: 'editor' },
  });
  expect(response.status(), await response.text()).toBe(201);

  const body = (await response.json()) as { acceptUrl?: string };
  acceptUrl = body.acceptUrl ?? '';
  expect(acceptUrl).toMatch(/^\/invite\//);

  // And the invitation is now visible to the person who sent it.
  await open(page, '/settings/team');
  await expect(page.getByText(COLLEAGUE.email)).toBeVisible();

  expect(failures).toEqual([]);
});

test.describe('the invited colleague, in French', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    locale: 'fr-FR',
    extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9' },
  });

  test('accepts the invitation and lands in the workspace', async ({ page }) => {
    const failures = collectFailures(page);

    await open(page, acceptUrl);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Signed out, so the landing page offers the detour — and has to bring the
    // invitation along, or the account is created against nothing.
    await page.getByRole('link', { name: /cr[ée]er|create/i }).click();
    await expect(page).toHaveURL(/\/register\?invite=/);

    await page.getByLabel(/votre nom|your name/i).fill(COLLEAGUE.name);
    await page.getByLabel(/e-?mail/i).fill(COLLEAGUE.email);
    await page.getByLabel(/^mot de passe$|^password$/i).fill(COLLEAGUE.password);
    await page.getByRole('button', { name: /cr[ée]er|create/i }).click();

    // Registering with an invitation returns to the invitation, which is where
    // the accept button is.
    await page.waitForURL(/\/invite\//, { timeout: 30_000 });
    await page.getByRole('button', { name: /accepter|accept/i }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole('banner')).toBeVisible();

    expect(failures).toEqual([]);

    await page.context().storageState({ path: 'e2e/.auth/colleague.json' });
  });

  test('is not shown a settings form they cannot save', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'e2e/.auth/colleague.json' });
    const page = await context.newPage();

    await open(page, '/settings');

    // An editor is below canManageSettings, so the four workspace sections are
    // gone and the reason is on screen in their place. Bulk upload stays:
    // creating posts is what the role is for.
    await expect(page.getByRole('button', { name: /save|enregistrer/i })).toHaveCount(0);
    await expect(page.getByText(/only workspace owners and admins|seuls les propriétaires/i))
      .toBeVisible();

    await context.close();
  });

  test('is not sent to setup, which only an owner can finish', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'e2e/.auth/colleague.json' });
    const page = await context.newPage();

    await open(page, '/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('a[href="/setup"]')).toHaveCount(0);
    await context.close();
  });

  // French labels run about a third longer than English, so the header row
  // that fits in English is checked again here.
  for (const width of DESKTOP_WIDTHS) {
    test(`every nav link is on screen at ${width}px in French`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: 'e2e/.auth/colleague.json',
        viewport: { width, height: 900 },
      });
      const page = await context.newPage();

      await open(page, '/dashboard');
      await expect(page.getByRole('link', { name: 'Réglages', exact: true })).toBeAttached();
      await expectEveryNavLinkShown(page);
      await context.close();
    });
  }

  test('cannot reach the installation settings', async ({ browser }) => {
    // A dozen addresses, each compiled on first visit by the dev server.
    test.setTimeout(180_000);
    // Registering gave them a workspace of their own to own, which used to be
    // enough to rewrite the Facebook app credentials for every client here.
    const context = await browser.newContext({ storageState: 'e2e/.auth/colleague.json' });
    const page = await context.newPage();

    // The root section does not exist for them: 404, old addresses included.
    for (const path of ['/settings/config', ...ROOT_SCREENS]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
    await expect(page.getByRole('link', { name: 'Root' })).toHaveCount(0);

    for (const path of ['/api/settings/config', '/api/root/config']) {
      expect((await page.request.get(path)).status(), path).toBe(404);
      const write = await page.request.post(path, {
        data: { values: { 'facebook.graphVersion': 'v1.0' } },
      });
      expect(write.status(), path).toBe(404);
    }
    const setup = await page.request.post('/api/setup', {
      data: { facebookAppId: 'someone-else', facebookAppSecret: 'x' },
    });
    expect(setup.status()).toBe(403);

    await context.close();
  });

  // An editor sees fewer screens than an owner; the ones they do see must be
  // whole. A missing French key throws, so rendering at all is the assertion.
  // Developer screens are the workspace owner's alone.
  for (const path of SIGNED_IN_SCREENS.filter((screen) => !['/settings/webhooks', '/settings/api'].includes(screen))) {
    test(`${path} renders in French`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: 'e2e/.auth/colleague.json',
        locale: 'fr-FR',
        extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9' },
      });
      const page = await context.newPage();
      const failures = collectFailures(page);

      await open(page, path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

      expect(failures, `${path} reported browser errors in French`).toEqual([]);
      await context.close();
    });
  }
});
