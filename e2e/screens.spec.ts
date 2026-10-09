import { expect, test } from '@playwright/test';

import {
  collectFailures,
  DESKTOP_WIDTHS,
  expectEveryNavLinkShown,
  open,
  SIGNED_IN_SCREENS,
} from './helpers';

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
