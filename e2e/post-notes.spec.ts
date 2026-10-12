import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Internal notes (NEXT_PHASES H8): a team-only thread on a post, with @mentions. */

const MESSAGE = 'Post with notes E2E';

test.afterAll(async () => {
  await prisma.post.deleteMany({ where: { message: MESSAGE } });
});

test('adds a note with a mention and removes it', async ({ page }) => {
  const failures = collectFailures(page);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: await connectPretendPage(OWNER.workspace) } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  const post = await prisma.post.create({
    data: { workspaceId: target.workspaceId, authorId: owner.id, message: MESSAGE, targets: { create: { targetId: target.id } } },
  });

  await open(page, `/compose?post=${post.id}`);
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass();
  await expect(dialog.getByText('No notes yet.', { exact: false })).toBeVisible();

  const box = dialog.getByLabel('Add a note');
  await box.pressSequentially('Please check @Wre');
  await dialog.getByRole('button', { name: `@${OWNER.name}` }).click();
  await expect(box).toHaveValue(`Please check @${OWNER.name} `);
  await box.pressSequentially('before Friday');
  await dialog.getByRole('button', { name: 'Add note' }).click();

  const thread = dialog.getByRole('list', { name: 'Internal notes' });
  await expect(thread.getByText(`@${OWNER.name}`)).toBeVisible();
  expect(await prisma.postNote.findFirstOrThrow({ where: { postId: post.id } })).toMatchObject({ mentionIds: [] });

  await thread.getByRole('button', { name: 'Remove' }).click();
  await page.locator('[data-confirm]').click();
  await expect(thread).toBeHidden();
  expect(await prisma.postNote.count({ where: { postId: post.id } })).toBe(0);
  expect(failures).toEqual([]);
});
