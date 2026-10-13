import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * The analytics screen's navigation: which view a URL opens, and what a tab
 * carries over to the next one.
 */

test.describe.configure({ mode: 'serial' });

let targetId: string;

test.beforeAll(async () => {
  targetId = await connectPretendPage(OWNER.workspace);

  // Two published posts with figures, one with no engagement rate to sort.
  const author = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  for (const [message, reach] of [['Walk: busy post', 900], ['Walk: quiet post', 0]] as const) {
    if (await prisma.post.findFirst({ where: { workspaceId: workspace.id, message } })) continue;
    await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: author.id,
        message,
        status: 'published',
        publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        targets: {
          create: {
            targetId,
            status: 'published',
            remotePostId: `${targetId}_${reach}`,
            publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            insights: { reach, reactions: reach / 30, comments: 1 },
          },
        },
      },
    });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('an unknown view opens the analysis rather than an empty screen', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/analytics?view=no-such-view');

  // The tab strip marks the analysis as current, and there is something
  // under it — not a tab strip over nothing.
  const tabs = page.getByRole('navigation', { name: /choose a view/i });
  await expect(tabs.getByRole('link', { name: /^analysis$/i })).toHaveAttribute('aria-current', 'page');

  expect(failures).toEqual([]);
});

test('switching tabs keeps the Page and window but drops one view’s filters', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, `/analytics?view=interactions&target=${targetId}&days=7&q=delivery&shown=hidden&page=2`);

  const tabs = page.getByRole('navigation', { name: /choose a view/i });
  const href = await tabs.getByRole('link', { name: /^by post$/i }).getAttribute('href');
  const next = new URL(href!, 'http://localhost');

  expect(next.searchParams.get('view')).toBe('posts');
  expect(next.searchParams.get('target')).toBe(targetId);
  expect(next.searchParams.get('days')).toBe('7');
  for (const dropped of ['q', 'shown', 'page']) expect(next.searchParams.has(dropped)).toBe(false);

  // The comment filter keeps the window too, rather than resetting it to 30 days.
  await expect(page.locator('form input[type="hidden"][name="days"]')).toHaveValue('7');

  // Comments are not windowed, so the header claims no date range.
  await expect(page.locator('header p').first()).not.toContainText('–');

  expect(failures).toEqual([]);
});

test('the posts table says which way it is sorted', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, `/analytics?view=posts&target=${targetId}`);

  const table = page.locator('table');
  await expect(table.getByText('Walk: busy post')).toBeVisible();

  const reach = table.getByRole('columnheader', { name: /^reach/i });
  // A click before hydration never reaches the handler; retry until it sorts.
  await expect(async () => {
    await reach.getByRole('button').click();
    await expect(reach).toHaveAttribute('aria-sort', 'descending', { timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
  await reach.getByRole('button').click();
  await expect(reach).toHaveAttribute('aria-sort', 'ascending');

  expect(failures).toEqual([]);
});
