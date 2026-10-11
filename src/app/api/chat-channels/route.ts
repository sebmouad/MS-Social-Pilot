import { requireCapability } from '@/lib/auth';
import { chatChannelSchema, createChatChannel, testChatChannel } from '@/lib/chat';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

/** The workspace's Slack and Telegram channels, without their secrets. */
export const GET = route(async () => {
  const auth = await requireCapability(canManageSettings);
  const channels = await prisma.chatChannel.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, name: true, events: true, enabled: true, lastError: true, lastSentAt: true },
  });
  return ok({ channels });
});

/** Add a channel and send it a test message straight away, so a wrong id shows now. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = chatChannelSchema.parse(await readJson(request));
  const channel = await createChatChannel(auth.workspace.id, input);
  const testError = await testChatChannel(channel.id, auth.workspace.id);
  return ok({ id: channel.id, testError }, 201);
});
