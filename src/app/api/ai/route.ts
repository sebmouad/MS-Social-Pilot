import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { aiAvailable, generateCaption, improveCaption, planWeek, suggestHashtags, TONES } from '@/lib/ai';
import { assertPagesAllowed } from '@/lib/page-access';
import { createPost } from '@/lib/posts';
import { formatInZone } from '@/lib/time';
import { errors } from '@/lib/errors';
import { ok, readJson, route } from '@/lib/api';

const tone = z.enum(TONES as [string, ...string[]]).optional();
/** The Pages the post is for: one picked Page lends its own voice. */
const targetIds = z.array(z.string().min(1)).max(500).default([]);

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate'),
    brief: z.string().trim().min(3, 'Say a little about the post.').max(2000),
    tone,
    targetIds,
  }),
  z.object({
    action: z.literal('improve'),
    draft: z.string().trim().min(3, 'Write something to improve first.').max(6000),
    tone,
    targetIds,
  }),
  z.object({
    action: z.literal('hashtags'),
    text: z.string().trim().min(3, 'Write the post first.').max(6000),
    targetIds,
  }),
  z.object({
    action: z.literal('plan'),
    brief: z.string().trim().min(3, 'Say what the week is about.').max(2000),
    targetId: z.string().min(1),
    count: z.number().int().min(1).max(14).default(5),
    days: z.number().int().min(1).max(14).default(7),
    /** `yyyy-MM-dd`, the plan's first day; tomorrow when absent. */
    startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    tone,
  }),
]);

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!aiAvailable()) throw errors.aiNotConfigured();

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: auth.workspace.id },
    select: { aiEnabled: true, aiTone: true, aiBrandVoice: true },
  });
  if (!workspace.aiEnabled) throw errors.aiNotConfigured();

  const input = schema.parse(await readJson(request));
  const pageIds = input.action === 'plan' ? [input.targetId] : input.targetIds;
  assertPagesAllowed(auth.pageScope, pageIds);
  // One Page picked: its own voice, when it has one, over the workspace's.
  const page =
    pageIds.length === 1
      ? await prisma.target.findFirst({
          where: { id: pageIds[0], workspaceId: auth.workspace.id },
          select: { id: true, name: true, brandVoice: true },
        })
      : null;
  const shared = {
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    // The post is written for the audience of this client, so the workspace
    // language wins over the user's own interface language.
    locale: auth.workspace.defaultLocale,
    brandVoice: page?.brandVoice?.trim() || workspace.aiBrandVoice,
  };

  if (input.action === 'hashtags') {
    return ok({ hashtags: await suggestHashtags({ ...shared, text: input.text }) });
  }

  if (input.action === 'plan') {
    if (!page) throw errors.notFound();
    const timezone = auth.workspace.timezone;
    const tomorrow = formatInZone(new Date(Date.now() + 24 * 60 * 60 * 1000), timezone, 'yyyy-MM-dd');
    const first = input.startDay ?? tomorrow;
    const planned = await planWeek({
      ...shared,
      tone: input.tone ?? workspace.aiTone,
      brief: input.brief,
      count: input.count,
      days: input.days,
      pageName: page.name,
    });
    if (planned.length === 0) throw errors.aiPlanEmpty();
    const dayAfter = (offset: number) => {
      const [year, month, date] = first.split('-').map(Number) as [number, number, number];
      return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
    };
    const created: string[] = [];
    for (const entry of planned) {
      const result = await createPost(
        { workspaceId: auth.workspace.id, userId: auth.user.id, role: auth.role, requiresApproval: auth.workspace.requiresApproval },
        {
          message: entry.text,
          targetIds: [page.id],
          media: [],
          saveAsDraft: true,
          publishMode: 'worker',
          useQueue: false,
          scheduledAtLocal: `${dayAfter(entry.day)}T${entry.time}`,
          timezone,
        },
      );
      created.push(result.postId);
    }
    return ok({ created: created.length, postIds: created, from: first, to: dayAfter(input.days - 1) }, 201);
  }

  const withTone = { ...shared, tone: input.tone ?? workspace.aiTone };
  const result =
    input.action === 'generate'
      ? await generateCaption({ ...withTone, brief: input.brief })
      : await improveCaption({ ...withTone, draft: input.draft });

  return ok({ text: result.text, model: result.model });
});
