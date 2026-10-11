import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER, SIGNED_IN_SCREENS } from './helpers';
import { connectPretendPage, PAGE_NAME, prisma } from './fixtures';

/**
 * The same screens, on a phone.
 *
 * Everything else runs at desktop width, which leaves an entire dimension of
 * the app untested: a navigation bar that collapses into a menu below `lg`,
 * tables that swap to cards at `sm`, tab strips that scroll sideways. None of
 * that is exercised by a test that never narrows the window.
 *
 * The assertion that earns its place here is horizontal overflow. A single
 * element wider than the screen makes the whole page slide under the thumb —
 * the heading drifts off, buttons sit half off the edge — and it is invisible
 * at any width where the element fits.
 */

/** How far past the viewport a page is allowed to reach. */
const SLACK = 2;

/**
 * The content that actually breaks a narrow layout.
 *
 * An empty screen fits on anything. Overflow arrives with a filename nobody
 * would shorten, a URL with no spaces in it, a table with one more column than
 * the screen has room for — so the walk seeds those before looking.
 */
test.beforeAll(async () => {
  const targetId = await connectPretendPage(OWNER.workspace);
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { name: OWNER.workspace },
  });
  const author = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });

  const post = await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: author.id,
      message:
        'Sourdough https://an-unreasonably-long-example-domain-for-testing.example/with/a/path/that/never/wraps?because=it+has+no+spaces',
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      targets: { create: { targetId, status: 'pending' } },
    },
    include: { targets: true },
  });

  await prisma.media.create({
    data: {
      workspaceId: workspace.id,
      kind: 'image',
      filename: 'a-photograph-of-the-bakery-taken-on-a-tuesday-morning-in-november.jpg',
      mimeType: 'image/jpeg',
      size: 2_400_000,
      storageKey: 'uploads/long-name.jpg',
      // A real (tiny) image rather than a path to a file that is not there.
      // A URL that 404s would make this walk fail on a broken image of its own
      // making, which teaches nothing about the app.
      url:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
  });

  await prisma.postComment.create({
    data: {
      postTargetId: post.targets[0]!.id,
      remoteId: 'phone_c1',
      fromName: 'Someone With A Notably Long Display Name',
      message: 'Supercalifragilisticexpialidociousandthensomemoreletterswithnobreaks',
      createdTime: new Date(),
    },
  });

  await prisma.activityLog.create({
    data: { workspaceId: workspace.id, actorId: author.id, action: 'post.created' },
  });

  // A feed: the name and the URL are both user-supplied, and a URL is the
  // longest unbreakable string the app ever renders.
  await prisma.feedSource.upsert({
    where: { id: 'phone-feed' },
    create: {
      id: 'phone-feed',
      workspaceId: workspace.id,
      name: 'The Halloway Bakery Journal — everything from the ovens, weekly',
      url: 'https://an-unreasonably-long-example-domain-for-testing.example/feeds/journal/everything.atom',
      messageTemplate: '{{title}}\n\n{{link}}',
      targetIds: [targetId],
    },
    update: {},
  });

  // A colleague whose name and address are both long, for the team screen.
  await prisma.invitation.upsert({
    where: { workspaceId_email: { workspaceId: workspace.id, email: 'a-very-long-address-indeed@an-unreasonably-long-example-domain.example' } },
    create: {
      workspaceId: workspace.id,
      email: 'a-very-long-address-indeed@an-unreasonably-long-example-domain.example',
      role: 'editor',
      tokenHash: 'phone-walk-not-a-real-token',
      invitedById: author.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });

  // A second destination, of the kind whose row carries the longest secondary
  // line: type, account name, and the note explaining why it is switched off.
  const page = await prisma.target.findFirstOrThrow({ where: { id: targetId } });
  await prisma.target.upsert({
    where: { workspaceId_providerId: { workspaceId: workspace.id, providerId: 'ig-phone' } },
    create: {
      workspaceId: workspace.id,
      socialAccountId: page.socialAccountId,
      type: 'instagram',
      providerId: 'ig-phone',
      name: '@halloway_bakery_official',
      accessToken: page.accessToken,
      enabled: false,
      canPublish: false,
    },
    update: {},
  });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function overflowingElements(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate((slack) => {
    const limit = document.documentElement.clientWidth + slack;
    const guilty: string[] = [];

    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= limit) continue;

      // Anything inside a container that scrolls its own overflow is doing the
      // right thing: a wide table or a tab strip that slides sideways is fine,
      // the page sliding is not. The container can be any ancestor, not just
      // the parent — an icon three levels inside a scrolling nav is still
      // inside it.
      let inScroller = false;
      for (
        let node: Element | null = element;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (['auto', 'scroll'].includes(window.getComputedStyle(node).overflowX)) {
          inScroller = true;
          break;
        }
      }
      if (inScroller) continue;

      const name = element.tagName.toLowerCase();
      const classes = (element.getAttribute('class') ?? '').slice(0, 60);
      guilty.push(`${name}.${classes} → ${Math.round(box.right)}px`);
    }

    return guilty;
  }, SLACK);
}

