import { prisma } from '@/server/data';

type ActivityRow = {
  id: string;
  action: string;
  detail: unknown;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
};

const ACTIVITY_METADATA: Record<string, { label: string; format?: 'boolean' }> = {
  suspended: { label: 'workspace suspended', format: 'boolean' },
  postCount: { label: 'posts' }, targetCount: { label: 'destinations' },
  published: { label: 'published' }, failed: { label: 'failed' },
  needsReconciliation: { label: 'needs reconciliation' },
  conversationCount: { label: 'conversations' }, messageCount: { label: 'messages' },
  commentCount: { label: 'comments' }, failedCount: { label: 'failed' },
  channels: { label: 'channels' }, adAccounts: { label: 'ad accounts' },
  stillScheduled: { label: 'scheduled items' }, retained: { label: 'data retained', format: 'boolean' },
  remoteDeletionRequested: { label: 'remote deletion requested', format: 'boolean' },
  remoteDeletedCount: { label: 'remote items deleted' }, targetCountRequested: { label: 'destinations requested' },
};

export function rootActivityLimit(value: string | undefined, configuredLimit: number) {
  if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1) throw new Error('Invalid Root activity page size.');
  const parsed = value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  const requested = Number.isSafeInteger(parsed) ? parsed : configuredLimit;
  return Math.min(requested, configuredLimit);
}

export function sanitizeRootActivity(row: ActivityRow) {
  const detail = row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
    ? row.detail as Record<string, unknown> : {};
  const metadata = Object.entries(ACTIVITY_METADATA).flatMap(([key, config]) => {
    const value = detail[key];
    if (config.format === 'boolean' && typeof value === 'boolean') return [`${config.label}: ${value ? 'yes' : 'no'}`];
    if (typeof value === 'number' && Number.isFinite(value)) return [`${value} ${config.label}`];
    return [];
  });
  return {
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    actor: row.actorName ? { name: row.actorName, email: row.actorEmail ?? '' } : null,
    metadata,
  };
}

export async function getRootOverview() {
  const [users, workspaces, sources, failedPosts, publishedPosts] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.socialAccount.count(),
    prisma.post.count({ where: { status: { in: ['failed', 'partially_failed'] } } }),
    prisma.post.count({ where: { status: 'published' } }),
  ]);
  return { users, workspaces, sources, failedPosts, publishedPosts };
}

export async function listRootActivity(limitValue: string | undefined, configuredLimit: number) {
  const limit = rootActivityLimit(limitValue, configuredLimit);
  const rows = await prisma.$queryRaw<ActivityRow[]>`
    SELECT a.id, a.action, a.detail, a."createdAt", u.name AS "actorName", u.email AS "actorEmail"
    FROM root_activities AS a
    LEFT JOIN users AS u ON u.id = a."actorId"
    ORDER BY a."createdAt" DESC, a.id DESC
    LIMIT ${limit}
  `;
  return rows.map(sanitizeRootActivity);
}
