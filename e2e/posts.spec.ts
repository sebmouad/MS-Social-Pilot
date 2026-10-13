import { expect, test, type Locator, type Page } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * The post list and the review queue, with a post in every state that changes
 * what they offer.
 *
 * The compose walk only ever makes a scheduled post, and a scheduled post is
 * the one case where every button is fine. The ones that matter are the rest:
 * a rejection whose reason has to be visible, a post Facebook is holding that
 * "Publish now" cannot touch, an overdue post that approving sends out.
 */

test.describe.configure({ mode: 'serial' });

// A marker every seeded message carries, so a search can find exactly these.
const MARK = 'Crumbwatch';
const REJECTED = `${MARK}: croissant special, all week`;
const NOTE = 'Please shorten the headline before this goes out.';
const HELD = `${MARK}: rye loaves, held by Facebook`;
const DRAFT = `${MARK}: seeded draft about baguettes`;
const OVERDUE = `${MARK}: overdue brioche announcement`;

// Inline, so the thumbnail never waits on — or fails against — the network.
const PIXEL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%23c2410c'/%3E%3C/svg%3E";

/**
 * Press a button that asks first, and answer the question.
 *
 * A click that lands before React has attached its handler does nothing, and
 * no question comes — so press until one does. One listener for the whole
 * exchange, rather than `page.once`, because an unanswered `once` from a click
 * that did nothing would otherwise answer the next question instead.
 */
async function pressAndAnswer(
  page: Page,
  button: Locator,
  answer: 'accept' | 'dismiss',
): Promise<string> {
  // The app's own confirmation dialog. Retried until it appears: a click that
  // lands before hydration does nothing the first time.
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
  // The question and what follows it: a long one is split into a title and a line under it.
  const asked = ((await dialog.textContent()) ?? '').replace(/\s+/g, ' ');
  await (answer === 'accept' ? dialog.locator('[data-confirm]') : dialog.locator('[data-close]')).click();
  await expect(dialog).toHaveCount(0);
  return asked;
}

let workspaceId = '';
let authorId = '';
let draftId = '';
let overdueId = '';

test.beforeAll(async () => {
  const targetId = await connectPretendPage(OWNER.workspace);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const author = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  workspaceId = workspace.id;
  authorId = author.id;

  // Re-runnable against the same database: start from none of ours.
  await prisma.post.deleteMany({ where: { workspaceId, message: { startsWith: MARK } } });

  const base = { workspaceId, authorId, timezone: 'UTC' };
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.post.create({
    data: {
      ...base,
      message: REJECTED,
      status: 'rejected',
      approvalStatus: 'rejected',
      scheduledAt: tomorrow,
      reviewedById: authorId,
      reviewedAt: new Date(),
      reviewNote: NOTE,
      targets: { create: { targetId, status: 'pending' } },
    },
  });

  await prisma.post.create({
    data: {
      ...base,
      message: HELD,
      status: 'scheduled',
      publishMode: 'native',
      scheduledAt: tomorrow,
      targets: { create: { targetId, status: 'scheduled_remote', remotePostId: '20000000000000002_1' } },
    },
  });

  draftId = (
    await prisma.post.create({
      data: { ...base, message: DRAFT, status: 'draft', targets: { create: { targetId, status: 'pending' } } },
    })
  ).id;

  overdueId = (
    await prisma.post.create({
      data: {
        ...base,
        message: OVERDUE,
        status: 'pending_approval',
        approvalStatus: 'pending',
        scheduledAt: hourAgo,
        submittedById: authorId,
        submittedAt: hourAgo,
        media: [{ id: 'crumb-pixel', kind: 'image', url: PIXEL, altText: 'A brioche' }],
        targets: { create: { targetId, status: 'pending' } },
      },
    })
  ).id;
});

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { workspaceId, message: { startsWith: MARK } } });
  await prisma.$disconnect();
});

test('every status a post can sit in has a tab, and a rejection says why', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/posts');
  const tabs = page.getByRole('navigation', { name: /filter by status/i });
  for (const name of [/awaiting approval/i, /^rejected$/i, /^publishing$/i]) {
    await expect(tabs.getByRole('link', { name })).toBeVisible();
  }

  await tabs.getByRole('link', { name: /^rejected$/i }).click();
  await page.waitForURL(/status=rejected/);
  const card = page.locator('article', { hasText: REJECTED });
  await expect(card).toBeVisible();
  await expect(card.getByText(NOTE)).toBeVisible();

  expect(failures).toEqual([]);
});

test('a search narrows the list and survives switching tabs', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/posts');
  await page.getByLabel(/search posts/i).fill('rye loaves');
  await page.getByRole('button', { name: /^search$/i }).click();
  await page.waitForURL(/q=rye/);

  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByText(HELD)).toBeVisible();

  // The tab keeps the search: the held post is scheduled, so it is still there.
  await page.getByRole('navigation', { name: /filter by status/i }).getByRole('link', { name: /^scheduled$/i }).click();
  await page.waitForURL(/status=scheduled/);
  expect(page.url()).toContain('q=rye');
  await expect(page.getByText(HELD)).toBeVisible();

  // And a search that matches nothing says so, rather than "no posts yet".
  await open(page, '/posts?q=nothing-matches-this-at-all');
  await expect(page.getByText(/no posts match/i)).toBeVisible();

  expect(failures).toEqual([]);
});

