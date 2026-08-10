import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { workspaceSettingsSchema } from '@/lib/validation';
import { fail, ok, readJson, route } from '@/lib/api';

export const PATCH = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!canManageAccounts(auth.role)) {
    return fail('Only workspace owners and admins can change these settings.', 403);
  }

  const input = workspaceSettingsSchema.parse(await readJson(request));

  const workspace = await prisma.workspace.update({
    where: { id: auth.workspace.id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    },
  });

  return ok({ id: workspace.id, name: workspace.name, timezone: workspace.timezone });
});
