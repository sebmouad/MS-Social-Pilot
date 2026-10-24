
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { PostStatus, Prisma, type Prisma as PrismaTypes } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { firstCommentState } from '../first-comment-state';
import { publishingPostReadQuery } from './read-query';
import type { PublishingActor } from './types';

const COLUMNS = [
  'post_id', 'author_id', 'message', 'first_comment', 'firstCommentDelayMinutes', 'link', 'media_json', 'status',
  'scheduled_at', 'published_at', 'created_at', 'destinations_json',
] as const;


type ExportFilters = { status?: PostStatus; channelId?: string; q: string };

function invalid(message: string | undefined = undefined, errorText: PublishingErrorText = defaultPublishingErrorText): never {
  message ??= errorText('chooseValidPublishingExportFilters');
  throw new OperationError('invalid_request', message);
}

function safeCap(value: unknown, label: string, errorText: PublishingErrorText = defaultPublishingErrorText): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new PublishingOperationError('unavailable', 'thePublishingValue0LimitIsUnavailable', {value0: label}, errorText);
  }
  return value;
}

function csvCell(value: string): string {
  // Spreadsheet programs may ignore leading whitespace before a formula marker.
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function safeMedia(value: unknown): Array<{ kind: string; url: string; altText?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const media = item as Record<string, unknown>;
    if (typeof media.kind !== 'string' || typeof media.url !== 'string') return [];
    return [{ kind: media.kind, url: media.url, ...(typeof media.altText === 'string' ? { altText: media.altText } : {}) }];
  });
}

function rowValues(post: {
  id: string; authorId: string; message: string; firstComment: string | null; firstCommentDelayMinutes?: number; format?: string; link: string | null; media: unknown;
  status: string; scheduledAt: Date | null; publishedAt: Date | null; createdAt: Date;
  targets: Array<{
    id: string; formatId?: string | null; status: string; remotePostId: string | null; remoteUrl: string | null; firstCommentId: string | null;
    firstCommentAt: Date | null; firstCommentError: string | null;
    target: { id: string; name: string; type: string };
  }>;
}): string[] {
  const destinations = [...post.targets].sort((a, b) => a.target.id.localeCompare(b.target.id)).map(target => ({
    id: target.target.id,
    name: target.target.name,
    type: target.target.type,
    status: target.status,
    format_id: target.formatId ?? post.format ?? null,
    remote_id: target.remotePostId,
    remote_url: target.remoteUrl,
    first_comment: {
      state: firstCommentState(post.firstComment, target),
      id: target.firstCommentId,
      at: target.firstCommentAt?.toISOString() ?? null,
      error_present: Boolean(target.firstCommentError),
    },
  }));
  return [
    post.id, post.authorId, post.message, post.firstComment, post.firstCommentDelayMinutes ?? 0, post.link,
    JSON.stringify(safeMedia(post.media)), post.status,
    post.scheduledAt, post.publishedAt, post.createdAt, JSON.stringify(destinations),
  ].map(asText);
}

/** Complete-or-refused, read-only CSV export of the caller's current scoped Publishing posts. */
export async function exportPublishingPosts(
  actor: PublishingActor,
  input: unknown = {},
  constraints: { maxItems?: number } = {},
) {
  const errorText = await loadPublishingErrorText();
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(undefined, errorText);
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !['q', 'status', 'channelId'].includes(key))) invalid(undefined, errorText);
  if (Object.values(values).some(value => value !== undefined && typeof value !== 'string')) invalid(undefined, errorText);
  if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)
    || Object.keys(constraints).some(key => key !== 'maxItems')) invalid(errorText('read_13'), errorText);
  const requested = constraints.maxItems;
  if (requested !== undefined && (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested < 1)) {
    invalid(errorText('read_13'), errorText);
  }

  const queryInput = {
    ...(values.q === undefined ? {} : { q: values.q as string }),
    ...(values.status === undefined ? {} : { status: values.status as string }),
    ...(values.channelId === undefined ? {} : { channelId: values.channelId as string }),
  };
  const [query, configuredPosts, configuredBytes] = await Promise.all([
    publishingPostReadQuery(actor, queryInput, 'publishing/posts'),
    runtimeConfig('publishing.exportMaxPosts'),
    runtimeConfig('publishing.exportMaxBytes'),
  ]);
  const rootPostLimit = safeCap(configuredPosts, 'post export', errorText);
  const byteLimit = safeCap(configuredBytes, 'export byte', errorText);
  const maxPosts = requested === undefined ? rootPostLimit : Math.min(rootPostLimit, requested);
  const batchSize = safeCap(await runtimeConfig('publishing.exportBatchSize'), 'export batch', errorText);
  const timeout = safeCap(await runtimeConfig('publishing.transactionTimeoutMs'), 'transaction timeout', errorText);
  const maxWait = safeCap(await runtimeConfig('publishing.transactionMaxWaitMs'), 'transaction wait', errorText);
  let csv = `${COLUMNS.map(column => `"${column}"`).join(',')}\r\n`;
  let byteLength = Buffer.byteLength(csv, 'utf8');
  let count = 0;
  if (byteLength > byteLimit) throw new OperationError('invalid_request', errorText('read_12'));
  await prisma.$transaction(async tx => {
    let cursor: { createdAt: Date; id: string } | undefined;
    while (true) {
      const remaining = maxPosts - count;
      const take = Math.min(batchSize, remaining + 1);
      const cursorWhere: PrismaTypes.PostWhereInput | undefined = cursor ? { OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ] } : undefined;
      const posts = await tx.post.findMany({
        where: cursorWhere ? { AND: [query.where, cursorWhere] } : query.where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take,
        select: {
          id: true, authorId: true, message: true, firstComment: true, firstCommentDelayMinutes: true, format: true, link: true, media: true,
          status: true, scheduledAt: true, publishedAt: true, createdAt: true,
          targets: { select: {
            id: true, formatId: true, status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true,
            target: { select: { id: true, name: true, type: true } },
          } },
        },
      });
      if (posts.length > remaining) throw new OperationError('invalid_request', errorText('read_12'));
      for (const post of posts) {
        const line = `${rowValues(post as Parameters<typeof rowValues>[0]).map(csvCell).join(',')}\r\n`;
        const lineBytes = Buffer.byteLength(line, 'utf8');
        const nextBytes = byteLength + lineBytes;
        if (nextBytes > byteLimit) throw new OperationError('invalid_request', errorText('read_12'));
        csv += line;
        byteLength = nextBytes;
        count++;
      }
      if (posts.length < take) break;
      const last = posts.at(-1);
      if (!last) break;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout, maxWait });

  const filters: ExportFilters = query.filters;
  return {
    format: 'ms-social-pilot-posts-csv' as const,
    version: 1 as const,
    csv,
    fileName: 'posts.csv' as const,
    postCount: count,
    byteLength,
    generatedAt: new Date().toISOString(),
    filters,
    channelUnavailable: query.channelUnavailable,
  };
}
