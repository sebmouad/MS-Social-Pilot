import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/**
 * Comment moderation rules (NEXT_PHASES G7): a rule is written, paused and
 * deleted from its screen, and what a rule did is listed with a way to undo it.
 */

test.describe.configure({ mode: 'serial' });

const RULE = 'Hide spam links (walk)';

test.beforeAll(async () => {
  const targetId = await connectPretendPage(OWNER.workspace);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  await prisma.moderationRule.deleteMany({ where: { workspaceId: workspace.id, name: { endsWith: '(walk)' } } });
  await prisma.moderationAction.deleteMany({ where: { workspaceId: workspace.id, ruleName: { endsWith: '(walk)' } } });
  await prisma.moderationAction.create({
    data: {
      workspaceId: workspace.id,
      ruleName: 'Earlier rule (walk)',
      targetId,
      remoteCommentId: 'walk-comment',
      authorName: 'Sam Carter',
      message: 'Cheap followers at spam.example',
      action: 'alert',
    },
  });
});

test.afterAll(async () => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  await prisma.moderationRule.deleteMany({ where: { workspaceId: workspace.id, name: { endsWith: '(walk)' } } });
  await prisma.moderationAction.deleteMany({ where: { workspaceId: workspace.id, ruleName: { endsWith: '(walk)' } } });
});

test('a rule is created, paused and deleted', async ({ page }) => {
  const failures = collectFailures(page);
  await open(page, '/inbox/rules');
  await expect(page.getByRole('heading', { name: 'Moderation rules', level: 1 })).toBeVisible();

  // The log lists what rules did, newest first.
  await expect(page.getByText('Cheap followers at spam.example')).toBeVisible();
  await expect(page.getByText('Alert sent')).toBeVisible();

  const form = page.getByRole('form', { name: 'Moderation rule' });
  // Clicked again until the page has hydrated and the form opens.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add a rule' }).click({ timeout: 2000 });
    await expect(form).toBeVisible({ timeout: 2000 });
  }).toPass();
  await form.getByLabel('Rule name').fill(RULE);
  await form.getByLabel('When a comment contains').selectOption('keywords');
  await form.getByLabel('Words to look for').fill('giveaway, free followers');
  await form.getByLabel('Then').selectOption('reply');
  // A reply rule cannot be saved without the reply.
  await expect(form.getByLabel('Reply', { exact: true })).toBeVisible();
  await form.getByLabel('Reply', { exact: true }).fill('Hi {first_name}, we never run giveaways here.');
  await form.getByRole('button', { name: 'Save rule' }).click();

  await expect(page.getByRole('status')).toContainText('Rule saved');
  const card = page.getByRole('listitem').filter({ hasText: RULE });
  await expect(card).toContainText('Reply as the Page when a comment contains one of these words');
  await expect(card).toContainText('giveaway, free followers');

  await card.getByRole('button', { name: 'Pause' }).click();
  await expect(card).toContainText('Paused');

  await card.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: RULE })).toHaveCount(0);

  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  expect(await prisma.moderationRule.count({ where: { workspaceId: workspace.id, name: RULE } })).toBe(0);
  expect(failures).toEqual([]);
});
