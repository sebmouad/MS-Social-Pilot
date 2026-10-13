import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { assertPagesAllowed } from '@/lib/page-access';
import { spamRisk } from '@/lib/spam-guard';
import { localInputToUtc } from '@/lib/time';
import { httpUrl, timezone } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({
  message: z.string().max(70_000).default(''),
  link: httpUrl.nullish(),
  targetIds: z.array(z.string().min(1)).max(500),
  /** The typed time; absent means now (publish now, or the queue). */
  scheduledAtLocal: z.string().min(10).nullish(),
  timezone: timezone.default('UTC'),
  /** The post being edited, which must not count against itself. */
  postId: z.string().min(1).optional(),
});

/**
 * Spam-risk guard: would this post put the same link or text
 * on too many Pages at once? Advice only — creating the post never asks.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse(await readJson(request));
  assertPagesAllowed(auth.pageScope, input.targetIds);

  let at = new Date();
  if (input.scheduledAtLocal) {
    try {
      at = localInputToUtc(input.scheduledAtLocal, input.timezone);
    } catch {
      return ok({ risk: null });
    }
  }

  const risk = await spamRisk(auth.workspace.id, {
    message: input.message,
    link: input.link ?? null,
    targetIds: input.targetIds,
    at,
    excludePostId: input.postId,
  });
  return ok({ risk });
});
