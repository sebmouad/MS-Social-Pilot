import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { authorizeInbox } from './access';
import type { InboxReadActor } from './types';

/**
 * Open Messenger conversations whose newest message is older than the reply window: Facebook no longer accepts a reply,
 * so they cannot be answered (2026-11-14). Scoped to the channels the person may read (and, when given, the channel
 * filter in view); at most 2000 ids.
 */
export async function readExpiredConversationIds(actor: InboxReadActor, channelFilter: readonly string[] = []): Promise<string[]> {
  const access = await authorizeInbox(actor);
  const channelIds = channelFilter.length ? access.channelIds.filter(id => channelFilter.includes(id)) : access.channelIds;
  if (!channelIds.length) return [];
  const hours = Number(await runtimeConfig('inbox.messengerReplyWindowHours'));
  if (!Number.isFinite(hours) || hours <= 0) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT c.id FROM conversations c JOIN targets t ON t.id = c."targetId"
    WHERE t."workspaceId" = ${actor.workspaceId} AND c."targetId" IN (${Prisma.join(channelIds)}) AND c."resolvedAt" IS NULL
      AND COALESCE((SELECT m."createdTime" FROM conversation_messages m WHERE m."conversationId" = c.id ORDER BY m."createdTime" DESC, m.id DESC LIMIT 1), c."updatedTime")
        < NOW() - make_interval(hours => ${hours}::int)
    ORDER BY c."updatedTime" DESC LIMIT 2000`);
  return rows.map(row => row.id);
}
