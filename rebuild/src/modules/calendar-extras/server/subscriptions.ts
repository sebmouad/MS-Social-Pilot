import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { publishingPostVisibilityWhere } from '@/modules/publishing/server/read-scope';
import { settings } from './settings';
import { authorize, array, checkTargets, fail, type Access, type Tx } from './access';
import { buildCalendar } from './ics';
import type { Actor, Feed } from '../contracts';
import type { Copy } from '../copy';
import type { Policy } from '../config';
import { OperationError } from '@/lib/operation-error';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
async function publicOrigin(copy: Copy) {
 const value = await runtimeConfig('app.publicOrigin');
 try { const url = new URL(String(value)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return fail('unavailable', copy.unavailable); return url.origin; }
 catch { return fail('unavailable', copy.unavailable); }
}
export async function groupTargets(tx: Tx, workspaceId: string, groupId: string) {
 return tx.$queryRaw<Array<{ targetId: string }>>`SELECT gt."targetId" FROM page_group_targets gt JOIN page_groups g ON g.id = gt."groupId" JOIN targets t ON t.id = gt."targetId" AND t."workspaceId" = g."workspaceId" WHERE g.id = ${groupId} AND g."workspaceId" = ${workspaceId}`;
}
export async function createFeedRecord(tx: Tx, actor: Actor, access: Access, id: string, data: { name: string; targetIds: string[]; groupId: string | null }, policy: Policy, copy: Copy) {
 let ids = data.targetIds;
 if (data.groupId) {
  if (ids.length) return fail('invalid_request', copy.invalid);
  const group = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM page_groups WHERE id = ${data.groupId} AND "workspaceId" = ${actor.workspaceId}`;
  if (!group.length) return fail('not_found', copy.missing);
  ids = (await groupTargets(tx, actor.workspaceId, data.groupId)).map(row => row.targetId);
  if (!ids.length) return fail('invalid_request', copy.invalid);
 }
 checkTargets(ids, access, copy, false);
 // Snapshot restricted scopes: an empty snapshot must never become an all-channel feed.
 if (!ids.length && access.scope !== null) ids = access.channels.map(c => c.id);
 if (!ids.length && access.scope !== null) return fail('forbidden', copy.denied);
 if (ids.length > policy.maxTargets) return fail('invalid_request', copy.tooMany);
 const storedIds = data.groupId && access.scope === null && actor.allowedTargetIds === undefined && actor.permissionCeiling === undefined ? [] : ids;
 const token = randomBytes(policy.tokenBytes).toString('base64url');
 const url = `${await publicOrigin(copy)}${policy.feedPath}${token}`;
 const count = await tx.$executeRaw`INSERT INTO calendar_feeds (id, "workspaceId", "userId", name, "tokenHash", "pageIds", "groupId", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${data.name}, ${tokenHash(token)}, ${storedIds}::text[], ${data.groupId}, NOW())`;
 if (count !== 1) return fail('unavailable', copy.failure);
 return url;
}
/** Token possession grants a read only; revalidate the current creator, plan and selected resources on every request. */
export async function renderCalendarFeed(token: string, now = new Date()): Promise<string | null> {
 // Legacy base64url tokens remain valid when the Root token-generation size changes.
 if (!/^[A-Za-z0-9_-]{43,171}$/.test(token)) return null;
 const { policy, copy } = await settings();
 const rows = await prisma.$queryRaw<Array<Feed & { userId: string; workspaceId: string }>>`SELECT id, name, "workspaceId", "userId", "pageIds", "groupId", "createdAt", "lastUsedAt" FROM calendar_feeds WHERE "tokenHash" = ${tokenHash(token)}`;
 const feed = rows[0];
 if (!feed) return null;
 const actor = { userId: feed.userId, workspaceId: feed.workspaceId };
 let access: Access;
 try { access = await authorize(actor, 'feeds', 'read', copy); } catch (error) { if (error instanceof OperationError) return null; throw error; }
 const suspension = await prisma.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id = ${feed.workspaceId}`;
 if (!suspension.length || suspension[0].suspendedAt) return null;
 let channels = access.channels.filter(c => !feed.pageIds.length || feed.pageIds.includes(c.id));
 if (feed.groupId) {
  const group = await groupTargets(prisma, feed.workspaceId, feed.groupId);
  channels = channels.filter(c => group.some(g => g.targetId === c.id));
 }
 const posts = await prisma.post.findMany({
  where: { AND: [publishingPostVisibilityWhere(feed.workspaceId, channels.map(c => c.id)), { targets: { some: { targetId: { in: channels.map(c => c.id) } } } }], status: { in: policy.feedStatuses }, scheduledAt: { gte: new Date(now.getTime() - policy.feedPastDays * 86400000), lte: new Date(now.getTime() + policy.feedAheadDays * 86400000) } },
  select: { id: true, message: true, link: true, scheduledAt: true, updatedAt: true, targets: { select: { targetId: true } } },
  orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: policy.feedMaxEvents + 1,
 });
 if (posts.length > policy.feedMaxEvents) return fail('invalid_request', copy.tooMany);
 const origin = await publicOrigin(copy);
 const names = new Map(channels.map(c => [c.id, c.name]));
 // Revocation racing this request wins before any content is returned. A later revocation cannot retract an in-flight response.
 const count = await prisma.$executeRaw`UPDATE calendar_feeds SET "lastUsedAt" = ${now} WHERE id = ${feed.id} AND "tokenHash" = ${tokenHash(token)} AND "workspaceId" = ${feed.workspaceId} AND "userId" = ${feed.userId}`;
 if (count !== 1) return null;
 return buildCalendar(feed.name, posts.filter(p => p.scheduledAt).map(p => ({ uid: `${p.id}@${new URL(origin).host}`, start: p.scheduledAt!, minutes: policy.feedEventMinutes,
  summary: `${p.targets.map(t => names.get(t.targetId)).filter(Boolean).join(', ')}: ${(p.message || p.link || '').replace(/\s+/g, ' ').slice(0, policy.feedSummaryLength)}`,
  description: `${p.message}${p.link ? `\n\n${p.link}` : ''}`, url: `${origin}${policy.postsPath}`, updated: p.updatedAt,
 })), now);
}
