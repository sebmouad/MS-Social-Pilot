import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Saved replies: written once on their screen, then picked
 * with `/` in a comment's reply box, with the person's first name filled in.
 * Nothing is sent: the walk stops at the filled box.
 */

test.describe.configure({ mode: 'serial' });

const NAME = 'Opening hours (walk)';
let targetId: string;

test.beforeAll(async () => {
  targetId = await connectPretendPage(OWNER.workspace);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const author = await prisma.user.findFirstOrThrow({ where: { email: OWNER.email } });
  await prisma.savedReply.deleteMany({ where: { workspaceId: workspace.id, name: { endsWith: '(walk)' } } });
  await prisma.postComment.deleteMany({ where: { remoteId: 'saved_reply_c1' } });

  const post = await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: author.id,
      message: 'Product launch (saved replies walk)',
      status: 'published',
      publishedAt: new Date(),
      targets: { create: { targetId, status: 'published', remotePostId: 'saved_reply_post', publishedAt: new Date() } },
    },
    include: { targets: true },
  });
  await prisma.postComment.create({
    data: {
      postTargetId: post.targets[0]!.id,
      remoteId: 'saved_reply_c1',
      fromId: 'someone-1',
      fromName: 'Robin Lee',
      message: 'When are you open on Sundays?',
      createdTime: new Date(),
    },
  });
});

test.afterAll(async () => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  await prisma.savedReply.deleteMany({ where: { workspaceId: workspace.id, name: { endsWith: '(walk)' } } });
  await prisma.post.deleteMany({ where: { workspaceId: workspace.id, message: 'Product launch (saved replies walk)' } });
});

test('a saved reply is written, then picked with / in a reply box', async ({ page }) => {
  const failures = collectFailures(page);

  await open(page, '/inbox/replies');
  const form = page.getByRole('form', { name: 'Saved reply' });
  // Clicked again until the page has hydrated and the form opens.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add a saved reply' }).click({ timeout: 2000 });
    await expect(form).toBeVisible({ timeout: 2000 });
  }).toPass();
  await form.getByLabel('Name').fill(NAME);
  await form.getByLabel('Reply', { exact: true }).fill('Hi {first_name}, {page} is open every day from 9 to 5.');
  await form.getByRole('button', { name: 'Save reply' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: NAME })).toBeVisible();

  await open(page, `/analytics?view=comments&target=${targetId}`);
  const comment = page.getByRole('listitem').filter({ hasText: 'When are you open on Sundays?' });
  const box = comment.getByRole('textbox');
  await expect(async () => {
    await comment.getByRole('button', { name: 'Reply', exact: true }).click({ timeout: 2000 });
    await expect(box).toBeVisible({ timeout: 2000 });
  }).toPass();
  await box.fill('/opening');
  await comment.getByRole('list', { name: 'Saved replies' }).getByRole('button', { name: /Opening hours \(walk\)/ }).click();
  await expect(box).toHaveValue(/^Hi Robin, .+ is open every day from 9 to 5\.$/);

  expect(failures).toEqual([]);
});
