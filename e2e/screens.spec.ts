import { expect, test } from '@playwright/test';

import { collectFailures, open, SIGNED_IN_SCREENS } from './helpers';

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
