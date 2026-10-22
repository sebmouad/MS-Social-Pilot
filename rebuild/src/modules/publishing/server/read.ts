
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { PostStatus, type Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { PLANNED_STATUSES } from '@/lib/post-groups';
import { prisma, listPostPage, listCalendarRange, getTargets } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { platformModule } from '@/platforms';
import { FIRST_COMMENT_REJECTED } from '../first-comment-state';
import { authorizePublishing } from './access';
import { publishingPostReadQuery } from './read-query';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from './read-scope';
import type { PublishingActor, PublishingFeature } from './types';

function invalid(message: string | undefined = undefined, errorText: PublishingErrorText = defaultPublishingErrorText): never {
  message ??= errorText('read_0'); throw new OperationError('invalid_request', message); }
async function scope(actor: PublishingActor, feature: PublishingFeature) {
  const access = await authorizePublishing(actor, feature, 'read');
  const targetIds = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.actor.allowedTargetIds);
  return { ...access, targetIds, authorId: access.actor.allowedTargetIds === undefined ? undefined : actor.userId };
}
async function channel(value: unknown): Promise<string | undefined> {
  const errorText = await loadPublishingErrorText();
  if (value === undefined || value === '') return undefined;
  const max = await runtimeConfig('publishing.identifierMaxCharacters');
  if (typeof value !== 'string' || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(errorText('read_2'), errorText);
  return value;
}
function status(value: unknown, errorText: PublishingErrorText = defaultPublishingErrorText): PostStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !Object.values(PostStatus).includes(value as PostStatus)) invalid(errorText('read_1'), errorText);
  return value as PostStatus;
}
function integer(value: unknown, fallback: number, max?: number, errorText: PublishingErrorText = defaultPublishingErrorText) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || (max !== undefined && value > max)) invalid(errorText('read_6'), errorText);
  return value;
}

/** Current authorization and selected resource visibility are shared by every Publishing read surface. */
export async function readPublishingPostPage(actor: PublishingActor, input: { page?: number; status?: string; channelId?: string; q?: string; origin?: string; postId?: string; order?: 'scheduled_asc' | 'created_asc' } = {}, feature: PublishingFeature = 'publishing/posts') {
  const errorText = await loadPublishingErrorText();
  if (input.order !== undefined && !['scheduled_asc', 'created_asc'].includes(input.order)) invalid(errorText('read_7'), errorText);
  const query = await publishingPostReadQuery(actor, { status: input.status, channelId: input.channelId, q: input.q, origin: input.origin, ...(input.postId === undefined ? {} : { postId: input.postId }) }, feature);
  const size = await runtimeConfig('publishing.postPageSize');
  const listing = await listPostPage(actor.workspaceId, integer(input.page, 1, undefined, errorText), size, query.scope.targetIds, query.scope.authorId, { where: query.where, order: input.order });
  return { ...listing, posts: await withPlatformNames(actor.workspaceId, listing.posts), channelUnavailable: query.channelUnavailable, filters: query.filters };
}

/**
 * Adds the installed platform module's customer-facing name to each destination so screens can say
 * where a post is held without knowing any provider. Unknown or removed providers yield null.
 */
export async function withPlatformNames<T extends { targets: Array<{ target: { id: string } }> }>(workspaceId: string, posts: T[]): Promise<Array<Omit<T, 'targets'> & { targets: Array<T['targets'][number] & { target: T['targets'][number]['target'] & { platformName: string | null } }> }>> {
  const ids = [...new Set(posts.flatMap(post => post.targets.map(({ target }) => target.id)))];
  const rows = ids.length ? await prisma.target.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, socialAccount: { select: { provider: true } } } }) : [];
  const names = new Map(rows.map(row => [row.id, row.socialAccount?.provider ? platformModule(row.socialAccount.provider)?.name ?? null : null]));
  return posts.map(post => ({ ...post, targets: post.targets.map(entry => ({ ...entry, target: { ...entry.target, platformName: names.get(entry.target.id) ?? null } })) }));
}

