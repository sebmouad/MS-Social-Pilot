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

test('the calendar opens a post for editing, and starts a new one on a chosen day', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/calendar');
  await page.getByRole('link', { name: new RegExp(CORRECTED.slice(0, 20)) }).first().click();
  await page.waitForURL(/\/compose\?post=/);
  await expect(page.getByLabel(/what do you want to say/i)).toHaveValue(CORRECTED);

  // Next month, where every day is ahead whatever today's date.
  await open(page, '/calendar');
  await page.getByRole('link', { name: /next month/i }).click();
  await page.waitForURL(/\/calendar\?month=/);
  const plus = page.getByRole('link', { name: /^new post on/i });
  await plus.nth(10).click();
  await page.waitForURL(/\/compose\?at=\d{4}-\d{2}-\d{2}T09:00/);
  const at = new URL(page.url()).searchParams.get('at');
  await expect(page.getByLabel(/date and time/i)).toHaveValue(at!);

  expect(failures).toEqual([]);
});

test('a published post offers no way to rewrite it', async ({ page }) => {
  // The Edit button and the API agree on this: the copy on Facebook cannot be
  // changed, so an edit here would only create a second version of the truth.
  const published = await prisma.post.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await prisma.post.update({ where: { id: published.id }, data: { status: 'published' } });

  await open(page, '/posts');
  await expect(page.getByRole('link', { name: /^edit$/i })).toHaveCount(0);

  // And the URL is refused even when typed by hand — with a 404, not a 200
  // carrying an apology. `/compose` has no loading boundary for this reason:
  // one would flush the response before the page decided.
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
  // Named "Email", or "Email, 1 failed" once an earlier spec's invite has failed to send.
  await page.getByRole('link', { name: /^email\b/i }).click();
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

test('comments can be searched and paged rather than only skimmed', async ({ page }) => {
  const failures = collectFailures(page);

  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const postTarget = await prisma.postTarget.findFirstOrThrow({ where: { targetId: target.id } });

  await prisma.postComment.createMany({
    data: Array.from({ length: 60 }, (_, index) => ({
      postTargetId: postTarget.id,
      remoteId: `walk_c_${index}`,
      fromName: 'Ada Byron',
      message: index === 7 ? 'The delivery never arrived' : `Ordinary comment ${index}`,
      createdTime: new Date('2026-08-01T10:00:00Z'),
    })),
  });

  await open(page, '/analytics?view=comments');

  // Sixty comments, fifty to a page: there is a second page and the screen
  // says so rather than stopping silently.
  const pager = page.getByRole('navigation', { name: /pages/i });
  await expect(pager).toBeVisible();

  // And the one somebody complained about is reachable without paging to it.
  await page.getByLabel(/search comments/i).fill('never arrived');
  await page.getByRole('button', { name: /^filter$/i }).click();

  await expect(page.getByText('The delivery never arrived')).toBeVisible();
  await expect(page.getByText(/Ordinary comment/).first()).toHaveCount(0);

  // A reply sits under the comment it answers, not where its own timestamp
  // would put it: the Page answered a day later, after a newer comment arrived.
  await prisma.postComment.createMany({
    data: [
      {
        postTargetId: postTarget.id,
        remoteId: 'walk_c_7_reply',
        parentRemoteId: 'walk_c_7',
        fromId: target.providerId,
        fromName: PAGE_NAME,
        message: 'Sorry about the delivery, a replacement is on its way',
        createdTime: new Date('2026-08-02T09:00:00Z'),
      },
      {
        postTargetId: postTarget.id,
        remoteId: 'walk_c_newer',
        fromName: 'Grace Hopper',
        message: 'My delivery was quick, thanks',
        createdTime: new Date('2026-08-01T12:00:00Z'),
      },
    ],
  });

  await page.getByLabel(/search comments/i).fill('delivery');
  await page.getByRole('button', { name: /^filter$/i }).click();

  const messages = page.getByRole('listitem').filter({ hasText: /delivery/i });
  await expect(messages).toHaveCount(3);
  await expect(messages.nth(0)).toContainText('My delivery was quick');
  await expect(messages.nth(1)).toContainText('The delivery never arrived');
  await expect(messages.nth(2)).toContainText('a replacement is on its way');

  expect(failures).toEqual([]);
});

test('a link that leads nowhere gets a page, not a bare 404', async ({ page }) => {
  const failures = collectFailures(page, { expect404: true });

  // The realistic route to this: somebody bookmarked the edit link for a post
  // that has since been published, or followed a colleague's link to a post
  // that was deleted. Next's own 404 is a line of text with no way back.
  const response = await page.goto('/compose?post=does-not-exist');
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { level: 1 })).toContainText(/not here/i);

  // Signed in, so it offers the dashboard rather than the sign-in screen.
  await page.getByRole('link', { name: /dashboard/i }).click();
  await page.waitForURL(/\/dashboard/);

  expect(failures).toEqual([]);
});

