import { z } from 'zod';

import { fail, ok, readJson, route } from '@/lib/api';
import { generateImage, IMAGE_SIZES, imageAvailable } from '@/lib/ai-image';
import { AiProviderError } from '@/lib/ai-providers';
import { requireCapability } from '@/lib/auth';
import { canCompose } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  prompt: z.string().trim().min(3).max(1000),
  size: z.enum(Object.keys(IMAGE_SIZES) as [keyof typeof IMAGE_SIZES, ...Array<keyof typeof IMAGE_SIZES>]).default('square'),
});

/** A picture from a description, saved to the media library. For people who write posts. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canCompose);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id }, select: { aiEnabled: true } });
  if (!workspace.aiEnabled || !imageAvailable()) throw errors.aiNotConfigured();
  const input = schema.parse(await readJson(request));
  try {
    return ok(await generateImage({ workspaceId: auth.workspace.id, userId: auth.user.id, ...input }));
  } catch (error) {
    if (error instanceof AiProviderError) return fail(error.message, 502);
    throw error;
  }
});
