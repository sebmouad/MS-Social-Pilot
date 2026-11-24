
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { sendDueFirstComment } from './first-comment';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { isStagingDryRun, suppressStagingBatch } from '@/server/jobs/staging';

type Candidate = {
  postId: string; postTargetId: string; workspaceId: string; authorId: string; provider: string;
  publishedAt: Date; firstCommentDelayMinutes: number;
};
type Cursor = { publishedAt: string; postTargetId: string };
export type DueFirstCommentSummary = { examined: number; sent: number; held: number; skipped: number; failed: number };
const cursorKey = 'publishing.firstCommentCursor';
const empty = (): DueFirstCommentSummary => ({ examined: 0, sent: 0, held: 0, skipped: 0, failed: 0 });

export function encodeFirstCommentCursor(row: Pick<Candidate, 'publishedAt' | 'postTargetId'>): string {
  if (typeof row.postTargetId !== 'string' || !row.postTargetId || row.postTargetId.length > 2048 || /[\u0000-\u001f\u007f]/.test(row.postTargetId)) throw new Error('Invalid first-comment cursor identity.');
  const value = JSON.stringify([row.publishedAt.toISOString(), row.postTargetId]);
  if (value.length > 4096) throw new Error('First-comment cursor exceeds its configured limit.');
  return value;
}
export function decodeFirstCommentCursor(value: unknown): Cursor | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string' ||
    !parsed[1] || parsed[1].length > 2048 || /[\u0000-\u001f\u007f]/.test(parsed[1])) return null;
  const date = new Date(parsed[0]);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== parsed[0]) return null;
  return { publishedAt: parsed[0], postTargetId: parsed[1] };
}
function positiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

async function readCandidates(now: Date, limit: number, maxDelayMinutes: number): Promise<Candidate[]> {
  const setting = await prisma.appSetting.findUnique({ where: { key: cursorKey }, select: { value: true } });
  const cursor = decodeFirstCommentCursor(setting?.value);
  const find = (position: Cursor | null, take: number) => prisma.$queryRaw<Candidate[]>`
    SELECT p.id AS "postId", pt.id AS "postTargetId", p."workspaceId", p."authorId", sa.provider, pt."publishedAt", p."firstCommentDelayMinutes"
    FROM posts p
    JOIN post_targets pt ON pt."postId"=p.id
    JOIN targets t ON t.id=pt."targetId" AND t."workspaceId"=p."workspaceId"
    JOIN social_accounts sa ON sa.id=t."socialAccountId" AND sa."workspaceId"=p."workspaceId"
    WHERE pt.status::text='published' AND pt."remotePostId" IS NOT NULL AND pt."remoteMissingAt" IS NULL AND p.status::text IN ('published','partially_failed')
      AND p."firstComment" IS NOT NULL AND btrim(p."firstComment")<>''
      AND p."firstCommentDelayMinutes" BETWEEN 0 AND ${maxDelayMinutes}
      AND pt."publishedAt" IS NOT NULL AND pt."publishedAt" <= ${now} - (p."firstCommentDelayMinutes" * INTERVAL '1 minute')
      AND pt."firstCommentId" IS NULL AND pt."firstCommentAt" IS NULL AND pt."firstCommentError" IS NULL
      AND t.enabled=true AND t."canPublish"=true AND sa.provider IS NOT NULL AND sa."invalidatedAt" IS NULL
      AND (${position?.publishedAt ?? null}::timestamp IS NULL OR (pt."publishedAt",pt.id) > (${position?.publishedAt ?? null}::timestamp,${position?.postTargetId ?? null}::text))
    ORDER BY pt."publishedAt" ASC,pt.id ASC LIMIT ${take}`;
  let rows = await find(cursor, limit);
  if (cursor && rows.length < limit) rows = rows.concat(await find(null, limit - rows.length));
  rows = [...new Map(rows.map(row => [row.postTargetId, row])).values()].slice(0, limit);
  if (rows.length) {
    const value = encodeFirstCommentCursor(rows[rows.length - 1]);
    await prisma.appSetting.upsert({ where: { key: cursorKey }, create: { key: cursorKey, value, encrypted: false, updatedAt: new Date() }, update: { value, encrypted: false, updatedAt: new Date() } });
  }
  return rows;
}