test('a page that throws offers a way out rather than a blank apology', async ({ page }) => {
  // Next's default is "Application error: a server-side exception has occurred"
  // with no navigation and a suggestion to check the server logs — addressed to
  // somebody who does not have them.
  await page.goto('/e2e-throw');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(/went wrong/i);
  await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();

  // And a way back that does not depend on the broken segment recovering.
  await page.getByRole('link', { name: /dashboard/i }).click();
  await page.waitForURL(/\/dashboard/);
});

test('a slow page shows a skeleton rather than nothing at all', async ({ page }) => {
  await open(page, '/dashboard');

  // Navigate without waiting, so the intermediate state is observable. Without
  // a loading boundary Next leaves the previous page up while the server
  // works, and a click on a screen that takes two seconds looks like a click
  // that missed.
  const arrived = page.getByRole('heading', { name: /eventually/i });
  await page.goto('/e2e-slow', { waitUntil: 'commit' });

  // The navigation bar stays: the boundary is beside the layout, not inside it.
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 5_000 });

  // And it gives way to the real thing.
  await expect(arrived).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.animate-pulse')).toHaveCount(0);
});

test('the dashboard totals every published post, not a sample of them', async ({ page }) => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const author = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });
  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });

  // Enough to have passed the five hundred the old query fetched.
  for (let batch = 0; batch < 6; batch += 1) {
    await prisma.post.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        workspaceId: workspace.id,
        authorId: author.id,
        message: `Totals ${batch}-${index}`,
        status: 'published' as const,
      })),
    });
  }
  const posts = await prisma.post.findMany({
    where: { workspaceId: workspace.id, message: { startsWith: 'Totals ' } },
    select: { id: true },
  });
  await prisma.postTarget.createMany({
    data: posts.map((post) => ({
      postId: post.id,
      targetId: target.id,
      status: 'published' as const,
      insights: { impressions: 10, reach: 4, reactions: 1, comments: 0 },
    })),
  });

  await open(page, '/dashboard');

  // 600 × 10 impressions. A partial sum would read 5,000 and look plausible,
  // which is what made the old cap worth fixing rather than documenting.
  await expect(page.getByText('6,000')).toBeVisible();
});

test('a caption too long for Instagram is flagged while it is being written', async ({ page }) => {
  // Instagram's limit is a fifth of Facebook's, so a caption that is fine for
  // a Page is refused there. Without this, the post is scheduled, sits on the
  // calendar looking correct, and fails on that one destination hours later.
  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const instagram = await prisma.target.upsert({
    where: { workspaceId_providerId: { workspaceId: target.workspaceId, providerId: 'ig-walk' } },
    create: {
      workspaceId: target.workspaceId,
      socialAccountId: target.socialAccountId,
      type: 'instagram',
      providerId: 'ig-walk',
      name: '@walkbakery',
      accessToken: target.accessToken,
      canPublish: true,
    },
    update: { canPublish: true, enabled: true },
  });

  await open(page, '/compose');
  await page.getByLabel(/what do you want to say/i).fill('x'.repeat(2_300));

  const box = page.getByRole('checkbox', { name: /@walkbakery/ });
  await expect(async () => {
    await box.click();
    await expect(page.getByText(/Instagram takes 2,?200/i)).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });

  // Removed rather than disabled: a row left behind is state one spec hands
  // to another, and a failure in the second is then nobody's obvious fault.
  await prisma.target.delete({ where: { id: instagram.id } });
});

