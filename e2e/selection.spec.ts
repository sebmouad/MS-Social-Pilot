import { expect, test, type Locator, type Page } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Working on several profiles at once: the selection that follows the user
 * from screen to screen, the views that add profiles up, and the actions that
 * move or cancel many posts in one go.
 */

test.describe.configure({ mode: 'serial' });

const MARK = 'Selectwalk';
const SECOND_PAGE = 'Halloway Deli';
const DAY = 24 * 60 * 60 * 1000;

let workspaceId = '';
let authorId = '';
let timezone = 'UTC';
let firstId = '';
let secondId = '';

/** `yyyy-MM-dd` of an instant in the workspace's time zone, as the calendar keys its squares. */
function dayKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * Tick both bulk posts. A tick that lands before hydration checks the box but
 * not the selection, so start again from a fresh page until the toolbar agrees.
 */
async function selectBoth(page: Page, toolbar: Locator) {
  let attempt = 0;
  await expect(async () => {
    if (attempt++ > 0) await page.reload();
    for (const name of ['first', 'second']) {
      const box = page.locator('article', { hasText: `${MARK}: bulk ${name}` }).getByRole('checkbox', { name: 'Select this post' });
      if (!(await box.isChecked())) await box.click();
    }
    await expect(toolbar).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

test.beforeAll(async () => {
  firstId = await connectPretendPage(OWNER.workspace);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const author = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  workspaceId = workspace.id;
  authorId = author.id;
  timezone = workspace.timezone;

  const first = await prisma.target.findUniqueOrThrow({ where: { id: firstId } });
  const existing = await prisma.target.findFirst({ where: { workspaceId, providerId: '20000000000000003' } });
  secondId =
    existing?.id ??
    (
      await prisma.target.create({
        data: {
          workspaceId,
          socialAccountId: first.socialAccountId,
          type: 'page',
          providerId: '20000000000000003',
          name: SECOND_PAGE,
          category: 'Restaurant',
          accessToken: first.accessToken,
          fanCount: 210,
          followersCount: 240,
        },
      })
    ).id;

  await prisma.post.deleteMany({ where: { workspaceId, message: { startsWith: MARK } } });

  // One published post a day on each Page, so the views that add up have figures.
  for (const [targetId, reach] of [[firstId, 400], [secondId, 90]] as const) {
    for (const ago of [1, 2, 3]) {
      const at = new Date(Date.now() - ago * DAY);
      await prisma.post.create({
        data: {
          workspaceId,
          authorId,
          timezone,
          message: `${MARK}: published ${ago} days ago`,
          status: 'published',
          publishedAt: at,
          targets: {
            create: {
              targetId,
              status: 'published',
              remotePostId: `${targetId}_sel_${ago}`,
              publishedAt: at,
              insights: { reach, reactions: 10 * ago, comments: ago },
            },
          },
        },
      });
    }
  }
});

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { workspaceId, message: { startsWith: MARK } } });
  await prisma.target.deleteMany({ where: { id: secondId } });
  await prisma.$disconnect();
});

test('two profiles add up on the Summary, and the selection follows to Posts and Calendar', async ({ page }) => {
  const failures = collectFailures(page);
  const pages = `${firstId},${secondId}`;

  await open(page, `/analytics?view=summary&pages=${pages}`);
  await expect(page.getByText(/Totals for 2 channels/)).toBeVisible();

  // The cookie keeps the choice: a bare URL opens on the same two.
  for (const path of ['/posts', '/calendar']) {
    await open(page, path);
    await expect(page.getByRole('button', { name: `Hide ${SECOND_PAGE}` })).toHaveAttribute('aria-pressed', 'true');
  }

  expect(failures).toEqual([]);
});

test('the comparison draws a line per profile that the legend hides and shows', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, `/analytics?view=compare&pages=${firstId},${secondId}`);
  const chart = page.getByRole('region', { name: 'Day by day, one line per channel' });
  await expect(chart).toBeVisible();

  const legend = chart.getByRole('list', { name: 'Channels on the chart' });
  const deli = legend.getByRole('button', { name: SECOND_PAGE });
  await expect(deli).toHaveAttribute('aria-pressed', 'true');
  await expect(async () => {
    if ((await deli.getAttribute('aria-pressed')) === 'true') await deli.click();
    await expect(deli).toHaveAttribute('aria-pressed', 'false', { timeout: 1_500 });
  }).toPass({ timeout: 30_000 });

  await chart.getByRole('radio', { name: 'Reach' }).click();
  await expect(chart.getByText(/Lines are not added up/)).toBeVisible();

  expect(failures).toEqual([]);
});

