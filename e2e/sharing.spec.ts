import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { open, OWNER } from './helpers';
import { prisma } from './fixtures';

test('deletes active and revoked client links from the workspace', async ({ page }) => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
  const links = await Promise.all([false, true].map((revoked) => prisma.shareLink.create({ data: {
    workspaceId: workspace.id,
    createdById: owner.id,
    kind: 'portal',
    title: revoked ? 'Old client link' : 'Current client link',
    tokenHash: randomUUID(),
    revokedAt: revoked ? new Date() : null,
  } })));
  try {
    await open(page, '/settings/sharing');
    for (const link of links) {
      const row = page.getByRole('listitem').filter({ hasText: link.title });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Delete record' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('stop working immediately');
      await dialog.locator('[data-confirm]').click();
      await expect.poll(() => prisma.shareLink.findUnique({ where: { id: link.id } })).toBeNull();
      await open(page, '/settings/sharing');
    }
  } finally {
    await prisma.shareLink.deleteMany({ where: { id: { in: links.map((link) => link.id) } } });
    await prisma.$disconnect();
  }
});
