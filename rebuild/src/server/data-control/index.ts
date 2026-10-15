import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';

export type DataControlActor = { userId: string; workspaceId: string };
const MANAGER_ROLES = new Set(['owner', 'admin']);

type DataControlTransaction = import('../../../generated/client').Prisma.TransactionClient;
type WorkspaceTable = { tableName: string };
const MAPPED_DIRECT_TABLES = new Set(['posts', 'targets', 'ad_accounts', 'social_accounts']);

/** Discover tables whose workspace ownership is enforced by a real FK, excluding identity and membership. */
async function workspaceTables(tx: DataControlTransaction | typeof prisma): Promise<string[]> {
  const rows = await tx.$queryRaw<WorkspaceTable[]>`
    SELECT child.relname AS "tableName"
    FROM pg_constraint AS fk
    JOIN pg_class AS child ON child.oid = fk.conrelid
    JOIN pg_namespace AS ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.workspaces'::regclass
      AND ns.nspname = 'public' AND child.relkind = 'r' AND child.relname <> 'memberships'
    ORDER BY child.relname
  `;
  return [...new Set(rows.map(row => row.tableName))];
}

function tableSql(table: string) {
  // Names originate from pg_catalog, and are quoted before interpolation into a SQL identifier.
  return `"public"."${table.replaceAll('"', '""')}"`;
}

