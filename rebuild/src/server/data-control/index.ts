import { assertPublishingTargetsSettled } from '@/modules/publishing/server/guard';
import { assertInboxDeletionsSettled } from '@/modules/inbox/server/comment-guard';
import { OperationError } from '@/lib/operation-error';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canonicalMediaRoot, removeWorkspaceStorage, validateWorkspaceId } from './storage';

export type DataControlActor = { userId: string; workspaceId: string; apiKeyId?: string };
const MANAGER_ROLES = new Set(['owner', 'admin']);

type DataControlTransaction = import('../../../generated/client').Prisma.TransactionClient;
type WorkspaceTable = { tableName: string };
const MAPPED_DIRECT_TABLES = new Set(['posts', 'targets', 'ad_accounts', 'social_accounts', 'instagram_accounts']);
const EXCLUDED_WORKSPACE_TABLES = new Set(['memberships', 'workspace_data_purges']);
const SENSITIVE_FIELD = /(?:access.?token|refresh.?token|token|secret|password|credential|private.?key|client.?secret|api.?key)/i;
const SAFE_SECURITY_METADATA = new Set(['credentialsExcluded', 'auditLogExcluded', 'providerCredentialsExcluded', 'secretsExcluded']);

/** Discover tables whose workspace ownership is enforced by a real FK, excluding identity and membership. */
async function workspaceTables(tx: DataControlTransaction | typeof prisma): Promise<string[]> {
  const rows = await tx.$queryRaw<WorkspaceTable[]>`
    SELECT child.relname AS "tableName"
    FROM pg_constraint AS fk
    JOIN pg_class AS child ON child.oid = fk.conrelid
    JOIN pg_namespace AS ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.workspaces'::regclass
      AND ns.nspname = 'public' AND child.relkind = 'r'
      AND child.relname NOT IN ('memberships', 'workspace_data_purges')
    ORDER BY child.relname
  `;
  return [...new Set(rows.map(row => row.tableName))];
}

function scrubLegacyValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(scrubLegacyValue);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_FIELD.test(key) && !SAFE_SECURITY_METADATA.has(key) ? '[REDACTED]' : scrubLegacyValue(item)]));
  }
  return value;
}

async function exportLegacyWorkspaceTables(workspaceId: string) {
  const tables = (await workspaceTables(prisma)).filter(table => !MAPPED_DIRECT_TABLES.has(table) && !EXCLUDED_WORKSPACE_TABLES.has(table));
  const datasets: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM ${tableSql(table)} WHERE "workspaceId" = $1`, workspaceId,
    );
    datasets[table] = rows.map(row => scrubLegacyValue(row) as Record<string, unknown>);
    rowCounts[table] = rows.length;
  }
  return { datasets, rowCounts, tables };
}

function tableSql(table: string) {
  // Names originate from pg_catalog, and are quoted before interpolation into a SQL identifier.
  return `"public"."${table.replaceAll('"', '""')}"`;
}

const ownedBy = (foreignKey: string, parentTable: string) =>
  `child."${foreignKey}" IN (SELECT "id" FROM ${tableSql(parentTable)} WHERE "workspaceId" = $1)`;
const INDIRECT_WORKSPACE_TABLES = [
  { table: 'bio_links', where: ownedBy('pageId', 'bio_pages') },
  { table: 'external_posts', where: ownedBy('targetId', 'targets') },
  { table: 'feed_items', where: ownedBy('feedSourceId', 'feed_sources') },
  { table: 'instagram_media', where: ownedBy('accountId', 'instagram_accounts') },
  { table: 'link_clicks', where: ownedBy('shortLinkId', 'short_links') },
  { table: 'member_page_access', where: `(${ownedBy('targetId', 'targets')} OR ${ownedBy('membershipId', 'memberships')})` },
  { table: 'metric_availability', where: ownedBy('targetId', 'targets') },
  { table: 'notification_mutes', where: ownedBy('targetId', 'targets') },
  { table: 'page_group_targets', where: `(${ownedBy('groupId', 'page_groups')} OR ${ownedBy('targetId', 'targets')})` },
  { table: 'page_reviews', where: ownedBy('targetId', 'targets') },
  { table: 'page_videos', where: ownedBy('targetId', 'targets') },
  { table: 'post_field_values', where: `(${ownedBy('postId', 'posts')} OR ${ownedBy('fieldId', 'custom_fields')})` },
  { table: 'post_labels', where: `(${ownedBy('postId', 'posts')} OR ${ownedBy('labelId', 'labels')})` },
  { table: 'post_notes', where: ownedBy('postId', 'posts') },
  { table: 'post_versions', where: ownedBy('postId', 'posts') },
  { table: 'review_decisions', where: `(${ownedBy('postId', 'posts')} OR ${ownedBy('shareLinkId', 'share_links')})` },
] as const;

