import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import { connectPretendPage, prisma } from './fixtures';
import { open, OWNER } from './helpers';

/**
 * The screenshots in the documentation, taken from the running app.
 *
 * Written as a spec rather than a script so the pictures cannot drift from the
 * product: they are produced by the same walk that asserts the screens render,
 * against the same seeded workspace, and a screen that stops rendering fails
 * here rather than quietly shipping a stale image.
 *
 *   npm run screenshots
 *
 * Only the screens somebody reads the documentation to understand are here.
 * A picture of every screen is a maintenance burden that nobody looks at.
 */

const SHOTS: Array<{ path: string; file: string }> = [
  { path: '/setup', file: 'setup' },
  { path: '/dashboard', file: 'dashboard' },
  { path: '/compose', file: 'compose' },
  { path: '/calendar', file: 'calendar' },
  { path: '/connections', file: 'connections' },
  { path: '/analytics', file: 'analytics' },
  { path: '/settings/team', file: 'team' },
];

const OUTPUT = 'test-results/screenshots';

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(async () => {
  await mkdir(OUTPUT, { recursive: true });
  // A connected Page, so the pictures show the screens as somebody using the
  // product sees them. Every list renders a much simpler empty branch, and a
  // documentation screenshot of an empty state teaches nothing.
  await connectPretendPage(OWNER.workspace);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

for (const shot of SHOTS) {
  test(`screenshot: ${shot.path}`, async ({ page }) => {
    await open(page, shot.path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    // Fonts and any client-side hydration settled, so the image is not caught
    // mid-render with fallback type or an empty chart.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    // The walk runs against `next dev`, which floats a build-status badge over
    // the corner of every page. It is not part of the product and has no place
    // in a picture of it.
    await page.addStyleTag({
      content: '[data-nextjs-toast], nextjs-portal { display: none !important; }',
    });

    await page.screenshot({ path: `${OUTPUT}/${shot.file}.png`, fullPage: true });
  });
}
