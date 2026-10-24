import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { withPublishingOperation, withPublishingTransaction } from '@/modules/publishing/server/guard';
import { audit, bad, lockActor } from '../server/core';
import { authorizeFeedWrite, type FeedActor } from '../server/access';
import { loadWordpressSettings, patchLimits } from '../server/wordpress-settings';
import { selectSource } from '../server/wordpress-store';
import { readWordpressCaption } from './db';
import { resolveConfig } from './recipe';
import { normalizeWordpressCaption } from './text';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const captionRepairConfirmation = (previewId: string) => `REPAIR RECIPE CAPTION ${previewId}`;
const inputSchema = z.object({
  postId: z.string().min(1), dryRun: z.boolean().default(true),
  previewId: z.string().uuid().optional(), confirmation: z.string().optional(),
}).strict();

/** Only source-proven entity/space corruption is eligible. Never replace arbitrary
 * zeroes: meaningful numbers and customer edits must survive this maintenance pass. */
export function captionRepairProposal(current: string, raw: string): string | null {
  const desired = normalizeWordpressCaption(raw);
  if (!desired || desired === current) return null;
  const spaceDamage = current.length === desired.length && [...Array(desired.length).keys()].every(index =>
    current[index] === desired[index] || (current[index] === '0' && /[\u00a0\u202f]/.test(desired[index]!)));
  return current === raw.trim() || spaceDamage ? desired : null;
}

/** Operator-invoked shared service, one explicitly identified post per call.
 * Dry-run is the default and writes ONLY an audit receipt. Apply requires that
 * same actor's reviewed receipt and exact confirmation; all state is revalidated.
 * No remote writes; already-held/attempted/published or edited content is refused. */
