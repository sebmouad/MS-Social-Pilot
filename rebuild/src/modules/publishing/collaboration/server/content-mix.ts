import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { collaborationPorts } from '../ports';
import { effectiveMix, MIX_SAVE, saveMixConfirmation } from '../schemas';
import { audit, bad, bounds, exact, lockActor, parse, protect, QUEUE, requireWorkspaceAdmin, transact, usableTargets } from './core';

type RuleRow = { id: string; targetId: string | null; groupId: string | null; labelId: string; perWeek: number; dryNotifiedAt: Date | null };
export type MixLine = { labelId: string; perWeek: number; planned: number; readyDrafts: number };
const PLANNED = ['scheduled', 'pending_approval', 'publishing', 'published'];
const notOffered = () => new OperationError('unavailable', 'Content mix is not available yet.');
const count = (v: bigint | number) => Number(v);

/**
 * The plan against what is already scheduled in the rolling window, for the channels the caller can use.
 * Group rules are shown only to callers who see every channel. Counts come from posts visible to the caller's channel scope.
 */
export async function readContentMix(actor: PublishingActor, now = new Date()) {
  if (!collaborationPorts().mix) throw notOffered();
  const auth = await authorizePublishing(actor, QUEUE, 'read');
  const limit = await bounds();
  const wide = auth.permissions.pageScope.all;
  const targets = await protect(usableTargets(auth));
  const ids = targets.map(t => t.id);
  const until = new Date(now.getTime() + limit.mixWindowDays * 86_400_000);
  const [labels, groups, rules, memberships, planned, drafts] = await protect(Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; color: string }>>`SELECT id, name, color FROM labels WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name ASC, id ASC`,
    wide ? prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM page_groups WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name ASC, id ASC` : Promise.resolve([] as Array<{ id: string; name: string }>),
    prisma.$queryRaw<RuleRow[]>`SELECT id, "targetId", "groupId", "labelId", "perWeek", "dryNotifiedAt" FROM content_mix_rules WHERE "workspaceId" = ${actor.workspaceId} AND ("targetId" = ANY(${ids}::text[]) OR ("groupId" IS NOT NULL AND ${wide})) ORDER BY "createdAt" ASC, id ASC`,
    prisma.$queryRaw<Array<{ groupId: string; targetId: string }>>`SELECT gt."groupId", gt."targetId" FROM page_group_targets gt JOIN page_groups g ON g.id = gt."groupId" WHERE g."workspaceId" = ${actor.workspaceId} AND gt."targetId" = ANY(${ids}::text[])`,
    prisma.$queryRaw<Array<{ targetId: string; labelId: string; n: bigint }>>`SELECT pt."targetId", pl."labelId", COUNT(DISTINCT p.id)::bigint AS n FROM posts p JOIN post_targets pt ON pt."postId" = p.id JOIN post_labels pl ON pl."postId" = p.id WHERE p."workspaceId" = ${actor.workspaceId} AND p.status::text = ANY(${PLANNED}::text[]) AND p."scheduledAt" >= ${now} AND p."scheduledAt" < ${until} AND pt."targetId" = ANY(${ids}::text[]) GROUP BY pt."targetId", pl."labelId"`,
    prisma.$queryRaw<Array<{ targetId: string; labelId: string; n: bigint }>>`
      SELECT pt."targetId", pl."labelId", COUNT(DISTINCT p.id)::bigint AS n FROM posts p
      JOIN post_targets pt ON pt."postId" = p.id JOIN post_labels pl ON pl."postId" = p.id
      JOIN workspaces w ON w.id = p."workspaceId"
      LEFT JOIN memberships m ON m."userId" = p."authorId" AND m."workspaceId" = p."workspaceId"
      WHERE p."workspaceId" = ${actor.workspaceId} AND p.status::text = 'draft' AND pt."targetId" = ANY(${ids}::text[])
        AND (p."approvalStatus"::text = 'approved' OR (p."approvalStatus"::text = 'not_required' AND (NOT w."requiresApproval" OR m.role::text IN ('owner','admin','editor'))))
      GROUP BY pt."targetId", pl."labelId"`,
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
  return { windowDays: limit.mixWindowDays, maxPerWeek: limit.mixMaxPerWeek, targets, groups, labels, rules: rules.map(({ dryNotifiedAt, ...r }) => ({ ...r, ranDry: Boolean(dryNotifiedAt) })), status, canEditChannels: canEdit, canEditGroups: canEdit && wide };
}

/** Replaces the rules of one channel or group atomically. Admin-only; group rules need access to every channel. */
export async function saveContentMix(actor: PublishingActor, input: unknown) {
  const data = parse(MIX_SAVE, input); exact(data.confirmation, saveMixConfirmation(data.scope));
  if (!collaborationPorts().mix) throw notOffered();
  const limit = await bounds();
  if (data.rules.length > limit.mixRulesPerScope || data.rules.some(r => r.perWeek > limit.mixMaxPerWeek)) throw bad(`Use at most ${limit.mixRulesPerScope} labels and ${limit.mixMaxPerWeek} posts per week for each.`);
  const check = (auth: Awaited<ReturnType<typeof authorizePublishing>>) => {
    if (auth.role !== 'owner' && auth.role !== 'admin') throw new OperationError('forbidden', 'Only workspace owners and admins can change the content mix.');
    if (data.scope.groupId) requireWorkspaceAdmin(auth, 'change a group content mix');
  };
  check(await authorizePublishing(actor, QUEUE, 'write'));
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, QUEUE, true); check(auth);
    const { targetId, groupId } = data.scope;
    if (targetId) {
      if (!(await usableTargets(auth)).some(t => t.id === targetId)) throw new OperationError('not_found', 'This channel is unavailable in the current workspace.');
    } else {
      const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM page_groups WHERE id = ${groupId!} AND "workspaceId" = ${actor.workspaceId}`;
      if (!found[0]) throw new OperationError('not_found', 'This group is unavailable in the current workspace.');
    }
    const labelIds = data.rules.map(r => r.labelId);
    if (labelIds.length) {
      const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${labelIds}::text[])`;
      if (found.length !== labelIds.length) throw new OperationError('invalid_request', 'Choose labels from this workspace.');
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
