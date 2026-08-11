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
const CORRECTED = 'Sourdough is out of the oven at eight tomorrow.';

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

test('a scheduled post can be corrected without being recreated', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/posts');
  await page.getByRole('link', { name: /^edit$/i }).first().click();

  // The same composer, with the post already in it — not a blank form and not
  // a cut-down edit dialog.
  await page.waitForURL(/\/compose\?post=/);
  const box = page.getByLabel(/what do you want to say/i);
  await expect(box).toHaveValue(MESSAGE);
  await expect(page.getByRole('checkbox').first()).toBeChecked();

  await box.fill(CORRECTED);

  const save = page.getByRole('button', { name: /save changes/i });
  await expect(save).toBeEnabled();
  await save.click();

  // Back on the list, with the correction in place and no second post.
  await page.waitForURL(/\/posts/, { timeout: 30_000 });
  await expect(page.getByText(CORRECTED, { exact: false })).toBeVisible();
  await expect(page.getByText(MESSAGE, { exact: true })).toHaveCount(0);

  expect(failures).toEqual([]);
});

test('a published post offers no way to rewrite it', async ({ page }) => {
  // The Edit button and the API agree on this: the copy on Facebook cannot be
  // changed, so an edit here would only create a second version of the truth.
  const published = await prisma.post.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await prisma.post.update({ where: { id: published.id }, data: { status: 'published' } });

  await open(page, '/posts');
  await expect(page.getByRole('link', { name: /^edit$/i })).toHaveCount(0);

  // And the URL is refused even when typed by hand.
  const response = await page.goto(`/compose?post=${published.id}`);
  expect(response?.status()).toBe(404);

  await prisma.post.update({ where: { id: published.id }, data: { status: 'scheduled' } });
});

test('a scheduled post can be cancelled from the list', async ({ page }) => {
  const failures = collectFailures(page);

  page.on('dialog', (dialog) => dialog.accept());

  await open(page, '/posts');
  await expect(page.getByText(CORRECTED, { exact: false }).first()).toBeVisible();

  const cancel = page.getByRole('button', { name: /cancel/i }).first();
  await cancel.click();

  // Cancelled, not deleted: the row stays so nobody wonders where it went.
  await expect(page.getByText(/cancell?ed/i).first()).toBeVisible({ timeout: 15_000 });

  expect(failures).toEqual([]);
});

test('the media library shows what a post is holding, and will not delete it', async ({ page }) => {
  const failures = collectFailures(page);

  // A file attached to a post that has not gone out yet. Uploaded through the
  // API the way the composer does, so the row and the indexed key array are
  // written together.
  const upload = await page.request.post('/api/media', {
    multipart: {
      file: {
        name: 'loaf.png',
        mimeType: 'image/png',
        // The smallest valid PNG: the upload route checks the bytes against
        // the declared type, so a fake one is rejected.
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      },
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const file = (await upload.json()) as { id: string; url: string; kind: string };

  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const created = await page.request.post('/api/posts', {
    data: {
      message: 'With a picture',
      media: [{ id: file.id, kind: file.kind, url: file.url }],
      targetIds: [target.id],
      publishMode: 'worker',
      scheduledAtLocal: null,
      timezone: 'UTC',
      saveAsDraft: true,
    },
  });
  expect(created.status(), await created.text()).toBe(201);

  await open(page, '/settings/media');
  await expect(page.getByText('loaf.png')).toBeVisible();

  // Held, so the button is out of reach and the screen says by what.
  await expect(page.getByRole('button', { name: /delete/i })).toBeDisabled();
  await expect(page.getByText(/has not gone out yet/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /with a picture/i })).toBeVisible();

  expect(failures).toEqual([]);
});

test('the history screen says who did what, in words', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/settings/history');

  // Everything above this test has been creating, editing and cancelling
  // posts, so the log is not empty — and it reads as sentences rather than as
  // the event names underneath them.
  const entry = page
    .getByRole('listitem')
    .filter({ hasText: /created a post/i })
    .first();

  // Scoped to the row, not the page: the nav bar carries the user's name too,
  // in an element that is hidden at this width.
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(OWNER.name);
  await expect(page.getByText('post.created')).toHaveCount(0);

  // The email tab is a click away and renders whether or not anything sent.
  await page.getByRole('link', { name: /^email$/i }).click();
  await expect(page).toHaveURL(/view=email/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  expect(failures).toEqual([]);
});

test('the post list pages rather than stopping at a hundred', async ({ page }) => {
  const failures = collectFailures(page);

  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const author = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });

  // Enough to need a third page at the default size, created flat so the
  // ordering has nothing but the tiebreaker to go on.
  await prisma.post.createMany({
    data: Array.from({ length: 60 }, (_, index) => ({
      workspaceId: workspace.id,
      authorId: author.id,
      message: `Bulk post ${index}`,
      status: 'draft' as const,
    })),
  });

  await open(page, '/posts');
  const pager = page.getByRole('navigation', { name: /pages/i });
  await expect(pager).toBeVisible();

  const first = await page.getByRole('article').count();
  expect(first).toBeLessThanOrEqual(25);

  await pager.getByRole('link', { name: /next/i }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole('article').first()).toBeVisible();

  // Filters survive the jump: a Next button that dropped them would look like
  // it had gone somewhere else entirely.
  await open(page, '/posts?status=draft');
  await pager.getByRole('link', { name: /next/i }).click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(page).toHaveURL(/page=2/);

  expect(failures).toEqual([]);
});