test('"Publish now" is not offered on a post Facebook is holding, and asks first elsewhere', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, `/posts?q=${encodeURIComponent(MARK)}`);

  const held = page.locator('article', { hasText: HELD });
  await expect(held).toBeVisible();
  await expect(held.getByRole('button', { name: /publish now/i })).toHaveCount(0);

  const draft = page.locator('article', { hasText: DRAFT });
  const asked = await pressAndAnswer(page, draft.getByRole('button', { name: /publish now/i }), 'dismiss');
  expect(asked).toMatch(/publish this now/i);

  // Declined, so nothing moved.
  const row = await prisma.post.findUniqueOrThrow({ where: { id: draftId } });
  expect(row.status).toBe('draft');

  expect(failures).toEqual([]);
});

test('duplicating a post opens the copy in the composer', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, `/posts?q=${encodeURIComponent(DRAFT)}`);
  const duplicate = page.locator('article', { hasText: DRAFT }).getByRole('button', { name: /^duplicate$/i });
  // Pressed again only if nothing happened, which is a click that beat hydration.
  await expect(async () => {
    if (!/\/compose\?post=/.test(page.url())) await duplicate.click();
    await page.waitForURL(/\/compose\?post=/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  const copyId = new URL(page.url()).searchParams.get('post');
  expect(copyId).toBeTruthy();
  expect(copyId).not.toBe(draftId);
  await expect(page.getByLabel(/what do you want to say/i)).toHaveValue(DRAFT);

  expect(failures).toEqual([]);

  // Out of the way of the next tests, which look for the original by its text.
  await prisma.post.deleteMany({ where: { workspaceId, message: DRAFT, id: { not: draftId } } });
});

test('the review queue shows the attachment and asks before approving an overdue post', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/approvals');
  const card = page.locator('article', { hasText: OVERDUE });
  await expect(card).toBeVisible();
  await expect(card.getByRole('img', { name: 'A brioche' })).toBeVisible();
  await expect(card.getByRole('link', { name: /^edit$/i })).toHaveAttribute('href', `/compose?post=${overdueId}`);

  // Declining the question leaves it in the queue.
  const approve = card.getByRole('button', { name: /^approve$/i });
  expect(await pressAndAnswer(page, approve, 'dismiss')).toMatch(/scheduled time has passed/i);
  await expect(card).toBeVisible();
  expect((await prisma.post.findUniqueOrThrow({ where: { id: overdueId } })).status).toBe('pending_approval');

  // Accepting it approves it.
  await pressAndAnswer(page, approve, 'accept');
  await expect(page.getByText(/goes out right away/i)).toBeVisible();
  await expect
    .poll(async () => (await prisma.post.findUniqueOrThrow({ where: { id: overdueId } })).approvalStatus)
    .toBe('approved');

  expect(failures).toEqual([]);
});

test('a contributor sends a draft for review from the list', async ({ page }) => {
  const failures = collectFailures(page);

  // The walk has one signed-in account, so it becomes a contributor in a
  // workspace with review on for this test, and is put back afterwards.
  const membership = await prisma.membership.findFirstOrThrow({ where: { userId: authorId, workspaceId } });
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  await prisma.membership.update({ where: { id: membership.id }, data: { role: 'contributor' } });
  await prisma.workspace.update({ where: { id: workspaceId }, data: { requiresApproval: true } });

  try {
    await open(page, `/posts?q=${encodeURIComponent(DRAFT)}`);
    const draft = page.locator('article', { hasText: DRAFT });

    // Their work goes through review, so going out early is not on offer.
    await expect(draft.getByRole('button', { name: /publish now/i })).toHaveCount(0);

    const status = async () => (await prisma.post.findUniqueOrThrow({ where: { id: draftId } })).status;
    await expect(async () => {
      if ((await status()) === 'draft') await draft.getByRole('button', { name: /submit for review/i }).click();
      await expect.poll(status, { timeout: 3_000 }).toBe('pending_approval');
    }).toPass({ timeout: 30_000 });

    // Once refreshed it reads as waiting, and can still be cancelled.
    await expect(draft.getByText(/awaiting approval/i)).toBeVisible({ timeout: 15_000 });
    await expect(draft.getByRole('button', { name: /submit for review/i })).toHaveCount(0);
    await expect(draft.getByRole('button', { name: /^cancel$/i })).toBeVisible();
  } finally {
    await prisma.membership.update({ where: { id: membership.id }, data: { role: membership.role } });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { requiresApproval: workspace.requiresApproval },
    });
  }

  expect(failures).toEqual([]);
});
