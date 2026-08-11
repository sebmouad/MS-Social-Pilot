import { expect, test } from '@playwright/test';

import { collectFailures, open } from './helpers';
import { connectPretendPage, PAGE_NAME, prisma } from './fixtures';
import { OWNER } from './helpers';

/**
 * The journey the product exists for: write something, schedule it, find it again.
 *
 * Every other spec walks empty screens, and an empty list renders a much
 * shorter branch than a full one — no dates to format, no statuses to badge, no
 * per-row menus. This one puts a Page and a post in front of them.
 */

test.describe.configure({ mode: 'serial' });

const MESSAGE = 'Sourdough is out of the oven at seven tomorrow.';

test.beforeAll(async () => {
  await connectPretendPage(OWNER.workspace);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('the composer offers the connected Page', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/compose');
  await expect(page.getByText(PAGE_NAME)).toBeVisible();

  // Nothing to post to nobody: the button stays out of reach until there is
  // both something to say and somewhere to say it.
  await expect(page.getByRole('button', { name: /^schedule$/i })).toBeDisabled();

  expect(failures).toEqual([]);
});

test('a post can be scheduled and then found on the other screens', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/compose');

  await page.getByLabel(/what do you want to say/i).fill(MESSAGE);

  // Ticking a Page only registers once React has attached its handler, and in
  // a development build that can be a second or two after the box appears.
  // Retry the tick until the button it governs agrees.
  const schedule = page.getByRole('button', { name: /^schedule$/i });
  await expect(async () => {
    if (!(await schedule.isEnabled())) {
      await page.getByRole('checkbox').first().click();
    }
    await expect(schedule).toBeEnabled({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });

  // The default timing is already "schedule", an hour out, in the workspace's
  // zone — so the only thing left is to press the button.
  await schedule.click();
  await expect(page.getByText(/scheduled/i).first()).toBeVisible();

  expect(failures).toEqual([]);

  // The post list, the calendar and the dashboard all read the same row; each
  // formats it differently, and each is a branch the empty walk never took.
  for (const path of ['/posts', '/calendar', '/dashboard']) {
    const seen = collectFailures(page);
    await open(page, path);
    await expect(page.getByText(MESSAGE, { exact: false }).first()).toBeVisible();
    expect(seen, `${path} reported browser errors with a post on it`).toEqual([]);
  }
});

test('a scheduled post can be cancelled from the list', async ({ page }) => {
  const failures = collectFailures(page);

  page.on('dialog', (dialog) => dialog.accept());

  await open(page, '/posts');
  await expect(page.getByText(MESSAGE, { exact: false }).first()).toBeVisible();

  const cancel = page.getByRole('button', { name: /cancel/i }).first();
  await cancel.click();

  // Cancelled, not deleted: the row stays so nobody wonders where it went.
  await expect(page.getByText(/cancell?ed/i).first()).toBeVisible({ timeout: 15_000 });

  expect(failures).toEqual([]);
});
