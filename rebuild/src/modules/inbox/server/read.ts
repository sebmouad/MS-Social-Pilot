import { z } from 'zod';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { conversationNeedsReply } from '@/modules/inbox/server/threads';
import { OperationError } from '@/lib/operation-error';
import { authorizeInbox as readAccess } from './access';
import { encodeInboxCursor, inboxFilterFingerprint, readInboxCursor, type InboxCursor } from './cursor';
import type { InboxReadActor, InboxReadConstraints, InboxLimits, InboxListItem, InboxListPage, InboxPageCursors, InboxThreadPage, ThreadEntry } from './types';

const targetSelect = { id: true, name: true, providerId: true, socialAccount: { select: { provider: true } } } as const;
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const invalid = () => new OperationError('invalid_request', 'Choose valid Inbox filters, or reset to the latest items.');
type Key = { id: string; kind: 'message' | 'comment' | 'review'; time: Date };

async function readLimits(): Promise<InboxLimits> {
  const [listPageSize, threadPageSize, searchMaxCharacters, cursorMaxCharacters] = await Promise.all([
    runtimeConfig('inbox.listPageSize'), runtimeConfig('inbox.threadPageSize'), runtimeConfig('inbox.searchMaxCharacters'), runtimeConfig('inbox.cursorMaxCharacters'),
  ]);
  return { listPageSize, threadPageSize, searchMaxCharacters, cursorMaxCharacters };
}
/** One tuple protocol for merged activity and individual history. C collation matches the encoded ordering. */
function seek(cursor: InboxCursor | null) {
  if (!cursor) return Prisma.empty;
  const operator = cursor.direction === 'older' ? Prisma.sql`<` : Prisma.sql`>`;
  return Prisma.sql`WHERE (time, kind COLLATE "C", id COLLATE "C") ${operator} (${cursor.at}::timestamp, ${cursor.kind}::text COLLATE "C", ${cursor.id}::text COLLATE "C")`;
}
function pageKeys(rows: Key[], take: number, cursor: InboxCursor | null, fingerprint: string, maxCharacters: number): { keys: Key[] } & InboxPageCursors {
  const more = rows.length > take;
  const keys = rows.slice(0, take);
  if (cursor?.direction === 'newer') keys.reverse();
  const encode = (key: Key | undefined, direction: 'older' | 'newer') => key ? encodeInboxCursor(key, direction, fingerprint, maxCharacters) : null;
  return { keys, olderCursor: cursor?.direction === 'newer' || more ? encode(keys.at(-1), 'older') : null, newerCursor: cursor && (cursor.direction === 'older' || more) ? encode(keys[0], 'newer') : null };
}
const literalSearch = (value: string) => `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`;

