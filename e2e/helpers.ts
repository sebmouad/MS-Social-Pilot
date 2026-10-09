import { expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Noise the dev server makes that says nothing about the app: the icon route
 * that only exists in a production build, hot-reload chatter, React's own
 * advertisement for its devtools.
 */
const IGNORED =
  /favicon|apple-touch-icon|Download the React DevTools|hot-update|websocket|__nextjs/i;

/**
 * Errors the browser reported while a page was on screen.
 *
 * A server component that throws renders an error overlay and logs; a client
 * component that throws does the same without changing the response status.
 * Checking the status alone would let both through, which is most of the reason
 * this walk exists.
 *
 * Returns a live array — read it *after* the navigation, not before.
 */
export function collectFailures(
  page: Page,
  options: { expect404?: boolean } = {},
): string[] {
  const failures: string[] = [];

  page.on('pageerror', (error) => failures.push(`uncaught: ${error.message}`));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = `${message.text()} (${message.location().url})`;
    if (IGNORED.test(text)) return;

    // A page visited to check its 404 reports its own status as a failed
    // resource load. That is the browser being right, not the app being wrong.
    if (options.expect404 && /status of 404/.test(text)) return;

    failures.push(`console: ${text}`);
  });

  return failures;
}

/** Navigate, and fail loudly on a 4xx or 5xx rather than asserting on its body. */
export async function open(page: Page, path: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response, `no response for ${path}`).not.toBeNull();
  expect(response!.status(), `${path} answered ${response!.status()}`).toBeLessThan(400);
}

/** Every screen behind the sign-in wall, in roughly the order the nav lists them. */
export const SIGNED_IN_SCREENS = [
  '/dashboard',
  '/compose',
  '/calendar',
  '/posts',
  '/approvals',
  '/connections',
  '/accounts',
  '/feeds',
  '/analytics',
  '/reports',
  '/settings',
  '/settings/team',
  '/settings/config',
  '/settings/notifications',
  '/settings/media',
  '/settings/history',
  '/setup',
];

export const OWNER = {
  name: 'Wren Halloway',
  email: 'wren@example.test',
  password: 'a-long-enough-passphrase',
  workspace: 'Halloway Studio',
};

export const OWNER_STATE = 'e2e/.auth/owner.json';

/** Desktop widths the link row has to fit: the smallest that shows it, a laptop, a large Mac. */
export const DESKTOP_WIDTHS = [1024, 1280, 1728];

/**
 * Every link in the header's link row is on screen, with nothing scrolled out
 * of sight. The row scrolls rather than wrapping, and a Mac hides the
 * scrollbar, so a link past the edge simply looks absent — which is how
 * Reports and Settings went missing on a desktop.
 */
export async function expectEveryNavLinkShown(page: Page): Promise<void> {
  const nav = page.getByRole('banner').getByRole('navigation');
  const { overflow, offscreen } = await nav.evaluate((element) => {
    const viewport = document.documentElement.clientWidth;
    const outside = [...element.querySelectorAll('a')]
      .filter((link) => {
        const box = link.getBoundingClientRect();
        const row = element.getBoundingClientRect();
        return box.width === 0 || box.left < row.left - 1 || box.right > Math.min(row.right, viewport) + 1;
      })
      .map((link) => link.textContent?.trim() ?? '');
    return { overflow: element.scrollWidth - element.clientWidth, offscreen: outside };
  });

  expect(offscreen, 'links hidden past the edge of the header').toEqual([]);
  expect(overflow, 'the link row scrolls').toBeLessThanOrEqual(1);
}