async function directWorkspaceCounts(tx: DataControlTransaction | typeof prisma, workspaceId: string) {
  const counts: Record<string, number> = {};
  for (const table of await workspaceTables(tx)) {
    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM ${tableSql(table)} WHERE "workspaceId" = $1`, workspaceId);
    const count = Number(rows[0]?.count ?? 0);
    if (!MAPPED_DIRECT_TABLES.has(table) && count > 0) counts[`other:${table}`] = count;
  }
  return counts;
}

async function assertManager(actor: DataControlActor) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new Error('You are no longer a member of this workspace.');
  if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can manage workspace data.');
}

/** Export workspace content and operational history while stripping provider credentials. */
export async function exportWorkspaceData(actor: DataControlActor) {
  await assertManager(actor);
  const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId } });
  if (!workspace) throw new Error('This workspace is unavailable.');
  const [memberships, socialAccounts, targets, adAccounts, posts] = await Promise.all([
    prisma.membership.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } }),
    prisma.socialAccount.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true, provider: true, providerUserId: true, name: true, pictureUrl: true, tokenExpiresAt: true, scopes: true, invalidatedAt: true, invalidReason: true, createdAt: true, updatedAt: true } }),
    prisma.target.findMany({ where: { workspaceId: actor.workspaceId }, include: { insights: true, conversations: { include: { messages: true } }, postTargets: { include: { comments: true, post: { select: { id: true, message: true, firstComment: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, updatedAt: true } } } } } }),
    prisma.adAccount.findMany({ where: { workspaceId: actor.workspaceId }, include: { insights: true } }),
    prisma.post.findMany({ where: { workspaceId: actor.workspaceId }, include: { targets: { include: { comments: true, target: { select: { id: true, type: true, providerId: true, name: true } } } } } }),
  ]);
  return {
    format: 'ms-social-pilot-workspace-export', version: 1, exportedAt: new Date().toISOString(),
    workspace, memberships,
    socialAccounts: socialAccounts.map(account => ({
      id: account.id, provider: account.provider, providerUserId: account.providerUserId,
      name: account.name, pictureUrl: account.pictureUrl, tokenExpiresAt: account.tokenExpiresAt,
      scopes: account.scopes, invalidatedAt: account.invalidatedAt, invalidReason: account.invalidReason,
      createdAt: account.createdAt, updatedAt: account.updatedAt,
    })),
    targets: targets.map(({ accessToken: _token, ...target }) => target),
    adAccounts, posts,
    security: { credentialsExcluded: true, auditLogExcluded: true, note: 'Provider access tokens and instance-wide audit records are excluded.' },
  };
}

/** Read-only count preview for the rows deleteWorkspaceData will remove. */
export async function previewWorkspaceDataDeletion(actor: DataControlActor) {
  await assertManager(actor);
  const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId }, select: { id: true } });
  if (!workspace) throw new Error('This workspace is unavailable.');
  return { ...await collectWorkspaceDeletionCounts(prisma, actor.workspaceId), ...await directWorkspaceCounts(prisma, actor.workspaceId) };
}

async function collectWorkspaceDeletionCounts(tx: DataControlTransaction | typeof prisma, workspaceId: string) {
  const [targets, adAccounts, posts] = await Promise.all([
    tx.target.findMany({ where: { workspaceId }, select: { id: true } }),
    tx.adAccount.findMany({ where: { workspaceId }, select: { id: true } }),
    tx.post.findMany({ where: { workspaceId }, select: { id: true } }),
  ]);
  const targetIds = targets.map(row => row.id);
  const adAccountIds = adAccounts.map(row => row.id);
  const postIds = posts.map(row => row.id);
  const postTargets = postIds.length ? await tx.postTarget.findMany({ where: { postId: { in: postIds } }, select: { id: true } }) : [];
  const postTargetIds = postTargets.map(row => row.id);
  const conversations = targetIds.length ? await tx.conversation.findMany({ where: { targetId: { in: targetIds } }, select: { id: true } }) : [];
  const conversationIds = conversations.map(row => row.id);
  const [comments, conversationMessages, pageInsights, adInsights, socialAccounts] = await Promise.all([
    postTargetIds.length ? tx.postComment.count({ where: { postTargetId: { in: postTargetIds } } }) : 0,
    conversationIds.length ? tx.conversationMessage.count({ where: { conversationId: { in: conversationIds } } }) : 0,
    targetIds.length ? tx.pageInsight.count({ where: { targetId: { in: targetIds } } }) : 0,
    adAccountIds.length ? tx.adInsight.count({ where: { adAccountId: { in: adAccountIds } } }) : 0,
    tx.socialAccount.count({ where: { workspaceId } }),
  ]);
  return {
    posts: posts.length, postTargets: postTargets.length, comments, targets: targets.length,
    conversations: conversations.length, conversationMessages, pageInsights,
    adAccounts: adAccounts.length, adInsights, socialAccounts,
  };
}

/** Delete content represented by this compatibility schema in one transaction. Workspace identity and memberships remain. */
export async function deleteWorkspaceData(actor: DataControlActor, confirmation: string) {
  if (confirmation !== 'DELETE') throw new Error('Type DELETE to confirm this action.');
  const timeout = await runtimeConfig('data.deleteTransactionTimeoutMs');
  return prisma.$transaction(async tx => {
    const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
    if (!membership) throw new Error('You are no longer a member of this workspace.');
    if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can manage workspace data.');
    const workspace = await tx.workspace.findUnique({ where: { id: actor.workspaceId }, select: { id: true } });
    if (!workspace) throw new Error('This workspace is unavailable.');

    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
    const counts: Record<string, number> = { ...await collectWorkspaceDeletionCounts(tx, actor.workspaceId), ...await directWorkspaceCounts(tx, actor.workspaceId) };
    if ((counts['other:media'] ?? 0) > 0 || (counts['other:workspace_exports'] ?? 0) > 0) {
      throw new Error('Stored files must be removed through a verified cleanup before this workspace can be erased. No database rows were deleted.');
    }
    for (const table of await workspaceTables(tx)) {
      await tx.$executeRawUnsafe(`DELETE FROM ${tableSql(table)} WHERE "workspaceId" = $1`, actor.workspaceId);
    }
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`data_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'workspace.data_deleted', ${JSON.stringify({ workspaceId: actor.workspaceId, counts })}::jsonb, NOW())`;
    return counts;
  }, { timeout });
}
