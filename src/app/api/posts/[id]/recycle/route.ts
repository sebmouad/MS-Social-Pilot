import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { setRecycling } from '@/lib/evergreen';
import { LIMITS } from '@/lib/constants';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({
  enabled: z.boolean(),
  everyDays: z.number().int().min(1).max(365).nullish(),
  limit: z.number().int().min(1).max(100).nullish(),
  /**
   * Alternate wordings. Facebook rejects identical repeated content with error
   * 506, so recycling with none is very likely to fail on the second run.
   */
  variants: z.array(z.string().trim().max(LIMITS.messageLength)).max(LIMITS.variantsPerPost).optional(),
});

export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = schema.parse(await readJson(request));

  await setRecycling({
    workspaceId: auth.workspace.id,
    postId: id,
    role: auth.role,
    requiresApproval: auth.workspace.requiresApproval,
    enabled: input.enabled,
    everyDays: input.everyDays ?? undefined,
    limit: input.limit ?? undefined,
    variants: input.variants,
  });

  return ok({ ok: true });
});