test('picking a time offers the times the Page has done best at', async ({ page }) => {
  const failures = collectFailures(page);
  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: target.workspaceId } });
  expect(workspace.timezone).toBe('UTC');

  // Six weeks of posts: the Wednesday-morning ones did well, the rest did not.
  const week = 7 * 24 * 60 * 60 * 1000;
  const lastWednesday = new Date();
  lastWednesday.setUTCDate(lastWednesday.getUTCDate() - ((lastWednesday.getUTCDay() - 3 + 7) % 7 || 7));
  lastWednesday.setUTCHours(10, 0, 0, 0);
  const insights = (reactions: number) => ({ impressions: null, reach: 1000, engagedUsers: null, reactions, comments: 0, shares: 0, clicks: 0 });
  const rows = Array.from({ length: 6 }, (_, index) => [
    { at: new Date(lastWednesday.getTime() - index * week), reactions: 90 },
    { at: new Date(lastWednesday.getTime() - index * week - 2 * 24 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000), reactions: 10 },
  ]).flat();
  await prisma.externalPost.createMany({
    data: rows.map((row, index) => ({
      targetId: target.id,
      remoteId: `good-time-${index}`,
      createdTime: row.at,
      insights: insights(row.reactions),
    })),
  });

  try {
    await open(page, '/compose');
    const chips = page.getByRole('group', { name: /good times this week/i }).getByRole('button');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveText(/Wed.*10:00/);

    // One tap fills the time in.
    const time = page.getByLabel(/date and time/i);
    await expect(async () => {
      await chips.first().click();
      await expect(time).toHaveValue(/T10:00$/, { timeout: 1_500 });
    }).toPass({ timeout: 30_000 });
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await prisma.externalPost.deleteMany({ where: { remoteId: { startsWith: 'good-time-' } } });
  }

  expect(failures).toEqual([]);
});

test('Instagram without a picture is stopped before it is sent, and Facebook cannot hold it', async ({ page }) => {
  // Instagram has no text-only post and no scheduling of its own; both used to
  // be learnt from the server's refusal after pressing the button.
  const failures = collectFailures(page);
  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const instagram = await prisma.target.upsert({
    where: { workspaceId_providerId: { workspaceId: target.workspaceId, providerId: 'ig-walk' } },
    create: {
      workspaceId: target.workspaceId,
      socialAccountId: target.socialAccountId,
      type: 'instagram',
      providerId: 'ig-walk',
      name: '@walkbakery',
      accessToken: target.accessToken,
      canPublish: true,
    },
    update: { canPublish: true, enabled: true },
  });

  try {
    await open(page, '/compose');
    await page.getByLabel(/what do you want to say/i).fill('Fresh loaves at seven.');

    const box = page.getByRole('checkbox', { name: /@walkbakery/ });
    await expect(async () => {
      if (!(await box.isChecked())) await box.click();
      await expect(page.getByText(/instagram only takes posts with a photo/i)).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 30_000 });

    await expect(page.getByRole('button', { name: /^schedule$/i })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /facebook\./i })).toBeDisabled();
    await expect(page.getByText(/unavailable while an instagram account is selected/i)).toBeVisible();
  } finally {
    await prisma.target.delete({ where: { id: instagram.id } });
  }

  expect(failures).toEqual([]);
});

test('leaving a half-written post asks first', async ({ page }) => {
  // Asked of the page directly: whether the browser then shows its prompt
  // depends on its own rules about user gestures, which a headless run blurs.
  const wouldAsk = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });

  await open(page, '/compose');
  const box = page.getByLabel(/what do you want to say/i);
  await expect(box).toBeEditable();
  expect(await wouldAsk()).toBe(false);

  await expect(async () => {
    await box.fill('Half a thought');
    expect(await wouldAsk()).toBe(true);
  }).toPass({ timeout: 30_000 });

  // Nothing left to lose once the box is empty again.
  await box.fill('');
  await expect.poll(wouldAsk).toBe(false);
});

