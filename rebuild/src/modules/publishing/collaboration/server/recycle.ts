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
const unavailable = () => new OperationError('unavailable', 'Recycling posts is not available yet.');
const toState = (postId: string, r: Row): RecycleState => ({ postId, enabled: r.recycleEnabled, everyDays: r.recycleEveryDays, limit: r.recycleLimit, count: r.recycleCount, nextAt: r.recycleNextAt, variants: Array.isArray(r.variants) ? r.variants.filter((v): v is string => typeof v === 'string') : [], isRepeat: r.originPostId !== null });
const select = (db: Tx | typeof prisma, workspaceId: string, postId: string, lock: boolean) => lock
  ? db.$queryRaw<Row[]>`SELECT "recycleEnabled", "recycleEveryDays", "recycleLimit", "recycleCount", "recycleNextAt", variants, "originPostId", "publishedAt", "scheduledAt" FROM posts WHERE id = ${postId} AND "workspaceId" = ${workspaceId} FOR UPDATE`
  : db.$queryRaw<Row[]>`SELECT "recycleEnabled", "recycleEveryDays", "recycleLimit", "recycleCount", "recycleNextAt", variants, "originPostId", "publishedAt", "scheduledAt" FROM posts WHERE id = ${postId} AND "workspaceId" = ${workspaceId}`;

/** Recycle settings of one post. The controls are offered only when the host registered a recycle executor. */
export async function readRecycle(actor: PublishingActor, input: unknown) {
  const { postId } = parse(RECYCLE_READ, input);
  if (!collaborationPorts().recycle) throw unavailable();
  const auth = await authorizePublishing(actor, POSTS, 'read');
  await visiblePost(prisma, auth, postId);
  const limit = await bounds();
  const rows = await protect(select(prisma, actor.workspaceId, postId, false));
  if (!rows[0]) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
  return { ...toState(postId, rows[0]), limits: { maxIntervalDays: limit.recycleMaxIntervalDays, maxRepeats: limit.recycleMaxRepeats, defaultIntervalDays: limit.recycleDefaultIntervalDays, maxVariants: limit.variantsLimit, maxVariantCharacters: limit.variantMaxCharacters } };
}

/**
 * Turns repeating on or off for a post and sets its alternate wordings. Alternate wordings are new text nobody has reviewed,
 * so in a workspace with approvals they need editor standing or above; repeating the approved text itself stays open to the author.
 * Repeats are created by the registered executor, never by this service.
 */
export async function setRecycle(actor: PublishingActor, input: unknown) {
  const data = parse(RECYCLE_SET, input); exact(data.confirmation, setRecycleConfirmation(data.postId));
  if (!collaborationPorts().recycle) throw unavailable();
  const limit = await bounds();
  const variants = data.variants?.map(v => v.trim()).filter(Boolean);
  if ((data.everyDays ?? 1) > limit.recycleMaxIntervalDays || (data.limit ?? 1) > limit.recycleMaxRepeats || (variants?.length ?? 0) > limit.variantsLimit || variants?.some(v => v.length > limit.variantMaxCharacters)) throw bad();
  await authorizePublishing(actor, POSTS, 'write');
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, POSTS, true);
    const post = await visiblePost(tx, auth, data.postId, true);
    assertMayEdit(auth, post);
    if (NOT_RECYCLABLE.has(post.status) && data.enabled) throw new OperationError('conflict', 'This post cannot be repeated in its current state.');
    const rows = await select(tx, actor.workspaceId, data.postId, true);
    const current = rows[0]; if (!current) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
    if (current.originPostId && data.enabled) throw new OperationError('conflict', 'This post is already a repeat. Change the original post instead.');
    if (variants?.length && !isManager(auth.role)) {
      const approvals = await tx.$queryRaw<Array<{ requiresApproval: boolean }>>`SELECT "requiresApproval" FROM workspaces WHERE id = ${actor.workspaceId}`;
      if (approvals[0]?.requiresApproval) throw new OperationError('forbidden', 'Alternate wordings need an editor or above because they are published without a new review.');
    }
    const everyDays = data.everyDays ?? current.recycleEveryDays ?? limit.recycleDefaultIntervalDays;
    const repeatLimit = data.limit === undefined ? current.recycleLimit : data.limit;
    const nextAt = data.enabled ? nextRecycleAt({ everyDays, limit: repeatLimit, count: current.recycleCount, from: current.publishedAt ?? current.scheduledAt ?? new Date() }) : null;
    if (data.enabled && !nextAt) throw new OperationError('conflict', 'This post has already used all of its repeats.');
    const nextVariants = JSON.stringify(variants ?? (Array.isArray(current.variants) ? current.variants : []));
    await tx.$executeRaw`UPDATE posts SET "recycleEnabled" = ${data.enabled}, "recycleEveryDays" = ${everyDays}, "recycleLimit" = ${repeatLimit}, "recycleNextAt" = ${nextAt}, variants = ${nextVariants}::jsonb, "updatedAt" = NOW() WHERE id = ${data.postId} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, data.enabled ? 'publishing.recycle_enabled' : 'publishing.recycle_disabled', { postId: data.postId, everyDays, limit: repeatLimit, variants: variants?.length ?? null, nextAt });
    await lockActor(tx, actor, POSTS, true);
    const fresh = await select(tx, actor.workspaceId, data.postId, false);
    return toState(data.postId, fresh[0] ?? current);
  }));
}
