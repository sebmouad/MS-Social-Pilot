
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { collaborationPorts } from '../ports';
import { effectiveMix, MIX_AUTOFILL, MIX_SAVE, mixAutoFillConfirmation, saveMixConfirmation } from '../schemas';
import { audit, bad, bounds, exact, lockActor, parse, protect, QUEUE, requireWorkspaceAdmin, transact, usableTargets } from './core';

type RuleRow = { id: string; targetId: string | null; groupId: string | null; labelId: string; perWeek: number; dryNotifiedAt: Date | null };
export type MixLine = { labelId: string; perWeek: number; planned: number; readyDrafts: number };
const PLANNED = ['scheduled', 'pending_approval', 'publishing', 'published'];
const notOffered = (errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('unavailable', 'collaboration_3', {}, errorText);
const count = (v: bigint | number) => Number(v);

/**
 * The plan against what is already scheduled in the rolling window, for the channels the caller can use.
 * Group rules are shown only to callers who see every channel. Counts come from posts visible to the caller's channel scope.
 */
export async function readContentMix(actor: PublishingActor, now = new Date()) {
  const errorText = await loadPublishingErrorText();
  if (!collaborationPorts().mix) throw notOffered(errorText);
  const auth = await authorizePublishing(actor, QUEUE, 'read');
  const limit = await bounds();
  const wide = auth.permissions.pageScope.all;
  const targets = await protect(usableTargets(auth));
  const ids = targets.map(t => t.id);
  const until = new Date(now.getTime() + limit.mixWindowDays * 86_400_000);
  const ownAuthor = auth.actor.allowedTargetIds !== undefined || auth.role === 'contributor' ? actor.userId : null;
  const [labels, groups, rules, memberships, planned, drafts, workspace] = await protect(Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; color: string }>>`SELECT id, name, color FROM labels WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name ASC, id ASC`,
    wide ? prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM page_groups WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name ASC, id ASC` : Promise.resolve([] as Array<{ id: string; name: string }>),
    prisma.$queryRaw<RuleRow[]>`SELECT id, "targetId", "groupId", "labelId", "perWeek", "dryNotifiedAt" FROM content_mix_rules WHERE "workspaceId" = ${actor.workspaceId} AND ("targetId" = ANY(${ids}::text[]) OR ("groupId" IS NOT NULL AND ${wide})) ORDER BY "createdAt" ASC, id ASC`,
    prisma.$queryRaw<Array<{ groupId: string; targetId: string }>>`SELECT gt."groupId", gt."targetId" FROM page_group_targets gt JOIN page_groups g ON g.id = gt."groupId" WHERE g."workspaceId" = ${actor.workspaceId} AND gt."targetId" = ANY(${ids}::text[])`,
    prisma.$queryRaw<Array<{ targetId: string; labelId: string; n: bigint }>>`SELECT pt."targetId", pl."labelId", COUNT(DISTINCT p.id)::bigint AS n FROM posts p JOIN post_targets pt ON pt."postId" = p.id JOIN post_labels pl ON pl."postId" = p.id WHERE p."workspaceId" = ${actor.workspaceId} AND p.status::text = ANY(${PLANNED}::text[]) AND p."scheduledAt" >= ${now} AND p."scheduledAt" < ${until} AND pt."targetId" = ANY(${ids}::text[]) AND NOT EXISTS (SELECT 1 FROM post_targets hidden WHERE hidden."postId" = p.id AND NOT (hidden."targetId" = ANY(${ids}::text[]))) AND (${ownAuthor}::text IS NULL OR p."authorId" = ${ownAuthor}) GROUP BY pt."targetId", pl."labelId"`,
    prisma.$queryRaw<Array<{ targetId: string; labelId: string; n: bigint }>>`
      SELECT pt."targetId", pl."labelId", COUNT(DISTINCT p.id)::bigint AS n FROM posts p
      JOIN post_targets pt ON pt."postId" = p.id JOIN post_labels pl ON pl."postId" = p.id
      JOIN workspaces w ON w.id = p."workspaceId"
      LEFT JOIN memberships m ON m."userId" = p."authorId" AND m."workspaceId" = p."workspaceId"
      WHERE p."workspaceId" = ${actor.workspaceId} AND p.status::text = 'draft' AND pt."targetId" = ANY(${ids}::text[])
        AND NOT EXISTS (SELECT 1 FROM post_targets hidden WHERE hidden."postId" = p.id AND NOT (hidden."targetId" = ANY(${ids}::text[])))
        AND (${ownAuthor}::text IS NULL OR p."authorId" = ${ownAuthor})
        AND (p."approvalStatus"::text = 'approved' OR (p."approvalStatus"::text = 'not_required' AND (NOT w."requiresApproval" OR m.role::text IN ('owner','admin','editor'))))
      GROUP BY pt."targetId", pl."labelId"`,
    prisma.$queryRaw<Array<{ mixAutoFill: boolean }>>`SELECT "mixAutoFill" FROM workspaces WHERE id = ${actor.workspaceId}`,
  ]));
  const groupsOf = new Map<string, string[]>();
  for (const m of memberships) groupsOf.set(m.targetId, [...(groupsOf.get(m.targetId) ?? []), m.groupId]);
  const plannedBy = new Map(planned.map(r => [`${r.targetId}\u0000${r.labelId}`, count(r.n)]));
  const draftsBy = new Map(drafts.map(r => [`${r.targetId}\u0000${r.labelId}`, count(r.n)]));
  const mixes = effectiveMix(rules, ids, groupsOf);
  const status = [...mixes].map(([targetId, mix]) => ({
    targetId,
    lines: [...mix].map(([labelId, e]): MixLine => ({ labelId, perWeek: e.perWeek, planned: plannedBy.get(`${targetId}\u0000${labelId}`) ?? 0, readyDrafts: draftsBy.get(`${targetId}\u0000${labelId}`) ?? 0 })),
  }));
  const canEdit = auth.permissions.features[QUEUE]?.write === true && (auth.role === 'owner' || auth.role === 'admin');
  return { windowDays: limit.mixWindowDays, maxPerWeek: limit.mixMaxPerWeek, targets, groups, labels, rules: rules.map(({ dryNotifiedAt, ...r }) => ({ ...r, ranDry: Boolean(dryNotifiedAt) })), status, mixAutoFill: workspace[0]?.mixAutoFill === true, canEditChannels: canEdit, canEditGroups: canEdit && wide, canEditAutoFill: canEdit && wide };
}

/** Workspace-wide scheduler policy; this updates the workspace row, so it deliberately avoids withWorkspaceOperation's FOR SHARE lock. */
export async function setContentMixAutoFill(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(MIX_AUTOFILL, input, undefined, errorText);
  exact(data.confirmation, mixAutoFillConfirmation(data.enabled), errorText);
  if (!collaborationPorts().mix) throw notOffered(errorText);
  const limit = await bounds();
  const check = (auth: Awaited<ReturnType<typeof authorizePublishing>>) => requireWorkspaceAdmin(auth, errorText('actionContentMix'), errorText);
  check(await authorizePublishing(actor, QUEUE, 'write'));
  return protect(prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
    const workspaces = await tx.$queryRaw<Array<{ suspendedAt: Date | null; mixAutoFill: boolean }>>`SELECT "suspendedAt", "mixAutoFill" FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
    const workspace = workspaces[0];
    if (!workspace) throw new PublishingOperationError('unavailable', 'collaboration_4', {}, errorText);
    if (workspace.suspendedAt) throw new PublishingOperationError('forbidden', 'collaboration_5', {}, errorText);
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw new PublishingOperationError('conflict', 'collaboration_6', {}, errorText);
    check(await lockActor(tx, actor, QUEUE, true));
    if (workspace.mixAutoFill !== data.enabled) {
      const changed = await tx.$executeRaw`UPDATE workspaces SET "mixAutoFill" = ${data.enabled}, "updatedAt" = NOW() WHERE id = ${actor.workspaceId}`;
      if (changed !== 1) throw new PublishingOperationError('conflict', 'collaboration_7', {}, errorText);
      await audit(tx, actor, data.enabled ? 'publishing.content_mix_autofill_enabled' : 'publishing.content_mix_autofill_disabled', { enabled: data.enabled });
    }
    check(await lockActor(tx, actor, QUEUE, true));
    return { enabled: data.enabled, changed: workspace.mixAutoFill !== data.enabled };
  }, { timeout: limit.transactionTimeoutMs, maxWait: limit.transactionMaxWaitMs }));
}