export async function readPublishingCalendar(actor: PublishingActor, input: { from: Date; to: Date; channelId?: string; status?: string }) {
  const errorText = await loadPublishingErrorText();
  const access = await scope(actor, 'publishing/calendar');
  const maxDays = await runtimeConfig('publishing.calendarMaxRangeDays');
  if (!(input.from instanceof Date) || !(input.to instanceof Date) || !Number.isFinite(input.from.getTime()) || !Number.isFinite(input.to.getTime()) || input.to <= input.from || input.to.getTime() - input.from.getTime() > maxDays * 86400000) invalid(errorText('read_8'), errorText);
  const channelId = await channel(input.channelId);
  const [posts, targets] = await Promise.all([
    listCalendarRange(actor.workspaceId, input.from, input.to, access.targetIds, access.authorId, { channelId, status: status(input.status, errorText) }),
    getTargets(actor.workspaceId, access.targetIds),
  ]);
  return { posts, channels: targets, channelUnavailable: Boolean(channelId && !access.targetIds.includes(channelId)) };
}

function date(value: unknown, errorText: PublishingErrorText = defaultPublishingErrorText): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) invalid(errorText('read_9'), errorText);
  const day = value.slice(0, 10);
  const utcDay = new Date(`${day}T00:00:00Z`);
  const parsed = new Date(value);
  if (!Number.isFinite(utcDay.getTime()) || utcDay.toISOString().slice(0, 10) !== day || !Number.isFinite(parsed.getTime())) invalid(errorText('read_9'), errorText);
  return parsed;
}

/** Bounded MCP list; dates retain the established inclusive scheduledAt meaning. */
export async function readPublishingPostList(actor: PublishingActor, input: unknown = {}, constraints: { maxItems?: number } = {}) {
  const errorText = await loadPublishingErrorText();
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(undefined, errorText);
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !['status', 'from', 'to', 'limit', 'channelId', 'q', 'origin', 'postId'].includes(key))) invalid(undefined, errorText);
  const statuses = values.status === undefined ? [] : typeof values.status === 'string' ? values.status.split(',').map(value => value.trim()).filter(Boolean).map(value => status(value, errorText)!) : invalid(errorText('read_10'), errorText);
  const from = date(values.from, errorText); const to = date(values.to, errorText);
  if (from && to && from > to) invalid(errorText('read_11'), errorText);
  const maximum = await runtimeConfig('publishing.readMaxItems');
  const cap = constraints.maxItems === undefined ? maximum : Math.min(integer(constraints.maxItems, maximum, undefined, errorText), maximum);
  const limit = Math.min(integer(values.limit, cap, undefined, errorText), cap);
  const query = await publishingPostReadQuery(actor, { channelId: values.channelId as string | undefined, q: values.q as string | undefined, origin: values.origin as string | undefined, ...(values.postId === undefined ? {} : { postId: values.postId as string }) });
  const where: Prisma.PostWhereInput = { AND: [query.where,
    ...(statuses.length ? [{ status: { in: statuses } }] : []),
    ...(from || to ? [{ scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }] : [])] };
  const posts = await prisma.post.findMany({ where, orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: limit,
    select: { id: true, authorId: true, message: true, firstComment: true, firstCommentDelayMinutes: true, format: true, link: true, media: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true,
      targets: { select: { id: true, formatId: true, status: true, remotePostId: true, remoteUrl: true, publishedAt: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true,
        target: { select: { id: true, type: true, name: true } } } } } });
  return posts.map(post => ({ ...post, targets: post.targets.map(row => ({ ...row, firstCommentError: row.firstCommentError === FIRST_COMMENT_REJECTED ? FIRST_COMMENT_REJECTED : row.firstCommentError ? 'review_required' : null })) }));
}

/** Planned-vs-outcome header counts over the same authorized scoped query as the Posts list, ignoring any status filter. `failed` covers the needs-attention outcomes (partially_failed, failed); cancelled and rejected are resolved and counted on neither side. */
export async function readPublishingStatusCounts(actor: PublishingActor, input: { channelId?: string; q?: string; origin?: string } = {}, feature: PublishingFeature = 'publishing/posts') {
  const query = await publishingPostReadQuery(actor, { ...(input.channelId === undefined ? {} : { channelId: input.channelId }), ...(input.q === undefined ? {} : { q: input.q }), ...(input.origin === undefined ? {} : { origin: input.origin }) }, feature);
  const [planned, published, failed] = await Promise.all([
    prisma.post.count({ where: { AND: [query.where, { status: { in: [...PLANNED_STATUSES] as PostStatus[] } }] } }),
    prisma.post.count({ where: { AND: [query.where, { status: 'published' }] } }),
    prisma.post.count({ where: { AND: [query.where, { status: { in: ['partially_failed', 'failed'] as PostStatus[] } }] } }),
  ]);
  return { planned, published, failed, channelUnavailable: query.channelUnavailable };
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