export async function repairPlannedRecipeCaption(actor: FeedActor, input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw await bad();
  const data = parsed.data;
  const auth = await authorizeFeedWrite(actor);
  if (!auth.workspaceWide || !['owner', 'admin'].includes(auth.role)) throw await bad();
  const settings = await loadWordpressSettings();
  const source = await selectSource(actor.workspaceId);
  if (!source) throw await bad();
  const plans = await prisma.$queryRaw<Array<{ id: string; wpPostId: string; targetId: string }>>`
    SELECT id, "wpPostId", "targetId" FROM wordpress_recipe_plans
    WHERE "workspaceId" = ${actor.workspaceId} AND "sourceId" = ${source.id}
      AND "postId" = ${data.postId} AND state = 'planned'`;
  if (plans.length !== 1) throw await bad();
  const plan = plans[0]!;
  const config = resolveConfig(settings.defaults, source.config, patchLimits(settings));
  const apiToken = await runtimeSecret('feeds.wordpress.databaseUrl').catch(() => null);
  const raw = await readWordpressCaption({ siteUrl: source.siteUrl || settings.siteUrl, apiToken, uploadsPath: settings.uploadsPath, ...settings.db }, config.mapping, plan.wpPostId);
  if (raw === null) throw await bad();
  const max = await runtimeConfig('publishing.maxMessageCharacters');
  const desired = normalizeWordpressCaption(raw);
  if (typeof max !== 'number' || !Number.isSafeInteger(max) || max <= 0 || !desired || desired.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(desired)) throw await bad();

  return withPublishingOperation(actor, { postId: data.postId }, ({ signal }) => withPublishingTransaction(signal, async tx => {
    const currentAuth = await lockActor(tx, actor, true);
    if (!currentAuth.workspaceWide || !['owner', 'admin'].includes(currentAuth.role)) throw await bad();
    // Lock local identity and source config while reviewing/applying. A changed
    // mapping/source or a planner settlement invalidates this proposal.
    const identities = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT l.id FROM wordpress_recipe_plans l
      JOIN wordpress_recipe_sources s ON s.id = l."sourceId" AND s."workspaceId" = l."workspaceId"
      WHERE l.id = ${plan.id} AND l."workspaceId" = ${actor.workspaceId}
        AND l."sourceId" = ${source.id} AND l."postId" = ${data.postId}
        AND l."wpPostId" = ${plan.wpPostId} AND l."targetId" = ${plan.targetId}
        AND l.state = 'planned' AND l."slotAt" > NOW() AND s."updatedAt" = ${source.updatedAt}
      FOR UPDATE OF l, s`;
    if (identities.length !== 1) throw await bad();
    const post = await tx.post.findFirst({ where: { id: data.postId, workspaceId: actor.workspaceId }, include: { targets: true } });
    // Legacy physical columns omitted from the rebuild Prisma projection still
    // govern worker claims/overrides; read and lock them explicitly.
    const targets = await tx.$queryRaw<Array<{
      id: string; targetId: string; status: string; attempts: number; lockedAt: Date | null; lockedBy: string | null;
      remotePostId: string | null; remoteUrl: string | null; publishedAt: Date | null; nativeScheduledFor: Date | null;
      messageOverride: string | null; updatedAt: Date;
    }>>`SELECT pt.id, pt."targetId", pt.status::text, pt.attempts, pt."lockedAt", pt."lockedBy",
      pt."remotePostId", pt."remoteUrl", pt."publishedAt", pt."nativeScheduledFor", pt."messageOverride", pt."updatedAt"
      FROM post_targets pt JOIN posts p ON p.id = pt."postId"
      WHERE p.id = ${data.postId} AND p."workspaceId" = ${actor.workspaceId} FOR UPDATE OF pt`;
    const target = targets[0];
    if (!post || post.status !== 'scheduled' || post.publishedAt || !post.scheduledAt || post.scheduledAt <= new Date()
      || post.targets.length !== 1 || targets.length !== 1 || !target || target.targetId !== plan.targetId
      || target.status !== 'pending' || target.attempts !== 0 || target.lockedAt || target.lockedBy
      || target.remotePostId || target.remoteUrl || target.publishedAt || target.nativeScheduledFor
      || (target.messageOverride !== null && target.messageOverride !== post.message)) throw await bad();
    const attempts = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM publication_attempts WHERE "workspaceId" = ${actor.workspaceId} AND "postId" = ${post.id}`;
    if (attempts.length) throw await bad();
    const proposal = captionRepairProposal(post.message, raw);
    if (!proposal) return { dryRun: data.dryRun, changed: false, reason: post.message === desired ? 'unchanged' : 'source_mismatch' } as const;
    const detail = { postId: post.id, planId: plan.id, wpPostId: plan.wpPostId, beforeHash: hash(post.message), afterHash: hash(proposal) };
    const reviewHash = hash({ ...detail, updatedAt: post.updatedAt, targetUpdatedAt: target.updatedAt, sourceUpdatedAt: source.updatedAt });
    if (data.dryRun) {
      const previewId = randomUUID();
      await audit(tx, actor.workspaceId, actor, 'feeds.recipe_caption_repair_preview', { ...detail, reviewHash, previewId });
      return { dryRun: true, changed: false, previewId, confirmation: captionRepairConfirmation(previewId), before: post.message, after: proposal } as const;
    }
    if (!data.previewId || data.confirmation !== captionRepairConfirmation(data.previewId)) throw await bad();
    const receipts = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND "actorId" = ${actor.userId}
        AND action = 'feeds.recipe_caption_repair_preview' AND detail->>'previewId' = ${data.previewId}
        AND detail->>'reviewHash' = ${reviewHash}`;
    if (!receipts.length) throw await bad();
    const updated = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, updatedAt: post.updatedAt, message: post.message, status: 'scheduled', publishedAt: null, scheduledAt: { gt: new Date() } }, data: { message: proposal } });
    if (updated.count !== 1) throw await bad();
    if (target.messageOverride !== null) {
      const count = await tx.$executeRaw`UPDATE post_targets SET "messageOverride" = ${proposal}, "updatedAt" = NOW()
        WHERE id = ${target.id} AND "postId" = ${post.id} AND "messageOverride" = ${post.message}`;
      if (count !== 1) throw await bad();
    }
    await audit(tx, actor.workspaceId, actor, 'feeds.recipe_caption_repaired', { ...detail, previewId: data.previewId, reviewHash });
    return { dryRun: false, changed: true, postId: post.id } as const;
  }));
}
