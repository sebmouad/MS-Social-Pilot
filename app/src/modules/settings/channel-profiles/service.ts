import { lockSelectedResources } from '@/server/platforms/resource-lock';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { canUseFeature, entitledPlatformIds, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { saveGroupConfirmation, setLabelsConfirmation, deleteGroupConfirmation, profileAction, scopedGroups, type ProfileActor, type ProfileFeature, type ProfileDirectory } from './contracts';
import { profilePolicySchema } from './config';

const denied = () => new OperationError('forbidden', 'Channel profiles are unavailable for this account.');
const unavailable = () => new OperationError('unavailable', 'Channel profiles are temporarily unavailable. Try again later.');
const invalid = () => new OperationError('invalid_request', 'Check the group name, labels and selected channels.');
type Db = Prisma.TransactionClient | typeof prisma;
async function authorize(actor: ProfileActor, feature: ProfileFeature, write = false) {
  const [user, member, entitlements, permissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!user || user.disabledAt || !member || !entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature, write ? 'write' : 'read')) throw denied();
  if (write && (feature !== 'settings/connections' || !['owner', 'admin'].includes(member.role))) throw denied();
  return { entitlements, permissions };
}
async function policy() { const value = profilePolicySchema.safeParse(await runtimeConfig('settings.channelProfilesPolicy')); if (!value.success) throw unavailable(); return value.data; }
async function channels(db: Db, actor: ProfileActor, authority: Awaited<ReturnType<typeof authorize>>, max: number) {
  const ids = authority.permissions.pageScope.all ? actor.allowedChannelIds : authority.permissions.pageScope.ids.filter(id => actor.allowedChannelIds === undefined || actor.allowedChannelIds.includes(id));
  const rows = await db.target.findMany({ where: { workspaceId: actor.workspaceId, enabled: true, socialAccount: { is: await selectedResourceConnectionWhere(actor.workspaceId, entitledPlatformIds(authority.entitlements)) }, ...(ids === undefined ? {} : { id: { in: [...ids] } }) }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: max + 1 });
  if (rows.length > max) throw new OperationError('unavailable', 'The channel directory exceeds its configured limit.');
  return rows;
}
async function protect<T>(run: () => Promise<T>) { try { return await run(); } catch (error) { if (error instanceof OperationError) throw error; if ((error as { code?: string })?.code === 'P2002' || ((error as { code?: string })?.code === 'P2010' && (error as { meta?: { code?: string } }).meta?.code === '23505')) throw new OperationError('conflict', 'A channel group already uses that name.'); throw unavailable(); } }

