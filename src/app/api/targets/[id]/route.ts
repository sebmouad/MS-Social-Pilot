import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { targetUpdateSchema } from '@/lib/validation';
import { fail, ok, readJson, route } from '@/lib/api';

/** Enable or disable a destination in the composer. */
export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = targetUpdateSchema.parse(await readJson(request));

  const target = await prisma.target.findFirst({
    where: { id, workspaceId: auth.workspace.id },
  });
  if (!target) return fail('Destination not found.', 404);

  if (input.enabled && !target.canPublish) {
    return fail(
      target.publishBlocker ?? 'This destination cannot be published to right now.',
      409,
    );
  }

  const updated = await prisma.target.update({
    where: { id },
    data: { enabled: input.enabled ?? target.enabled },
  });

  return ok({ id: updated.id, enabled: updated.enabled });
});
