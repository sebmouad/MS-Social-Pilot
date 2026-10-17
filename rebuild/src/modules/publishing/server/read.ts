import { PostStatus, type Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma, listPostPage, listCalendarRange, getTargets } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { FIRST_COMMENT_REJECTED } from '../first-comment-state';
import { authorizePublishing } from './access';
import { publishingPostReadQuery } from './read-query';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from './read-scope';
import type { PublishingActor, PublishingFeature } from './types';

function invalid(message = 'Choose valid Publishing filters.'): never { throw new OperationError('invalid_request', message); }
async function scope(actor: PublishingActor, feature: PublishingFeature) {
  const access = await authorizePublishing(actor, feature, 'read');
  const targetIds = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.actor.allowedTargetIds);
  return { ...access, targetIds, authorId: access.actor.allowedTargetIds === undefined ? undefined : actor.userId };
}
async function channel(value: unknown): Promise<string | undefined> {
  if (value === undefined || value === '') return undefined;
  const max = await runtimeConfig('publishing.identifierMaxCharacters');
  if (typeof value !== 'string' || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid('Choose a valid channel filter.');
  return value;
}
function status(value: unknown): PostStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !Object.values(PostStatus).includes(value as PostStatus)) invalid('Choose a valid post status.');
  return value as PostStatus;
}
function integer(value: unknown, fallback: number, max?: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || (max !== undefined && value > max)) invalid('Choose a valid result page and size.');
  return value;
}

/** Current authorization and selected resource visibility are shared by every Publishing read surface. */
export async function readPublishingPostPage(actor: PublishingActor, input: { page?: number; status?: string; channelId?: string; q?: string; order?: 'scheduled_asc' | 'created_asc' } = {}, feature: PublishingFeature = 'publishing/posts') {
  if (input.order !== undefined && !['scheduled_asc', 'created_asc'].includes(input.order)) invalid('Choose a valid post order.');
  const query = await publishingPostReadQuery(actor, { status: input.status, channelId: input.channelId, q: input.q }, feature);
  const size = await runtimeConfig('publishing.postPageSize');
  const listing = await listPostPage(actor.workspaceId, integer(input.page, 1), size, query.scope.targetIds, query.scope.authorId, { where: query.where, order: input.order });
  return { ...listing, channelUnavailable: query.channelUnavailable, filters: query.filters };
}

export async function readPublishingCalendar(actor: PublishingActor, input: { from: Date; to: Date; channelId?: string; status?: string }) {
  const access = await scope(actor, 'publishing/calendar');
  const maxDays = await runtimeConfig('publishing.calendarMaxRangeDays');
  if (!(input.from instanceof Date) || !(input.to instanceof Date) || !Number.isFinite(input.from.getTime()) || !Number.isFinite(input.to.getTime()) || input.to <= input.from || input.to.getTime() - input.from.getTime() > maxDays * 86400000) invalid('Choose a supported calendar date range.');
  const channelId = await channel(input.channelId);
  const [posts, targets] = await Promise.all([
    listCalendarRange(actor.workspaceId, input.from, input.to, access.targetIds, access.authorId, { channelId, status: status(input.status) }),
    getTargets(actor.workspaceId, access.targetIds),
  ]);
  return { posts, channels: targets, channelUnavailable: Boolean(channelId && !access.targetIds.includes(channelId)) };
}

function date(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) invalid('Choose valid ISO date filters.');
  const day = value.slice(0, 10);
  const utcDay = new Date(`${day}T00:00:00Z`);
  const parsed = new Date(value);
  if (!Number.isFinite(utcDay.getTime()) || utcDay.toISOString().slice(0, 10) !== day || !Number.isFinite(parsed.getTime())) invalid('Choose valid ISO date filters.');
  return parsed;
}

/** Bounded MCP list; dates retain the established inclusive scheduledAt meaning. */
export async function readPublishingPostList(actor: PublishingActor, input: unknown = {}, constraints: { maxItems?: number } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !['status', 'from', 'to', 'limit', 'channelId', 'q'].includes(key))) invalid();
  const statuses = values.status === undefined ? [] : typeof values.status === 'string' ? values.status.split(',').map(value => value.trim()).filter(Boolean).map(value => status(value)!) : invalid('Choose valid post statuses.');
  const from = date(values.from); const to = date(values.to);
  if (from && to && from > to) invalid('The end date must follow the start date.');
  const maximum = await runtimeConfig('publishing.readMaxItems');
  const cap = constraints.maxItems === undefined ? maximum : Math.min(integer(constraints.maxItems, maximum), maximum);
  const limit = Math.min(integer(values.limit, cap), cap);
  const query = await publishingPostReadQuery(actor, { channelId: values.channelId as string | undefined, q: values.q as string | undefined });
  const where: Prisma.PostWhereInput = { AND: [query.where,
    ...(statuses.length ? [{ status: { in: statuses } }] : []),
    ...(from || to ? [{ scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }] : [])] };
  const posts = await prisma.post.findMany({ where, orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: limit,
    select: { id: true, authorId: true, message: true, firstComment: true, link: true, media: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true,
      targets: { select: { id: true, status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true,
        target: { select: { id: true, type: true, name: true } } } } } });
  return posts.map(post => ({ ...post, targets: post.targets.map(row => ({ ...row, firstCommentError: row.firstCommentError === FIRST_COMMENT_REJECTED ? FIRST_COMMENT_REJECTED : row.firstCommentError ? 'review_required' : null })) }));
}

/** Home uses the same current-authorized whole-post scope as Posts. */
export async function readPublishingSummary(actor: PublishingActor) {
  const access = await scope(actor, 'publishing/posts');
  const where = publishingPostVisibilityWhere(actor.workspaceId, access.targetIds, access.authorId);
  const [published, scheduled] = await Promise.all([
    prisma.post.count({ where: { AND: [where, { status: 'published' }] } }),
    prisma.post.count({ where: { AND: [where, { status: 'scheduled' }] } }),
  ]);
  return { published, scheduled };
}