test('an undated draft is listed under the calendar, and a switched-off destination can be unticked', async ({
  page,
}) => {
  const failures = collectFailures(page);
  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const author = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });
  const draft = await prisma.post.create({
    data: {
      workspaceId: target.workspaceId,
      authorId: author.id,
      message: 'Undated draft about rye',
      status: 'draft',
      targets: { create: [{ targetId: target.id, status: 'pending' }] },
    },
  });
  // Switched off after the draft was written: it stays ticked in the editor.
  await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });

  try {
    await open(page, '/calendar');
    const drafts = page.getByRole('region', { name: /unscheduled drafts/i });
    await expect(drafts).toBeVisible();
    await drafts.getByRole('link', { name: /undated draft about rye/i }).click();
    await page.waitForURL(new RegExp(`/compose\\?post=${draft.id}`));

    const box = page.getByRole('checkbox', { name: new RegExp(PAGE_NAME) });
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled();
    await expect(page.getByText(/switched off since this post was written/i)).toBeVisible();
    await expect(async () => {
      if (await box.isChecked()) await box.click();
      await expect(box).not.toBeChecked({ timeout: 1_500 });
    }).toPass({ timeout: 30_000 });
    // Unticked for good: it cannot be ticked again while switched off.
    await expect(box).toBeDisabled();
  } finally {
    await prisma.target.update({ where: { id: target.id }, data: { enabled: true } });
    await prisma.post.delete({ where: { id: draft.id } });
  }

  expect(failures).toEqual([]);
});

test('what a phone shares to the app arrives in the composer', async ({ page }) => {
  await open(page, `/compose?title=${encodeURIComponent('Recipe of the day')}&text=${encodeURIComponent('A lovely tart https://example.com/tart')}`);
  await expect(page.locator('#message')).toHaveValue('Recipe of the day\n\nA lovely tart');
  await expect(page.locator('#link')).toHaveValue('https://example.com/tart');
});

test('the same post to many Pages at once is flagged, and can go out one Page at a time', async ({ page }) => {
  // Spam-risk guard (NEXT_PHASES G6): warn, never block, and offer the stagger.
  const failures = collectFailures(page);
  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const extra = await Promise.all(
    ['Client B', 'Client C'].map((name, index) =>
      prisma.target.upsert({
        where: { workspaceId_providerId: { workspaceId: target.workspaceId, providerId: `spam-${index}` } },
        create: {
          workspaceId: target.workspaceId,
          socialAccountId: target.socialAccountId,
          type: 'page',
          providerId: `spam-${index}`,
          name,
          accessToken: target.accessToken,
          canPublish: true,
        },
        update: { canPublish: true, enabled: true },
      }),
    ),
  );
  const caption = 'Our product launch is live today with free delivery for every order this week';

  try {
    await open(page, '/compose');
    await page.getByLabel(/what do you want to say/i).fill(caption);
    // A tick before hydration is undone by React, so wait for React's own
    // count, ticking again whatever it dropped.
    await expect(async () => {
      for (const name of [PAGE_NAME, 'Client B', 'Client C']) {
        const box = page.getByRole('checkbox', { name: new RegExp(name) });
        if (!(await box.isChecked())) await box.click();
      }
      await expect(page.getByText(/^3 of 3 selected$/)).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 30_000 });

    await expect(page.getByText(/same content on 3 pages within 20 minutes/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: /send to one page every 20 minutes/i }).check();
    await page.getByRole('button', { name: /^schedule$/i }).click();
    await expect(page.getByText(/scheduled as 3 posts, one page at a time/i)).toBeVisible();

    const posts = await prisma.post.findMany({ where: { message: caption }, orderBy: { scheduledAt: 'asc' } });
    expect(posts).toHaveLength(3);
    expect(posts[1]!.scheduledAt!.getTime() - posts[0]!.scheduledAt!.getTime()).toBe(20 * 60_000);
  } finally {
    await prisma.post.deleteMany({ where: { message: caption } });
    await prisma.target.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
  }

  expect(failures).toEqual([]);
});
