import { PostStatus, type Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { authorizePublishing } from './access';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from './read-scope';
import type { PublishingActor, PublishingFeature } from './types';

function invalid(message = 'Choose valid Publishing filters.'): never {
  throw new OperationError('invalid_request', message);
}

function parseStatus(value: unknown): PostStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !Object.values(PostStatus).includes(value as PostStatus)) invalid('Choose a valid post status.');
  return value as PostStatus;
}

async function parseChannel(value: unknown): Promise<string | undefined> {
  if (value === undefined || value === '') return undefined;
  const max = await runtimeConfig('publishing.identifierMaxCharacters');
  if (typeof value !== 'string' || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid('Choose a valid channel filter.');
  return value;
}

/** Normalize and validate the shared literal post-search input. */
export async function publishingPostSearch(value: unknown): Promise<string> {
  if (value === undefined) return '';
  const max = await runtimeConfig('publishing.searchMaxCharacters');
  if (typeof value !== 'string') invalid('Enter valid post search text.');
  if (/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) invalid('Search must fit on one line.');
  const q = value.trim();
  if (q.length > max) invalid(`Search must be ${max.toLocaleString()} characters or fewer.`);
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
  input: { status?: string; channelId?: string; q?: string },
  feature: PublishingFeature = 'publishing/posts',
): Promise<{ where: Prisma.PostWhereInput; filters: { status?: PostStatus; channelId?: string; q: string }; channelUnavailable: boolean; scope: { targetIds: string[]; authorId?: string } }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.keys(input).some(key => !['status', 'channelId', 'q'].includes(key))) invalid();
  const [postStatus, channelId, q] = await Promise.all([parseStatus(input.status), parseChannel(input.channelId), publishingPostSearch(input.q)]);
  const access = await authorizePublishing(actor, feature, 'read');
  const targetIds = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.actor.allowedTargetIds);
  const authorId = access.actor.allowedTargetIds === undefined ? undefined : actor.userId;
  const where: Prisma.PostWhereInput = { AND: [
    publishingPostVisibilityWhere(actor.workspaceId, targetIds, authorId),
    ...(postStatus ? [{ status: postStatus } as Prisma.PostWhereInput] : []),
    ...(channelId ? [{ targets: { some: { targetId: channelId } } } as Prisma.PostWhereInput] : []),
    ...(q ? [publishingPostSearchWhere(q)] : []),
  ] };
  return {
    where,
    filters: { ...(postStatus ? { status: postStatus } : {}), ...(channelId ? { channelId } : {}), q },
    channelUnavailable: Boolean(channelId && !targetIds.includes(channelId)),
    scope: { targetIds, ...(authorId ? { authorId } : {}) },
  };
}