async function directWorkspaceCounts(tx: DataControlTransaction | typeof prisma, workspaceId: string) {
  const counts: Record<string, number> = {};
  for (const table of await workspaceTables(tx)) {
    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM ${tableSql(table)} WHERE "workspaceId" = $1`, workspaceId);
    const count = Number(rows[0]?.count ?? 0);
    if (!MAPPED_DIRECT_TABLES.has(table) && count > 0) counts[`other:${table}`] = count;
  }
  return counts;
}

async function exportIndirectWorkspaceTables(workspaceId: string) {
  const datasets: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};
  for (const { table, where } of INDIRECT_WORKSPACE_TABLES) {
    if (table === 'instagram_media') continue; // Exported through the mapped model below.
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT child.* FROM ${tableSql(table)} child WHERE ${where}`, workspaceId,
    );
    datasets[table] = rows.map(row => scrubLegacyValue(row) as Record<string, unknown>);
    rowCounts[table] = rows.length;
  }
  return { datasets, rowCounts };
}

async function indirectWorkspaceCounts(tx: DataControlTransaction | typeof prisma, workspaceId: string) {
  const counts: Record<string, number> = {};
  for (const { table, where } of INDIRECT_WORKSPACE_TABLES) {
    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM ${tableSql(table)} child WHERE ${where}`, workspaceId,
    );
    counts[`indirect:${table}`] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

async function assertManager(actor: DataControlActor) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new OperationError('forbidden', 'You are no longer a member of this workspace.');
  if (!MANAGER_ROLES.has(membership.role)) throw new OperationError('forbidden', 'Only workspace owners and admins can manage workspace data.');
}

/** Export workspace content and operational history while stripping provider credentials. */
export async function exportWorkspaceData(actor: DataControlActor) {
  await assertManager(actor);
  const maxBytes = await runtimeConfig('data.maxArchiveBytes') as number;
  const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId } });
  if (!workspace) throw new OperationError('unavailable', 'This workspace is unavailable.');
  const [memberships, socialAccounts, targets, adAccounts, instagramAccounts, posts, legacy, indirect] = await Promise.all([
    prisma.membership.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } }),
    prisma.socialAccount.findMany({ where: { workspaceId: actor.workspaceId }, select: { id: true, provider: true, providerUserId: true, name: true, pictureUrl: true, tokenExpiresAt: true, scopes: true, invalidatedAt: true, invalidReason: true, createdAt: true, updatedAt: true } }),
    prisma.target.findMany({ where: { workspaceId: actor.workspaceId }, include: { insights: true, conversations: { include: { messages: true } }, postTargets: { include: { comments: true, post: { select: { id: true, message: true, firstComment: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, updatedAt: true } } } } } }),
    prisma.adAccount.findMany({ where: { workspaceId: actor.workspaceId }, include: { insights: true } }),
    prisma.instagramAccount.findMany({ where: { workspaceId: actor.workspaceId }, include: { insights: true, media: true } }),
    prisma.post.findMany({ where: { workspaceId: actor.workspaceId }, include: { targets: { include: { comments: true, target: { select: { id: true, type: true, providerId: true, name: true } } } } } }),
    exportLegacyWorkspaceTables(actor.workspaceId),
    exportIndirectWorkspaceTables(actor.workspaceId),
  ]);
  const instagramMedia = instagramAccounts.flatMap(account => account.media.map(media => ({ ...media, accountId: account.id })));
  const mappedIndirectRowCounts = {
    post_targets: posts.reduce((sum, post) => sum + post.targets.length, 0),
    post_comments: posts.reduce((sum, post) => sum + post.targets.reduce((targetSum, target) => targetSum + target.comments.length, 0), 0),
    page_insights: targets.reduce((sum, target) => sum + target.insights.length, 0),
    conversations: targets.reduce((sum, target) => sum + target.conversations.length, 0),
    conversation_messages: targets.reduce((sum, target) => sum + target.conversations.reduce((conversationSum, conversation) => conversationSum + conversation.messages.length, 0), 0),
    ad_insights: adAccounts.reduce((sum, account) => sum + account.insights.length, 0),
    instagram_insights: instagramAccounts.reduce((sum, account) => sum + account.insights.length, 0),
  };
  const exported = scrubLegacyValue({
    format: 'ms-social-pilot-workspace-export', version: 1, exportedAt: new Date().toISOString(),
    workspace, memberships,
    socialAccounts: socialAccounts.map(account => ({
      id: account.id, provider: account.provider, providerUserId: account.providerUserId,
      name: account.name, pictureUrl: account.pictureUrl, tokenExpiresAt: account.tokenExpiresAt,
      scopes: account.scopes, invalidatedAt: account.invalidatedAt, invalidReason: account.invalidReason,
      createdAt: account.createdAt, updatedAt: account.updatedAt,
    })),
    targets: targets.map(({ accessToken: _token, ...target }) => target),
    adAccounts,
    instagramAccounts: instagramAccounts.map(({ media: _media, ...account }) => account),
    instagramMedia,
    posts,
    legacyTables: legacy.datasets,
    indirectTables: indirect.datasets,
    coverage: {
      directlyOwnedLegacyTables: legacy.tables,
      directlyOwnedLegacyRowCounts: legacy.rowCounts,
      directlyOwnedLegacyTablesComplete: true,
      includedIndirectTables: [
        'post_targets', 'post_comments', 'page_insights', 'conversations', 'conversation_messages', 'ad_insights', 'instagram_insights',
        ...INDIRECT_WORKSPACE_TABLES.map(({ table }) => table),
      ],
      indirectRowCounts: { ...mappedIndirectRowCounts, ...indirect.rowCounts, instagram_media: instagramMedia.length },
      complete: false,
      omitted: ['instance-wide audit and authentication records', 'tables outside the current application Prisma schema'],
    },
    security: { credentialsExcluded: true, auditLogExcluded: true, note: 'Provider access tokens and instance-wide audit records are excluded.' },
  }) as Record<string, any>;
  if (Buffer.byteLength(JSON.stringify(exported)) > maxBytes) throw new OperationError('invalid_request', 'Workspace database export exceeds the configured archive size limit.');
  return exported;
}

/** Read-only count preview for the rows deleteWorkspaceData will remove. */
export async function previewWorkspaceDataDeletion(actor: DataControlActor) {
  await assertManager(actor);
  const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId }, select: { id: true } });
  if (!workspace) throw new OperationError('unavailable', 'This workspace is unavailable.');
  return { ...await collectWorkspaceDeletionCounts(prisma, actor.workspaceId), ...await indirectWorkspaceCounts(prisma, actor.workspaceId), ...await directWorkspaceCounts(prisma, actor.workspaceId) };
}

async function collectWorkspaceDeletionCounts(tx: DataControlTransaction | typeof prisma, workspaceId: string) {
  const [targets, adAccounts, instagramAccounts, posts] = await Promise.all([
    tx.target.findMany({ where: { workspaceId }, select: { id: true } }),
    tx.adAccount.findMany({ where: { workspaceId }, select: { id: true } }),
    tx.instagramAccount.findMany({ where: { workspaceId }, select: { id: true } }),
    tx.post.findMany({ where: { workspaceId }, select: { id: true } }),
  ]);
  const targetIds = targets.map(row => row.id);
  const adAccountIds = adAccounts.map(row => row.id);
  const instagramAccountIds = instagramAccounts.map(row => row.id);
  const postIds = posts.map(row => row.id);
  const postTargets = postIds.length || targetIds.length
    ? await tx.postTarget.findMany({ where: { OR: [{ postId: { in: postIds } }, { targetId: { in: targetIds } }] }, select: { id: true } })
    : [];
  const postTargetIds = postTargets.map(row => row.id);
  const conversations = targetIds.length ? await tx.conversation.findMany({ where: { targetId: { in: targetIds } }, select: { id: true } }) : [];
  const conversationIds = conversations.map(row => row.id);
  const [comments, conversationMessages, pageInsights, adInsights, instagramInsights, socialAccounts] = await Promise.all([
    postTargetIds.length ? tx.postComment.count({ where: { postTargetId: { in: postTargetIds } } }) : 0,
    conversationIds.length ? tx.conversationMessage.count({ where: { conversationId: { in: conversationIds } } }) : 0,
    targetIds.length ? tx.pageInsight.count({ where: { targetId: { in: targetIds } } }) : 0,
    adAccountIds.length ? tx.adInsight.count({ where: { adAccountId: { in: adAccountIds } } }) : 0,
    instagramAccountIds.length ? tx.instagramInsight.count({ where: { accountId: { in: instagramAccountIds } } }) : 0,
    tx.socialAccount.count({ where: { workspaceId } }),
  ]);
  return {
    posts: posts.length, postTargets: postTargets.length, comments, targets: targets.length,
    conversations: conversations.length, conversationMessages, pageInsights,
    adAccounts: adAccounts.length, adInsights, instagramAccounts: instagramAccounts.length, instagramInsights, socialAccounts,
  };
}

/** Delete mapped rows that are owned through a workspace record rather than a workspaceId column.
 * This makes erasure independent of whether an older database installed cascading foreign keys.
 * Every statement starts from a workspace-scoped parent, so a malformed cross-workspace link can
 * only remove its link/child row and never a row belonging to another workspace.
 */
async function deleteIndirectWorkspaceRows(tx: DataControlTransaction, workspaceId: string) {
  // Posts are removed in the direct-table phase. Clear the optional feed-item
  // pointer first so deleting an owned RSS item cannot strand a post FK.
  await tx.$executeRawUnsafe(
    `UPDATE ${tableSql('posts')} SET "sourceFeedItemId" = NULL WHERE "workspaceId" = $1 AND "sourceFeedItemId" IS NOT NULL`,
    workspaceId,
  );
  const statements = [
    ...INDIRECT_WORKSPACE_TABLES.map(({ table, where }) => `DELETE FROM ${tableSql(table)} child WHERE ${where}`),
    `DELETE FROM ${tableSql('post_comments')} child USING ${tableSql('post_targets')} link WHERE child."postTargetId" = link."id" AND (link."postId" IN (SELECT "id" FROM ${tableSql('posts')} WHERE "workspaceId" = $1) OR link."targetId" IN (SELECT "id" FROM ${tableSql('targets')} WHERE "workspaceId" = $1))`,
    `DELETE FROM ${tableSql('conversation_messages')} child USING ${tableSql('conversations')} parent JOIN ${tableSql('targets')} owner ON owner."id" = parent."targetId" WHERE child."conversationId" = parent."id" AND owner."workspaceId" = $1`,
    `DELETE FROM ${tableSql('page_insights')} child USING ${tableSql('targets')} owner WHERE child."targetId" = owner."id" AND owner."workspaceId" = $1`,
    `DELETE FROM ${tableSql('ad_insights')} child USING ${tableSql('ad_accounts')} owner WHERE child."adAccountId" = owner."id" AND owner."workspaceId" = $1`,
    `DELETE FROM ${tableSql('instagram_insights')} child USING ${tableSql('instagram_accounts')} owner WHERE child."accountId" = owner."id" AND owner."workspaceId" = $1`,
    `DELETE FROM ${tableSql('post_targets')} child WHERE child."postId" IN (SELECT "id" FROM ${tableSql('posts')} WHERE "workspaceId" = $1) OR child."targetId" IN (SELECT "id" FROM ${tableSql('targets')} WHERE "workspaceId" = $1)`,
    `DELETE FROM ${tableSql('conversations')} child USING ${tableSql('targets')} owner WHERE child."targetId" = owner."id" AND owner."workspaceId" = $1`,
  ];
  for (const statement of statements) await tx.$executeRawUnsafe(statement, workspaceId);
}

function savedCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

/** Queue a resumable purge, erase database rows, then remove the two workspace storage trees. */
export async function deleteWorkspaceData(actor: DataControlActor, confirmation: string) {
  if (confirmation !== 'DELETE') throw new OperationError('invalid_request', 'Type DELETE to confirm this action.');
  validateWorkspaceId(actor.workspaceId);
  const timeout = await runtimeConfig('data.deleteTransactionTimeoutMs');
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
    const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
    if (!membership) throw new OperationError('forbidden', 'You are no longer a member of this workspace.');
    if (!MANAGER_ROLES.has(membership.role)) throw new OperationError('forbidden', 'Only workspace owners and admins can manage workspace data.');
    const workspace = await tx.workspace.findUnique({ where: { id: actor.workspaceId }, select: { id: true } });
    if (!workspace) throw new OperationError('unavailable', 'This workspace is unavailable.');
    const existing = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId } });
    if (existing?.status === 'requested' || existing?.status === 'db_deleted') return;
    await assertPublishingTargetsSettled(tx, actor.workspaceId);
    await assertInboxDeletionsSettled(tx, actor.workspaceId);
    const configuredRoot = await runtimeConfig('storage.mediaRoot');
    if (!configuredRoot) throw new Error('Set the media storage root in Root before deleting workspace data. No data was deleted.');
    const mediaRoot = await canonicalMediaRoot(configuredRoot);
    const values = { status: 'requested', requestedById: actor.userId, apiKeyId: actor.apiKeyId ?? null, mediaRoot, counts: undefined, error: null, requestedAt: new Date(), dbDeletedAt: null, completedAt: null };
    if (existing) await tx.workspaceDataPurge.update({ where: { workspaceId: actor.workspaceId }, data: values });
    else await tx.workspaceDataPurge.create({ data: { workspaceId: actor.workspaceId, ...values } });
  }, { timeout });

  return finishWorkspaceDataPurge(actor, timeout);
}

/** Resume an already-confirmed purge using the identity captured when it was requested. */
async function finishWorkspaceDataPurge(actor: DataControlActor, timeout: number) {
  const counts = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
    const job = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId } });
    if (!job) throw new Error('Workspace data purge state is missing.');
    await assertPublishingTargetsSettled(tx, actor.workspaceId);
    await assertInboxDeletionsSettled(tx, actor.workspaceId);
    if (job.status === 'db_deleted' || job.status === 'completed') return savedCounts(job.counts);
    if (job.status !== 'requested') throw new Error('Workspace data purge state is invalid.');
    const counts: Record<string, number> = {
      ...await collectWorkspaceDeletionCounts(tx, actor.workspaceId),
      ...await indirectWorkspaceCounts(tx, actor.workspaceId),
      ...await directWorkspaceCounts(tx, actor.workspaceId),
    };
    await deleteIndirectWorkspaceRows(tx, actor.workspaceId);
    for (const table of await workspaceTables(tx)) {
      await tx.$executeRawUnsafe(`DELETE FROM ${tableSql(table)} WHERE "workspaceId" = $1`, actor.workspaceId);
    }
    await tx.workspaceDataPurge.update({ where: { workspaceId: actor.workspaceId }, data: { status: 'db_deleted', counts, dbDeletedAt: new Date(), error: null } });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`data_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'workspace.data_deleted', ${JSON.stringify({ workspaceId: actor.workspaceId, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}), counts })}::jsonb, NOW())`;
    return counts;
  }, { timeout });

  const job = await prisma.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId }, select: { status: true, mediaRoot: true, counts: true } });
  if (!job) throw new Error('Workspace data purge state is missing.');
  if (job.status === 'completed') return savedCounts(job.counts);
  await canonicalMediaRoot(job.mediaRoot);
  let storage;
  try { storage = await removeWorkspaceStorage(job.mediaRoot, actor.workspaceId); }
  catch (error) {
    await prisma.workspaceDataPurge.update({ where: { workspaceId: actor.workspaceId }, data: { error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) } });
    throw error;
  }
  const result = { ...counts, storedFiles: storage.files, storedBytes: storage.bytes };
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
    const current = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId } });
    if (!current) throw new Error('Workspace data purge state is missing.');
    if (current.status === 'completed') return savedCounts(current.counts);
    await tx.workspaceDataPurge.update({ where: { workspaceId: actor.workspaceId }, data: { status: 'completed', counts: result, completedAt: new Date(), error: null } });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`data_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'workspace.storage_deleted', ${JSON.stringify({ workspaceId: actor.workspaceId, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}), files: storage.files, bytes: storage.bytes })}::jsonb, NOW())`;
    return result;
  }, { timeout });
}

/** Recover work requested before a crash; no new deletion is initiated here. */
export async function resumePendingWorkspaceDataPurges(): Promise<{ examined: number; completed: number; failed: number }> {
  const limit = await runtimeConfig('sync.maxItemsPerJob');
  const timeout = await runtimeConfig('data.deleteTransactionTimeoutMs');
  const jobs = await prisma.workspaceDataPurge.findMany({
    where: { status: { in: ['requested', 'db_deleted'] } },
    orderBy: [{ requestedAt: 'asc' }, { workspaceId: 'asc' }], take: limit,
    select: { workspaceId: true, requestedById: true, apiKeyId: true },
  });
  let completed = 0; let failed = 0;
  for (const job of jobs) {
    try {
      validateWorkspaceId(job.workspaceId);
      await finishWorkspaceDataPurge({ userId: job.requestedById, workspaceId: job.workspaceId, ...(job.apiKeyId ? { apiKeyId: job.apiKeyId } : {}) }, timeout);
      completed++;
    } catch (error) {
      failed++;
      await prisma.workspaceDataPurge.update({ where: { workspaceId: job.workspaceId }, data: { error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) } }).catch(() => undefined);
    }
  }
  return { examined: jobs.length, completed, failed };
}
