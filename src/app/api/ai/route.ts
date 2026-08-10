import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { aiAvailable, generateCaption, improveCaption, TONES } from '@/lib/ai';
import { errors } from '@/lib/errors';
import { ok, readJson, route } from '@/lib/api';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate'),
    brief: z.string().trim().min(3, 'Say a little about the post.').max(2000),
    tone: z.enum(TONES as [string, ...string[]]).optional(),
  }),
  z.object({
    action: z.literal('improve'),
    draft: z.string().trim().min(3, 'Write something to improve first.').max(6000),
    tone: z.enum(TONES as [string, ...string[]]).optional(),
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
  const shared = {
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    // The post is written for the audience of this client, so the workspace
    // language wins over the user's own interface language.
    locale: auth.workspace.defaultLocale,
    tone: input.tone ?? workspace.aiTone,
    brandVoice: workspace.aiBrandVoice,
  };

  const result =
    input.action === 'generate'
      ? await generateCaption({ ...shared, brief: input.brief })
      : await improveCaption({ ...shared, draft: input.draft });

  return ok({ text: result.text, model: result.model });
});