/** Every stored top-level item is reachable; all filters apply before count and cursor selection. */
export async function readInboxList(actor: InboxReadActor, input: unknown = {}, constraints: InboxReadConstraints = {}): Promise<InboxListPage> {
  const access = await readAccess(actor, constraints);
  const limits = await readLimits();
  const parsed = z.object({ channelId: idSchema.optional(), kind: z.enum(['all', 'message', 'comment', 'review']).default('all'), state: z.enum(['open', 'resolved', 'all']).default('open'), hidden: z.enum(['visible', 'all']).default('visible'), q: z.string().trim().max(limits.searchMaxCharacters).default(''), cursor: z.string().max(limits.cursorMaxCharacters).optional(), limit: z.number().int().positive().safe().optional() }).strict().safeParse(input);
  if (!parsed.success) throw invalid();
  const { channelId, kind, state, hidden, q, limit: requestedLimit } = parsed.data;
  if (channelId && !access.channelIds.includes(channelId)) throw new OperationError('forbidden', 'Selected channel is unavailable. Choose another channel or reset the filters.');
  const channelIds = channelId ? [channelId] : access.channelIds;
  const take = Math.min(requestedLimit ?? limits.listPageSize, limits.listPageSize, constraints.maxItems ?? limits.listPageSize);
  const fingerprint = inboxFilterFingerprint({ workspaceId: actor.workspaceId, channelIds: [...channelIds].sort(), kind, state, hidden, q });
  const cursor = readInboxCursor(parsed.data.cursor, fingerprint, limits.cursorMaxCharacters);
  const filters = { channelId: channelId ?? null, kind, state, hidden, q };
  const base = { filters, channels: access.channels, timeZone: access.timeZone, limits, limit: take, cursor: parsed.data.cursor ?? null };
  if (!channelIds.length) return { ...base, items: [], total: 0, olderCursor: null, newerCursor: null, lastSynced: null };
  const status = (alias: 'c' | 'pc' | 'r') => state === 'all' ? Prisma.empty : state === 'open' ? Prisma.sql`AND ${Prisma.raw(alias)}."resolvedAt" IS NULL` : Prisma.sql`AND ${Prisma.raw(alias)}."resolvedAt" IS NOT NULL`;
  const pattern = literalSearch(q);
  const activity = Prisma.sql`
    SELECT c.id, 'message'::text AS kind, c."updatedTime" AS time FROM conversations c JOIN targets t ON t.id = c."targetId"
    WHERE ${kind === 'all' || kind === 'message'} AND t."workspaceId" = ${actor.workspaceId} AND t.id IN (${Prisma.join(channelIds)}) ${status('c')}
      ${q ? Prisma.sql`AND (c.snippet ILIKE ${pattern} ESCAPE ${'\\'} OR EXISTS (SELECT 1 FROM conversation_messages m WHERE m."conversationId" = c.id AND (m.message ILIKE ${pattern} ESCAPE ${'\\'} OR m."fromName" ILIKE ${pattern} ESCAPE ${'\\'})))` : Prisma.empty}
    UNION ALL
    SELECT pc.id, 'comment'::text AS kind, pc."createdTime" AS time FROM post_comments pc
      JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
    WHERE ${kind === 'all' || kind === 'comment'} AND pc."parentRemoteId" IS NULL AND t."workspaceId" = ${actor.workspaceId} AND p."workspaceId" = ${actor.workspaceId} AND t.id IN (${Prisma.join(channelIds)}) ${status('pc')}
      ${hidden === 'visible' ? Prisma.sql`AND pc."isHidden" = false` : Prisma.empty}
      ${q ? Prisma.sql`AND (pc.message ILIKE ${pattern} ESCAPE ${'\\'} OR pc."fromName" ILIKE ${pattern} ESCAPE ${'\\'})` : Prisma.empty}
    UNION ALL
    SELECT r.id, 'review'::text AS kind, r."createdTime" AS time FROM page_reviews r JOIN targets t ON t.id = r."targetId"
    WHERE ${kind === 'all' || kind === 'review'} AND t."workspaceId" = ${actor.workspaceId} AND t.id IN (${Prisma.join(channelIds)}) ${status('r')}
      ${q ? Prisma.sql`AND (r."reviewText" ILIKE ${pattern} ESCAPE ${'\\'} OR r."reviewerName" ILIKE ${pattern} ESCAPE ${'\\'})` : Prisma.empty}`;
  const order = cursor?.direction === 'newer' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const [rows, counts, lastSynced] = await Promise.all([
    prisma.$queryRaw<Key[]>(Prisma.sql`SELECT id, kind, time FROM (${activity}) AS activity ${seek(cursor)} ORDER BY time ${order}, kind COLLATE "C" ${order}, id COLLATE "C" ${order} LIMIT ${take + 1}`),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*) AS count FROM (${activity}) AS activity`),
    inboxLastSynced(actor.workspaceId, channelIds),
  ]);
  const { keys, ...cursors } = pageKeys(rows, take, cursor, fingerprint, limits.cursorMaxCharacters);
  const items = await hydrateItems(actor.workspaceId, keys);
  return { ...base, ...cursors, items, total: Number(counts[0]?.count ?? 0), lastSynced };
}

type ReviewRow = { id: string; targetId: string; reviewerName: string | null; rating: number | null; recommendationType: string | null; reviewText: string | null; createdTime: Date; resolvedAt: Date | null };
const recommendationOf = (value: string | null): 'positive' | 'negative' | null => value === 'positive' || value === 'negative' ? value : null;

/** Stored reviews of one workspace (the join to targets is the tenant check), with their channel. The rebuild client does not map this table, hence raw SQL. */
async function readReviews(workspaceId: string, ids: string[], channelIds?: readonly string[]) {
  if (!ids.length) return [];
  const rows = await prisma.$queryRaw<ReviewRow[]>(Prisma.sql`
    SELECT r.id, r."targetId", r."reviewerName", r.rating, r."recommendationType", r."reviewText", r."createdTime", r."resolvedAt"
    FROM page_reviews r JOIN targets t ON t.id = r."targetId"
    WHERE r.id IN (${Prisma.join(ids)}) AND t."workspaceId" = ${workspaceId} ${channelIds ? Prisma.sql`AND t.id IN (${Prisma.join(channelIds)})` : Prisma.empty}`);
  const targets = rows.length ? await prisma.target.findMany({ where: { id: { in: [...new Set(rows.map(row => row.targetId))] }, workspaceId }, select: targetSelect }) : [];
  const byId = new Map(targets.map(target => [target.id, target]));
  return rows.flatMap(row => { const target = byId.get(row.targetId); return target ? [{ ...row, target }] : []; });
}

async function hydrateItems(workspaceId: string, keys: Key[]): Promise<InboxListItem[]> {
  const conversationIds = keys.filter(key => key.kind === 'message').map(key => key.id);
  const commentIds = keys.filter(key => key.kind === 'comment').map(key => key.id);
  const reviewIds = keys.filter(key => key.kind === 'review').map(key => key.id);
  const [conversations, comments, reviews] = await Promise.all([
    conversationIds.length ? prisma.conversation.findMany({ where: { id: { in: conversationIds }, target: { workspaceId } }, select: { id: true, snippet: true, unreadCount: true, updatedTime: true, resolvedAt: true, target: { select: targetSelect }, messages: { orderBy: [{ createdTime: 'desc' }, { id: 'desc' }], take: 1, select: { fromName: true, fromId: true, sentById: true, message: true } } } }) : [],
    commentIds.length ? prisma.postComment.findMany({ where: { id: { in: commentIds }, postTarget: { target: { workspaceId }, post: { workspaceId } } }, select: { id: true, message: true, fromName: true, createdTime: true, resolvedAt: true, isHidden: true, postTarget: { select: { target: { select: targetSelect }, post: { select: { message: true } } } } } }) : [],
    reviewIds.length ? readReviews(workspaceId, reviewIds) : [],
  ]);
  const answered = commentIds.length ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT pc.id FROM post_comments pc JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
    WHERE pc.id IN (${Prisma.join(commentIds)}) AND t."workspaceId" = ${workspaceId} AND p."workspaceId" = ${workspaceId}
    AND EXISTS (SELECT 1 FROM post_comments reply WHERE reply."postTargetId" = pc."postTargetId" AND reply."parentRemoteId" = pc."remoteId" AND (reply."sentById" IS NOT NULL OR reply."fromId" = t."providerId"))`) : [];
  const answeredIds = new Set(answered.map(item => item.id));
  const mapped = new Map<string, InboxListItem>();
  for (const item of conversations) {
    const newest = item.messages[0];
    mapped.set(`message:${item.id}`, { key: `message:${item.id}`, kind: 'message', id: item.id, author: newest?.sentById ? item.target.name : newest?.fromName || 'Conversation', preview: newest?.message || item.snippet || 'No message text available.', time: item.updatedTime, target: { id: item.target.id, name: item.target.name, provider: item.target.socialAccount?.provider ?? null }, unread: item.unreadCount, needsReply: conversationNeedsReply(newest, item.target.providerId, Boolean(item.resolvedAt)), resolved: Boolean(item.resolvedAt), hidden: false, context: null, rating: null, recommendation: null });
  }
  for (const item of reviews) mapped.set(`review:${item.id}`, { key: `review:${item.id}`, kind: 'review', id: item.id, author: item.reviewerName || 'Visitor', preview: item.reviewText ?? '', time: item.createdTime, rating: item.rating, recommendation: recommendationOf(item.recommendationType), target: { id: item.target.id, name: item.target.name, provider: item.target.socialAccount?.provider ?? null }, unread: 0, needsReply: false, resolved: Boolean(item.resolvedAt), hidden: false, context: null });
  for (const item of comments) mapped.set(`comment:${item.id}`, { key: `comment:${item.id}`, kind: 'comment', id: item.id, author: item.fromName || 'Visitor', preview: item.message, time: item.createdTime, target: { id: item.postTarget.target.id, name: item.postTarget.target.name, provider: item.postTarget.target.socialAccount?.provider ?? null }, unread: 0, needsReply: !item.resolvedAt && !item.isHidden && !answeredIds.has(item.id), resolved: Boolean(item.resolvedAt), hidden: item.isHidden, context: item.postTarget.post.message, rating: null, recommendation: null });
  return keys.flatMap(key => { const item = mapped.get(`${key.kind}:${key.id}`); return item ? [item] : []; });
}

