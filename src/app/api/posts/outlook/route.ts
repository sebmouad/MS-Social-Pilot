import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { engagementOutlook } from '@/lib/engagement-outlook';
import { assertPagesAllowed } from '@/lib/page-access';
import { POST_FORMATS } from '@/lib/page-analysis';
import { prisma } from '@/lib/prisma';
import { formatInZone, localInputToUtc } from '@/lib/time';
import { timezone } from '@/lib/validation';

const schema = z.object({
  targetId: z.string().min(1),
  format: z.enum(POST_FORMATS as [string, ...string[]]),
  length: z.number().int().min(0).max(70_000),
  /** The typed time; absent means the time is not chosen yet. */
  scheduledAtLocal: z.string().min(10).nullish(),
  timezone: timezone.default('UTC'),
});

/**
 * Engagement prediction: how the draft compares with the
 * Page's own past posts. Advice only; reads stored posts, no Graph call.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse(await readJson(request));
  assertPagesAllowed(auth.pageScope, [input.targetId]);
  const target = await prisma.target.findFirst({ where: { id: input.targetId, workspaceId: auth.workspace.id, type: 'page' }, select: { id: true } });
  if (!target) return ok({ prediction: null });

  let hour: number | null = null;
  let weekday: number | null = null;
  if (input.scheduledAtLocal) {
    try {
      const at = localInputToUtc(input.scheduledAtLocal, input.timezone);
      hour = Number(formatInZone(at, auth.workspace.timezone, 'H', 'en'));
      weekday = Number(formatInZone(at, auth.workspace.timezone, 'i', 'en')) % 7;
    } catch {
      // An unfinished date: judge the rest.
    }
  }
  const prediction = await engagementOutlook({
    targetId: target.id,
    timeZone: auth.workspace.timezone,
    draft: { format: input.format as (typeof POST_FORMATS)[number], length: input.length, hour, weekday },
  });
  return ok({ prediction });
});
