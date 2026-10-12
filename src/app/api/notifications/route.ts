import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { PAGE_EVENTS } from '@/lib/email/notify';
import { targetScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({
  onPublishFailure: z.boolean().optional(),
  onTokenExpiry: z.boolean().optional(),
  onApprovalRequest: z.boolean().optional(),
  onApprovalDecision: z.boolean().optional(),
  onNewInbox: z.boolean().optional(),
  /** Every Page × event this member does not want to hear about; replaces the list. */
  mutes: z
    .array(z.object({ targetId: z.string().min(1), event: z.enum(PAGE_EVENTS) }))
    .max(5000)
    .optional(),
});

export const GET = route(async () => {
  const auth = await requireAuth();

  const setting = await prisma.notificationSetting.findUnique({
    where: { userId_workspaceId: { userId: auth.user.id, workspaceId: auth.workspace.id } },
  });

  // No row yet means "not configured", which is treated as opted in — a new
  // workspace must warn about failures before anyone visits this screen.
  return ok({
    settings: setting ?? {
      onPublishFailure: true,
      onTokenExpiry: true,
      onApprovalRequest: true,
      onApprovalDecision: true,
      onNewInbox: false,
    },
  });
});

export const PUT = route(async (request: Request) => {
  const auth = await requireAuth();
  const { mutes, ...input } = schema.parse(await readJson(request));
  const where = { userId_workspaceId: { userId: auth.user.id, workspaceId: auth.workspace.id } };

  // Switched on again: the inbox email starts from now, not from when it was last on.
  const previous = await prisma.notificationSetting.findUnique({ where, select: { onNewInbox: true } });
  const restart = input.onNewInbox === true && !previous?.onNewInbox ? { inboxDigestAt: null } : {};

  const setting = await prisma.notificationSetting.upsert({
    where,
    create: { userId: auth.user.id, workspaceId: auth.workspace.id, ...input },
    update: { ...input, ...restart },
  });

  if (mutes) {
    // Only this workspace's Pages the member may see; anything else is dropped.
    const pages = await prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, ...targetScope(auth.pageScope) },
      select: { id: true },
    });
    const allowed = new Set(pages.map((page) => page.id));
    await prisma.$transaction([
      prisma.notificationMute.deleteMany({ where: { userId: auth.user.id, target: { workspaceId: auth.workspace.id } } }),
      prisma.notificationMute.createMany({
        data: mutes.filter((mute) => allowed.has(mute.targetId)).map((mute) => ({ userId: auth.user.id, ...mute })),
        skipDuplicates: true,
      }),
    ]);
  }

  return ok({ settings: setting });
});
