import { inboxServiceText } from './service-copy';
import { z } from 'zod';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { authorizeInbox as readAccess } from './access';
import type { InboxReadActor, InboxReadConstraints } from './types';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const invalid = async () => new OperationError('invalid_request', await inboxServiceText('service3'));

export type InboxSearchHit = {
  kind: 'message' | 'comment';
  /** Thread key the hit belongs to (`message:<conversationId>` or `comment:<commentId>`), for opening the thread. */
  threadKey: string;
  /** Stored row that matched (a message inside a conversation, or the top-level comment itself). */
  itemId: string;
  channelId: string; channelName: string;
  author: string; excerpt: string; time: Date; rank: number;
};
export type InboxSearchPage = { hits: InboxSearchHit[]; total: number; limit: number; q: string };

type HitRow = { kind: 'message' | 'comment'; threadKey: string; itemId: string; channelId: string; channelName: string; author: string; excerpt: string; time: Date; rank: number; total: bigint | number };

/**
 * Ranked full-text search over stored inbox content within the workspace and
 * the person's channel scope. Messages match inside their conversation (the
 * hit opens the thread); comments match top-level only. Uses the `simple`
 * text configuration so English and French content match predictably; never
 * contacts a provider.
 */
export async function searchInbox(actor: InboxReadActor, input: unknown = {}, constraints: InboxReadConstraints = {}): Promise<InboxSearchPage> {
  const access = await readAccess(actor, constraints);
  const [searchMaxCharacters, listPageSize] = await Promise.all([runtimeConfig('inbox.searchMaxCharacters'), runtimeConfig('inbox.listPageSize')]);
  const parsed = z.object({ q: z.string().trim().min(1).max(searchMaxCharacters), channelId: idSchema.optional(), kind: z.enum(['all', 'message', 'comment']).default('all'), limit: z.number().int().positive().safe().optional() }).strict().safeParse(input);
  if (!parsed.success) throw await invalid();
  const { q, kind } = parsed.data;
  if (parsed.data.channelId && !access.channelIds.includes(parsed.data.channelId)) throw new OperationError('forbidden', await inboxServiceText('service46'));
  const channelIds = parsed.data.channelId ? [parsed.data.channelId] : access.channelIds;
  const limit = Math.min(parsed.data.limit ?? listPageSize, listPageSize, constraints.maxItems ?? listPageSize);
  if (!channelIds.length) return { hits: [], total: 0, limit, q };
  const gate = (wanted: 'message' | 'comment') => kind === 'all' || kind === wanted;
  const rows = await prisma.$queryRaw<HitRow[]>(Prisma.sql`
    WITH hits AS MATERIALIZED (
      SELECT 'message'::text AS kind, ('message:' || c.id)::text AS "threadKey", m.id AS "itemId", c."targetId" AS "channelId", t.name AS "channelName",
        COALESCE(m."fromName", '') AS author, ts_headline('simple', COALESCE(m.message, ''), plainto_tsquery('simple', ${q}), 'MaxWords=25, MinWords=8') AS excerpt,
        m."createdTime" AS time, ts_rank(to_tsvector('simple', COALESCE(m.message, '') || ' ' || COALESCE(m."fromName", '')), plainto_tsquery('simple', ${q})) AS rank
      FROM conversation_messages m JOIN conversations c ON c.id = m."conversationId" JOIN targets t ON t.id = c."targetId"
      WHERE ${gate('message')} AND t."workspaceId" = ${actor.workspaceId} AND t.id IN (${Prisma.join(channelIds)})
        AND to_tsvector('simple', COALESCE(m.message, '') || ' ' || COALESCE(m."fromName", '')) @@ plainto_tsquery('simple', ${q})
      UNION ALL
      SELECT 'comment'::text AS kind, ('comment:' || pc.id)::text AS "threadKey", pc.id AS "itemId", pt."targetId" AS "channelId", t.name AS "channelName",
        COALESCE(pc."fromName", '') AS author, ts_headline('simple', pc.message, plainto_tsquery('simple', ${q}), 'MaxWords=25, MinWords=8') AS excerpt,
        pc."createdTime" AS time, ts_rank(to_tsvector('simple', COALESCE(pc.message, '') || ' ' || COALESCE(pc."fromName", '')), plainto_tsquery('simple', ${q})) AS rank
      FROM post_comments pc JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
      WHERE ${gate('comment')} AND pc."parentRemoteId" IS NULL AND t."workspaceId" = ${actor.workspaceId} AND p."workspaceId" = ${actor.workspaceId} AND t.id IN (${Prisma.join(channelIds)})
        AND to_tsvector('simple', COALESCE(pc.message, '') || ' ' || COALESCE(pc."fromName", '')) @@ plainto_tsquery('simple', ${q})
    ), totals AS (SELECT COUNT(*) AS count FROM hits)
    SELECT hits.*, totals.count AS total FROM totals LEFT JOIN hits ON true
    ORDER BY hits.rank DESC, hits.time DESC, hits."itemId" ASC LIMIT ${limit}`);
  const total = Number(rows[0]?.total ?? 0);
  const hits: InboxSearchHit[] = rows.flatMap(row => row.itemId ? [{ kind: row.kind, threadKey: row.threadKey, itemId: row.itemId, channelId: row.channelId, channelName: row.channelName, author: row.author, excerpt: row.excerpt, time: row.time, rank: row.rank }] : []);
  return { hits, total, limit, q };
}