/**
 * A send cut off mid-way (2026-11-24: a worker restart left La Cuisine Ensoleillée's 15:15 post with its claim and no
 * outcome) blocked the first comment for good: the claim prevents a duplicate, and nothing ever looked again. After
 * 30 minutes, within 2 days (posts the inbox sync still reads every run):
 * - the Page's own top-level comment on that post around the attempt → it was sent; its id is recorded;
 * - none, while the sync has read that Page's comments since → it was not sent; the claim is released for the next run.
 * Anything else is left as it is, so a comment is never posted twice on a guess.
 */
export async function recoverInterruptedFirstComments(now = new Date()): Promise<{ sent: number; released: number }> {
  const cutoff = new Date(now.getTime() - 30 * 60_000); const oldest = new Date(now.getTime() - 2 * 86_400_000);
  const sent = await prisma.$executeRaw`
    WITH stale AS (
      SELECT pt.id, pt."firstCommentAt", t."providerId" FROM post_targets pt JOIN targets t ON t.id = pt."targetId"
      WHERE pt.status::text = 'published' AND pt."firstCommentId" IS NULL AND pt."firstCommentError" IS NULL
        AND pt."firstCommentAt" < ${cutoff} AND pt."firstCommentAt" > ${oldest}),
    found AS (
      SELECT DISTINCT ON (s.id) s.id, c."remoteId" FROM stale s JOIN post_comments c ON c."postTargetId" = s.id
      WHERE c."parentRemoteId" IS NULL AND c."fromId" = s."providerId"
        AND c."createdTime" BETWEEN s."firstCommentAt" - INTERVAL '5 minutes' AND s."firstCommentAt" + INTERVAL '30 minutes'
      ORDER BY s.id, c."createdTime")
    UPDATE post_targets pt SET "firstCommentId" = f."remoteId" FROM found f
    WHERE pt.id = f.id AND pt."firstCommentId" IS NULL AND pt."firstCommentError" IS NULL`;
  const released = await prisma.$executeRaw`
    UPDATE post_targets pt SET "firstCommentAt" = NULL FROM targets t
    WHERE t.id = pt."targetId" AND pt.status::text = 'published' AND pt."firstCommentId" IS NULL AND pt."firstCommentError" IS NULL
      AND pt."firstCommentAt" < ${cutoff} AND pt."firstCommentAt" > ${oldest}
      AND EXISTS (SELECT 1 FROM post_comments c JOIN post_targets o ON o.id = c."postTargetId" WHERE o."targetId" = pt."targetId" AND c."fetchedAt" > pt."firstCommentAt" + INTERVAL '10 minutes')
      AND NOT EXISTS (SELECT 1 FROM post_comments c WHERE c."postTargetId" = pt.id AND c."parentRemoteId" IS NULL AND c."fromId" = t."providerId")`;
  return { sent, released };
}

/** Continue due first comments only; the normal author-bound service owns authorization and dispatch. */
export async function runDueFirstComments(now = new Date()): Promise<DueFirstCommentSummary> {
  const errorText = await loadPublishingErrorText();
  const [limit, maxDelayMinutes] = await Promise.all([runtimeConfig('sync.maxItemsPerJob'), runtimeConfig('publishing.maxFirstCommentDelayMinutes')]);
  if (!positiveInteger(limit) || limit < 1 || !positiveInteger(maxDelayMinutes)) throw new PublishingOperationError('unavailable', 'automaticFirstcommentSettingsAreUnavailable', {}, errorText);
  const recovered = await recoverInterruptedFirstComments(now).catch(() => ({ sent: 0, released: 0 }));
  const rows = await readCandidates(now, limit, maxDelayMinutes);
  const result: DueFirstCommentSummary = { ...empty(), examined: rows.length, sent: recovered.sent };
  if (rows.length && await isStagingDryRun()) {
    await suppressStagingBatch('posts', 'first_comment', rows.map(row => ({ workspaceId: row.workspaceId, id: row.postTargetId })));
    result.skipped += rows.length;
    return result;
  }
  for (const row of rows) {
    try {
      await assertWorkspaceJobAccess(row.workspaceId, { provider: row.provider, anyFeatureOf: ['publishing/posts'] });
      const outcome = await sendDueFirstComment({ userId: row.authorId, workspaceId: row.workspaceId }, { postId: row.postId, postTargetId: row.postTargetId }, now);
      if (outcome.state === 'sent') result.sent++;
      else if (outcome.state === 'needs_review') result.held++;
      else result.skipped++;
    } catch (error) {
      if (error instanceof OperationError && ['forbidden', 'not_found', 'conflict'].includes(error.code)) result.skipped++;
      else result.failed++;
    }
  }
  return result;
}