async function memberNames(workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const members = await prisma.membership.findMany({ where: { workspaceId, userId: { in: ids } }, select: { user: { select: { id: true, name: true } } } });
  return new Map(members.map(member => [member.user.id, member.user.name]));
}

/** Orders a page of stored replies as a tree under the opening comment, chronological among siblings.
 * A reply whose parent is not on this page hangs directly under the opening comment. */
export function nestReplies<T extends { id: string; remoteId?: string; parentRemoteId?: string | null }>(replies: T[], opening: { id: string; remoteId: string }, make: (item: T, parentId: string, depth: number) => ThreadEntry): ThreadEntry[] {
  const idByRemote = new Map<string, string>([[opening.remoteId, opening.id]]);
  for (const reply of replies) if (reply.remoteId) idByRemote.set(reply.remoteId, reply.id);
  const children = new Map<string, T[]>();
  for (const reply of replies) {
    const parent = reply.parentRemoteId ? idByRemote.get(reply.parentRemoteId) : undefined;
    const key = parent && parent !== reply.id ? parent : opening.id;
    children.set(key, [...(children.get(key) ?? []), reply]);
  }
  const out: ThreadEntry[] = []; const seen = new Set<string>();
  const walk = (parentId: string, depth: number) => {
    for (const reply of children.get(parentId) ?? []) { if (seen.has(reply.id)) continue; seen.add(reply.id); out.push(make(reply, parentId, depth)); walk(reply.id, depth + 1); }
  };
  walk(opening.id, 1);
  return out;
}

