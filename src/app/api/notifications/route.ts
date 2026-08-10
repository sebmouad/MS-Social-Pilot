import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({
  onPublishFailure: z.boolean().optional(),
  onTokenExpiry: z.boolean().optional(),
  onApprovalRequest: z.boolean().optional(),
  onApprovalDecision: z.boolean().optional(),
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
    },
  });
});

export const PUT = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse(await readJson(request));

  const setting = await prisma.notificationSetting.upsert({
    where: { userId_workspaceId: { userId: auth.user.id, workspaceId: auth.workspace.id } },
    create: { userId: auth.user.id, workspaceId: auth.workspace.id, ...input },
    update: input,
  });

  return ok({ settings: setting });
});