test('the calendar filters by status and moves a post dragged to another day', async ({ page }) => {
  const failures = collectFailures(page);

  const from = new Date(Date.now() + DAY);
  const to = new Date(Date.now() + 2 * DAY);
  const post = await prisma.post.create({
    data: {
      workspaceId,
      authorId,
      timezone,
      message: `${MARK}: dragged across the calendar`,
      status: 'scheduled',
      scheduledAt: from,
      targets: { create: { targetId: firstId, status: 'pending' } },
    },
  });

  await open(page, `/calendar?month=${dayKey(from).slice(0, 7)}&pages=${firstId},${secondId}`);

  const summary = page.getByRole('list', { name: /.+/ }).filter({ has: page.locator('a[aria-pressed]') });
  const scheduled = summary.locator('a[aria-pressed]', { hasText: /scheduled/i });
  await scheduled.click();
  await page.waitForURL(/status=scheduled/);
  await expect(summary.locator('a[aria-pressed="true"]')).toHaveCount(1);
  await summary.getByRole('link', { name: 'Show every status' }).click();
  await page.waitForURL((url) => !url.searchParams.has('status'));

  const target = page.locator(`[data-drop-day="${dayKey(to)}"]`);
  test.skip((await target.count()) === 0, 'the next day is outside the month grid on this date');

  const chip = page.locator(`[data-drag-post="${post.id}"]`);
  await expect(async () => {
    await chip.dragTo(target);
    await expect(page.getByRole('status').filter({ hasText: /^Moved to/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  const moved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(dayKey(moved.scheduledAt!)).toBe(dayKey(to));

  expect(failures).toEqual([]);
});

test('posts selected together move a day later, then cancel after a question', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectFailures(page);

  const at = new Date(Date.now() + 5 * DAY);
  const ids: string[] = [];
  for (const name of ['first', 'second']) {
    const post = await prisma.post.create({
      data: {
        workspaceId,
        authorId,
        timezone,
        message: `${MARK}: bulk ${name}`,
        status: 'scheduled',
        scheduledAt: at,
        targets: { create: { targetId: firstId, status: 'pending' } },
      },
    });
    ids.push(post.id);
  }

  await open(page, `/posts?pages=${firstId}&q=${encodeURIComponent(`${MARK}: bulk`)}`);
  const toolbar = page.getByRole('toolbar', { name: '2 posts selected' });
  await selectBoth(page, toolbar);
  await toolbar.getByRole('combobox').first().selectOption({ label: '1 day later' });
  await expect(page.getByText('Done for 2 posts.')).toBeVisible();

  for (const id of ids) {
    const post = await prisma.post.findUniqueOrThrow({ where: { id } });
    expect(post.scheduledAt!.getTime() - at.getTime()).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
  }

  // A finished action clears the selection; cancelling asks first.
  await expect(toolbar).toBeHidden();
  await selectBoth(page, toolbar);
  await toolbar.getByRole('button', { name: 'Cancel posts' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Cancel these 2 posts?');
  await dialog.locator('[data-confirm]').click();
  await expect(page.getByText('Done for 2 posts.')).toBeVisible();

  await expect
    .poll(async () => (await prisma.post.findMany({ where: { id: { in: ids } } })).map((post) => post.status))
    .toEqual(['cancelled', 'cancelled']);

  expect(failures).toEqual([]);
});

test('approvals follow the selection, and the headings say how many', async ({ page }) => {
  const failures = collectFailures(page);
  await prisma.post.create({
    data: {
      workspaceId,
      authorId,
      timezone,
      message: `${MARK}: waiting on the second Page`,
      status: 'pending_approval',
      approvalStatus: 'pending',
      submittedAt: new Date(),
      targets: { create: { targetId: secondId } },
    },
  });

  await open(page, `/approvals?pages=${firstId}`);
  await expect(page.getByText(`${MARK}: waiting on the second Page`)).toHaveCount(0);

  await open(page, `/approvals?pages=${secondId}`);
  await expect(page.getByText(`${MARK}: waiting on the second Page`).first()).toBeVisible();
  await expect(page.getByText('1 post waiting for review · 1 channel')).toBeVisible();

  await open(page, `/posts?pages=${secondId}&q=${encodeURIComponent(`${MARK}: waiting`)}`);
  await expect(page.getByText('1 post · 1 channel')).toBeVisible();
  expect(failures).toEqual([]);
});

test('a day in the month opens its week', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/calendar');
  const day = page.locator('[data-drop-day]').nth(10);
  const key = await day.getAttribute('data-drop-day');
  await day.hover();
  await day.getByRole('link', { name: /See the week of/ }).click();
  await expect(page).toHaveURL(new RegExp(`view=week.*week=${key}|week=${key}.*view=week`));
  expect(failures).toEqual([]);
});
