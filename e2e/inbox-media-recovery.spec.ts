import { expect, test } from '@playwright/test';
import { open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

test('conversation drafts survive switching and reselecting the current conversation', async ({ page }) => {
  const targetId = await connectPretendPage(OWNER.workspace);
  const threads: string[] = [];
  for (const name of ['Draft participant A', 'Draft participant B']) {
    const row = await prisma.conversation.create({ data: { targetId, remoteId: `draft-${name}`, participants: [name], updatedTime: new Date(), messageCount: 1,
      messages: { create: { remoteId: `draft-message-${name}`, fromName: name, fromId: `recipient-${name}`, message: 'Draft test message', createdTime: new Date() } },
    } }); threads.push(row.id);
  }
  try {
    await open(page, `/inbox/messages?target=${targetId}`);
    const a = page.getByRole('button').filter({ hasText: 'Draft participant A' });
    const b = page.getByRole('button').filter({ hasText: 'Draft participant B' });
    await a.click();
    const replyA = page.getByRole('textbox', { name: 'Reply to Draft participant A' });
    await replyA.fill('Unsent reply A');
    await a.click(); await expect(replyA).toHaveValue('Unsent reply A');
    await b.click();
    await page.getByRole('textbox', { name: 'Reply to Draft participant B' }).fill('Unsent reply B');
    await a.click(); await expect(replyA).toHaveValue('Unsent reply A');
    await b.click(); await expect(page.getByRole('textbox', { name: 'Reply to Draft participant B' })).toHaveValue('Unsent reply B');
  } finally { await prisma.conversation.deleteMany({ where: { id: { in: threads } } }); }
});

test('media transport loss is announced and retry reconciles before issuing another deletion', async ({ page }) => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const media = await prisma.media.create({ data: { workspaceId: workspace.id, kind: 'image', filename: 'transport-test.png', mimeType: 'image/png', size: 1, storageKey: 'transport-test.png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } });
  let writes = 0; let reconciliations = 0;
  await page.route(`**/api/media/${media.id}`, async route => { writes++; await route.abort('failed'); });
  await page.route('**/api/media', async route => { reconciliations++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ media: [{ id: media.id }] }) }); });
  try {
    await open(page, '/settings/media');
    const row = page.getByRole('listitem').filter({ hasText: 'transport-test.png' });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('[data-confirm]').click();
    await expect(page.locator('div[role=alert]').filter({ hasText: 'connection was lost' })).toContainText('connection was lost');
    await expect(row).toBeVisible(); await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('[data-confirm]').click();
    await expect.poll(() => writes).toBe(2);
    expect(reconciliations).toBe(1);
  } finally { await prisma.media.delete({ where: { id: media.id } }); }
});