/** Replaces the rules of one channel or group atomically. Admin-only; group rules need access to every channel. */
export async function saveContentMix(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(MIX_SAVE, input, undefined, errorText); exact(data.confirmation, saveMixConfirmation(data.scope), errorText);
  if (!collaborationPorts().mix) throw notOffered(errorText);
  const limit = await bounds();
  if (data.rules.length > limit.mixRulesPerScope || data.rules.some(r => r.perWeek > limit.mixMaxPerWeek)) throw bad(errorText('collaboration_8', {value0: limit.mixRulesPerScope, value1: limit.mixMaxPerWeek}), errorText);
  const check = (auth: Awaited<ReturnType<typeof authorizePublishing>>) => {
    if (auth.role !== 'owner' && auth.role !== 'admin') throw new PublishingOperationError('forbidden', 'collaboration_9', {}, errorText);
    if (data.scope.groupId) requireWorkspaceAdmin(auth, errorText('actionGroupMix'), errorText);
  };
  check(await authorizePublishing(actor, QUEUE, 'write'));
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, QUEUE, true); check(auth);
    const { targetId, groupId } = data.scope;
    if (targetId) {
      if (!(await usableTargets(auth)).some(t => t.id === targetId)) throw new PublishingOperationError('not_found', 'collaboration_10', {}, errorText);
    } else {
      const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM page_groups WHERE id = ${groupId!} AND "workspaceId" = ${actor.workspaceId}`;
      if (!found[0]) throw new PublishingOperationError('not_found', 'collaboration_11', {}, errorText);
    }
    const labelIds = data.rules.map(r => r.labelId);
    if (labelIds.length) {
      const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${labelIds}::text[])`;
      if (found.length !== labelIds.length) throw new PublishingOperationError('invalid_request', 'collaboration_1', {}, errorText);
    }
    // Keep the "ran dry" marker of labels that stay, so admins are not told again.
    const kept = await tx.$queryRaw<Array<{ labelId: string; dryNotifiedAt: Date | null }>>`SELECT "labelId", "dryNotifiedAt" FROM content_mix_rules WHERE "workspaceId" = ${actor.workspaceId} AND "targetId" IS NOT DISTINCT FROM ${targetId ?? null} AND "groupId" IS NOT DISTINCT FROM ${groupId ?? null} FOR UPDATE`;
    const dry = new Map(kept.map(r => [r.labelId, r.dryNotifiedAt]));
    await tx.$executeRaw`DELETE FROM content_mix_rules WHERE "workspaceId" = ${actor.workspaceId} AND "targetId" IS NOT DISTINCT FROM ${targetId ?? null} AND "groupId" IS NOT DISTINCT FROM ${groupId ?? null}`;
    for (const rule of data.rules) await tx.$executeRaw`INSERT INTO content_mix_rules (id, "workspaceId", "targetId", "groupId", "labelId", "perWeek", "dryNotifiedAt", "createdAt") VALUES (${`mix_${randomUUID()}`}, ${actor.workspaceId}, ${targetId ?? null}, ${groupId ?? null}, ${rule.labelId}, ${rule.perWeek}, ${dry.get(rule.labelId) ?? null}, NOW())`;
    await audit(tx, actor, 'publishing.content_mix_saved', { targetId: targetId ?? null, groupId: groupId ?? null, before: kept.length, rules: data.rules });
    await lockActor(tx, actor, QUEUE, true);
    return { scope: data.scope, rules: data.rules.length, replaced: kept.length };
  }));
}