/** Newest stored history by default, with Earlier/Newer continuation and reply policy independent of the shown window. */
export async function readInboxThread(actor: InboxReadActor, input: unknown, constraints: InboxReadConstraints = {}): Promise<InboxThreadPage> {
  const access = await readAccess(actor, constraints);
  const limits = await readLimits();
  const parsed = z.object({ key: z.string().regex(/^(message|comment|review):[A-Za-z0-9_-]{1,200}$/), cursor: z.string().max(limits.cursorMaxCharacters).optional(), limit: z.number().int().positive().safe().optional() }).strict().safeParse(input);
  if (!parsed.success) throw invalid();
  const { key, cursor: encoded, limit: requestedLimit } = parsed.data;
  const [kind, id] = key.split(':') as ['message' | 'comment' | 'review', string];
  if (kind === 'review') {
    if (encoded !== undefined) throw invalid();
    const [review] = access.channelIds.length ? await readReviews(actor.workspaceId, [id], access.channelIds) : [];
    if (!review) throw new OperationError('not_found', 'This review is unavailable. Choose another Inbox item.');
    const entry: ThreadEntry = { id: review.id, author: review.reviewerName || 'Visitor', text: review.reviewText ?? '', time: review.createdTime, fromChannel: false, sentBy: null, parentId: null, depth: 0, hidden: false };
    return { thread: { kind, id, rating: review.rating, recommendation: recommendationOf(review.recommendationType), target: { id: review.target.id, name: review.target.name, providerId: review.target.providerId, provider: review.target.socialAccount?.provider ?? null }, resolved: Boolean(review.resolvedAt), hidden: false, postText: null, entries: [entry], lastInbound: null }, history: { olderCursor: null, newerCursor: null, total: 1, shown: 1, limit: 1, cursor: null } };
  }
  const take = Math.min(requestedLimit ?? limits.threadPageSize, limits.threadPageSize, constraints.maxItems ?? limits.threadPageSize);
  const fingerprint = inboxFilterFingerprint({ workspaceId: actor.workspaceId, channelIds: [...access.channelIds].sort(), thread: key });
  const cursor = readInboxCursor(encoded, fingerprint, limits.cursorMaxCharacters);
  if (cursor && cursor.kind !== kind) throw invalid();
  if (!access.channelIds.length) throw new OperationError('not_found', 'This conversation is unavailable. Choose another Inbox item.');
  const conversation = kind === 'message' ? await prisma.conversation.findFirst({ where: { id, targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId } }, select: { id: true, resolvedAt: true, target: { select: targetSelect } } }) : null;
  const comment = kind === 'comment' ? await prisma.postComment.findFirst({ where: { id, parentRemoteId: null, postTarget: { targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } }, select: { id: true, remoteId: true, postTargetId: true, message: true, fromName: true, fromId: true, sentById: true, createdTime: true, resolvedAt: true, isHidden: true, postTarget: { select: { target: { select: targetSelect }, post: { select: { message: true } } } } } }) : null;
  if (!conversation && !comment) throw new OperationError('not_found', 'This conversation is unavailable. Choose another Inbox item.');
  const target = conversation?.target ?? comment!.postTarget.target;
  const source = conversation ? Prisma.sql`SELECT id, 'message'::text AS kind, "createdTime" AS time FROM conversation_messages WHERE "conversationId" = ${id}`
    : Prisma.sql`SELECT id, 'comment'::text AS kind, "createdTime" AS time FROM post_comments WHERE "postTargetId" = ${comment!.postTargetId} AND "remoteId" IN (
        WITH RECURSIVE descendants("remoteId") AS (
          SELECT "remoteId" FROM post_comments WHERE "postTargetId" = ${comment!.postTargetId} AND "parentRemoteId" = ${comment!.remoteId}
          UNION
          SELECT c."remoteId" FROM post_comments c JOIN descendants d ON c."parentRemoteId" = d."remoteId" WHERE c."postTargetId" = ${comment!.postTargetId}
        ) SELECT "remoteId" FROM descendants)`;
  const order = cursor?.direction === 'newer' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const [rows, counts, lastInbound] = await Promise.all([
    prisma.$queryRaw<Key[]>(Prisma.sql`SELECT id, kind, time FROM (${source}) AS history ${seek(cursor)} ORDER BY time ${order}, kind COLLATE "C" ${order}, id COLLATE "C" ${order} LIMIT ${take + 1}`),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*) AS count FROM (${source}) AS history`),
    conversation ? prisma.conversationMessage.findFirst({ where: { conversationId: id, sentById: null, fromId: { not: null }, NOT: { fromId: target.providerId } }, orderBy: [{ createdTime: 'desc' }, { id: 'desc' }], select: { fromId: true, createdTime: true } }) : Promise.resolve(null),
  ]);
  const { keys, ...cursors } = pageKeys(rows, take, cursor, fingerprint, limits.cursorMaxCharacters);
  const ids = keys.map(item => item.id);
  const select = { id: true, message: true, fromName: true, fromId: true, sentById: true, createdTime: true } as const;
  type Stored = { id: string; message: string | null; fromName: string | null; fromId: string | null; sentById: string | null; createdTime: Date; remoteId?: string; parentRemoteId?: string | null; isHidden?: boolean };
  // Replies at any stored depth belong to the opening comment: the recursive source above is scoped to its post target.
  const entries: Stored[] = !ids.length ? [] : conversation ? await prisma.conversationMessage.findMany({ where: { id: { in: ids }, conversationId: id }, select }) : await prisma.postComment.findMany({ where: { id: { in: ids }, postTargetId: comment!.postTargetId, remoteId: { not: comment!.remoteId } }, select: { ...select, remoteId: true, parentRemoteId: true, isHidden: true } });
  const names = await memberNames(actor.workspaceId, [...new Set([...entries, ...(comment ? [comment] : [])].flatMap(entry => entry.sentById ? [entry.sentById] : []))]);
  const entry = (item: Stored, parentId: string | null = null, depth = 0): ThreadEntry => {
    const fromChannel = item.sentById !== null || item.fromId !== null && item.fromId === target.providerId;
    return { id: item.id, author: fromChannel ? target.name : item.fromName || 'Visitor', text: item.message || '', time: item.createdTime, fromChannel, sentBy: item.sentById ? names.get(item.sentById) ?? 'A teammate' : null, parentId, depth, hidden: item.isHidden === true };
  };
  const byId = new Map(entries.map(item => [item.id, item]));
  const pageOrder = [...keys].reverse().flatMap(key => { const item = byId.get(key.id); return item ? [item] : []; });
  const chronological = comment ? nestReplies(pageOrder, comment, entry) : pageOrder.map(item => entry(item));
  return { thread: { kind, id, rating: null, recommendation: null, target: { id: target.id, name: target.name, providerId: target.providerId, provider: target.socialAccount?.provider ?? null }, resolved: Boolean(conversation?.resolvedAt ?? comment?.resolvedAt), hidden: comment?.isHidden ?? false, postText: comment?.postTarget.post.message ?? null, entries: [...(comment ? [entry(comment)] : []), ...chronological], lastInbound }, history: { ...cursors, total: Number(counts[0]?.count ?? 0), shown: chronological.length, limit: take, cursor: encoded ?? null } };
}

/** Refresh timestamps only: replies and local workflow actions do not claim provider synchronization. */
export async function inboxLastSynced(workspaceId: string, channelIds: string[]): Promise<Date | null> {
  if (!channelIds.length) return null;
  const [conversations, comments, audited, reviewed] = await Promise.all([
    prisma.conversation.aggregate({ where: { targetId: { in: channelIds }, target: { workspaceId } }, _max: { fetchedAt: true } }),
    prisma.postComment.aggregate({ where: { postTarget: { targetId: { in: channelIds }, target: { workspaceId }, post: { workspaceId } } }, _max: { fetchedAt: true } }),
    prisma.$queryRaw<Array<{ at: Date | null }>>`SELECT MAX("createdAt") AS at FROM root_activities WHERE action = 'inbox.synced' AND detail->>'workspaceId' = ${workspaceId} AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(detail->'targetIds') = 'array' THEN detail->'targetIds' ELSE '[]'::jsonb END) AS channel(id) WHERE channel.id = ANY(${channelIds}::text[]))`,
    prisma.$queryRaw<Array<{ at: Date | null }>>(Prisma.sql`SELECT MAX(r."fetchedAt") AS at FROM page_reviews r JOIN targets t ON t.id = r."targetId" WHERE t."workspaceId" = ${workspaceId} AND t.id IN (${Prisma.join(channelIds)})`),
  ]);
  const times = [conversations._max.fetchedAt, comments._max.fetchedAt, audited[0]?.at ?? null, reviewed[0]?.at ?? null].filter((value): value is Date => value instanceof Date);
  return times.length ? new Date(Math.max(...times.map(value => value.getTime()))) : null;
}
