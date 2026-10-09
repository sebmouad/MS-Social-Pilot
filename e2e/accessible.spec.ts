import { expect, test } from '@playwright/test';

import { open, SIGNED_IN_SCREENS } from './helpers';

/**
 * Whether the app can be used without a mouse or without sight.
 *
 * Nothing has ever checked this. The browser walk asserts that a heading
 * exists, which is a start and not much more — a button with no name is a
 * button a screen reader announces as "button", an image with no alt text is
 * announced as its filename, and a control that cannot be reached by tab
 * cannot be used at all.
 *
 * These are mechanical checks. They cannot tell you the app is usable; they
 * can tell you it is not, which is the half a machine can answer.
 */

interface Offender {
  what: string;
  where: string;
}

/**
 * Interactive elements with nothing to announce.
 *
 * The accessible name is what a screen reader reads out. An icon-only button
 * has none unless somebody supplies one — with `aria-label`, or visually
 * hidden text, which is what this codebase uses.
 */
async function unnamedControls(page: import('@playwright/test').Page): Promise<Offender[]> {
  return page.evaluate(() => {
    const found: Offender[] = [];

    const name = (element: Element): string => {
      const aria = element.getAttribute('aria-label');
      if (aria?.trim()) return aria.trim();

      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }

      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement) {
        if (element.labels && element.labels.length > 0) {
          const text = Array.from(element.labels).map((label) => label.textContent ?? '').join(' ');
          if (text.trim()) return text.trim();
        }
        if (element.getAttribute('title')?.trim()) return element.getAttribute('title')!.trim();
      }

      return (element.textContent ?? '').trim();
    };

    const describe = (element: Element): string =>
      `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}` +
      `.${(element.getAttribute('class') ?? '').slice(0, 40)}`;

    for (const element of Array.from(
      document.querySelectorAll('button, a[href], input, select, textarea'),
    )) {
      // Hidden things are not announced and cannot be reached.
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (element instanceof HTMLInputElement && element.type === 'hidden') continue;
      if (element.getAttribute('aria-hidden') === 'true') continue;

      if (!name(element)) found.push({ what: 'no accessible name', where: describe(element) });
    }

    for (const image of Array.from(document.querySelectorAll('img'))) {
      // `alt=""` is a deliberate statement that the image is decorative, and
      // is correct. A missing attribute is not a statement about anything.
      if (image.getAttribute('alt') === null) {
        found.push({ what: 'image with no alt attribute', where: describe(image) });
      }
    }

    return found;
  });
}

for (const path of SIGNED_IN_SCREENS) {
  test(`${path} announces every control it shows`, async ({ page }) => {
    await open(page, path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    expect(await unnamedControls(page), `${path} has controls a screen reader cannot name`)
      .toEqual([]);
  });
}

test('the whole composer can be reached with a keyboard', async ({ page }) => {
  await open(page, '/compose');

  // Tab from the top and collect what receives focus. The message box and the
  // submit button both have to be in there, or the screen cannot be used
  // without a pointing device.
  const reached: string[] = [];
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const marker = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      return `${active.tagName.toLowerCase()}#${active.id}`;
    });
    if (marker) reached.push(marker);
  }

  expect(reached.join(' '), 'the message box never took focus').toContain('textarea#message');
});

test('focus is visible when it lands somewhere', async ({ page }) => {
  await open(page, '/compose');

  await page.getByLabel(/what do you want to say/i).focus();

  // A focus ring that has been styled away leaves a keyboard user with no idea
  // where they are on the page.
  const outline = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active) return null;
    const style = window.getComputedStyle(active);
    return {
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
    };
  });

  const ringed =
    (outline?.outlineStyle !== 'none' && outline?.outlineWidth !== '0px') ||
    (outline?.boxShadow !== 'none' && outline?.boxShadow !== '');

  expect(ringed, `focused element has no visible ring: ${JSON.stringify(outline)}`).toBe(true);
});

/**
 * The controls somebody touches before they have an account.
 *
 * The sweep above runs signed in, which skips the two forms most people use
 * most: signing in, and accepting an invitation. A field with no label there is
 * not a degraded experience, it is a door that will not open.
 */
test.describe('before signing in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ['/login', '/register', '/data-deletion', '/terms', '/invite/not-a-real-token']) {
    test(`${path} announces every control it shows`, async ({ page }) => {
      await open(page, path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

      expect(await unnamedControls(page), `${path} has controls a screen reader cannot name`)
        .toEqual([]);
    });
  }

  test('the sign-in form can be completed with a keyboard alone', async ({ page }) => {
    await open(page, '/login');

    const reached: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      const marker = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;
        return `${active.tagName.toLowerCase()}#${active.id}`;
      });
      if (marker) reached.push(marker);
    }

    // Both fields and the button, in an order that makes sense to somebody who
    // never sees the page.
    expect(reached.join(' ')).toContain('input#email');
    expect(reached.join(' ')).toContain('input#password');
    expect(reached.indexOf('input#email')).toBeLessThan(reached.indexOf('input#password'));
  });
});
