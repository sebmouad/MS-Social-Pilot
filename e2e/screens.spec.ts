import { expect, test } from '@playwright/test';

import { connectPretendPage } from './fixtures';
import {
  collectFailures,
  DESKTOP_WIDTHS,
  expectEveryNavLinkShown,
  open,
  OWNER,
  SIGNED_IN_SCREENS,
  ROOT_SCREENS,
} from './helpers';

/**
 * Open every screen behind the sign-in wall and check that it renders.
 *
 * Deliberately shallow: the Vitest suites cover the libraries underneath,
 * faster and in more detail. What they cannot do is notice that a page throws,
 * because none of them render one.
 */

for (const path of [...SIGNED_IN_SCREENS, ...ROOT_SCREENS]) {
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

for (const width of DESKTOP_WIDTHS) {
  test(`every nav link is on screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/dashboard');
    await expectEveryNavLinkShown(page);
  });
}

test('an unfinished setup is pointed out on the dashboard', async ({ page }) => {
  // No worker runs during the walk, so setup is never complete here, and an
  // owner arriving on the dashboard should be told where to finish it.
  await open(page, '/dashboard');
  await expect(page.getByRole('link', { name: 'Continue setup' })).toHaveAttribute('href', '/setup');
});

test('an empty composer says why it cannot send yet', async ({ page }) => {
  await open(page, '/compose');
  const reason = page.locator('#submit-blocker');
  await expect(reason).toBeVisible();
  await expect(page.locator('button[aria-describedby="submit-blocker"]')).toBeDisabled();
});

test('the nav offers every screen it links to', async ({ page }) => {
  // One request per screen, each compiled on first visit by the dev server.
  test.setTimeout(180_000);
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
  await page.locator('details summary').first().click();
  await page.getByRole('textbox', { name: 'From', exact: true }).fill('2026-07-01');
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

test('the icon rail lists the areas, the sidebar the pages of the one in use', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/queue');

  const rail = page.getByRole('navigation', { name: /main areas/i });
  for (const name of [/^home$/i, /^publish$/i, /^inbox$/i, /^analytics$/i, /^settings$/i]) {
    await expect(rail.getByRole('link', { name })).toBeVisible();
  }
  await expect(rail.getByRole('link', { name: /^publish$/i })).toHaveAttribute('aria-current', 'true');

  const sidebar = page.getByRole('banner').getByRole('navigation', { name: /^modules$/i });
  await expect(sidebar.getByRole('link', { name: /^queue$/i })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByRole('link', { name: /^reports$/i })).toHaveCount(0);

  // The top bar says where you are; it holds utilities, not modules.
  await expect(page.getByRole('navigation', { name: /you are here/i })).toContainText('Queue');

  // Another area swaps the sidebar's pages.
  await rail.getByRole('link', { name: /^analytics$/i }).click();
  await expect(page).toHaveURL(/\/analytics/);
  await expect(sidebar.getByRole('link', { name: /^reports$/i })).toBeVisible();

  // Folding the sidebar keeps the rail and survives a reload.
  await expect(async () => {
    await page.getByRole('button', { name: /collapse sidebar/i }).click();
    await expect(sidebar).toHaveCount(0, { timeout: 1_500 });
  }).toPass();
  await page.reload();
  await expect(rail).toBeVisible();
  await expect(page.getByRole('button', { name: /expand sidebar/i })).toBeVisible();
  await page.getByRole('button', { name: /expand sidebar/i }).click();
  await expect(sidebar).toBeVisible();
});

test('Connections offers chips that jump to each part of the page', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, '/connections');
  const chips = page.getByRole('navigation', { name: /jump to/i });
  await expect(chips.getByRole('link', { name: /other networks/i })).toBeVisible();
  await expect(async () => {
    await chips.getByRole('link', { name: /other networks/i }).click();
    await expect(page).toHaveURL(/#networks$/, { timeout: 1_500 });
  }).toPass();
  await expect(page.locator('#networks')).toBeInViewport();
});