export async function readChannelProfiles(actor: ProfileActor, feature: ProfileFeature = 'settings/connections'): Promise<ProfileDirectory> {
  return protect(async () => {
    const authority = await authorize(actor, feature); await assertWorkspaceNotPurging(actor.workspaceId);
    const limits = await policy(); const available = await channels(prisma, actor, authority, limits.maxChannels);
    const groups = await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM page_groups WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name, id LIMIT ${limits.maxGroups + 1}`;
    if (groups.length > limits.maxGroups) throw new OperationError('unavailable', 'The group directory exceeds its configured limit.');
    const ids = available.map(channel => channel.id);
    const members = ids.length ? await prisma.$queryRaw<Array<{ groupId: string; targetId: string }>>`SELECT p."groupId", p."targetId" FROM page_group_targets p JOIN page_groups g ON g.id = p."groupId" WHERE g."workspaceId" = ${actor.workspaceId} AND p."targetId" = ANY(${ids}::text[])` : [];
    const labels = ids.length ? await prisma.$queryRaw<Array<{ targetId: string; labels: string[] }>>`SELECT p."targetId", p.labels FROM channel_profiles p JOIN targets t ON t.id = p."targetId" WHERE t."workspaceId" = ${actor.workspaceId} AND p."targetId" = ANY(${ids}::text[])` : [];
    return { channels: available.map(channel => ({ ...channel, labels: labels.find(row => row.targetId === channel.id)?.labels ?? [] })), groups: scopedGroups(groups.map(group => ({ ...group, channelIds: members.filter(row => row.groupId === group.id).map(row => row.targetId) })), ids) };
  });
}

/** All surfaces enter here; locks, current access, validation and audit are atomic. */
export async function changeChannelProfiles(actor: ProfileActor, input: unknown) {
  return protect(async () => {
    const parsed = profileAction.safeParse(input); if (!parsed.success) throw invalid(); const value = parsed.data;
    await authorize(actor, 'settings/connections', true); const limits = await policy();
    if (value.action === 'saveGroup' && (value.name.length > limits.maxNameCharacters || value.channelIds.length > limits.maxChannels)) throw invalid();
    if (value.action === 'setLabels' && (value.labels.length > limits.maxLabelsPerChannel || value.labels.some(label => label.length > limits.maxNameCharacters))) throw invalid();
    if (value.action === 'saveGroup' && value.confirmation !== saveGroupConfirmation(value)) throw invalid();
    if (value.action === 'setLabels' && value.confirmation !== setLabelsConfirmation(value.channelId)) throw invalid();
    if (value.action === 'deleteGroup' && value.confirmation !== deleteGroupConfirmation(value.id)) throw invalid();
    const [timeout, maxWait] = await Promise.all([runtimeConfig('settings.teamOperationTimeoutMs'), runtimeConfig('settings.teamOperationMaxWaitMs')]);
    return prisma.$transaction(async tx => {
      const workspace = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
      if (!workspace[0] || workspace[0].suspendedAt) throw denied();
      const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId }, select: { status: true } });
      if (purge && purge.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
      await tx.$queryRaw`SELECT m.id FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
      let previous: Array<{ targetId: string }> = [];
      if (value.action !== 'setLabels' && value.id) {
        const group = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM page_groups WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
        if (!group.length) throw new OperationError('not_found', 'This channel group is unavailable.');
        previous = await tx.$queryRaw<Array<{ targetId: string }>>`SELECT "targetId" FROM page_group_targets WHERE "groupId" = ${value.id}`;
      }
      const requested = value.action === 'setLabels' ? [value.channelId] : value.action === 'saveGroup' ? value.channelIds : [];
      await lockSelectedResources(tx, actor.workspaceId, [...new Set([...requested, ...previous.map(row => row.targetId)])].map(id => ({ kind: 'target', id })));
      const authority = await authorize(actor, 'settings/connections', true);
      const available = await channels(tx, actor, authority, limits.maxChannels); const ids = available.map(channel => channel.id);
      let id = value.action === 'setLabels' ? value.channelId : value.id;
      if (value.action === 'setLabels') {
        if (!ids.includes(value.channelId)) throw denied();
        const labels = [...new Set(value.labels)];
        await tx.$executeRaw`INSERT INTO channel_profiles ("targetId", labels) VALUES (${value.channelId}, ${labels}::text[]) ON CONFLICT ("targetId") DO UPDATE SET labels = EXCLUDED.labels`;
      } else {
        if (previous.some(row => !ids.includes(row.targetId))) throw new OperationError('conflict', 'This group includes unavailable channels. Restore channel selection before editing or deleting it.');
        if (value.action === 'deleteGroup') {
          const rules = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM content_mix_rules WHERE "groupId" = ${value.id} LIMIT 1`;
          if (rules.length) throw new OperationError('conflict', 'Remove the scheduling rules using this group before deleting it.');
          await tx.$executeRaw`DELETE FROM page_groups WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
        }
        else {
          const selected = [...new Set(value.channelIds)]; if (selected.some(id => !ids.includes(id))) throw denied();
          if (value.id) await tx.$executeRaw`UPDATE page_groups SET name = ${value.name}, "updatedAt" = NOW() WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
          else {
            const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM page_groups WHERE "workspaceId" = ${actor.workspaceId}`;
            if (!count[0]) throw unavailable();
            if (Number(count[0].count) >= limits.maxGroups) throw new OperationError('conflict', 'The configured group limit has been reached.');
            id = `cg_${randomUUID()}`;
            await tx.$executeRaw`INSERT INTO page_groups (id, "workspaceId", name, color, "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${value.name}, 'blue', NOW(), NOW())`;
          }
          await tx.$executeRaw`DELETE FROM page_group_targets WHERE "groupId" = ${id!}`;
          for (const channelId of selected) await tx.$executeRaw`INSERT INTO page_group_targets ("groupId", "targetId") VALUES (${id!}, ${channelId})`;
        }
      }
      await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'settings.channelProfiles', ${JSON.stringify({ workspaceId: actor.workspaceId, action: value.action, id })}::jsonb, NOW())`;
      return { ok: true as const, id };
    }, { timeout, maxWait });
  });
}
