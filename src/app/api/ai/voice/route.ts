import { NextResponse } from 'next/server';

import { fail, readJson, route } from '@/lib/api';
import { speak, voiceAvailable, voiceSchema } from '@/lib/ai-voice';
import { AiProviderError } from '@/lib/ai-providers';
import { requireCapability } from '@/lib/auth';
import { canCompose } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

/** A text read aloud, as an MP3 to play or download. For people who write posts. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canCompose);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id }, select: { aiEnabled: true } });
  if (!workspace.aiEnabled || !voiceAvailable()) throw errors.aiNotConfigured();
  const input = voiceSchema.parse(await readJson(request));
  try {
    const audio = await speak({ workspaceId: auth.workspace.id, userId: auth.user.id, ...input });
    return new NextResponse(new Uint8Array(audio), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof AiProviderError) return fail(error.message, 502);
    throw error;
  }
});
