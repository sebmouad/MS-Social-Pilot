import { fail, ok, readJson, route } from '@/lib/api';
import { listVideos, startVideo, videoAvailable, videoSchema } from '@/lib/ai-video';
import { AiProviderError } from '@/lib/ai-providers';
import { requireCapability } from '@/lib/auth';
import { canCompose } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export const GET = route(async () => {
  const auth = await requireCapability(canCompose);
  return ok({ videos: await listVideos(auth.workspace.id) });
});

/** Start a video from a description; the worker finishes it into the media library. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canCompose);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id }, select: { aiEnabled: true } });
  if (!workspace.aiEnabled || !videoAvailable()) throw errors.aiNotConfigured();
  const input = videoSchema.parse(await readJson(request));
  try {
    const video = await startVideo({ workspaceId: auth.workspace.id, userId: auth.user.id, ...input });
    return ok({ video }, 201);
  } catch (error) {
    if (error instanceof AiProviderError) return fail(error.message, 502);
    throw error;
  }
});
