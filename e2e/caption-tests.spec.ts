import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Caption A/B tests (NEXT_PHASES G9): the composer offers a second caption,
 * and a finished test shows its winner and adds it to the Page voice. Nothing
 * is published: the finished test is seeded.
 */

test.describe.configure({ mode: 'serial' });

const NAME = 'Product launch (caption walk)';
let targetId: string;

async function cleanUp() {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  await prisma.post.deleteMany({ where: { workspaceId: workspace.id, captionTest: { name: NAME } } });
  await prisma.captionTest.deleteMany({ where: { workspaceId: workspace.id, name: NAME } });
  return workspace;
}

test.beforeAll(async () => {
  targetId = await connectPretendPage(OWNER.workspace);
  const workspace = await cleanUp();
  const author = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });
  const test = await prisma.captionTest.create({
    data: {
      workspaceId: workspace.id,
      name: NAME,
      status: 'decided',
      winnerLabel: 'B',
      lift: 50,
      decidedAt: new Date(),
      results: [
        { label: 'A', views: 1000, engagements: 20, rate: 0.02 },
        { label: 'B', views: 1000, engagements: 30, rate: 0.03 },
      ],
    },
  });
  for (const label of ['A', 'B']) {
    await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: author.id,
        message: `${NAME} caption ${label}`,
        status: 'published',
        publishedAt: new Date(),
        captionTestId: test.id,
        captionLabel: label,
        targets: { create: { targetId, status: 'published', publishedAt: new Date() } },
      },
    });
  }
});

test.afterAll(async () => {
  await cleanUp();
  await prisma.target.update({ where: { id: targetId }, data: { brandVoice: null } });
});

test('the composer offers a second caption to test', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/compose');
  const toggle = page.getByLabel('A/B test the caption');
  await expect(async () => {
    // A tick before hydration checks the box without telling React: untick and tick again.
    await toggle.uncheck({ timeout: 2000 });
    await toggle.check({ timeout: 2000 });
    await expect(page.getByLabel('Caption B')).toBeVisible({ timeout: 2000 });
  }).toPass();
  await expect(page.getByLabel('Compare after')).toBeVisible();
  await page.getByRole('button', { name: 'Add a caption' }).click();
  await expect(page.getByLabel('Caption C')).toBeVisible();
  expect(failures).toEqual([]);
});

test('a finished test shows its winner and goes into the Page voice', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/analytics/tests');
  await expect(page.getByText('Caption B won (+50% engagement per view)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Caption tests' })).toHaveAttribute('aria-current', 'page');

  await expect(async () => {
    await page.getByRole('button', { name: 'Add to Page voice' }).click({ timeout: 2000 }).catch(() => undefined);
    await expect(page.getByText('Added to the Page voice.')).toBeVisible({ timeout: 5000 });
  }).toPass();
  const voice = await prisma.target.findUniqueOrThrow({ where: { id: targetId }, select: { brandVoice: true } });
  expect(voice.brandVoice).toContain(`${NAME} caption B`);
  expect(failures).toEqual([]);
});
