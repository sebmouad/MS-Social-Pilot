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

test('an unknown view opens the Summary rather than an empty screen', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/analytics?view=no-such-view');

  // The menu marks the Summary as current, and lists the four views only.
  const tabs = page.getByRole('navigation', { name: /choose a view/i });
  await expect(tabs.getByRole('link', { name: /^summary$/i })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link')).toHaveCount(4);
  await expect(tabs.getByText(/detailed figures/i)).toHaveCount(0);

  expect(failures).toEqual([]);
});

test('Summary shows stored Page reach on a day without posts and gaps for missing days', async ({ page }) => {
  const failures = collectFailures(page);
  const endTime = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  endTime.setUTCHours(12, 0, 0, 0);
  const reading = await prisma.pageInsight.create({ data: {
    targetId, metric: 'page_total_media_view_unique', period: 'day', endTime,
    value: 777, numeric: 777,
  } });
  try {
    await open(page, `/analytics?view=summary&pages=${targetId}&range=7d`);
    const trend = page.locator('section.card-viz').filter({ has: page.getByRole('heading', { name: 'Trend' }) });
    await trend.getByRole('radio', { name: 'People reached' }).click();
    await trend.getByRole('button', { name: 'Table' }).click();
    await expect(trend.getByRole('cell', { name: '777' })).toBeVisible();
    await expect(trend.getByRole('cell', { name: '—' }).first()).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    await prisma.pageInsight.delete({ where: { id: reading.id } });
  }
});

test('switching tabs keeps the Page and window but drops one view’s filters', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, `/analytics?view=interactions&target=${targetId}&days=7&q=delivery&shown=hidden&page=2`);

  const tabs = page.getByRole('navigation', { name: /choose a view/i });
  const href = await tabs.getByRole('link', { name: /^posts$/i }).getAttribute('href');
  const next = new URL(href!, 'http://localhost');

  expect(next.searchParams.get('view')).toBe('posts');
  expect(next.searchParams.get('target')).toBe(targetId);
  expect(next.searchParams.get('days')).toBe('7');
  for (const dropped of ['q', 'shown', 'page']) expect(next.searchParams.has(dropped)).toBe(false);

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

test('a Page post with unread insights shows missing figures instead of zero', async ({ page }) => {
  const failures = collectFailures(page);
  const external = await prisma.externalPost.create({ data: {
    targetId,
    remoteId: 'e2e-unread-external',
    message: 'Walk: unseen external',
    createdTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
  } });
  try {
    await open(page, `/analytics?view=posts&target=${targetId}`);
    const row = page.getByRole('row', { name: /Walk: unseen external/ });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell', { name: '—' })).toHaveCount(7);
    expect(failures).toEqual([]);
  } finally {
    await prisma.externalPost.delete({ where: { id: external.id } });
  }
});

test('post metric breakdown reveals every stored entry and filters from the sidebar', async ({ page }) => {
  const failures = collectFailures(page);
  const external = await prisma.externalPost.create({ data: {
    targetId,
    remoteId: 'e2e-full-metric-breakdown',
    message: 'Walk: complete metric breakdown',
    createdTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
    insights: {
      metrics: {
        post_reactions_by_type_total: Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`kind_${index + 1}`, 15 - index])),
        post_media_view: 42,
      },
    },
  } });
  try {
    await open(page, `/analytics/post/${external.id}?external=true`);
    const filter = page.locator('#shell-filters').getByRole('searchbox', { name: 'Filter metrics' });
    await expect(filter).toBeVisible();
    const breakdown = page.getByText('post_reactions_by_type_total');
    await expect(breakdown).toBeVisible();
    await expect(page.getByText('kind_15', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all 15 breakdown entries' }).click();
    await expect(page.getByText('kind_15', { exact: true })).toBeVisible();
    await filter.fill('media_view');
    await expect(breakdown).toHaveCount(0);
    await expect(page.getByText('post_media_view')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('searchbox', { name: 'Filter metrics' })).toBeVisible();
    await expect(page.locator('#shell-filters').getByRole('searchbox')).toHaveCount(0);
    expect(failures).toEqual([]);
  } finally {
    await prisma.externalPost.delete({ where: { id: external.id } });
  }
});

test('Posts counts every Page post beyond the former 500-row limit', async ({ page }) => {
  const failures = collectFailures(page);
  const createdTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.externalPost.createMany({ data: Array.from({ length: 501 }, (_, index) => ({
    targetId, remoteId: `e2e-page-count-${index}`, message: `Walk: external ${index}`, createdTime,
  })) });
  try {
    await open(page, `/analytics?view=posts&target=${targetId}`);
    const sources = page.getByRole('radiogroup', { name: 'Which posts' });
    const pagePosts = sources.getByRole('radio', { name: /Made on Facebook 501/ });
    await expect(pagePosts).toBeVisible();
    await expect(async () => {
      await pagePosts.click();
      await expect(pagePosts).toHaveAttribute('aria-checked', 'true', { timeout: 1_500 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText('1–25 of 501')).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    await prisma.externalPost.deleteMany({ where: { targetId, remoteId: { startsWith: 'e2e-page-count-' } } });
  }
});