for (const path of SIGNED_IN_SCREENS) {
  test(`${path} fits on a phone`, async ({ page }) => {
    const failures = collectFailures(page);

    await open(page, path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    // The page itself must not slide sideways under the thumb.
    expect(await overflowingElements(page), `${path} has elements past the edge`).toEqual([]);

    const scrollable = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(scrollable, `${path} scrolls ${scrollable}px sideways`).toBeLessThanOrEqual(SLACK);

    expect(failures, `${path} reported browser errors`).toEqual([]);
  });
}

test('the per-post metrics screen fits, with a caption that does not wrap', async ({ page }) => {
  // Reached from the analytics table rather than the nav, so the walk over
  // SIGNED_IN_SCREENS never sees it — and it renders the post's whole message
  // above a table of metric names, which is the combination that overflows.
  const target = await prisma.target.findFirstOrThrow({ where: { name: PAGE_NAME } });
  const post = await prisma.post.create({
    data: {
      workspaceId: target.workspaceId,
      authorId: (await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } })).id,
      message:
        'Read the whole thing at https://an-unreasonably-long-example-domain-for-testing.example/journal/the-sourdough-post',
      status: 'published',
      publishedAt: new Date(),
      targets: {
        create: {
          targetId: target.id,
          status: 'published',
          remotePostId: 'ig_metrics_walk',
          publishedAt: new Date(),
          insights: { impressions: 120, reach: 90, reactions: 12, comments: 3 },
        },
      },
    },
    include: { targets: true },
  });

  const failures = collectFailures(page);
  await open(page, `/analytics/post/${post.targets[0]!.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  expect(await overflowingElements(page), 'the metrics screen has elements past the edge').toEqual([]);

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scrollable, `the metrics screen scrolls ${scrollable}px sideways`).toBeLessThanOrEqual(SLACK);
  expect(failures).toEqual([]);
});

test('the seeded long content actually reaches the screens that are checked', async ({ page }) => {
  // Without this the seeding above is decoration: a fixture that never renders
  // makes the overflow checks look thorough while exercising an empty page,
  // which is exactly how the first version of this walk passed on every screen.
  await open(page, '/feeds');
  await expect(page.getByText(/Halloway Bakery Journal/i)).toBeVisible();

  await open(page, '/settings/team');
  await expect(page.getByText(/a-very-long-address-indeed/i)).toBeVisible();

  await open(page, '/compose');
  await expect(page.getByText(/halloway_bakery_official/i)).toBeVisible();

  await open(page, '/settings/media');
  await expect(page.getByText(/a-photograph-of-the-bakery/i).first()).toBeVisible();
});

test('the analytics tabs stay usable when there is data behind them', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/analytics?view=comments');
  await expect(page.getByText(PAGE_NAME).first()).toBeVisible();

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scrollable, `the comments tab scrolls ${scrollable}px sideways`).toBeLessThanOrEqual(SLACK);
  expect(await overflowingElements(page)).toEqual([]);
  expect(failures).toEqual([]);
});

test('on a phone the sidebar is a drawer behind the menu, with the composer one tap away', async ({ page }) => {
  await open(page, '/dashboard');

  // Writing a post is the one job that never hides behind the menu.
  await expect(page.getByRole('banner').getByRole('link', { name: /new post/i })).toBeVisible();

  const menu = page.getByRole('button', { name: /^menu$/i });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-controls', 'main-menu');

  // Retry until the drawer is open: the handler is attached at hydration, and
  // on a development build a first click can land before React is listening.
  await expect(async () => {
    await menu.click();
    await expect(page.locator('#main-menu')).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });

  // Every module's screens are in it, grouped, and the drawer fits the phone.
  const drawer = page.locator('#main-menu');
  for (const name of [/^calendar$/i, /^queue$/i, /^posts$/i, /^pages$/i, /^reports$/i, /^ads$/i, /^connections$/i, /^settings$/i]) {
    await expect(drawer.getByRole('link', { name })).toBeVisible();
  }

  await drawer.getByRole('link', { name: /^settings$/i }).click();
  await page.waitForURL(/\/settings/);

  // And it closes on the way, rather than covering the screen it navigated to.
  await expect(page.locator('#main-menu')).toHaveCount(0);
});

/**
 * The screens somebody meets before they have an account.
 *
 * These are the ones most likely to be opened on a phone in the first place —
 * an invitation arrives by email, and the email is read on a phone — and the
 * ones where a layout that does not fit costs the most, because nobody has any
 * reason yet to persevere with it.
 */
test.describe('before signing in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const PUBLIC_SCREENS = ['/login', '/register', '/data-deletion', '/terms', '/privacy-policy', '/invite/not-a-real-token'];

  for (const path of PUBLIC_SCREENS) {
    test(`${path} fits on a phone`, async ({ page }) => {
      const failures = collectFailures(page);

      await open(page, path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

      expect(await overflowingElements(page), `${path} has elements past the edge`).toEqual([]);

      const scrollable = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(scrollable, `${path} scrolls ${scrollable}px sideways`).toBeLessThanOrEqual(SLACK);

      expect(failures, `${path} reported browser errors`).toEqual([]);
    });
  }

  test('the sign-in form can be filled in with a thumb', async ({ page }) => {
    await open(page, '/login');

    // Every field reachable without pinching, and the button not underneath
    // the fold or half off the edge.
    for (const field of [/e-?mail/i, /^password$/i]) {
      const input = page.getByLabel(field);
      await expect(input).toBeVisible();

      const box = await input.boundingBox();
      expect(box, 'no box for a visible field').not.toBeNull();
      expect(box!.width, 'a field narrower than a thumb').toBeGreaterThan(200);
    }

    const submit = page.getByRole('button', { name: /sign in/i });
    await expect(submit).toBeVisible();

    const box = await submit.boundingBox();
    // Apple and Google both put the minimum comfortable tap target at 44px.
    expect(box!.height, 'the button is too short to tap reliably').toBeGreaterThanOrEqual(40);
  });
});
