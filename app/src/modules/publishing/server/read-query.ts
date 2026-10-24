
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { readChannelProfiles } from '@/modules/settings/channel-profiles/service';
import { PostStatus, type Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { authorizePublishing } from './access';
import { parsePostOrigin, postOriginWhere, type PostOriginSource } from './origin-source';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from './read-scope';
import type { PublishingActor, PublishingFeature } from './types';

function invalid(message: string | undefined = undefined, errorText: PublishingErrorText = defaultPublishingErrorText): never {
  message ??= errorText('read_0');
  throw new OperationError('invalid_request', message);
}

function parseStatus(value: unknown, errorText: PublishingErrorText = defaultPublishingErrorText): PostStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !Object.values(PostStatus).includes(value as PostStatus)) invalid(errorText('read_1'), errorText);
  return value as PostStatus;
}

async function parseChannel(value: unknown): Promise<string | undefined> {
  const errorText = await loadPublishingErrorText();
  if (value === undefined || value === '') return undefined;
  const max = await runtimeConfig('publishing.identifierMaxCharacters');
  if (typeof value !== 'string' || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(errorText('read_2'), errorText);
  return value;
}

/** Normalize and validate the shared literal post-search input. */
export async function publishingPostSearch(value: unknown): Promise<string> {
  const errorText = await loadPublishingErrorText();
  if (value === undefined) return '';
  const max = await runtimeConfig('publishing.searchMaxCharacters');
  if (typeof value !== 'string') invalid(errorText('read_3'), errorText);
  if (/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) invalid(errorText('read_4'), errorText);
  const q = value.trim();
  if (q.length > max) invalid(errorText('read_5', {value0: max.toLocaleString()}), errorText);
  return q;
}

/** Escape PostgreSQL LIKE metacharacters so Prisma `contains` stays literal. */
export function publishingPostSearchWhere(q: string): Prisma.PostWhereInput {
  const literal = q.replace(/[\\%_]/g, '\\$&');
  return { OR: [
    { message: { contains: literal, mode: 'insensitive' } },
    { firstComment: { contains: literal, mode: 'insensitive' } },
  ] };
}

/** Current authorized scope and validated search/status/channel filters for Posts and export. */
export async function publishingPostReadQuery(
  actor: PublishingActor,
  input: { status?: string; channelId?: string; q?: string; origin?: string; postId?: string },
  feature: PublishingFeature = 'publishing/posts',
  originSources?: readonly PostOriginSource[],
): Promise<{ where: Prisma.PostWhereInput; filters: { status?: PostStatus; channelId?: string; q: string; origin?: string }; channelUnavailable: boolean; scope: { targetIds: string[]; authorId?: string } }> {
  const errorText = await loadPublishingErrorText();
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.keys(input).some(key => !['status', 'channelId', 'q', 'origin', 'postId'].includes(key))) invalid(undefined, errorText);
  // One post by id (the post page and the `?post=` link); it is still read through the same visibility rules as the list.
  if (input.postId !== undefined && (typeof input.postId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.postId))) invalid(errorText('read_2'), errorText);
  const [postStatus, channelId, q] = await Promise.all([parseStatus(input.status, errorText), parseChannel(input.channelId), publishingPostSearch(input.q)]);
  const origin = parsePostOrigin(input.origin, originSources, errorText);
  const access = await authorizePublishing(actor, feature, 'read');
  const targetIds = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.actor.allowedTargetIds);
  const authorId = access.actor.allowedTargetIds === undefined ? undefined : actor.userId;
  let filterIds = channelId ? [channelId] : undefined;
  if (channelId?.startsWith('channel-group:')) {
    const profiles = await readChannelProfiles({ userId: actor.userId, workspaceId: actor.workspaceId, allowedChannelIds: targetIds }, 'publishing/posts');
    filterIds = profiles.groups.find(group => group.id === channelId.slice('channel-group:'.length))?.channelIds ?? [];
  }
  // The channel scope of the shell (design v2) sends several channels as `a,b`; a post matches when it has any of them.
  const multiple = !channelId?.startsWith('channel-group:') && Boolean(channelId?.includes(','));
  if (multiple && channelId) filterIds = [...new Set(channelId.split(',').map(id => id.trim()).filter(Boolean))];
  const where: Prisma.PostWhereInput = { AND: [
    publishingPostVisibilityWhere(actor.workspaceId, targetIds, authorId),
    ...(postStatus ? [{ status: postStatus } as Prisma.PostWhereInput] : []),
    ...(input.postId ? [{ id: input.postId } as Prisma.PostWhereInput] : []),
    ...(filterIds ? [{ targets: { some: { targetId: channelId?.startsWith('channel-group:') || multiple ? { in: filterIds } : channelId } } } as Prisma.PostWhereInput] : []),
    ...(q ? [publishingPostSearchWhere(q)] : []),
    ...(origin ? [await postOriginWhere(actor.workspaceId, origin, originSources, errorText)] : []),
  ] };
  return {
    where,
    filters: { ...(postStatus ? { status: postStatus } : {}), ...(channelId ? { channelId } : {}), q, ...(origin ? { origin } : {}) },
    channelUnavailable: Boolean(channelId && !filterIds?.some(id => targetIds.includes(id))),
    scope: { targetIds, ...(authorId ? { authorId } : {}) },
  };
}
