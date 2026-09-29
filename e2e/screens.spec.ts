import { expect, test } from '@playwright/test';

import { connectPretendPage } from './fixtures';
import { collectFailures, open, OWNER, SIGNED_IN_SCREENS } from './helpers';

/**
 * Open every screen behind the sign-in wall and check that it renders.
 *
 * Deliberately shallow: the Vitest suites cover the libraries underneath,
 * faster and in more detail. What they cannot do is notice that a page throws,
 * because none of them render one.
 */

for (const path of SIGNED_IN_SCREENS) {
  test(`${path} renders for a signed-in owner`, async ({ page }) => {
    const failures = collectFailures(page);

    await open(page, path);

    // Not just "a heading": a redirect to /login would also show one. The nav
    // bar is rendered by the signed-in layout and nowhere else.
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    expect(failures, `${path} reported browser errors`).toEqual([]);
  });
}

test('the nav offers every screen it links to', async ({ page }) => {
  await open(page, '/dashboard');

  const hrefs = await page
    .getByRole('banner')
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));

  // A link in the bar that answers 404 is worse than no link at all.
  for (const href of hrefs) {
    if (!href || !href.startsWith('/')) continue;
    const response = await page.request.get(href);
    expect(response.status(), `nav links to ${href}, which answered ${response.status()}`)
      .toBeLessThan(400);
  }
});

test('each screen names itself in the tab, with the client it belongs to', async ({ page }) => {
  const seen = new Map<string, string>();

  for (const path of ['/dashboard', '/posts', '/calendar', '/settings/team']) {
    await open(page, path);
    const title = await page.title();

    // The screen first — a tab strip crops from the right — and the client
    // after it, which is what tells three open windows apart.
    expect(title, `${path} has no title of its own`).not.toBe('MS Social Pilot');
    expect(title, `${path} does not name the client`).toContain('Halloway Studio');

    const clash = seen.get(title);
    expect(clash, `${path} and ${clash} share the title "${title}"`).toBeUndefined();
    seen.set(title, path);
  }
});

test('the report download covers the range on screen, not the one being typed', async ({ page }) => {
  await open(page, '/reports?from=2026-08-01&to=2026-08-31');

  const download = page.getByRole('link', { name: 'Download CSV' });
  await expect(download).toHaveAttribute('href', /from=2026-08-01&to=2026-08-31/);

  // Changed but not applied: the file must still be the report being shown.
  await page.getByLabel('From').fill('2026-07-01');
  await expect(download).toHaveAttribute('href', /from=2026-08-01&to=2026-08-31/);

  const response = await page.request.get((await download.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  // Named for the workspace's days, and for the whole range.
  expect(response.headers()['content-disposition']).toContain('2026-08-01_2026-08-31.csv');
});

test('the export menu closes on Escape and on a click elsewhere', async ({ page }) => {
  // The menu belongs to a Page's analytics, so there has to be a Page.
  await connectPretendPage(OWNER.workspace);
  await open(page, '/analytics');

  const trigger = page.getByRole('button', { name: 'Export' });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  // Retry until it reports itself open: the handler is attached at hydration,
  // which on a development build can land after the first click.
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // Focus goes into the menu, so the arrow keys work straight away.
  await expect(menu.getByRole('menuitem').first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.getByRole('heading', { level: 1 }).first().click();
  await expect(menu).toBeHidden();
});
