
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { collaborationPorts } from '../ports';
import { nextRecycleAt, RECYCLE_READ, RECYCLE_SET, setRecycleConfirmation } from '../schemas';
import { assertMayEdit, audit, bad, bounds, exact, isManager, lockActor, parse, POSTS, protect, transact, visiblePost } from './core';
import type { Tx } from './core';

export type RecycleState = { postId: string; enabled: boolean; everyDays: number | null; limit: number | null; count: number; nextAt: Date | null; variants: string[]; isRepeat: boolean };
type Row = { recycleEnabled: boolean; recycleEveryDays: number | null; recycleLimit: number | null; recycleCount: number; recycleNextAt: Date | null; variants: unknown; originPostId: string | null; publishedAt: Date | null; scheduledAt: Date | null };
const NOT_RECYCLABLE = new Set(['publishing', 'cancelled', 'rejected', 'failed']);
const unavailable = (errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('unavailable', 'collaboration_43', {}, errorText);
const toState = (postId: string, r: Row): RecycleState => ({ postId, enabled: r.recycleEnabled, everyDays: r.recycleEveryDays, limit: r.recycleLimit, count: r.recycleCount, nextAt: r.recycleNextAt, variants: Array.isArray(r.variants) ? r.variants.filter((v): v is string => typeof v === 'string') : [], isRepeat: r.originPostId !== null });
const select = (db: Tx | typeof prisma, workspaceId: string, postId: string, lock: boolean) => lock
  ? db.$queryRaw<Row[]>`SELECT "recycleEnabled", "recycleEveryDays", "recycleLimit", "recycleCount", "recycleNextAt", variants, "originPostId", "publishedAt", "scheduledAt" FROM posts WHERE id = ${postId} AND "workspaceId" = ${workspaceId} FOR UPDATE`
  : db.$queryRaw<Row[]>`SELECT "recycleEnabled", "recycleEveryDays", "recycleLimit", "recycleCount", "recycleNextAt", variants, "originPostId", "publishedAt", "scheduledAt" FROM posts WHERE id = ${postId} AND "workspaceId" = ${workspaceId}`;

/** Recycle settings of one post. The controls are offered only when the host registered a recycle executor. */
export async function readRecycle(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const { postId } = parse(RECYCLE_READ, input, undefined, errorText);
  if (!collaborationPorts().recycle) throw unavailable(errorText);
  const auth = await authorizePublishing(actor, POSTS, 'read');
  await visiblePost(prisma, auth, postId);
  const limit = await bounds();
  const rows = await protect(select(prisma, actor.workspaceId, postId, false));
  if (!rows[0]) throw new PublishingOperationError('not_found', 'collaboration_13', {}, errorText);
  return { ...toState(postId, rows[0]), limits: { maxIntervalDays: limit.recycleMaxIntervalDays, maxRepeats: limit.recycleMaxRepeats, defaultIntervalDays: limit.recycleDefaultIntervalDays, maxVariants: limit.variantsLimit, maxVariantCharacters: limit.variantMaxCharacters } };
}

/**
 * Turns repeating on or off for a post and sets its alternate wordings. Alternate wordings are new text nobody has reviewed,
 * so in a workspace with approvals they need editor standing or above; repeating the approved text itself stays open to the author.
 * Repeats are created by the registered executor, never by this service.
 */
export async function setRecycle(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(RECYCLE_SET, input, undefined, errorText); exact(data.confirmation, setRecycleConfirmation(data.postId), errorText);
  if (!collaborationPorts().recycle) throw unavailable(errorText);
  const limit = await bounds();
  const suppliedVariants = data.variants?.map(value => value.trim()).filter(Boolean);
  if ((data.everyDays !== undefined && data.everyDays > limit.recycleMaxIntervalDays) ||
    (data.limit !== undefined && data.limit !== null && data.limit > limit.recycleMaxRepeats) ||
    (suppliedVariants?.length ?? 0) > limit.variantsLimit ||
    suppliedVariants?.some(value => value.length > limit.variantMaxCharacters)) throw bad(undefined, errorText);
  await authorizePublishing(actor, POSTS, 'write');
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, POSTS, true);
    const post = await visiblePost(tx, auth, data.postId, true);
    assertMayEdit(auth, post, errorText);
    if (NOT_RECYCLABLE.has(post.status) && data.enabled) throw new PublishingOperationError('conflict', 'collaboration_44', {}, errorText);
    const rows = await select(tx, actor.workspaceId, data.postId, true);
    const current = rows[0]; if (!current) throw new PublishingOperationError('not_found', 'collaboration_13', {}, errorText);
    if (current.originPostId && data.enabled) throw new PublishingOperationError('conflict', 'collaboration_45', {}, errorText);
    const everyDays = data.everyDays ?? current.recycleEveryDays ?? limit.recycleDefaultIntervalDays;
    if (!Number.isSafeInteger(everyDays) || everyDays < 1 || everyDays > limit.recycleMaxIntervalDays) throw bad(errorText('collaboration_46', {value0: limit.recycleMaxIntervalDays}), errorText);
    const repeatLimit = data.limit === undefined ? current.recycleLimit : data.limit;
    if (repeatLimit !== null && (!Number.isSafeInteger(repeatLimit) || repeatLimit < 1 || repeatLimit > limit.recycleMaxRepeats)) throw bad(errorText('collaboration_47', {value0: limit.recycleMaxRepeats}), errorText);
    const storedVariants = current.variants;
    if (data.variants === undefined && (!Array.isArray(storedVariants) || storedVariants.some(value => typeof value !== 'string'))) throw bad(errorText('collaboration_48'), errorText);
    const nextVariants = data.variants === undefined
      ? (storedVariants as string[]).map(value => value.trim()).filter(Boolean)
      : data.variants.map(value => value.trim()).filter(Boolean);
    if (nextVariants.length > limit.variantsLimit || nextVariants.some(value => value.length > limit.variantMaxCharacters)) throw bad(errorText('collaboration_49', {value0: limit.variantsLimit, value1: limit.variantMaxCharacters}), errorText);
    if (nextVariants.length && !isManager(auth.role)) {
      const approvals = await tx.$queryRaw<Array<{ requiresApproval: boolean }>>`SELECT "requiresApproval" FROM workspaces WHERE id = ${actor.workspaceId}`;
      if (approvals[0]?.requiresApproval) throw new PublishingOperationError('forbidden', 'collaboration_50', {}, errorText);
    }
    const nextAt = data.enabled ? nextRecycleAt({ everyDays, limit: repeatLimit, count: current.recycleCount, from: current.publishedAt ?? current.scheduledAt ?? new Date() }) : null;
    if (data.enabled && !nextAt) throw new PublishingOperationError('conflict', 'collaboration_51', {}, errorText);
    const variantsJson = JSON.stringify(nextVariants);
    await tx.$executeRaw`UPDATE posts SET "recycleEnabled" = ${data.enabled}, "recycleEveryDays" = ${everyDays}, "recycleLimit" = ${repeatLimit}, "recycleNextAt" = ${nextAt}, variants = ${variantsJson}::jsonb, "updatedAt" = NOW() WHERE id = ${data.postId} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, data.enabled ? 'publishing.recycle_enabled' : 'publishing.recycle_disabled', { postId: data.postId, everyDays, limit: repeatLimit, variants: nextVariants.length, nextAt });
    await lockActor(tx, actor, POSTS, true);
    const fresh = await select(tx, actor.workspaceId, data.postId, false);
    return toState(data.postId, fresh[0] ?? current);
  }));
}
